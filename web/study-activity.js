(function () {
  'use strict';

  const inactiveAfter = 30 * 86400000;
  const checkInterval = 12 * 60 * 60 * 1000;
  const idLimit = 256;

  function read(record) {
    return record?.version === 2 ? record : { version: 2 };
  }

  function hiddenReason(record) {
    const state = read(record);
    if (state.alwaysVisible) return '';
    if (state.manualHidden) return '手动隐藏';
    return state.autoHidden ? '超过 30 天未发现新通知或作业' : '';
  }

  function setVisibility(record, action, now) {
    const state = read(record);
    if (action === 'hide') return { ...state, manualHidden: true, alwaysVisible: false, hiddenAt: now };
    if (action === 'pin') return { ...state, manualHidden: false, autoHidden: false, alwaysVisible: true, hiddenAt: 0 };
    if (action === 'unpin') return { ...state, alwaysVisible: false };
    return { ...state, manualHidden: false, autoHidden: false, hiddenAt: 0 };
  }

  function observeSource(previous, section, kind, now) {
    const state = previous || { ids: [], observedAt: 0, publishedAt: 0, latest: 0 };
    if (!section || section.error || !Array.isArray(section.items)) return { state, reliable: false, updated: false };
    const ids = new Set(state.ids);
    const complete = section.complete === true;
    let reliable = complete;
    let saturated = !!state.saturated;
    let latest = state.latest;
    let publishedAt = state.publishedAt;
    for (const item of section.items) {
      if (item.kind !== kind) continue;
      const timestamp = item.publishedAt;
      if (timestamp > now || (!timestamp && item.startAt * 1000 > now)) {
        reliable = false;
        continue;
      }
      const dated = Number.isFinite(timestamp) && timestamp > 0 && timestamp <= now;
      const id = typeof item.id === 'string' && !!item.id ? item.id : null;
      if (dated) {
        publishedAt = Math.max(publishedAt, timestamp);
        latest = Math.max(latest, timestamp);
      }
      if (!id) {
        if (!dated) reliable = false;
        continue;
      }
      if (!complete || ids.has(id)) continue;
      if (ids.size >= idLimit) {
        saturated = true;
        if (!dated) reliable = false;
        continue;
      }
      ids.add(id);
      // Activity start times can identify older records but do not establish publication.
      const startedBeforeLastCheck = Number.isFinite(item.startAt) && item.startAt > 0
        && item.startAt * 1000 <= state.observedAt;
      if (!dated && !saturated && !startedBeforeLastCheck) latest = now;
    }
    return { state: { ids: Array.from(ids), saturated, publishedAt, latest,
      observedAt: reliable ? now : state.observedAt },
    reliable, updated: latest > state.latest };
  }

  function update(record, sections, deviceNow) {
    const previous = read(record);
    const sources = sections.filter(section => section.title === '活动' || section.title === '作业');
    const successful = sources.filter(section => !section.error && Array.isArray(section.items));
    const times = successful.map(section => section.serverTime)
      .filter(value => Number.isFinite(value) && value > 0);
    const now = times.length ? Math.max(...times) : deviceNow;
    const state = { ...previous, checkedAt: deviceNow };
    if (!successful.length || now < (previous.evidenceAt || 0) || (!times.length && previous.serverClock)) return state;
    const notices = observeSource(state.notices, sections.find(section => section.title === '活动'), 'notice', now);
    const homework = observeSource(state.homework, sections.find(section => section.title === '作业'), 'work', now);
    const reliable = notices.reliable && homework.reliable;
    const firstObservedAt = state.firstObservedAt || (reliable ? now : 0);
    const latest = Math.max(notices.state.latest, homework.state.latest);
    const activityAt = latest || firstObservedAt;
    const hasNewContent = [notices, homework].some(source => source.updated && now - source.state.latest <= inactiveAfter);
    let autoHidden = !!state.autoHidden;
    if (hasNewContent || state.alwaysVisible) autoHidden = false;
    else if (reliable && activityAt) autoHidden = now - activityAt > inactiveAfter;
    return { ...state, notices: notices.state, homework: homework.state, firstObservedAt,
      evidenceAt: now, serverClock: times.length > 0,
      lastSuccessfulCheckAt: reliable ? now : state.lastSuccessfulCheckAt,
      lastActivityAt: activityAt, reliable, autoHidden,
      hiddenAt: state.manualHidden || autoHidden ? state.hiddenAt || now : 0 };
  }

  function dueCourses(courses, updates, keyOf, now, force = false) {
    const checked = course => read(updates[keyOf(course)]).checkedAt || 0;
    return courses.filter(course => {
      const at = checked(course);
      return force || !at || now < at || now - at >= checkInterval;
    }).sort((a, b) => checked(a) - checked(b));
  }

  window.StudyActivity = { hiddenReason, setVisibility, update, dueCourses };
})();
