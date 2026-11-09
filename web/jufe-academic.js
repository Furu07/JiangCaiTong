/* JUFE adapter boundary. The bundled codecs read JCT exchange fixtures. */
(function () {
  'use strict';

  const schema = 'jct-timetable/1';

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

  function fromJson(content) {
    const data = JSON.parse(content);
    if (!data || data.schema !== schema || !data.term || !Array.isArray(data.courses)) {
      throw new AcademicError('format', '无法识别 JCT 课表交换数据');
    }
    const courses = [];
    for (const course of data.courses) {
      if (typeof course.id !== 'string' || !course.id.trim()
          || !Array.isArray(course.meetings) || !course.meetings.length) {
        throw new AcademicError('format', '课程标识或上课时段缺失');
      }
      for (const meeting of course.meetings) {
        courses.push({ ...meeting, courseId: course.id, name: course.name, teacher: meeting.teacher === undefined
          ? course.teacher : meeting.teacher });
      }
    }
    return { ...readTerm(data.term), courses, changes: data.changes };
  }

  function integer(value) {
    return /^\d+$/.test(value || '') ? Number(value) : NaN;
  }

  function cells(row) {
    const values = Object.create(null);
    for (const cell of Array.from(row.cells)) {
      const field = cell.dataset.field;
      if (field && Object.prototype.hasOwnProperty.call(values, field)) {
        throw new AcademicError('format', '课表样本含重复字段');
      }
      if (field) values[field] = cell.textContent.trim();
    }
    return values;
  }

  function fromHtml(content) {
    // Template contents stay inert. No nodes from the response are added to the live page.
    const template = document.createElement('template');
    template.innerHTML = content;
    const tables = template.content.querySelectorAll('table[data-schema="' + schema + '"]');
    if (tables.length !== 1) throw new AcademicError('format', '未找到唯一的 JCT 课表样本表格');
    const table = tables[0];
    const info = table.dataset;
    const term = readTerm({
      id: info.termId, label: info.term, firstMonday: info.firstMonday, totalWeeks: integer(info.totalWeeks),
      weekMondays: info.weekMondays ? info.weekMondays.split(',').map(value => value.trim()) : undefined
    });
    const meetings = Array.from(table.tBodies).filter(body => body.hasAttribute('data-meetings'));
    if (meetings.length !== 1) throw new AcademicError('format', '课表样本缺少唯一的时段区');
    const courses = Array.from(meetings[0].rows, row => {
      const value = cells(row);
      return {
        id: row.dataset.meetingId, courseId: row.dataset.courseId,
        name: value.name, teacher: value.teacher, location: value.location, campus: value.campus,
        building: value.building, day: integer(value.day), startPeriod: integer(value.startPeriod),
        endPeriod: integer(value.endPeriod), weekText: value.weekText, kind: value.kind, note: value.note
      };
    });
    const changes = [];
    for (const body of Array.from(table.tBodies).filter(entry => entry.hasAttribute('data-changes'))) {
      for (const row of Array.from(body.rows)) {
        const value = cells(row);
        const change = { meetingId: row.dataset.meetingId, week: integer(value.week), action: value.action, note: value.note };
        if (value.action === 'move') {
          const target = value.date === undefined ? { week: integer(value.targetWeek), day: integer(value.day) }
            : { date: value.date };
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

  function parseSchedule(response, parsers = fixtureParsers) {
    if (!response) throw new AcademicError('format', '未收到课表数据');
    const parser = Object.prototype.hasOwnProperty.call(parsers, response.format) && parsers[response.format];
    if (typeof parser !== 'function' || typeof response.content !== 'string') {
      throw new AcademicError('format', '课表响应格式未配置');
    }
    try {
      return Academic.normalizeSchedule(parser(response.content));
    } catch (error) {
      throw new AcademicError('format', '无法解析课表数据');
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
        // Transport errors may include URLs or identifiers. Do not expose them to the UI.
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
        const result = terms.map(Academic.normalizeTerm);
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
        return schedule;
      }
    };
  }

  const fixtureParsers = Object.freeze({ json: fromJson, html: fromHtml });
  window.JufeAcademicAdapter = { create: createAdapter, parseSchedule, fixtureParsers };
})();
