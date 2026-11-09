/* Independent JUFE schedule model and data-source contract. */
(function () {
  'use strict';

  /**
   * @typedef {{id:string, name:string, teacher:string, location:string,
   *   day:number, startPeriod:number, endPeriod:number, weeks:number[],
   *   weekText:string}} Course
   * @typedef {{term:string, firstMonday:string, totalWeeks:number,
   *   courses:Course[]}} Schedule
   * @interface JufeAcademicAdapter
   * @property {string} id Unique cache namespace for the source and account.
   * @property {string} label Display name of the source.
   * @property {function(): Promise<Schedule>} loadSchedule Read a normalized timetable.
   */

  const dayMs = 86400000;
  const cacheVersion = 1;

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

  function normalizeSchedule(raw) {
    const first = new Date(raw.firstMonday + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.firstMonday) || isNaN(first.getTime())
        || first.toISOString().slice(0, 10) !== raw.firstMonday || first.getUTCDay() !== 1
        || !Number.isInteger(raw.totalWeeks) || raw.totalWeeks < 1 || raw.totalWeeks > 60
        || typeof raw.term !== 'string' || !raw.term || !Array.isArray(raw.courses)) {
      throw new Error('课表学期信息无效');
    }
    const ids = new Set();
    const courses = raw.courses.map(course => {
      const { id, name, teacher, location, day, startPeriod, endPeriod, weekText } = course;
      if (![id, name, teacher, location, weekText].every(value => typeof value === 'string')
          || !id || !name || ids.has(id)
          || ![day, startPeriod, endPeriod].every(Number.isInteger)
          || day < 1 || day > 7 || startPeriod < 1 || startPeriod > endPeriod || endPeriod > 20) {
        throw new Error('课表课程信息无效');
      }
      ids.add(id);
      return {
        id, name, teacher, location, day, startPeriod, endPeriod, weekText,
        weeks: parseTeachingWeeks(weekText, raw.totalWeeks)
      };
    });
    return { term: raw.term, firstMonday: raw.firstMonday, totalWeeks: raw.totalWeeks, courses };
  }

  /** @type {JufeAcademicAdapter} */
  const mockAdapter = {
    id: 'mock',
    label: '模拟课表',
    async loadSchedule() {
      const courses = [
        ['econ', '微观经济学', '示例教师 A', '示例楼 201', 1, 1, 2, '1-18周'],
        ['stats', '应用统计学', '示例教师 B', '示例楼 302', 2, 3, 4, '1-17周(单)'],
        ['lab', '数据分析实验', '示例教师 C', '示例机房 01', 3, 5, 6, '2-18周(双)'],
        ['english', '大学英语', '示例教师 D', '示例楼 105', 4, 1, 2, '1-8,10-18周'],
        ['finance', '金融学', '示例教师 E', '示例楼 203', 5, 3, 4, '1-18周']
      ].map(([id, name, teacher, location, day, startPeriod, endPeriod, weekText]) =>
        ({ id, name, teacher, location, day, startPeriod, endPeriod, weekText }));
      return normalizeSchedule({
        term: '示例学期 2026–2027 秋', firstMonday: '2026-09-07', totalWeeks: 18, courses
      });
    }
  };

  function createRepository(adapter, storage) {
    const key = 'jct.academic.' + adapter.id;
    return {
      read() {
        try {
          const entry = JSON.parse(storage.getItem(key));
          if (entry && entry.version === cacheVersion && Number.isFinite(entry.syncedAt)) {
            return { schedule: normalizeSchedule(entry.schedule), syncedAt: entry.syncedAt, cached: true };
          }
        } catch (error) {
          // A malformed or unavailable cache can be replaced by the provider.
        }
        return null;
      },
      async sync() {
        const schedule = normalizeSchedule(await adapter.loadSchedule());
        const syncedAt = Date.now();
        let cached = true;
        try {
          storage.setItem(key, JSON.stringify({ version: cacheVersion, schedule, syncedAt }));
        } catch (error) {
          cached = false;
        }
        return { schedule, syncedAt, cached };
      }
    };
  }

  function coursesFor(schedule, week, day) {
    return schedule.courses.filter(course => course.day === day && course.weeks.includes(week))
      .sort((left, right) => left.startPeriod - right.startPeriod || left.endPeriod - right.endPeriod);
  }

  function dayDate(schedule, week, day) {
    return new Date(Date.parse(schedule.firstMonday + 'T00:00:00Z') + ((week - 1) * 7 + day - 1) * dayMs);
  }

  function currentWeek(schedule, now) {
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return 1 + Math.floor((today - dayDate(schedule, 1, 1).getTime()) / (7 * dayMs));
  }

  window.Academic = { parseTeachingWeeks, mockAdapter, createRepository, coursesFor, dayDate, currentWeek };
})();
