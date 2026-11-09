'use strict';

(async function () {
  const result = document.getElementById('result');
  const tests = [];
  function check(condition, title) {
    if (!condition) throw new Error(title);
    tests.push('PASS ' + title);
  }
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  async function expectFailure(operation, code) {
    try { await operation(); } catch (error) { return error.code === code; }
    return false;
  }
  async function fixture(extension) {
    const response = await fetch('fixtures/jct-timetable.synthetic.' + extension);
    if (!response.ok) throw new Error('无法读取本地样本');
    return { format: extension, content: await response.text() };
  }

  try {
    const json = await fixture('json');
    const html = await fixture('html');
    const schedule = JufeAcademicAdapter.parseSchedule(json);
    const parsedHtml = JufeAcademicAdapter.parseSchedule(html);
    check(same(schedule, parsedHtml), 'HTML 与 JSON 统一为同一课程模型');
    check(schedule.courses.filter(course => course.courseId === 'stats').length === 2,
      '同课多时段保留独立标识');
    check(same(schedule.courses[0].weeks, [1, 3, 5]) && same(schedule.courses[1].weeks, [2, 4, 6]),
      '单双周及离散教学周');
    check(same(Academic.teachingDay(schedule, '2026-09-28'), { week: 3, day: 1 })
      && Academic.teachingDay(schedule, '2026-09-21') === null
      && Academic.dayDate(schedule, 4, 3).toISOString().slice(0, 10) === '2026-10-07',
      '跳周学期的周次与日期双向映射');
    const original = Academic.coursesFor(schedule, 1, 2)[0];
    check(original.endPeriod - original.startPeriod === 2 && original.building === '教学楼 A'
      && schedule.courses[1].campus === '校区 B', '跨节次课程、校区和教学楼');
    const moved = Academic.coursesFor(schedule, 4, 3);
    check(Academic.coursesFor(schedule, 3, 2).length === 0 && moved.length === 2
      && moved[0].kind === 'moved' && moved[0].location === '301'
      && moved[0].note === '示例调课', '调课替换原时段并保留新地点和备注');
    check(moved.every(course => course.conflict), '同一节次冲突保留两门课并标记');
    check(Academic.coursesFor(schedule, 2, 5).length === 0
      && Academic.coursesFor(schedule, 4, 6)[0].kind === 'special', '停课与特殊安排');
    check(await expectFailure(() => JufeAcademicAdapter.parseSchedule({ format: 'html', content: '<form>登录</form>' }),
      'format'), '拒绝未标记的 HTML 登录页');
    const invalid = JSON.parse(json.content);
    invalid.changes[0].target.date = '2026-09-21';
    check(await expectFailure(() => JufeAcademicAdapter.parseSchedule({ format: 'json', content: JSON.stringify(invalid) }),
      'format'), '拒绝落入未排教学周的调课日期');

    const spring = JSON.parse(json.content);
    spring.term.id = 'fixture-spring';
    spring.term.label = '合成第二学期';
    spring.courses = [];
    spring.changes = [];
    const values = new Map();
    const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
    const legacy = await Academic.mockAdapter.loadSchedule('demo-autumn');
    delete legacy.termId;
    delete legacy.changes;
    storage.setItem('jct.academic.mock', JSON.stringify({ version: 1, schedule: legacy, syncedAt: 8 }));
    const demoRepo = Academic.createRepository(Academic.mockAdapter, storage);
    check(demoRepo.read('demo-autumn').syncedAt === 8 && demoRepo.read('demo-spring') === null,
      'P0B 示例缓存可读且不会串入其他学期');
    const first = schedule.termId;
    const second = spring.term.id;
    const handles = new Map([['scope-a', {}], ['scope-b', {}]]);
    let mode = 'normal';
    let finishPending;
    let readCount = 0;
    let clock = 100;
    const adapter = JufeAcademicAdapter.create({
      now: () => clock,
      transport: {
        async listTerms() { return [schedule, { ...schedule, termId: second, term: spring.term.label }]; },
        async loadSchedule(handle, termId) {
          if (handle !== handles.get('scope-a') && handle !== handles.get('scope-b')) throw Error('invalid handle');
          readCount++;
          if (mode === 'network') throw Error('offline');
          if (mode === 'expired') throw { status: 401 };
          if (mode === 'pending') return new Promise(resolve => { finishPending = resolve; });
          if (termId === second) return { format: 'json', content: JSON.stringify(spring) };
          return html;
        }
      }
    });
    const repo = Academic.createRepository(adapter, storage);
    check(adapter.status().state === 'unlinked' && await expectFailure(() => adapter.loadSchedule(first), 'auth'),
      '未授权时请求不执行');
    const authorize = (accountKey, expiresAt) => adapter.authorize({ accountKey, handle: handles.get(accountKey), expiresAt });
    authorize('scope-a');
    const terms = await adapter.listTerms();
    const firstCall = repo.sync(first);
    const sameCall = repo.sync(first);
    await firstCall;
    await repo.sync(second);
    check(terms.length === 2 && firstCall === sameCall && readCount === 2
      && repo.read(first).schedule.courses.length === 4 && repo.read(second).schedule.courses.length === 0,
      '学期列表、并发去重、学期缓存隔离');
    mode = 'network';
    const fallback = await repo.sync(first);
    check(fallback.status === 'fallback' && fallback.error.code === 'request'
      && same(fallback.schedule, schedule) && fallback.syncedAt === repo.read(first).syncedAt,
      '网络失败回退同账号同学期缓存并保留原同步时间');
    mode = 'expired';
    const expired = await repo.sync(first);
    check(expired.status === 'fallback' && expired.error.code === 'expired'
      && adapter.status().state === 'expired', '401 转为过期并保留本账号离线课表');
    authorize('scope-a', clock + 10);
    clock += 10;
    check(adapter.status().state === 'expired' && !!repo.read(first),
      '本地过期时间生效并保留本账号缓存');
    authorize('scope-b');
    check(repo.read(first) === null && repo.read(second) === null,
      '切换账号后不会读取旧账号缓存');
    mode = 'pending';
    const oldSync = repo.sync(first);
    await Promise.resolve();
    authorize('scope-a');
    finishPending(json);
    check(await expectFailure(() => oldSync, undefined) && same(repo.read(first).schedule, schedule),
      '账号切换丢弃上一会话的在途响应');
    adapter.signOut();
    check(adapter.status().state === 'unlinked' && repo.read(first) === null,
      '退出后无法显示缓存或继续同步');
    const unconfigured = JufeAcademicAdapter.create({});
    check(await expectFailure(() => unconfigured.loadSchedule(first), 'unconfigured'),
      '未配置正式传输时不访问猜测接口');

    result.textContent = tests.join('\n') + '\n' + tests.length + ' checks passed';
    result.dataset.status = 'pass';
  } catch (error) {
    result.textContent = tests.concat('FAIL ' + error.message).join('\n');
    result.dataset.status = 'fail';
  }
})();
