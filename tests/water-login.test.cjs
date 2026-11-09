const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '../web/water.js'), 'utf8');
const phone = '10000000000';
const otherPhone = '10000000001';
const sms = '001234';
const key = 'test-graphic-key';
const token = 'test-only-token';

async function main() {
  const calls = [];
  const cleared = [];
  let debug = true;
  let saveError = '';
  let reply = { status: 200, body: '{"code":0}', sessionPresent: true };
  let finishSend;
  const env = {
    performance,
    Android: {
      debugDiagnosticsEnabled: () => debug,
      clearWaterAttempt: id => cleared.push(id),
      saveWater: () => saveError
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

  await failed(water.login(phone, sms), 'session');
  assert.equal(calls.length, 0);
  reply = new Promise(resolve => { finishSend = resolve; });
  const sending = water.sendSms(phone, key, 'ABCD');
  await failed(water.sendSms(phone, key, 'ABCD'), 'session');
  finishSend({ status: 200, body: '{"code":0}', sessionPresent: true });
  await sending;
  await failed(water.login(otherPhone, sms), 'session');
  assert.equal(calls.length, 1);
  reply = { status: 200, body: JSON.stringify({ code: -1, msg: '验证码错误或失效 ' + token }), sessionSent: true };
  await failed(water.login(phone, sms), 'otp-rejected');
  const send = calls[0], submit = calls[1];
  assert.equal(send.attempt, submit.attempt);
  assert.equal(send.headers.ApplicationType, submit.headers.ApplicationType);
  assert.equal(send.headers.VersionCode, submit.headers.VersionCode);
  assert.deepEqual(send.body, { un: phone, authCode: 'ABCD', s: key });
  assert.deepEqual(submit.body, { un: phone, authCode: sms });
  const salt = /SALT_APP: '([^']+)'/.exec(source)[1];
  assert.equal(new URL(submit.url).searchParams.get('sign'),
    crypto.createHash('md5').update('authCode=' + sms + '&un=' + phone + salt).digest('hex'));
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
  reply = { status: 200, body: '{"code":-1,"msg":"短信验证码已过期"}' };
  await failed(water.login(phone, sms), 'otp-expired');
  assert(cleared.includes(send.attempt));
  await failed(water.login(phone, sms), 'session');

  reply = { status: 200, body: '{"code":0}' };
  await water.sendSms(phone, key, 'ABCD');
  reply = { status: 200, body: JSON.stringify({ code: 0, data: { token } }) };
  saveError = 'fixture storage error';
  await failed(water.login(phone, sms), 'storage');
  assert.equal(water.diagnostics().at(-1).kind, 'storage');
  const trace = JSON.stringify(water.diagnostics());
  for (const value of [phone, otherPhone, sms, token, key, salt]) assert(!trace.includes(value));
  debug = false;
  assert.equal(water.diagnostics().length, 0);
  console.log('PASS 798 attempt binding, wire parity, error classification, storage and debug redaction');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
