/* JUFE adapter boundary and timetable codecs. */
(function () {
  'use strict';

  const schema = 'jct-timetable/1';
  // The portal label and the published calendar are independent evidence.
  // https://jwc.jxufe.edu.cn/news-show-2056.html
  // https://jwc.jxufe.edu.cn/news-show-2054.html
  // https://jwc.jxufe.edu.cn/news-show-1974.html
  const portalTerms = new Map([
    ['2026-2027学年第一学期', {
      id: '261', label: '2026-2027学年第一学期', firstMonday: '2026-09-07', totalWeeks: 19
    }],
    ['2025-2026学年第二学期', {
      id: '252', label: '2025-2026学年第二学期', firstMonday: '2026-03-02', totalWeeks: 19
    }]
  ]);

  class AcademicError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  function readTerm(term) {
    return Academic.normalizeTerm({
      termId: term.id, term: term.label, firstMonday: term.firstMonday,
      totalWeeks: term.totalWeeks, weekMondays: term.weekMondays
    });
  }

  const placeFields = ['campus', 'building', 'location'];
  const slotFields = ['day', 'startPeriod', 'endPeriod', ...placeFields];
  const meetingFields = ['id', 'teacher', ...slotFields, 'weekText', 'kind', 'note'];
  const termFields = ['id', 'label', 'firstMonday', 'totalWeeks', 'weekMondays'];
  const changeFields = ['meetingId', 'week', 'action', 'note', 'target'];
  const targetFields = ['date', 'week', ...slotFields];

  function fields(value, allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some(key => !allowed.includes(key))) {
      throw new AcademicError('format', '课表样本含未定义字段');
    }
  }

  function fromJson(content) {
    const data = JSON.parse(content);
    fields(data, ['schema', 'term', 'courses', 'changes']);
    if (data.schema !== schema || !Array.isArray(data.courses)
        || (data.changes !== undefined && !Array.isArray(data.changes))) {
      throw new AcademicError('format', '无法识别 JCT 课表交换数据');
    }
    fields(data.term, termFields);
    const courses = [];
    for (const course of data.courses) {
      fields(course, ['id', 'courseCode', 'name', 'teacher', 'meetings']);
      if (typeof course.id !== 'string' || !course.id.trim()
          || !Array.isArray(course.meetings) || !course.meetings.length) {
        throw new AcademicError('format', '课程标识或上课时段缺失');
      }
      for (const meeting of course.meetings) {
        fields(meeting, meetingFields);
        courses.push({ ...meeting, courseId: course.id, courseCode: course.courseCode, name: course.name, teacher: meeting.teacher === undefined
          ? course.teacher : meeting.teacher });
      }
    }
    for (const change of data.changes || []) {
      fields(change, changeFields);
      if (change.target !== undefined) fields(change.target, targetFields);
    }
    return { ...readTerm(data.term), courses, changes: data.changes };
  }

  function integer(value) {
    return /^\d+$/.test(value || '') ? Number(value) : NaN;
  }

  function cells(row, allowed) {
    const values = Object.create(null);
    for (const cell of Array.from(row.cells)) {
      const field = cell.dataset.field;
      if (!allowed.includes(field) || Object.prototype.hasOwnProperty.call(values, field)) {
        throw new AcademicError('format', '课表样本含未知或重复的字段');
      }
      values[field] = cell.textContent.trim();
    }
    return values;
  }

  function fromHtml(content) {
    // Template contents stay inert. No nodes from the response are added to the live page.
    const template = document.createElement('template');
    template.innerHTML = content;
    const attributes = {
      TABLE: ['data-schema', 'data-term-id', 'data-term', 'data-first-monday', 'data-total-weeks', 'data-week-mondays'],
      TBODY: ['data-meetings', 'data-changes'],
      TR: ['data-course-id', 'data-meeting-id'],
      TD: ['data-field']
    };
    for (const element of template.content.querySelectorAll('*')) {
      const allowed = attributes[element.tagName];
      if (!allowed || Array.from(element.attributes).some(attr => !allowed.includes(attr.name))) {
        throw new AcademicError('format', 'HTML 样本应仅包含课表交换表格');
      }
    }
    const tables = template.content.querySelectorAll('table[data-schema="' + schema + '"]');
    if (tables.length !== 1 || template.content.children.length !== 1) throw new AcademicError('format', '未找到唯一的 JCT 课表样本表格');
    const table = tables[0];
    const info = table.dataset;
    const term = readTerm({
      id: info.termId, label: info.term, firstMonday: info.firstMonday, totalWeeks: integer(info.totalWeeks),
      weekMondays: info.weekMondays ? info.weekMondays.split(',').map(value => value.trim()) : undefined
    });
    const meetings = Array.from(table.tBodies).filter(body => body.hasAttribute('data-meetings'));
    if (meetings.length !== 1) throw new AcademicError('format', '课表样本缺少唯一的时段区');
    const courses = Array.from(meetings[0].rows, row => {
      const value = cells(row, ['name', 'courseCode', ...meetingFields]);
      return {
        id: row.dataset.meetingId, courseId: row.dataset.courseId,
        name: value.name, courseCode: value.courseCode, teacher: value.teacher, location: value.location, campus: value.campus,
        building: value.building, day: integer(value.day), startPeriod: integer(value.startPeriod),
        endPeriod: integer(value.endPeriod), weekText: value.weekText, kind: value.kind, note: value.note
      };
    });
    const changes = [];
    for (const body of Array.from(table.tBodies).filter(entry => entry.hasAttribute('data-changes'))) {
      for (const row of Array.from(body.rows)) {
        const value = cells(row, ['week', 'action', 'note', 'date', 'targetWeek', ...slotFields]);
        const change = { meetingId: row.dataset.meetingId, week: integer(value.week), action: value.action, note: value.note };
        if (value.action === 'move') {
          const target = value.date === undefined ? { week: integer(value.targetWeek), day: integer(value.day) }
            : { date: value.date };
          if (value.date !== undefined && (value.targetWeek !== undefined || value.day !== undefined)) {
            throw new AcademicError('format', '调课日期与教学周不能同时指定');
          }
          for (const key of ['startPeriod', 'endPeriod', 'campus', 'building', 'location']) {
            if (value[key] !== undefined) target[key] = key.endsWith('Period') ? integer(value[key]) : value[key];
          }
          change.target = target;
        }
        changes.push(change);
      }
    }
    return { ...term, courses, changes };
  }

  // Internal projection of the observed personal timetable grid. The school
  // page does not return this envelope. A reader must supply verified term
  // metadata and one entry per course block in its corresponding weekday.
  function fromPortalGrid(content) {
    const data = JSON.parse(content);
    fields(data, ['termLabel', 'blocks']);
    const term = portalTerms.get(data.termLabel);
    if (!term) throw new AcademicError('format', '个人课表所选学期暂无已核实的官方校历');
    if (!Array.isArray(data.blocks) || !data.blocks.length) {
      throw new AcademicError('format', '未取得已确认的个人课表课程块');
    }
    const weekdays = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
    const courses = data.blocks.map((block, index) => {
      fields(block, ['weekday', 'text']);
      const day = weekdays.indexOf(block.weekday) + 1;
      const lines = typeof block.text === 'string' ? block.text.split(/\r?\n/).map(line => line.trim()) : [];
      if (!day || lines.length !== 4 || lines.some(line => !line)) {
        throw new AcademicError('format', '个人课表课程块的星期或行结构无法识别');
      }
      const [name, teacher, time, place] = lines;
      const slot = /^([^\[\]]+)\[(\d{1,2})(?:-(\d{1,2}))?\]$/.exec(time);
      if (!slot) throw new AcademicError('format', '个人课表上课时间格式无法识别');
      const campus = /^(\S.*?)\s*[(（]([^()（）]+校区)[)）]$/.exec(place);
      return {
        id: 'jufe-grid-' + (index + 1), name, teacher, day,
        weekText: slot[1].trim(), startPeriod: Number(slot[2]), endPeriod: Number(slot[3] || slot[2]),
        location: campus ? campus[1].trim() : place, campus: campus ? campus[2].trim() : ''
      };
    });
    return { ...readTerm(term), courses };
  }

  function parseSchedule(response, parsers = fixtureParsers) {
    if (!response) throw new AcademicError('format', '未收到课表数据');
    const parser = Object.prototype.hasOwnProperty.call(parsers, response.format) && parsers[response.format];
    if (typeof parser !== 'function' || typeof response.content !== 'string') {
      throw new AcademicError('format', '课表响应格式未配置');
    }
    try {
      return Academic.normalizeSchedule(parser(response.content));
    } catch (error) {
      if (error instanceof AcademicError) throw error;
      throw new AcademicError('format', '无法解析课表数据，请检查字段、节次和教学周');
    }
  }

  /**
   * Transport owns the authorized read-only requests. Its session handle stays
   * in memory and is excluded from status and cache entries.
   */
  function createAdapter({ transport, parsers = fixtureParsers, now = Date.now }) {
    let session = { accountKey: '', revision: 0, state: 'unlinked' };
    const nextRevision = () => session.revision + 1;

    function status() {
      if (session.state === 'authorized' && now() >= session.expiresAt) expire();
      return { accountKey: session.accountKey, revision: session.revision, state: session.state };
    }

    function expire() {
      session = { accountKey: session.accountKey, revision: session.revision, state: 'expired' };
    }

    function authorize({ accountKey, handle, expiresAt = Infinity }) {
      if (typeof accountKey !== 'string' || !accountKey.trim() || handle == null
          || !(expiresAt > now())) throw new AcademicError('auth', '授权会话无效');
      session = { accountKey, handle, expiresAt, revision: nextRevision(), state: 'authorized' };
    }

    function signOut() {
      session = { accountKey: '', revision: nextRevision(), state: 'unlinked' };
    }

    function expiredError() {
      return new AcademicError('expired', '教务会话已过期，请在学校官方页面重新授权');
    }

    async function request(read) {
      if (!transport) throw new AcademicError('unconfigured', '待确认江财教务查询接口');
      const context = status();
      if (context.state === 'expired') throw expiredError();
      if (context.state !== 'authorized') throw new AcademicError('auth', '请先完成教务授权');
      let response;
      try {
        response = await read(session.handle);
      } catch (error) {
        const current = status();
        if (current.revision !== context.revision) throw new AcademicError('session-changed', '教务会话已切换');
        if (current.state === 'expired' || (error && (error.status === 401 || error.code === 'expired'))) {
          expire();
          throw expiredError();
        }
        // Transport errors may include URLs or identifiers. Only expose classified messages.
        const statusCode = error && error.status;
        if (statusCode === 403) throw new AcademicError('permission', '学校拒绝访问该课表');
        if (statusCode === 429) throw new AcademicError('limited', '教务查询暂受频率限制');
        if (statusCode >= 500 && statusCode < 600) throw new AcademicError('service', '教务服务暂不可用');
        throw new AcademicError('request', '无法读取教务数据，请稍后再试');
      }
      const current = status();
      if (current.revision !== context.revision) throw new AcademicError('session-changed', '教务会话已切换');
      if (current.state === 'expired') throw expiredError();
      return response;
    }

    return {
      id: 'jufe', label: '江财教务', authorize, status, signOut,
      async listTerms() {
        const terms = await request(handle => transport.listTerms(handle));
        if (!Array.isArray(terms)) throw new AcademicError('format', '无法读取学期列表');
        const result = terms.map(term => ({ ...Academic.normalizeTerm(term), current: term.current === true }));
        if (new Set(result.map(term => term.termId)).size !== result.length) {
          throw new AcademicError('format', '教务学期标识重复');
        }
        return result;
      },
      async loadSchedule(termId) {
        if (typeof termId !== 'string' || !termId.trim()) throw new AcademicError('format', '请选择有效学期');
        const response = await request(handle => transport.loadSchedule(handle, termId));
        const schedule = parseSchedule(response, parsers);
        if (schedule.termId !== termId) throw new AcademicError('format', '课表所属学期与所选学期不符');
        return { ...schedule, emptyConfirmed: response.emptyConfirmed === true };
      }
    };
  }

  const fixtureParsers = Object.freeze({ json: fromJson, html: fromHtml });
  const schoolParsers = Object.freeze({
    'jufe-html': null,
    'jufe-json': null,
    'jufe-portal-grid': fromPortalGrid
  });
  window.JufeAcademicAdapter = { create: createAdapter, parseSchedule, fixtureParsers, schoolParsers, schoolTransport: null };
})();
