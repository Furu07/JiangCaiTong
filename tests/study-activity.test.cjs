const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const activitySource = fs.readFileSync(require.resolve('../web/study-activity.js'), 'utf8');
const moduleContext = { window: {} };
vm.runInNewContext(activitySource, moduleContext);
const Activity = moduleContext.window.StudyActivity;
const { update, hiddenReason, setVisibility, dueCourses } = Activity;
const day = 86400000;
const now = Date.UTC(2026, 10, 11);
const notices = (...items) => ({ title: '活动', complete: true, items });
const work = (...items) => ({ title: '作业', complete: true, items });
const notice = (id, publishedAt) => ({ kind: 'notice', id, publishedAt });
const homework = (id, publishedAt) => ({ kind: 'work', id, publishedAt, endAt: (now + day) / 1000 });
const old = [notices(notice('n1', now - 31 * day)), work(homework('w1', now - 31 * day))];

test('uses the strict 30-day boundary and ignores deadlines, work status, and unrelated activities', () => {
  const a = update(null, [notices(notice('n1', now - 30 * day)), work()], now);
  assert.equal(hiddenReason(a), '');
  const b = update(null, old, now);
  assert.ok(hiddenReason(b));
  const repeated = update(b, [
    notices({ kind: 'sign', id: 'new-sign' }, notice('n1', now - 31 * day)),
    work({ ...old[1].items[0], status: '待批阅', endAt: (now + 2 * day) / 1000 })
  ], now + day);
  assert.equal(repeated.lastActivityAt, now - 31 * day);
  assert.ok(hiddenReason(repeated));
});

test('published notices and newly discovered stable homework IDs restore automatic hiding', () => {
  const hidden = update(null, old, now);
  assert.equal(hiddenReason(update(hidden, [notices(notice('n2', now + day)), { title: '作业', error: 'timeout' }],
    now + day)), '');
  const first = update(null, [notices(), work(homework('w1'))], now);
  const inactive = update(first, [notices(), work(homework('w1'))], now + 31 * day);
  assert.ok(hiddenReason(inactive));
  const restored = update(inactive, [notices(), work(homework('w2'), homework('w1'))], now + 32 * day);
  assert.equal(hiddenReason(restored), '');
  assert.equal(restored.lastActivityAt, now + 32 * day);
});

test('removed IDs, reordering and incomplete pages do not reset the observation time', () => {
  const a = update(null, [notices(), work(homework('w1'), homework('w2'))], now);
  const b = update(a, [notices(), work(homework('w2'))], now + 31 * day);
  const partial = update(b, [notices(), { ...work(homework('w3')), complete: false }], now + 32 * day);
  assert.ok(hiddenReason(partial));
  const again = update(partial, [notices(), work(homework('w2'), homework('w1'))], now + 33 * day);
  assert.equal(again.lastActivityAt, now);
  assert.ok(hiddenReason(again));
  assert.equal(hiddenReason(update(null, [notices(notice('n', now - 40 * day)), { ...work(), complete: false }], now)), '');
});

test('empty and unknown lists require reliable evidence, and server time handles device clock jumps', () => {
  const empty = update(null, [notices(), work()], now);
  assert.equal(empty.firstObservedAt, now);
  assert.equal(hiddenReason(update(empty, [notices(), { title: '作业', error: 'timeout' }], now + 31 * day)), '');
  assert.ok(hiddenReason(update(empty, [notices(), work()], now + 31 * day)));
  assert.equal(hiddenReason(update(null, [notices(notice('n', now - 40 * day)), work({ kind: 'work' })], now)), '');
  const trusted = update(empty, [{ ...notices(), serverTime: now + day }, work()], now + 40 * day);
  assert.equal(hiddenReason(trusted), '');
  const backward = update(trusted, [{ ...notices(), serverTime: now }, work()], now);
  assert.equal(backward.evidenceAt, trusted.evidenceAt);
});

test('manual hiding survives updates, while always-visible and restore are explicit choices', () => {
  const inactive = update(null, old, now);
  const pinned = setVisibility(inactive, 'pin', now);
  assert.equal(hiddenReason(update(pinned, old, now + day)), '');
  const manual = setVisibility(pinned, 'hide', now);
  const newer = update(manual, [notices(notice('n2', now + day)), work()], now + day);
  assert.equal(hiddenReason(newer), '手动隐藏');
  assert.equal(hiddenReason(setVisibility(newer, 'restore', now + day)), '');
});

test('hidden courses remain due after 12 hours and can be refreshed immediately', () => {
  const courses = [{ key: 'recent' }, { key: 'hidden' }];
  const records = { recent: update(null, old, now + day / 4), hidden: update(null, old, now) };
  assert.equal(dueCourses(courses, records, c => c.key, now + day / 2 - 1).length, 0);
  assert.equal(dueCourses(courses, records, c => c.key, now + day / 2)[0].key, 'hidden');
  assert.equal(dueCourses(courses, records, c => c.key, now + day / 4, true).length, 2);
});

const app = fs.readFileSync(require.resolve('../web/app.js'), 'utf8');
const studyCode = app.slice(app.indexOf('const studyKeyPrefix'), app.indexOf('let waterBusy'));
function studyContext(storage, session, readCourse) {
  const context = vm.createContext({
    StudyActivity: Activity, Learning: { readCourse }, window: { addEventListener() {} },
    document: { hidden: false, addEventListener() {} }, navigator: { onLine: true },
    native: { cxSessionKey: () => session.scope, cxAccountKey: () => session.account },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }
  });
  vm.runInContext(studyCode, context);
  return context;
}

test('cache migration and restart preserve course history and preferences for the matching account', () => {
  const storage = new Map([['jct.study.v2', JSON.stringify({
    scope: 'session-A', courses: [{ courseId: '1', classId: '2' }], details: { '1:2': { sections: old } },
    updates: { '1:2': { hidden: true, latest: now } }, at: now
  })]]);
  const session = { scope: 'session-A', account: 'A' };
  const first = studyContext(storage, session);
  assert.equal(vm.runInContext('studyCache.updates["1:2"]', first), undefined);
  vm.runInContext('studyCache.updates["1:2"] = StudyActivity.setVisibility(null, "pin", 1); saveStudyCache()', first);
  session.scope = 'new-session-A';
  const reopened = studyContext(storage, session);
  assert.equal(vm.runInContext('studyCache.updates["1:2"].alwaysVisible', reopened), true);
  assert.equal(vm.runInContext('studyCache.details["1:2"].sections.length', reopened), 2);
  session.scope = 'session-B';
  session.account = 'B';
  assert.equal(vm.runInContext('reconcileStudyCache(); studyCache.courses.length', reopened), 0);
  assert.equal(storage.has('jct.study.v3.A'), true);
});

test('a result from a previous account is discarded before it changes the new account cache', async () => {
  const session = { scope: 'session-A', account: 'A' };
  let resolve;
  const response = new Promise(done => { resolve = done; });
  const context = studyContext(new Map(), session, () => response);
  const scan = vm.runInContext('scanStudyUpdates([{courseId:"1",classId:"2"}], "session-A")', context);
  session.scope = 'session-B';
  session.account = 'B';
  vm.runInContext('reconcileStudyCache()', context);
  resolve(old);
  assert.equal(await scan, 0);
  assert.equal(vm.runInContext('Object.keys(studyCache.updates).length', context), 0);
});
