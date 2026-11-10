/* Contracts for normalized records. An official page reader must supply the source. */
(function () {
  'use strict';
  const freshFor = 6 * 60 * 60 * 1000;
  const states = new Set(['ready', 'empty', 'unpublished']);
  const errors = new Set(['expired', 'network', 'timeout', 'denied', 'format', 'term', 'busy', 'account-changed']);

  function invalid() { throw { code: 'format' }; }

  function text(value, required = false) {
    if (value == null && !required) return '';
    if (typeof value !== 'string' && !Number.isFinite(value)) invalid();
    const result = String(value).trim();
    if ((required && !result) || result.length > 240) invalid();
    return result;
  }

  function grade(row) {
    return { name: text(row.name, true), credits: text(row.credits), grade: text(row.grade),
      category: text(row.category), nature: text(row.nature), assessment: text(row.assessment),
      earnedCredits: text(row.earnedCredits), gpa: text(row.gpa), creditPoints: text(row.creditPoints), note: text(row.note) };
  }

  function exam(row) {
    const date = text(row.date);
    const start = text(row.start);
    const end = text(row.end);
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
        || new Date(date).toISOString().slice(0, 10) !== date)) invalid();
    if ([start, end].some(time => time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
        || (start && end && start >= end)) invalid();
    return { name: text(row.name, true), date, start, end, campus: text(row.campus),
      building: text(row.building), room: text(row.room), seat: text(row.seat),
      mode: text(row.mode), status: text(row.status), timeText: text(row.timeText) };
  }

  function create(normalize, source, now = Date.now) {
    const cache = new Map();
    const pending = new Map();
    let account = '';
    let generation = 0;
    return {
      available: !!source,
      async load(scope, term, force = false) {
        const bound = ['authorized', 'unverified'].includes(scope.state) ? scope.accountKey : '';
        if (bound !== account) {
          cache.clear();
          pending.clear();
          account = bound;
          generation++;
        }
        if (scope.state === 'reauthorize') return { state: 'expired' };
        if (!source) return { state: 'unavailable' };
        if (!account) return { state: 'needs-auth' };
        const previous = cache.get(term);
        if (!force && previous && now() - previous.at < freshFor) return previous;
        if (pending.has(term)) return pending.get(term);
        const requestGeneration = generation;
        const request = Promise.resolve().then(async () => {
          if (requestGeneration !== generation) return { state: 'account-changed' };
          try {
            const raw = await source(bound, term);
            if (requestGeneration !== generation || raw.accountKey !== bound) return { state: 'account-changed' };
            if (raw.termId !== term || !states.has(raw.state) || !Array.isArray(raw.rows)
                || (raw.state === 'ready') !== (raw.rows.length > 0)) invalid();
            const rows = raw.rows.map(normalize);
            const result = { state: raw.state, rows, at: now() };
            cache.set(term, result);
            return result;
          } catch (error) {
            if (requestGeneration !== generation) return { state: 'account-changed' };
            const state = errors.has(error?.code) ? error.code : 'format';
            if (state === 'expired' || state === 'account-changed') {
              cache.clear();
              pending.clear();
              generation++;
              return { state };
            }
            return { state, cached: previous };
          } finally {
            if (requestGeneration === generation) pending.delete(term);
          }
        });
        pending.set(term, request);
        return request;
      }
    };
  }

  const api = { grades: (source, now) => create(grade, source, now), exams: (source, now) => create(exam, source, now) };
  if (typeof module !== 'undefined') module.exports = api;
  else window.AcademicRecords = api;
}());
