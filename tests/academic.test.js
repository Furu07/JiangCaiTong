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
          if (typeof mode === 'number') throw { status: mode };
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
    const classifications = [[403, 'permission'], [429, 'limited'], [503, 'service']];
    const errors = [];
    for (const [status, expected] of classifications) {
      mode = status;
      const failed = await repo.sync(first);
      errors.push(failed.status === 'fallback' && failed.error.code === expected);
    }
    check(errors.every(Boolean) && adapter.status().state === 'authorized',
      '权限、限流及服务异常分别归类并保留当前授权');
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

    const imported = AcademicImport.createStore(storage);
    imported.save(AcademicImport.parse(json.content));
    check(imported.list().length === 1 && imported.read(first).schedule.courses.length === 4,
      '导入 JSON 并仅保存规范化课表');
    check(same(AcademicImport.parse(html.content), schedule), '导入 HTML 得到相同结构');
    const unsafe = JSON.parse(json.content);
    unsafe.courses[0].meetings[0].token = 'synthetic-secret';
    check(await expectFailure(() => AcademicImport.parse(JSON.stringify(unsafe)), 'format')
      && Array.from(values.values()).every(value => !value.includes('synthetic-secret')), '拒绝未定义的凭据字段');
    check(await expectFailure(() => AcademicImport.parse('<script>throw Error(1)</script>' + html.content),
      'format'), '拒绝样本中的脚本或其他非表格标签');
    check(await expectFailure(() => AcademicImport.parse('x'.repeat(262145)), undefined),
      '拒绝超出本地限制的文件内容');
    const restoredImport = AcademicImport.createStore(storage);
    check(same(restoredImport.read(first).schedule, schedule) && demoRepo.read(first) === null,
      '重开可恢复导入数据，且不会写入示例缓存');
    restoredImport.save(AcademicImport.parse(JSON.stringify(spring)));
    const replacement = JSON.parse(json.content);
    replacement.courses[0].name = '更新后的样本课程';
    restoredImport.save(AcademicImport.parse(JSON.stringify(replacement)));
    check(restoredImport.list().length === 2 && restoredImport.read(first).schedule.courses[0].name === '更新后的样本课程'
      && restoredImport.read(second).schedule.courses.length === 0, '同一导入学期更新且保留其他学期');
    const rawJson = '{"someSchoolShape":[{"slot":"redacted"}]}';
    const rawHtml = '<table><tr><td>脱敏时段</td></tr></table>';
    check(AcademicImport.inspectSchoolSample(rawJson).schedule === null
      && AcademicImport.inspectSchoolSample(rawHtml).summary.includes('1 个表格'),
      '学校原始 HTML/JSON 可读取结构，但未注册解析器时不生成课表');
    const rawRoutes = {
      'jufe-json': content => content === rawJson ? schedule : null,
      'jufe-html': content => content === rawHtml ? schedule : null
    };
    check(same(AcademicImport.inspectSchoolSample(rawJson, rawRoutes).schedule, schedule)
      && same(AcademicImport.inspectSchoolSample(rawHtml, rawRoutes).schedule, schedule),
      '测试注入的学校 HTML/JSON 解析槽各自路由并规范化');
    check(await expectFailure(() => AcademicImport.inspectSchoolSample(json.content), undefined)
      && await expectFailure(() => AcademicImport.inspectSchoolSample('{"log":{"entries":[]}}'), undefined)
      && await expectFailure(() => AcademicImport.inspectSchoolSample('<form><input type="password"></form>'), undefined),
      '原始样本模式拒绝 JCT、抓包和登录表单');
    const emptyReplacement = { ...schedule, courses: [], changes: [] };
    check(await expectFailure(() => restoredImport.save(emptyReplacement), 'empty-replacement')
      && restoredImport.read(first).schedule.courses[0].name === '更新后的样本课程',
      '未确认的空课表不可覆盖原数据');
    restoredImport.save(emptyReplacement, { replaceWithEmpty: true });
    check(restoredImport.read(first).schedule.courses.length === 0, '显式确认后可保存空课表');
    restoredImport.remove(first);
    check(restoredImport.read(first) === null && !!restoredImport.read(second), '只移除所选导入学期');

    const syncValues = new Map();
    const syncStorage = { getItem: key => syncValues.get(key) || null, setItem: (key, value) => syncValues.set(key, value) };
    let syncClock = 1000;
    let responses = 0;
    let modeSync = 'normal';
    const transport = {
      listTerms: async () => [{ ...schedule, current: true }, { ...schedule, termId: second, term: '另一个学期' }],
      async loadSchedule(handle, id) {
        responses++;
        if (modeSync === 'network') throw new Error('offline');
        if (modeSync === 'expired') throw { status: 401 };
        if (modeSync === 'empty') {
          const raw = JSON.parse(json.content);
          raw.courses = [];
          raw.changes = [];
          return { format: 'json', content: JSON.stringify(raw) };
        }
        return id === first ? json : { format: 'json', content: JSON.stringify(spring) };
      }
    };
    const candidate = { accountKey: 'test-owner', handle: {}, expiresAt: Infinity };
    const controller = JufeSync.create(JufeAcademicAdapter.create({ transport }), syncStorage, () => syncClock);
    check((await controller.bind(candidate)).status === 'fresh' && controller.snapshot().state === 'authorized'
      && controller.snapshot().selected === first && responses === 1, '首次授权自动查询并验证当前学期课表');
    await controller.resume();
    check(responses === 1, '启动或返回时未过期缓存不触发重复查询');
    const reopened = JufeSync.create(JufeAcademicAdapter.create({ transport }), syncStorage, () => syncClock);
    check(reopened.snapshot().state === 'reauthorize' && reopened.snapshot().entry.schedule.courses.length === 4,
      '重开先显示缓存，单凭缓存不建立授权');
    await reopened.restore(candidate);
    check(responses === 1 && reopened.snapshot().state === 'authorized', '恢复已验证会话时沿用新鲜课表');
    syncClock += 6 * 60 * 60 * 1000 + 1;
    const one = reopened.refresh(first);
    const two = reopened.refresh(first);
    await one;
    check(one === two && responses === 2, '过期缓存按需刷新且并发去重');
    syncClock += 31000;
    modeSync = 'empty';
    const emptySync = await reopened.refresh(first, true);
    check(emptySync.status === 'fallback' && emptySync.schedule.courses.length === 4, '自动同步拒绝未经确认的空响应覆盖');
    syncClock += 31000;
    modeSync = 'expired';
    const expiredSync = await reopened.refresh(first, true);
    check(expiredSync.status === 'fallback' && reopened.snapshot().state === 'reauthorize', '教务 401 保留原课表并提示重新认证');
    modeSync = 'normal';
    await reopened.restore(candidate);
    syncClock += 31000;
    await reopened.refresh(second, true);
    check(reopened.snapshot().selected === second && reopened.snapshot().entry.schedule.courses.length === 0,
      '学期切换选择独立的有效缓存');
    modeSync = 'network';
    await expectFailure(() => reopened.bind({ ...candidate, accountKey: 'another-owner' }), 'request');
    check(reopened.snapshot().state === 'reauthorize' && reopened.snapshot().selected === second,
      '新账号未验证成功时未替换旧账号绑定');

    result.textContent = tests.join('\n') + '\n' + tests.length + ' checks passed';
    result.dataset.status = 'pass';
  } catch (error) {
    result.textContent = tests.concat('FAIL ' + error.message).join('\n');
    result.dataset.status = 'fail';
  }
})();
