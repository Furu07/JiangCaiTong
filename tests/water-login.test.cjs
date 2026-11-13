const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = filename => fs.readFileSync(path.join(__dirname, '..', 'web', filename), 'utf8');
const phone = '10000000000';
const sms = '001234';
const salts = { SALT_APP: 'fixture-app-salt', SALT_MINI: 'fixture-score-salt' };

async function main() {
  let stored = JSON.stringify({ token: 'old-session', devices: [{ id: 'legacy' }] });
  let next = { code: 0 };
  const requests = [];
  const env = {
    Android: {
      req2(id, method, url, body, referer, headers, studyScope) {
        requests.push({ method, url: new URL(url), body, referer, headers: JSON.parse(headers), studyScope });
        env.__nativeDone(id, JSON.stringify({ status: 200, date: Date.now(), body: JSON.stringify(next) }));
      },
      loadWater: () => stored,
      saveWater: json => { stored = json; return ''; },
      clearWater: () => { stored = ''; }
    }
  };
  env.window = env;
  vm.runInNewContext(read('native.js'), env);
  let source = read('water.js');
  vm.runInNewContext(source, env);
  assert.equal(env.Water.configured(), false);
  for (const [key, value] of Object.entries(salts)) {
    source = source.replace('/* P7F:' + key + ' */ ""', JSON.stringify(value));
  }
  vm.runInNewContext(source, env);
  const water = env.Water;
  const api = (endpoint, body) => water.handle('/api/water/' + endpoint, body);
  assert.equal(water.configured(), true);
  assert.equal(water.state().devices[0].id, 'legacy');
  const captcha = await api('captcha');
  assert.equal(new URL(captcha.url).searchParams.get('s'), captcha.key);
  assert.equal((await api('sms', { phone, key: captcha.key, graph: 'ABCD' })).ok, true);
  assert.deepEqual(JSON.parse(requests.at(-1).body), { un: phone, authCode: 'ABCD', s: captcha.key });
  assert.equal(requests.at(-1).headers.VersionCode, '3.1.9');

  next = { code: -1, msg: '验签失败' };
  const rejected = await api('login', { phone, sms, kind: 'device' });
  assert.equal(rejected.kind, 'sign');
  assert.equal(rejected.code, -1);
  assert.equal(JSON.parse(stored).token, 'old-session');
  for (const [kind, channel, version, salt] of [
    ['device', '1,1', '3.1.9', salts.SALT_APP],
    ['score', '1,5', '2.0.83', salts.SALT_MINI]
  ]) {
    next = { code: 0, data: kind === 'device' ? { al: { token: kind, uid: 'fixture-id' } } : { token: kind, id: 'fixture-id' } };
    assert.equal((await api('login', { phone, sms, kind })).ok, true);
    const request = requests.at(-1);
    assert.equal(request.method, 'POST');
    assert.equal(request.url.pathname, '/api/v1/acc/login');
    assert.equal(request.body, JSON.stringify({ authCode: sms, un: phone }));
    assert.equal(request.url.searchParams.get('sign'),
      crypto.createHash('md5').update('authCode=' + sms + '&un=' + phone + salt).digest('hex'));
    assert.equal(request.headers['User-Agent'], 'Android_ilife798_3.1.9');
    assert.equal(request.headers.ApplicationType, channel);
    assert.equal(request.headers.VersionCode, version);
    assert.equal(request.headers.Authorization, undefined);
    assert.equal(request.studyScope, '');
  }
  assert.equal(JSON.parse(stored).device.token, 'device');
  assert.equal(JSON.parse(stored).score.token, 'score');
  next = { code: 0, data: { aw: { total: 7.25 }, favos: [{ id: 'dev1', name: 'Fixture' }] } };
  const home = await api('home');
  assert.equal(home.balance, 7.25);
  assert.equal(home.devices[0].id, 'dev1');
  assert.equal(requests.at(-1).headers.Authorization, 'device');
  next = { code: 0, data: { validScore: 1000, totalScore: 2000 } };
  assert.equal((await api('score')).valid, 1000);
  assert.equal(requests.at(-1).headers.VersionCode, '2.0.178');
  assert.equal(requests.at(-1).headers.Authorization, 'score');
  next = { code: 0, data: { records: [{ id: 'bill1', payment: 1.2 }], total: 1 } };
  assert.equal((await api('bills?page=0')).items[0].money, 1.2);
  next = { code: 0, data: { bill: { id: 'bill1', status: 3 } } };
  assert.equal((await api('exchange-bill?id=bill1')).done, true);
  next = { code: 0 };
  assert.equal((await api('start', { did: 'dev1' })).ok, true);
  assert.equal(requests.at(-1).url.pathname, '/api/v1/dev/start');
  assert.equal((await api('end', { did: 'dev1' })).ok, true);
  assert.equal(requests.at(-1).url.pathname, '/api/v1/dev/end');
  await api('logout', { kind: 'device' });
  assert.equal(water.state().accounts.device, null);
  assert.equal(JSON.parse(stored).score.token, 'score');
  await api('logout', { kind: 'score' });
  assert.equal(water.state().state, 'none');
  console.log('PASS: 0.52.0 798 dual-account request, persistence and service fixtures');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
