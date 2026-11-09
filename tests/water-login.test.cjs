const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '../web/water.js'), 'utf8');
const phone = '10000000000';
const otherPhone = '10000000001';
const sms = '001234';
const token = 'test-only-token';
const salt = 'fixture-app-salt';
const sign = (phone, sms) => crypto.createHash('md5').update('authCode=' + sms + '&un=' + phone + salt).digest('hex');

async function main() {
  const calls = [];
  const cleared = [];
  const saved = [];
  let debug = true;
  let configured = false;
  let saveError = '';
  let reply = { status: 200, body: '{"code":0}', sessionPresent: true };
  let finishSend;
  const env = {
    performance, crypto: crypto.webcrypto,
    Android: {
      debugDiagnosticsEnabled: () => debug,
      waterLoginConfigured: () => configured,
      signWaterLogin: sign,
      clearWaterAttempt: id => cleared.push(id),
      saveWater: json => {
        if (!saveError) saved.push(JSON.parse(json));
        return saveError;
      }
    },
    nativeRequest(method, url, body, referer, headers, scope, attempt) {
      calls.push({ method, url, body: JSON.parse(body), headers, scope, attempt });
      return reply;
    }
  };
  env.window = env;
  vm.runInNewContext(source, env);
  const water = env.Water;
  const failed = (promise, kind) => assert.rejects(promise, error => error.kind === kind);
  const captcha = water.captcha();
  const key = captcha.key;
  assert.match(key, /^[A-Za-z0-9]{10}$/);
  assert.equal(new URL(captcha.url).searchParams.get('s'), key);
  assert.notEqual(water.captcha().key, key);

  await failed(water.sendSms(phone, key, 'ABCD'), 'config');
  assert.equal(water.diagnostics().at(-1).signingConfigured, false);
  assert.equal(water.diagnostics().at(-1).http, null);
  await failed(water.login(phone, sms), 'config');
  assert.equal(calls.length, 0);
  configured = true;
  await failed(water.login(phone, sms), 'session');
  assert.equal(calls.length, 0);
  reply = new Promise(resolve => { finishSend = resolve; });
  const sending = water.sendSms(phone, key, 'ABCD');
  await failed(water.sendSms(phone, key, 'ABCD'), 'session');
  finishSend({ status: 200, body: '{"code":0}', sessionPresent: true });
  await sending;
  assert(water.canLogin(phone));
  await failed(water.login(otherPhone, sms), 'session');
  assert.equal(calls.length, 1);
  reply = { status: 200, body: JSON.stringify({ code: -1, msg: '验证码错误或失效 ' + token }), sessionSent: true };
  await failed(water.login(phone, sms), 'otp-rejected');
  const send = calls[0], submit = calls[1];
  assert.equal(send.attempt, submit.attempt);
  assert.equal(send.headers.ApplicationType, '1,1');
  assert.equal(submit.headers.ApplicationType, '1,1');
  assert.equal(send.headers.VersionCode, '3.1.10');
  assert.equal(submit.headers.VersionCode, '3.1.10');
  assert.equal(submit.headers['User-Agent'], 'Android_ilife798_3.1.10');
  assert(!('Authorization' in submit.headers));
  assert.deepEqual(send.body, { un: phone, authCode: 'ABCD', s: key });
  assert.deepEqual(submit.body, { un: phone, authCode: sms });
  assert.equal(new URL(submit.url).searchParams.get('sign'), sign(phone, sms));
  assert.equal(water.diagnostics().at(-1).code, -1);
  assert.equal(water.diagnostics().at(-1).cookieSent, true);

  reply = { status: 200, body: JSON.stringify({ code: -1, data: { token } }), setCookiePresent: false };
  await assert.rejects(water.login(phone, sms), error =>
    error.kind === 'deny' && /业务码 -1.*原因未能识别/.test(error.message));
  assert.equal(water.diagnostics().at(-1).messageField, null);
  assert.equal(water.diagnostics().at(-1).setCookiePresent, false);

  reply = { status: 200, body: '{"code":-1,"message":"短信验证码错误"}', setCookiePresent: true };
  await failed(water.login(phone, sms), 'otp-invalid');
  assert.equal(water.diagnostics().at(-1).messageField, 'message');
  assert.equal(water.diagnostics().at(-1).setCookiePresent, true);
  reply = { status: 400, body: '{"code":-2}' };
  await failed(water.login(phone, sms), 'params');
  reply = { status: 403, body: '{}' };
  await failed(water.login(phone, sms), 'deny');
  reply = { status: 403, body: '{"code":0,"data":{"al":{"token":"ignored"}}}' };
  await failed(water.login(phone, sms), 'deny');
  reply = { status: 403, body: '{"code":-1,"msg":"请升级最新版app"}' };
  await failed(water.login(phone, sms), 'client');
  reply = { status: 200, body: '{"code":-1,"msg":"请升级最新版app"}' };
  await failed(water.login(phone, sms), 'client');
  reply = { status: 200, body: '{"code":-1,"msg":"签名校验失败"}' };
  await failed(water.login(phone, sms), 'sign');
  reply = { status: 200, body: '{"code":-1,"msg":"短信验证码已过期"}' };
  await failed(water.login(phone, sms), 'otp-expired');
  assert(cleared.includes(send.attempt));
  await failed(water.login(phone, sms), 'session');

  const issueSms = async () => {
    reply = { status: 200, body: '{"code":"0"}' };
    await water.sendSms(phone, water.captcha().key, 'ABCD');
  };
  await issueSms();
  water.captcha();
  assert(!water.canLogin(phone));
  await failed(water.login(phone, sms), 'session');

  for (const data of [{ token }, { al: { token: 123 } }, { al: { token: '   ' } }]) {
    await issueSms();
    reply = { status: 200, body: JSON.stringify({ code: 0, data }) };
    await failed(water.login(phone, sms), 'data');
    assert.equal(water.diagnostics().at(-1).tokenPresent, false);
    assert.equal(saved.length, 0);
  }
  await issueSms();
  reply = { status: 200, body: JSON.stringify({ code: 0, data: { al: { token: 'first\nsecond' } } }) };
  await failed(water.login(phone, sms), 'data');
  assert.equal(saved.length, 0);
  await issueSms();
  const success = { status: 200, body: JSON.stringify({ code: 0, data: { al: { token } } }) };
  reply = success;
  saveError = 'fixture storage error';
  await failed(water.login(phone, sms), 'storage');
  assert.equal(water.diagnostics().at(-1).kind, 'storage');
  assert.equal(saved.length, 0);
  await issueSms();
  let finishLogin;
  reply = new Promise(resolve => { finishLogin = resolve; });
  const abandoned = water.login(phone, sms);
  water.clearLoginAttempt();
  finishLogin(success);
  await failed(abandoned, 'session');
  assert.equal(saved.length, 0);
  await issueSms();
  reply = success;
  saveError = '';
  await water.login(phone, sms);
  assert.deepEqual(saved, [{ token, devices: [], at: 0 }]);
  assert.equal(water.diagnostics().at(-1).accountEnvelope, true);
  assert.equal(water.diagnostics().at(-1).tokenPresent, true);
  const trace = JSON.stringify(water.diagnostics());
  for (const value of [phone, otherPhone, sms, token, key, salt]) assert(!trace.includes(value));
  debug = false;
  assert.equal(water.diagnostics().length, 0);
  console.log('PASS 798 attempt binding, wire parity, error classification, storage and debug redaction');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
