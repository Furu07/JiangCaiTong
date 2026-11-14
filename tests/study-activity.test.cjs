const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const activitySource = fs.readFileSync(require.resolve('../web/study-activity.js'), 'utf8');
const moduleContext = { window: {} };
vm.runInNewContext(activitySource, moduleContext);
const Activity = moduleContext.window.StudyActivity;
const { update, hiddenReason, setVisibility, needsFullCheck } = Activity;
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

test('hidden courses become eligible for a full check after 12 hours', () => {
  const records = { recent: update(null, old, now + day / 4), hidden: update(null, old, now) };
  assert.equal(needsFullCheck(records.hidden, now + day / 2 - 1), false);
  assert.equal(needsFullCheck(records.hidden, now + day / 2), true);
  assert.equal(needsFullCheck(records.recent, now + day / 2), false);
});

const app = fs.readFileSync(require.resolve('../web/app.js'), 'utf8');
const studyCode = app.slice(app.indexOf('const studyKeyPrefix'), app.indexOf('function openAccounts'));
function studyContext(storage, session, scan) {
  const context = vm.createContext({
    StudyActivity: Activity, Learning: { scan, restore: () => session.scope }, window: { addEventListener() {} },
    $: () => ({ textContent: '', hidden: true }),
    schoolSync: { snapshot: () => ({ terms: [] }) }, refreshSession() {},
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
  const context = studyContext(new Map(), session, async (_, options) => {
    options.capture({ courseId: '1', classId: '2' }, await response);
    return { at: 1, rest: {} };
  });
  const scan = vm.runInContext('queryStudy(null, true)', context);
  session.scope = 'session-B';
  session.account = 'B';
  vm.runInContext('reconcileStudyCache()', context);
  resolve(old);
  await scan;
  assert.equal(vm.runInContext('Object.keys(studyCache.updates).length', context), 0);
});

const learningSource = fs.readFileSync(require.resolve('../web/learning.js'), 'utf8');

function learningContext(response) {
  const window = { Android: { cxSessionKey: () => 'session-A', cxPersist: () => '' } };
  vm.runInNewContext(learningSource, { window, URL, setTimeout, nativeRequest: async () => response });
  return window.Learning;
}

test('HTTP 200 login-expired JSON is distinguished from other service failures', async () => {
  const response = { status: 200, body: '{"result":0,"status":false,"msg":"请重新登录"}' };
  const learning = learningContext(response);
  const options = { courses() {}, capture() {}, progress() {}, full: () => false, rest: {} };
  await assert.rejects(learning.scan('session-A', options), { kind: 'auth' });
  response.body = '{"result":0,"msg":"课程已归档"}';
  await assert.rejects(learning.scan('session-A', options), { kind: 'parse' });
});

test('partial refresh keeps the previous exam and assignment data without marking unseen rows as new', () => {
  const { mergeCourseResults, taskState, officialUrl } = learningContext();
  const first = mergeCourseResults(null, [
    { title: '作业', items: [{ id: 'w1', kind: 'work', state: 'done', status: '待批阅' }] },
    { title: '考试', items: [{ id: 'e1', kind: 'exam', state: 'closed' }] }
  ], 10).cache;
  assert.equal(taskState(first.sections[0].items[0], 0), 'done');
  assert.equal(taskState(first.sections[1].items[0], 0), 'closed');
  const failed = mergeCourseResults(first, [{ title: '作业', complete: false, items: [] }], 20).cache;
  assert.equal(failed.sections[0].items[0].id, 'w1');
  assert.equal(failed.sections[1].items[0].id, 'e1');
  const next = mergeCourseResults(first, [{ title: '作业', items: [
    { id: 'w1', kind: 'work' }, { id: 'w2', kind: 'work' }
  ] }], 30).cache;
  assert.equal(next.sections[0].items[0].newAt, undefined);
  assert.equal(next.sections[0].items[1].newAt, 30);
  assert.equal(officialUrl('https://chaoxing.com.evil.invalid/task'), '');
  assert.equal(officialUrl('https://mobilelearn.chaoxing.com/task'), 'https://mobilelearn.chaoxing.com/task');
});

test('auto scan uses the reference freshness window and class grouping preserves different teaching groups', () => {
  const { autoScan, groupByCourse } = learningContext();
  const visible = { linked: true, visible: true, lastAt: Date.now() - 31 * 60000, failedAt: 0 };
  assert.equal(autoScan(visible), true);
  assert.equal(autoScan({ ...visible, visible: false }), false);
  assert.equal(autoScan({ ...visible, failedAt: Date.now() }), false);
  assert.equal(groupByCourse([
    { course: '同名课', courseId: '1', classId: '2' },
    { course: '同名课', courseId: '1', classId: '3' }
  ]).length, 2);
});
