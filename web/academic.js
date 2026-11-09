/* Normalized timetable and the adapter-independent cache. */
(function () {
  'use strict';

  /**
   * @typedef {{termId:string, term:string, firstMonday:string, totalWeeks:number,
   *   weekMondays:string[]}} AcademicTerm
   * @typedef {{id:string, courseId:string, name:string, teacher:string,
   *   location:string, campus:string, building:string, day:number, startPeriod:number,
   *   endPeriod:number, weeks:number[], weekText:string, kind:string, note:string}} CourseMeeting
   */
  const dayMs = 86400000;
  const weekMs = 7 * dayMs;

  function parseTeachingWeeks(text, totalWeeks = 30) {
    if (!Number.isInteger(totalWeeks) || totalWeeks < 1 || totalWeeks > 60) {
      throw new Error('教学周总数无效');
    }
    const tokens = String(text).replace(/\s/g, '').replace(/[～~－—–至]/g, '-')
      .replace(/（/g, '(').replace(/）/g, ')')
      .replace(/\((单|双)周?\)/g, '$1').replace(/[第周]/g, '')
      .split(/[,，、;；]/);
    const weeks = new Set();
    for (const token of tokens) {
      const match = /^(\d+)(?:-(\d+))?([单双])?$/.exec(token);
      if (!match) throw new Error('无法识别教学周：' + token);
      const first = Number(match[1]);
      const last = match[2] ? Number(match[2]) : first;
      if (first < 1 || last > totalWeeks || first > last) throw new Error('教学周超出范围');
      for (let week = first; week <= last; week++) {
        if (!match[3] || week % 2 === (match[3] === '单' ? 1 : 0)) weeks.add(week);
      }
    }
    if (!weeks.size) throw new Error('教学周为空');
    return Array.from(weeks).sort((left, right) => left - right);
  }

  function dateValue(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return NaN;
    const date = new Date(iso + 'T00:00:00Z');
    return isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? NaN : date.getTime();
  }

  function normalizeTerm(raw) {
    const { termId, term, firstMonday, totalWeeks } = raw;
    const first = dateValue(firstMonday);
    if (typeof termId !== 'string' || !termId.trim() || typeof term !== 'string' || !term.trim()
        || !Number.isFinite(first) || new Date(first).getUTCDay() !== 1
        || !Number.isInteger(totalWeeks) || totalWeeks < 1 || totalWeeks > 60) {
      throw new Error('课表学期信息无效');
    }
    const weekMondays = raw.weekMondays === undefined
      ? Array.from({ length: totalWeeks }, (_, index) => new Date(first + index * weekMs).toISOString().slice(0, 10))
      : raw.weekMondays;
    if (!Array.isArray(weekMondays) || weekMondays.length !== totalWeeks
        || weekMondays[0] !== firstMonday || weekMondays.some((monday, index) => {
          const value = dateValue(monday);
          return !Number.isFinite(value) || new Date(value).getUTCDay() !== 1
            || (index > 0 && value <= dateValue(weekMondays[index - 1]));
        })) throw new Error('教学周映射无效');
    return { termId, term, firstMonday, totalWeeks, weekMondays: weekMondays.slice() };
  }

  function normalizeSlot(slot) {
    const { day, startPeriod, endPeriod } = slot;
    if (![day, startPeriod, endPeriod].every(Number.isInteger)
        || day < 1 || day > 7 || startPeriod < 1 || startPeriod > endPeriod || endPeriod > 20) {
      throw new Error('上课星期或节次无效');
    }
    return { day, startPeriod, endPeriod };
  }

  function optionalText(value) {
    if (value == null) return '';
    if (typeof value !== 'string') throw new Error('课表文本字段无效');
    return value.trim();
  }

  function locationOf(raw) {
    const { campus, building, location } = raw;
    return { campus: optionalText(campus), building: optionalText(building), location: optionalText(location) };
  }

  function dayDate(term, week, day) {
    return new Date(dateValue(term.weekMondays[week - 1]) + (day - 1) * dayMs);
  }

  function teachingDay(term, date) {
    const target = dateValue(date);
    for (let week = 1; week <= term.totalWeeks; week++) {
      const offset = (target - dayDate(term, week, 1).getTime()) / dayMs;
      if (offset >= 0 && offset < 7) return { week, day: offset + 1 };
    }
    return null;
  }

  function normalizeSchedule(raw) {
    const term = normalizeTerm(raw);
    if (!Array.isArray(raw.courses)) throw new Error('课程列表无效');
    const meetings = new Map();
    const courses = raw.courses.map(course => {
      const { id, name, weekText } = course;
      const courseId = course.courseId === undefined ? id : course.courseId;
      const kind = course.kind === undefined ? 'regular' : course.kind;
      if (![id, courseId, name, weekText].every(value => typeof value === 'string' && value.trim())
          || meetings.has(id) || !['regular', 'special'].includes(kind)) {
        throw new Error('课表课程或时段标识无效');
      }
      const meeting = {
        id, courseId, name: name.trim(), teacher: optionalText(course.teacher), ...locationOf(course),
        ...normalizeSlot(course), weekText, weeks: parseTeachingWeeks(weekText, term.totalWeeks),
        kind, note: optionalText(course.note)
      };
      meetings.set(id, meeting);
      return meeting;
    });
    const changed = new Set();
    const rawChanges = raw.changes === undefined ? [] : raw.changes;
    if (!Array.isArray(rawChanges)) throw new Error('调课列表无效');
    const changes = rawChanges.map(change => {
      const { meetingId, week, action } = change;
      const meeting = meetings.get(meetingId);
      const key = JSON.stringify([meetingId, week]);
      if (!meeting || !meeting.weeks.includes(week) || changed.has(key)
          || !['move', 'cancel'].includes(action)) throw new Error('调课来源无效或重复');
      changed.add(key);
      const note = optionalText(change.note);
      if (action === 'cancel') return { meetingId, week, action, note };
      const target = change.target;
      if (!target || (target.date !== undefined && (target.week !== undefined || target.day !== undefined))) {
        throw new Error('调课目标无效');
      }
      const mapped = target.date === undefined ? target : teachingDay(term, target.date);
      if (!mapped || !Number.isInteger(mapped.week) || mapped.week < 1 || mapped.week > term.totalWeeks) {
        throw new Error('调课目标超出教学周');
      }
      const slot = { ...meeting, ...target, day: mapped.day };
      return {
        meetingId, week, action, note,
        target: { week: mapped.week, ...normalizeSlot(slot), ...locationOf(slot) }
      };
    });
    return { ...term, courses, changes };
  }

  function coursesFor(schedule, week, day) {
    const suppressed = new Set(schedule.changes.filter(change => change.week === week).map(change => change.meetingId));
    const entries = schedule.courses.filter(course => course.day === day && course.weeks.includes(week)
      && !suppressed.has(course.id)).map(course => ({ ...course }));
    for (const change of schedule.changes) {
      if (change.action !== 'move' || change.target.week !== week || change.target.day !== day) continue;
      const source = schedule.courses.find(course => course.id === change.meetingId);
      entries.push({ ...source, ...change.target, weeks: [week], weekText: '第 ' + week + ' 周',
        kind: 'moved', note: change.note || source.note });
    }
    entries.sort((left, right) => left.startPeriod - right.startPeriod || left.endPeriod - right.endPeriod);
    return entries.map((course, index) => ({
      ...course,
      conflict: entries.some((other, otherIndex) => otherIndex !== index
        && other.startPeriod <= course.endPeriod && other.endPeriod >= course.startPeriod)
    }));
  }

  function currentWeek(term, now) {
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    let week = 0;
    while (week < term.totalWeeks && dayDate(term, week + 1, 1).getTime() <= today) week++;
    return week;
  }

  /**
   * @interface JufeAcademicAdapter
   * @property {string} id
   * @property {string} label
   * @property {function(): {accountKey:string, revision:number, state:string}} status
   * @property {function(): Promise<AcademicTerm[]>} listTerms
   * @property {function(string): Promise<object>} loadSchedule
   */
  function createRepository(adapter, storage) {
    const inflight = new Map();
    const keyFor = (accountKey, termId) => 'jct.academic.v2.' + JSON.stringify([adapter.id, accountKey, termId]);

    function readAt(key, termId) {
      try {
        const entry = JSON.parse(storage.getItem(key));
        if (entry && Number.isFinite(entry.syncedAt)) {
          const schedule = normalizeSchedule(entry.schedule);
          if (schedule.termId === termId) return { schedule, syncedAt: entry.syncedAt, cached: true, status: 'cached' };
        }
      } catch (error) {
        // Ignore corrupt or unavailable cache entries.
      }
      return null;
    }

    function read(termId) {
      const { accountKey } = adapter.status();
      if (!accountKey) return null;
      const cached = readAt(keyFor(accountKey, termId), termId);
      if (cached || adapter !== mockAdapter || termId !== 'demo-autumn') return cached;
      try {
        const legacy = JSON.parse(storage.getItem('jct.academic.mock'));
        if (legacy && legacy.version === 1 && Number.isFinite(legacy.syncedAt)
            && legacy.schedule.term === demoTerms[0].term) {
          const schedule = normalizeSchedule({ ...legacy.schedule, termId });
          return { schedule, syncedAt: legacy.syncedAt, cached: true, status: 'cached' };
        }
      } catch (error) {
        // Old entries use the same schedule shape except for the term identifier.
      }
      return null;
    }

    function sync(termId) {
      const context = adapter.status();
      if (!context.accountKey) return Promise.reject(new Error('请先完成教务授权'));
      const key = keyFor(context.accountKey, termId);
      const requestKey = JSON.stringify([key, context.revision]);
      if (inflight.has(requestKey)) return inflight.get(requestKey);
      const sameContext = () => {
        const current = adapter.status();
        return current.accountKey === context.accountKey && current.revision === context.revision;
      };
      const request = Promise.resolve().then(async () => {
        try {
          if (!sameContext()) throw new Error('教务会话已切换');
          const schedule = normalizeSchedule(await adapter.loadSchedule(termId));
          if (schedule.termId !== termId) throw new Error('返回课表的学期与所选学期不符');
          if (!sameContext()) throw new Error('教务会话已切换');
          if (adapter.status().state === 'expired') throw new Error('教务会话已过期');
          const entry = { schedule, syncedAt: Date.now(), cached: true, status: 'fresh' };
          try {
            storage.setItem(key, JSON.stringify({ schedule, syncedAt: entry.syncedAt }));
          } catch (error) {
            entry.cached = false;
          }
          return entry;
        } catch (error) {
          if (!sameContext()) throw new Error('教务会话已切换');
          const fallback = read(termId);
          if (!fallback) throw error;
          return { ...fallback, status: 'fallback', error };
        }
      }).finally(() => inflight.delete(requestKey));
      inflight.set(requestKey, request);
      return request;
    }

    return { read, sync };
  }

  const demoTerms = [
    { termId: 'demo-autumn', term: '示例学期 2026–2027 秋', firstMonday: '2026-09-07', totalWeeks: 18 },
    { termId: 'demo-spring', term: '示例学期 2025–2026 春', firstMonday: '2026-03-02', totalWeeks: 18 }
  ];

  /** @type {JufeAcademicAdapter} */
  const mockAdapter = {
    id: 'mock',
    label: '模拟课表',
    status: () => ({ accountKey: 'demo', revision: 0, state: 'offline' }),
    async listTerms() { return demoTerms.map(normalizeTerm); },
    async loadSchedule(termId) {
      const term = demoTerms.find(entry => entry.termId === termId);
      if (!term) throw new Error('未知示例学期');
      const spring = termId === 'demo-spring';
      const rows = spring ? [
        ['acct', '基础会计学', '示例教师 F', '示例楼 101', 2, 1, 2, '1-18周']
      ] : [
        ['econ', '微观经济学', '示例教师 A', '示例楼 201', 1, 1, 2, '1-18周'],
        ['stats', '应用统计学', '示例教师 B', '示例楼 302', 2, 3, 4, '1-17周(单)'],
        ['lab', '数据分析实验', '示例教师 C', '示例机房 01', 3, 5, 6, '2-18周(双)'],
        ['english', '大学英语', '示例教师 D', '示例楼 105', 4, 1, 2, '1-8,10-18周'],
        ['finance', '金融学', '示例教师 E', '示例楼 203', 5, 3, 4, '1-18周']
      ];
      const courses = rows.map(([id, name, teacher, location, day, startPeriod, endPeriod, weekText]) =>
        ({ id, name, teacher, location, day, startPeriod, endPeriod, weekText }));
      const changes = spring ? [] : [
        { meetingId: 'finance', week: 10, action: 'move', target: { week: 10, day: 3, startPeriod: 6, endPeriod: 7 },
          note: '示例调课' }
      ];
      return { ...term, courses, changes };
    }
  };

  window.Academic = { parseTeachingWeeks, normalizeTerm, normalizeSchedule, mockAdapter,
    createRepository, coursesFor, dayDate, teachingDay, currentWeek };
})();
