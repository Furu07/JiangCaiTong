const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({});
context.window = context;
for (const file of ['academic.js', 'jufe-academic.js', 'jufe-sync.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../web', file), 'utf8'), context);
}

const { JufeAcademicAdapter, JufeSync } = context;
const term = { termId: 'fixture', term: '测试学期', firstMonday: '2026-09-07', totalWeeks: 19, current: true };
const values = new Map();
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key) };
let online = true;
let now = 0;
let reads = 0;
let expired = false;
const candidate = name => ({ accountKey: name, handle: { name } });
const transport = {
  async listTerms() { return [term]; },
  async loadSchedule({ name }) {
    reads++;
    if (expired) throw { status: 401 };
    if (!online) throw Error('fixture offline');
    const content = {
      schema: 'jct-timetable/1',
      term: { id: term.termId, label: term.term, firstMonday: term.firstMonday, totalWeeks: term.totalWeeks },
      courses: [{ id: 'course', name, meetings: [{ id: 'meeting', day: 1, startPeriod: 1, endPeriod: 2, weekText: '1' }] }]
    };
    return { format: 'json', content: JSON.stringify(content) };
  }
};
const reopen = () => JufeSync.create(JufeAcademicAdapter.create({ transport }), storage, () => now);
const displayed = controller => controller.snapshot().entry?.schedule.courses[0].name;

async function main() {
  const a = candidate('fixture-owner-a');
  const b = candidate('fixture-owner-b');
  let controller = reopen();
  assert.equal((await controller.bind(a)).status, 'fresh');
  assert.equal(displayed(controller), a.accountKey);
  controller = reopen();
  assert.equal(displayed(controller), a.accountKey);
  await controller.restore(a);
  assert.equal(reads, 1);

  now += 6 * 60 * 60 * 1000 + 1;
  controller = reopen();
  assert.equal((await controller.restore(a)).status, 'fresh');
  assert.equal(reads, 2);
  const lastSyncTime = controller.snapshot().entry.syncedAt;
  assert.equal(lastSyncTime, now);

  now += 6 * 60 * 60 * 1000 + 1;
  controller = reopen();
  online = false;
  const fallback = await controller.restore(a);
  assert.equal(fallback.status, 'fallback');
  assert.equal(fallback.syncedAt, lastSyncTime);
  assert.equal(displayed(controller), a.accountKey);
  await assert.rejects(controller.bind(b), error => error.code === 'request');
  assert.equal(controller.snapshot().state, 'unbound');
  assert.equal(displayed(controller), undefined);
  controller = reopen();
  assert.equal(displayed(controller), undefined);
  await assert.rejects(controller.restore(b), error => error.code === 'request');
  assert.equal(displayed(controller), undefined);

  online = true;
  assert.equal((await controller.restore(b)).status, 'fresh');
  assert.equal(displayed(reopen()), b.accountKey);
  assert(values.has('jct.academic.v2.' + JSON.stringify(['jufe', a.accountKey, term.termId])));
  assert(values.has('jct.academic.v2.' + JSON.stringify(['jufe', b.accountKey, term.termId])));
  assert.equal((await controller.bind(a)).status, 'fresh');
  assert.equal(displayed(reopen()), a.accountKey);
  assert.equal(controller.protectAccount(b.accountKey), true);
  assert.equal(displayed(reopen()), undefined);
  assert.equal((await controller.restore(a)).status, 'fresh');
  assert.equal(displayed(reopen()), a.accountKey);
  now += 31000;
  expired = true;
  assert.equal((await controller.refresh(term.termId, true)).status, 'fallback');
  assert.equal(controller.snapshot().state, 'reauthorize');
  controller = reopen();
  assert.equal(displayed(controller), a.accountKey);
  assert.equal(controller.needsRefresh(), false);
  const before = reads;
  await assert.rejects(controller.restore(a), /主动重新绑定/);
  await controller.resume();
  assert.equal(reads, before);
  expired = false;
  assert.equal((await controller.bind(a)).status, 'fresh');
  assert.equal(controller.snapshot().state, 'authorized');
  controller.disconnect();
  assert.equal(controller.snapshot().state, 'unbound');
  assert.equal(reopen().snapshot().accountKey, '');
  assert(values.has('jct.academic.v2.' + JSON.stringify(['jufe', a.accountKey, term.termId])));
  console.log('PASS JUFE refresh, offline fallback, isolation, and expired-session gate');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
