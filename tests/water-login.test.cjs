const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../web/water.js'), 'utf8');
const bridge = fs.readFileSync(path.join(__dirname, '../web/native.js'), 'utf8');
const phone = '10000000000';
const sms = '001234';
const salt = 'fixture-app-salt';
const token = 'test-only-token';

async function main() {
  const calls = [];
  let stored = JSON.stringify({ token: 'old-session', devices: [{ id: 'old-device' }], at: 1 });
  let saveError = '';
  let response = { status: 200, body: '{"code":0}' };
  const env = {
    Android: {
      req2(id, method, url, body, referer, headers, studyScope) {
        calls.push({ method, url: new URL(url), body, referer, headers: JSON.parse(headers), studyScope });
        env.__nativeDone(id, JSON.stringify(response));
      },
      loadWater: () => stored,
      clearWater: () => { stored = ''; },
      saveWater(json) {
        if (!saveError) stored = json;
        return saveError;
      }
    }
  };
  env.window = env;
  vm.runInNewContext(bridge, env);
  vm.runInNewContext(source, env);
  assert.equal(env.Water.loginConfigured(), false);
  vm.runInNewContext(source.replace('/* local authorized build */ ""', JSON.stringify(salt)), env);
  const water = env.Water;
  assert.equal(water.loginConfigured(), true);
  assert.equal(water.state().devices[0].id, 'old-device');

  const key = water.captchaKey();
  assert.match(key, /^[A-Za-z0-9]{10}$/);
  assert.equal(new URL(water.captchaUrl(key)).searchParams.get('s'), key);
  await water.sendSms(phone, key, 'ABCD');
  response.body = '{"code":-1,"msg":"service rejected"}';
  await assert.rejects(water.login(phone, sms), { code: -1, kind: 'biz', message: 'service rejected' });
  assert.equal(JSON.parse(stored).token, 'old-session');
  const [send, submit] = calls;
  assert.equal(send.method, 'POST');
  assert.equal(send.url.pathname, '/api/v1/acc/login/code');
  assert.equal(send.body, JSON.stringify({ un: phone, authCode: 'ABCD', s: key }));
  assert.equal(submit.method, 'POST');
  assert.equal(submit.url.pathname, '/api/v1/acc/login');
  assert.equal(submit.body, JSON.stringify({ authCode: sms, un: phone }));
  const signature = crypto.createHash('md5').update('authCode=' + sms + '&un=' + phone + salt).digest('hex');
  assert.equal(submit.url.searchParams.get('sign'), signature);
  for (const call of [send, submit]) {
    assert.equal(call.studyScope, '');
    assert.equal(call.headers.ApplicationType, '1,1');
    assert.equal(call.headers.VersionCode, '3.1.10');
    assert.equal(call.headers['User-Agent'], 'Android_ilife798_3.1.10');
    assert.equal(call.headers['Accept-Language'], 'zh-Hans-CN;q=1');
    assert.equal(call.headers.Authorization, undefined);
  }
  response.body = JSON.stringify({ code: 0, data: { al: { token, uid: 'test-uid' } } });
  saveError = 'fail';
  await assert.rejects(water.login(phone, sms), { kind: 'data' });
  assert.equal(JSON.parse(stored).token, 'old-session');
  saveError = '';
  await water.login(phone, sms);
  assert.equal(JSON.parse(stored).device.token, token);
  assert.equal(water.state().devices.length, 0);
  response.body = JSON.stringify({ code: 0, data: { token, id: 'test-uid' } });
  await water.login(phone, sms);
  assert.equal(water.state().accounts.device.uid, 'test-uid');

  response.body = '{"code":0,"data":{"id":"test-uid"}}';
  assert.equal((await water.account()).id, 'test-uid');
  assert.equal(calls.at(-1).headers.Authorization, token);
  response.body = '{"code":0,"data":{"aw":{"total":"7.25"}}}';
  assert.equal(await water.balance(), 7.25);
  response.body = '{"code":0,"data":{"favos":[{"id":"dev1","name":"Fixture"}]}}';
  assert.equal((await water.devices())[0].id, 'dev1');
  response.body = '{"code":0,"data":{"records":[{"id":"bill1","did":"dev1","payment":"1.2","ctime":1700000000}],"total":1}}';
  const page = await water.bills(0, 20);
  assert.equal(page.items[0].money, 1.2);
  assert.equal(page.items[0].at, 1700000000000);
  assert.equal(page.more, false);
  response.body = '{"code":0,"data":{"bill":{"id":"bill1","status":3,"payment":"1.2"}}}';
  assert.equal((await water.billDetail('bill1')).settled, true);
  response.body = '{"code":0}';
  await water.start('dev1');
  assert.equal(calls.at(-1).url.pathname, '/api/v1/dev/start');
  assert.equal(calls.at(-1).url.search, '?did=dev1&upgrade=true&ptype=91&rcp=false');
  await water.end('dev1');
  assert.equal(calls.at(-1).url.pathname, '/api/v1/dev/end');
  assert.equal(calls.at(-1).url.search, '?did=dev1&rcp=false');
  response.body = 'null';
  await assert.rejects(water.end('dev1'), { kind: 'data' });
  water.rememberUse({ did: 'dev1', phase: 'starting' });
  vm.runInNewContext(source, env);
  assert.equal(env.Water.live().did, 'dev1');
  response.body = '{"code":-99}';
  await assert.rejects(water.balance(), { kind: 'auth' });
  water.logout();
  assert.equal(water.state().state, 'none');
  console.log('PASS: upstream 798 bridge, login, session, read-only queries, and device request fixtures');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
