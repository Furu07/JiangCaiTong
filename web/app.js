'use strict';

const APP_VERSION = '0.8.0';
const $ = id => document.getElementById(id);
const tabs = Array.from(document.querySelectorAll('[data-tab]'));
const native = window.Android;
const zhuli = Zhuli.create(native);
const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function empty(element) {
  element.textContent = '';
}

function time(at) {
  return new Date(at).toLocaleString('zh-CN', { hour12: false });
}

function select(tab) {
  tabs.forEach(button => {
    const active = button.dataset.tab === tab;
    $('page-' + button.dataset.tab).hidden = !active;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  refreshSession();
  if (tab === 'study') scheduleStudyUpdates();
}

let toastTimer;
function toast(message) {
  const element = $('toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, 3000);
}

let previousFocus;
function setOverlay(mask, open) {
  mask.hidden = !open;
  const modalOpen = Array.from(document.querySelectorAll('.sheet-mask')).some(item => !item.hidden);
  document.querySelectorAll('.page, .tabbar').forEach(item => { item.inert = modalOpen; });
}

function showDetails(title, lines) {
  previousFocus = document.activeElement;
  $('detailTitle').textContent = title;
  empty($('detailBody'));
  lines.forEach(line => $('detailBody').appendChild(node('p', line)));
  setOverlay($('sheetMask'), true);
  $('sheetClose').focus();
}

function closeCourseDetails() {
  if ($('sheetMask').hidden) return false;
  setOverlay($('sheetMask'), false);
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  return true;
}
window.closeDetails = () => window.closeTodoEditor?.() || closeCourseDetails();
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && window.closeDetails()) event.preventDefault();
});

let portalPending = null;
let recordPending = null;
let nextRecordRequest = 0;
let schoolReads = Promise.resolve();
let schoolAuthorizing = false;
let schoolVerificationFailed = false;
const schoolTransport = native && native.supportsAcademicSync && native.supportsAcademicSync() ? {
  async listTerms(handle) { return handle.terms; },
  async loadSchedule(handle, termId) {
    const result = handle.pending && handle.pending.schedule.termId === termId
      ? handle.pending : await requestSchoolPortal(termId, false);
    handle.pending = null;
    if (result.accountKey !== handle.accountKey) throw { code: 'account-changed' };
    return result.response;
  }
} : null;
const schoolSync = JufeSync.create(JufeAcademicAdapter.create({
  transport: schoolTransport, parsers: JufeAcademicAdapter.schoolParsers
}), window.localStorage);
const schoolPrefix = 'jufe/';
const scheduleRepo = Academic.createRepository(Academic.mockAdapter, window.localStorage);
const importedSchedules = AcademicImport.createStore(window.localStorage);
const importedPrefix = 'import/';
const recordSource = schoolTransport && typeof native.openAcademicRecords === 'function'
  ? kind => (account, term) => requestRecordPortal(kind, account, term) : () => undefined;
const recordAdapters = { grades: AcademicRecords.grades(recordSource('grades')),
  exams: AcademicRecords.exams(recordSource('exams')) };
const gradeTerms = AcademicRecords.gradeTerms(recordSource('grade-terms'));
const recordTerms = {};
const recordViews = {};
let academicPanel = 'timetable';
let recordRender = 0;
let demoTerms = [];
let snapshot = null;
let week = 1;
let day = (new Date().getDay() + 6) % 7 + 1;
let daily = false;

function periodLabel(course) {
  return '第 ' + course.startPeriod + (course.endPeriod === course.startPeriod
    ? '' : '–' + course.endPeriod) + ' 节';
}

function courseButton(course) {
  const button = node('button', null, 'course');
  button.setAttribute('aria-label', course.name + ' · ' + periodLabel(course));
  button.appendChild(node('span', course.name, 'course-name'));
  const shortPeriod = course.startPeriod + (course.endPeriod === course.startPeriod ? '' : '–' + course.endPeriod) + ' 节';
  button.appendChild(node('small', shortPeriod));
  const location = [course.campus, course.building, course.location].filter(Boolean).join(' · ');
  button.appendChild(node('small', location || '地点待定', 'course-location'));
  if (course.teacher) button.appendChild(node('small', course.teacher, 'course-teacher'));
  if (course.kind === 'moved') button.appendChild(node('small', '调课'));
  if (course.kind === 'special') button.appendChild(node('small', '特殊安排'));
  if (course.conflict) button.appendChild(node('small', '冲突', 'course-conflict'));
  button.addEventListener('click', () => showDetails(course.name, [
    days[course.day - 1] + ' · ' + periodLabel(course),
    '教师 · ' + (course.teacher || '待定'),
    course.courseCode ? '课程代码 · ' + course.courseCode : '',
    '地点 · ' + (location || '待定'),
    course.conflict ? '该时段与其他课程重叠' : '',
    course.note,
    '教学周 · ' + course.weekText,
    '数据来源 · ' + snapshot.source
  ].filter(Boolean)));
  return button;
}

function renderSchedule() {
  if (!snapshot) return;
  const schedule = snapshot.schedule;
  $('previousWeek').disabled = week <= 1;
  $('nextWeek').disabled = week >= schedule.totalWeeks;
  $('week').value = week;
  $('day').value = day;
  $('day').hidden = !daily;
  $('weekView').setAttribute('aria-pressed', String(!daily));
  $('dayView').setAttribute('aria-pressed', String(daily));
  const target = $('schedule');
  empty(target);
  if (!schedule.courses.length) {
    target.appendChild(node('p', '此学期的课表数据为空。', 'card pad sub'));
    return;
  }
  const grid = node('div', null, daily ? 'day-schedule card pad' : 'week-schedule card');
  const visibleDays = daily ? [day] : [1, 2, 3, 4, 5, 6, 7];
  const today = new Date().toLocaleDateString('sv-SE');
  visibleDays.forEach(weekday => {
    const date = Academic.dayDate(schedule, week, weekday);
    const column = node('section', null, 'weekday');
    const isToday = date.toISOString().slice(0, 10) === today;
    const heading = node('header', null, 'weekday-head' + (isToday ? ' today' : ''));
    if (isToday) heading.setAttribute('aria-current', 'date');
    heading.append(node('h2', days[weekday - 1], 'weekday-title'),
      node('p', (date.getUTCMonth() + 1) + '/' + date.getUTCDate(), 'date'));
    column.appendChild(heading);
    const courses = Academic.coursesFor(schedule, week, weekday);
    courses.forEach(course => column.appendChild(courseButton(course)));
    if (!courses.length) column.appendChild(node('p', daily ? '当天没有课程' : '—', 'date'));
    grid.appendChild(column);
  });
  target.appendChild(grid);
}

function installSchedule(entry, label, source = Academic.mockAdapter.label) {
  const termChanged = !snapshot || snapshot.source !== source || snapshot.schedule.termId !== entry.schedule.termId;
  snapshot = { ...entry, source };
  const schedule = snapshot.schedule;
  if (termChanged) {
    week = Math.max(1, Math.min(schedule.totalWeeks, Academic.currentWeek(schedule, new Date())));
  }
  week = Math.min(week, schedule.totalWeeks);
  empty($('week'));
  for (let number = 1; number <= schedule.totalWeeks; number++) {
    $('week').add(new Option('第 ' + number + ' 周', number));
  }
  $('scheduleStatus').textContent = source + ' · ' + label + ' · ' + time(entry.syncedAt);
  renderSchedule();
}

async function syncSchedule() {
  const termId = $('term').value;
  if (!termId) return;
  if (termId.startsWith(schoolPrefix)) {
    refreshSchool(termId.slice(schoolPrefix.length), true);
    return;
  }
  if (termId.startsWith(importedPrefix)) {
    loadSelectedTerm();
    return;
  }
  $('term').disabled = true;
  $('scheduleSync').disabled = true;
  $('scheduleStatus').textContent = '正在读取本机示例…';
  try {
    const entry = await scheduleRepo.sync(termId);
    const label = entry.status === 'fallback' ? '同步失败，显示上次缓存'
      : entry.cached ? '已更新离线缓存' : '仅本次可用，缓存写入失败';
    installSchedule(entry, label);
  } catch (error) {
    $('scheduleStatus').textContent = '同步失败' + (snapshot ? '，继续显示上次课表' : '') + ' · ' + error.message;
  } finally {
    $('term').disabled = false;
    $('scheduleSync').disabled = false;
  }
}

const studyKeyPrefix = 'jct.study.v3.';
const oldStudyKey = 'jct.study.v2';
const activeStudyScope = () => native ? native.cxSessionKey() : '';
const emptyStudyCache = (scope, account = '') => ({ scope, account, courses: [], details: {}, updates: {}, at: 0 });

function readStudyCache(scope) {
  const account = scope ? native.cxAccountKey?.(scope) || scope : '';
  if (!account) return emptyStudyCache(scope);
  try {
    const saved = JSON.parse(localStorage.getItem(studyKeyPrefix + account));
    if (saved?.account === account && Array.isArray(saved.courses) && saved.details) {
      return { ...saved, scope, updates: saved.updates || {} };
    }
    const old = JSON.parse(localStorage.getItem(oldStudyKey));
    if (old?.scope === scope && Array.isArray(old.courses) && old.details) {
      const migrated = { ...old, account, updates: {} };
      try {
        localStorage.setItem(studyKeyPrefix + account, JSON.stringify(migrated));
        localStorage.removeItem(oldStudyKey);
      } catch (_) { /* Keep the old cache available if migration could not be saved. */ }
      return migrated;
    }
  } catch (error) { /* Invalid or inaccessible cache. */ }
  return emptyStudyCache(scope, account);
}

let studyCache = readStudyCache(activeStudyScope());
let selectedCourse = '';
let studyAttempt = null;
let studyBusy = false;
let studyMessage = '';
let showInactiveStudyCourses = false;
let studyListState = [];
const studyOpenSections = new Map();
let studyForeground = true;
let studyScanTimer;
let studyRetryAt = 0;
let studyManualQueue = new Set();
const studyCheckLimit = 6;

function courseKey(course) {
  return String(course.courseId) + ':' + String(course.classId);
}

function reconcileStudyCache() {
  const scope = activeStudyScope();
  if (studyCache.scope !== scope) {
    studyCache = readStudyCache(scope);
    selectedCourse = '';
    studyAttempt = null;
    showInactiveStudyCourses = false;
    studyOpenSections.clear();
    studyManualQueue.clear();
    studyRetryAt = 0;
    studyMessage = scope ? '已接收学习通会话，请查询课程确认授权。' : '';
  }
  return scope;
}

function saveStudyCache() {
  if (!studyCache.scope || activeStudyScope() !== studyCache.scope) return;
  try {
    localStorage.setItem(studyKeyPrefix + studyCache.account, JSON.stringify(studyCache));
  } catch (error) {
    toast('学习通结果仅本次可用，缓存写入失败');
  }
}

function clearStudyCache(remove = false) {
  const account = studyCache.account;
  studyCache = emptyStudyCache(activeStudyScope());
  selectedCourse = '';
  studyAttempt = null;
  showInactiveStudyCourses = false;
  studyOpenSections.clear();
  studyManualQueue.clear();
  studyRetryAt = 0;
  if (!remove || !account) return;
  try {
    localStorage.removeItem(studyKeyPrefix + account);
  } catch (error) { /* This session cannot be displayed without its matching scope. */ }
}

function showCourseResults(course) {
  const target = $('studyDetails');
  empty(target);
  const key = courseKey(course);
  const entry = studyCache.details[key];
  const sections = studyAttempt && studyAttempt.key === key ? studyAttempt.sections : entry && entry.sections;
  const open = studyOpenSections.get(key) || new Map();
  studyOpenSections.set(key, open);
  const card = node('section', null, 'card pad');
  card.appendChild(node('h2', course.title || '课程详情'));
  const refresh = node('button', '刷新学习任务', 'btn');
  refresh.disabled = studyBusy;
  refresh.addEventListener('click', () => queryStudy(course));
  const controls = node('div', null, 'controls');
  const activity = studyCache.updates[key];
  const hidden = StudyActivity.hiddenReason(activity);
  const visibility = node('button', hidden ? '恢复显示' : '隐藏课程', 'btn');
  visibility.addEventListener('click', () => changeStudyVisibility(key, hidden ? 'restore' : 'hide'));
  const always = node('button', '始终显示', 'btn');
  always.setAttribute('aria-pressed', String(activity?.alwaysVisible === true));
  always.addEventListener('click', () => changeStudyVisibility(key, activity?.alwaysVisible ? 'unpin' : 'pin'));
  controls.append(refresh, visibility, always);
  card.appendChild(controls);
  if (!activity?.reliable) card.appendChild(node('p', '课程活跃度待确认', 'sub'));
  if (!sections) card.appendChild(node('p', studyBusy ? '正在读取…' : '尚无任务缓存。', 'sub'));
  (sections || []).forEach(section => {
    const group = node('details', null, 'result-group');
    const state = section.error ? (section.cached ? ' · 旧缓存' : ' · 查询失败')
      : ' · ' + section.items.length + ' 项';
    group.appendChild(node('summary', section.title + state));
    group.open = open.get(section.title) ?? (section.title === '作业' || !!section.error);
    group.addEventListener('toggle', () => { open.set(section.title, group.open); });
    if (section.error) {
      const error = node('p', section.error, 'sub status-note');
      error.dataset.tone = 'warning';
      group.appendChild(error);
    }
    if (section.items && (section.at || entry)) {
      group.appendChild(node('p', '数据时间 · ' + time(section.at || entry.at), 'sub'));
    }
    if (section.items && !section.items.length) group.appendChild(node('p', '暂无' + section.title, 'empty-state'));
    const items = section.items || [];
    const ordered = section.title === '作业'
      ? [...items.filter(item => item.state === 'todo'), ...items.filter(item => item.state !== 'todo')] : items;
    ordered.forEach(item => {
      const signed = item.kind === 'sign' && !item.status
        ? item.signed === true ? '已签' : item.signed === false ? '未签' : '签到状态未知' : '';
      const status = [item.kindName, item.status || signed, studyDeadline(item)].filter(Boolean).join(' · ');
      group.appendChild(resultRow(item.title, status));
    });
    card.appendChild(group);
  });
  target.appendChild(card);
}

function changeStudyVisibility(key, action) {
  if (!reconcileStudyCache() || !studyCache.courses.some(course => courseKey(course) === key)) return;
  studyCache.updates[key] = StudyActivity.setVisibility(studyCache.updates[key], action, Date.now());
  saveStudyCache();
  renderStudy();
}

function resultRow(title, subtitle) {
  const row = node('div', null, 'result-row');
  row.appendChild(node('strong', title));
  if (subtitle) row.appendChild(node('p', subtitle, 'sub'));
  return row;
}

function studyDeadline(item) {
  if (item.kind === 'notice') return '';
  if (item.left) return item.left;
  return item.kind === 'work' && Number.isFinite(item.endAt) && item.endAt > 0 ? '截止 ' + time(item.endAt * 1000) : '';
}

function pendingHomework(entry) {
  return entry?.sections?.find(section => section.title === '作业')?.items
    ?.filter(item => item.kind === 'work' && item.state === 'todo');
}

function openStudyCourse(course) {
  selectedCourse = courseKey(course);
  if (!studyCache.details[selectedCourse]) {
    queryStudy(course);
    return;
  }
  renderStudy();
  $('studyDetails').scrollIntoView({ block: 'nearest' });
}

function sectionHeading(title, detail) {
  const heading = node('header', null, 'section-title');
  heading.appendChild(node('h2', title));
  if (detail) heading.appendChild(node('p', detail, 'sub'));
  return heading;
}

function renderStudyTasks(courses) {
  const target = $('studyTasks');
  const tasks = [];
  let loaded = 0;
  for (const course of courses) {
    const work = pendingHomework(studyCache.details[courseKey(course)]);
    if (!work) continue;
    loaded++;
    work.forEach(item => tasks.push({ course, item }));
  }
  if (!loaded) {
    target.replaceChildren();
    return;
  }
  const section = node('section');
  section.appendChild(sectionHeading('待处理作业', '已读取 ' + loaded + ' 门课程'));
  const list = node('div', null, 'card task-list');
  tasks.sort((a, b) => (a.item.endAt || Infinity) - (b.item.endAt || Infinity));
  if (!tasks.length) list.appendChild(node('p', '已读取的课程暂无待处理作业。', 'empty-state'));
  function taskButton({ course, item }) {
    const button = node('button', null, 'study-task');
    button.type = 'button';
    button.append(node('span', item.title, 'task-name'),
      node('span', [course.title || '未命名课程', item.status, studyDeadline(item)].filter(Boolean).join(' · '), 'course-meta'));
    button.addEventListener('click', () => openStudyCourse(course));
    return button;
  }
  tasks.slice(0, 4).forEach(task => list.appendChild(taskButton(task)));
  if (tasks.length > 4) {
    const more = node('details', null, 'result-group study-hidden');
    more.open = target.querySelector('details')?.open || false;
    more.appendChild(node('summary', '其余 ' + (tasks.length - 4) + ' 项'));
    tasks.slice(4).forEach(task => more.appendChild(taskButton(task)));
    list.appendChild(more);
  }
  section.appendChild(list);
  target.replaceChildren(section);
}

function renderStudy() {
  const linked = !!reconcileStudyCache();
  $('studyLogin').hidden = linked;
  $('studyLogin').disabled = !native || studyBusy;
  $('studyRefresh').disabled = !linked || studyBusy;
  $('studyRefresh').textContent = studyBusy ? '刷新中…' : '刷新课程';
  $('studyStatus').textContent = studyMessage || (linked
    ? studyCache.at ? '学习通已连接 · ' + studyCache.courses.length + ' 门课程' : '学习通已连接，可刷新课程。'
    : '登录后查看课程与任务。');
  $('studyStatus').dataset.tone = /失败|过期|限制|未确认|未更新/.test(studyMessage) ? 'warning'
    : linked && !studyBusy ? 'success' : '';
  const target = $('studyCourses');
  const nextState = [studyCache.courses, studyCache.at, linked, studyBusy, selectedCourse, studyAttempt];
  for (const course of studyCache.courses) {
    const key = courseKey(course);
    nextState.push(studyCache.details[key], studyCache.updates[key]);
  }
  if (nextState.length === studyListState.length && nextState.every((value, i) => value === studyListState[i])) return;
  studyListState = nextState;
  const scroll = $('page-study').querySelector('.scroll');
  const scrollTop = scroll.scrollTop;
  const focusKey = document.activeElement?.dataset.studyCourse;
  const content = document.createDocumentFragment();
  const active = studyCache.courses.filter(course => !StudyActivity.hiddenReason(studyCache.updates[courseKey(course)]));
  renderStudyTasks(active);
  if (studyCache.at) {
    const card = node('section', null, 'card study-course-list');
    const hiddenCount = studyCache.courses.length - active.length;
    content.appendChild(sectionHeading('活跃课程', active.length + ' 门'));
    if (!active.length) card.appendChild(node('p', hiddenCount ? '课程可在下方的隐藏列表查看。' : '暂无课程记录。', 'empty-state'));
    const folded = node('details', null, 'card study-hidden result-group');
    folded.open = showInactiveStudyCourses;
    folded.appendChild(node('summary', '已隐藏课程 · ' + hiddenCount + ' 门'));
    folded.addEventListener('toggle', () => { showInactiveStudyCourses = folded.open; });
    studyCache.courses.forEach(course => {
      const key = courseKey(course);
      const button = node('button', null, 'course-list-item');
      button.type = 'button';
      button.dataset.studyCourse = key;
      const entry = studyCache.details[key];
      button.disabled = !entry && (!linked || studyBusy);
      button.setAttribute('aria-pressed', String(selectedCourse === key));
      button.addEventListener('click', () => openStudyCourse(course));
      button.appendChild(node('span', course.title || '未命名课程', 'course-name'));
      const activity = studyCache.updates[key];
      const reason = StudyActivity.hiddenReason(activity);
      const meta = node('span', null, 'course-meta');
      const pending = pendingHomework(entry);
      if (pending?.length) meta.appendChild(node('span', pending.length + ' 项待交', 'badge'));
      if (course.alias && course.alias !== course.title) meta.appendChild(node('span', course.alias));
      if (activity?.alwaysVisible) meta.appendChild(node('span', '始终显示', 'badge muted'));
      else if (!reason && !activity?.reliable) {
        const label = activity?.lastSuccessfulCheckAt ? '检查待确认 · 保留上次结果' : '活跃度观察中';
        meta.appendChild(node('span', label, 'badge muted'));
      }
      const publishedAt = Math.max(activity?.notices?.publishedAt || 0, activity?.homework?.publishedAt || 0);
      if (!reason && publishedAt) meta.appendChild(node('span', '最近发布 ' + time(publishedAt)));
      if (meta.childNodes.length) button.appendChild(meta);
      if (!reason) {
        card.appendChild(button);
        return;
      }
      const row = node('div', null, 'result-row');
      row.append(button, node('p', reason + (publishedAt ? ' · 最近发布 ' + time(publishedAt) : ''), 'sub'));
      if (activity.checkedAt) {
        const prefix = activity.reliable ? '最近检查 ' : '检查待确认 · ';
        row.appendChild(node('p', prefix + time(activity.checkedAt), 'study-check-time'));
      }
      const restore = node('button', '恢复显示', 'btn');
      restore.addEventListener('click', () => changeStudyVisibility(key, 'restore'));
      const always = node('button', '始终显示', 'btn');
      always.addEventListener('click', () => changeStudyVisibility(key, 'pin'));
      const controls = node('div', null, 'controls');
      controls.append(restore, always);
      row.appendChild(controls);
      folded.appendChild(row);
    });
    content.appendChild(card);
    if (hiddenCount) content.appendChild(folded);
  }
  target.replaceChildren(content);
  const current = studyCache.courses.find(course => courseKey(course) === selectedCourse);
  if (current) showCourseResults(current);
  else empty($('studyDetails'));
  scroll.scrollTop = scrollTop;
  if (focusKey) {
    Array.from(target.querySelectorAll('[data-study-course]')).find(item => item.dataset.studyCourse === focusKey)
      ?.focus({ preventScroll: true });
  }
}

function openStudyLogin() {
  if (!native || studyBusy) return;
  try {
    if (!native.openStudyLogin()) {
      studyMessage = '登录窗口暂不可用，请稍后再试';
    } else {
      studyMessage = '';
    }
  } catch (error) {
    studyMessage = '无法打开学习通登录页 · ' + error.message;
  }
  renderStudy();
}

function studyUpdateBatch() {
  const due = studyManualQueue.size
    ? studyCache.courses.filter(course => studyManualQueue.has(courseKey(course)))
    : StudyActivity.dueCourses(studyCache.courses, studyCache.updates, courseKey, Date.now());
  const hidden = due.filter(course => StudyActivity.hiddenReason(studyCache.updates[courseKey(course)]))
    .slice(0, studyCheckLimit / 2);
  return hidden.concat(due.filter(course => !hidden.includes(course))).slice(0, studyCheckLimit);
}

function scheduleStudyUpdates(delay = 0) {
  clearTimeout(studyScanTimer);
  if (!native || !studyForeground || document.hidden || !navigator.onLine || studyBusy
      || !reconcileStudyCache() || !studyUpdateBatch().length) return;
  studyScanTimer = setTimeout(() => queryStudy(null, true), Math.max(delay, studyRetryAt - Date.now()));
}

window.pauseStudyUpdates = () => {
  studyForeground = false;
  clearTimeout(studyScanTimer);
};
window.resumeStudyUpdates = () => {
  studyForeground = true;
  scheduleStudyUpdates(1500);
};
document.addEventListener('visibilitychange', () => scheduleStudyUpdates(1500));
window.addEventListener('online', () => scheduleStudyUpdates(1500));

async function scanStudyUpdates(batch, scope) {
  let checked = 0;
  for (const course of batch) {
    if (activeStudyScope() !== scope || !studyForeground || document.hidden) break;
    const sections = await Learning.readCourse(course, scope, true);
    if (activeStudyScope() !== scope) break;
    const key = courseKey(course);
    studyCache.updates[key] = StudyActivity.update(studyCache.updates[key], sections, Date.now());
    studyManualQueue.delete(key);
    if (sections.every(section => !section.error && section.complete)) checked++;
    if (sections.every(section => section.error) && sections.some(section => section.kind === 'net')) {
      studyRetryAt = Date.now() + 15 * 60 * 1000;
      break;
    }
  }
  return checked;
}

async function queryStudy(course, checkOnly = false) {
  if (!native || studyBusy) return;
  const scope = reconcileStudyCache();
  if (!scope) return;
  const batch = checkOnly ? studyUpdateBatch() : null;
  if (batch && (!batch.length || !navigator.onLine || !studyForeground || document.hidden)) return;
  clearTimeout(studyScanTimer);
  if (course) selectedCourse = courseKey(course);
  studyBusy = true;
  studyMessage = course ? '正在读取作业、考试与活动…' : checkOnly ? '正在检查课程更新…' : '正在读取课程…';
  refreshSession();
  try {
    if (course) {
      const sections = await Learning.readCourse(course, scope);
      if (activeStudyScope() !== scope) return;
      const key = courseKey(course);
      const previous = studyCache.details[key];
      const merged = Learning.mergeCourseResults(previous, sections, Date.now());
      studyCache.updates[key] = StudyActivity.update(studyCache.updates[key], sections, Date.now());
      studyManualQueue.delete(key);
      studyAttempt = { key, sections: merged.sections };
      if (merged.cache && merged.cache !== previous) studyCache.details[key] = merged.cache;
      studyMessage = sections.every(section => section.error) ? '任务刷新失败，请查看各类别的状态。'
        : sections.some(section => section.error) ? '部分学习任务未更新，请查看各类别的状态。' : '学习任务读取完成。';
    } else if (!checkOnly) {
      const courses = await Learning.courses(scope);
      if (activeStudyScope() !== scope) return;
      studyCache = { ...studyCache, courses, at: Date.now() };
      studyManualQueue = new Set(courses.map(courseKey));
      studyRetryAt = 0;
      studyAttempt = null;
      studyMessage = courses.length ? '课程查询成功，会话已验证。' : '课程查询成功，该账号暂无课程。';
      saveStudyCache();
    }
    if (!course) {
      const pending = batch || studyUpdateBatch();
      if (pending.length) {
        studyMessage = '正在检查课程更新…';
        renderStudy();
        const checked = await scanStudyUpdates(pending, scope);
        if (activeStudyScope() !== scope) return;
        studyMessage = checked ? '已检查 ' + checked + ' 门课程的通知与作业。' : '本次未确认课程更新。';
      }
    }
    if (native.cxPersist(scope)) studyMessage += ' 暂时无法保存登录状态。';
    saveStudyCache();
  } catch (error) {
    if (error.kind === 'auth') {
      let cleared = true;
      try {
        native.cxInvalidate(scope);
      } catch (failure) {
        cleared = false;
      }
      const current = activeStudyScope();
      if (studyCache.scope === scope && (!current || current === scope)) {
        studyMessage = cleared ? '学习通会话已过期，请重新授权。' : '学习通会话已过期，本地登录状态清理失败。';
        clearStudyCache();
      }
    } else if (activeStudyScope() === scope) {
      if (error.kind === 'busy' || error.kind === 'net') studyRetryAt = Date.now() + 15 * 60 * 1000;
      studyMessage = error.message + (studyCache.at ? '。下方保留上次结果。' : '');
      saveStudyCache();
    }
  } finally {
    studyBusy = false;
    refreshSession();
    scheduleStudyUpdates(15000);
    if (course && studyCache.details[selectedCourse] && !$('page-study').hidden) {
      $('studyDetails').scrollIntoView({ block: 'nearest' });
    }
  }
}

let waterBusy = false;
let waterExpired = false;
let waterMessage = '';
let captcha = null;
let captchaReady = false;
let smsUntil = 0;
let smsTimer;
let billPage = -1;
let moreBills = false;

function renderWater() {
  const state = native ? Water.state() : { linked: false };
  const connected = state.linked && !waterExpired;
  const canStart = Water.loginConfigured();
  $('waterStatus').textContent = waterMessage || (connected
    ? '饮水服务已登录。' : !canStart && native
      ? '应用内短信登录暂不可用，缺少授权配置。' : state.broken
      ? '登录已失效，请重新登录。'
      : '登录后查看余额和消费记录。');
  $('waterStatus').dataset.tone = /失败|错误|失效|不可用/.test($('waterStatus').textContent) ? 'warning'
    : connected && !waterBusy ? 'success' : '';
  $('waterLoginOpen').hidden = connected || !canStart;
  $('waterOfficial').hidden = $('waterExternalHelp').hidden = !native || !native.openOfficialWater;
  $('waterRefresh').hidden = !connected;
  $('waterResults').hidden = !connected;
  ['waterRefresh', 'waterLoginCancel', 'billRefresh', 'billMore', 'phone', 'graph', 'sms']
    .forEach(id => { $(id).disabled = !native || waterBusy; });
  $('waterLoginOpen').disabled = $('loadCaptcha').disabled = !canStart || waterBusy;
  $('waterLogin').disabled = !canStart || waterBusy || !Water.canLogin($('phone').value.trim());
  $('sendSms').disabled = !canStart || waterBusy || !captchaReady || Date.now() < smsUntil;
  $('billMore').hidden = !moreBills;
  const trace = Water.diagnostics();
  $('waterDiagnostic').hidden = !trace.length;
  $('waterDiagnosticRows').textContent = trace.map(item => JSON.stringify(item)).join('\n');
  if (connected && !$('devices').childElementCount && state.at) {
    showDevices(state.devices);
    $('deviceStatus').textContent = '本机缓存 · ' + time(state.at);
  }
}

function showDevices(devices) {
  empty($('devices'));
  devices.forEach(device => $('devices').appendChild(resultRow(device.name || '饮水机', '编号 · ' + device.id)));
}

function showCaptcha() {
  if (!Water.loginConfigured() || waterBusy) return;
  if (!/^1\d{10}$/.test($('phone').value.trim())) {
    toast('请先输入 11 位手机号');
    return;
  }
  captcha = Water.captcha();
  captchaReady = false;
  $('graph').value = '';
  $('sms').value = '';
  $('captcha').hidden = false;
  $('captcha').src = captcha.url;
  waterMessage = '正在加载图形验证码…';
  renderWater();
}

function resetWaterView() {
  $('balance').textContent = '—';
  $('deviceStatus').textContent = '';
  $('billStatus').textContent = '';
  empty($('devices'));
  empty($('bills'));
  billPage = -1;
  moreBills = false;
}

function hideWaterForm() {
  Water.clearLoginAttempt();
  $('waterForm').reset();
  $('waterForm').hidden = true;
  $('captcha').hidden = true;
  $('captcha').removeAttribute('src');
  captcha = null;
  captchaReady = false;
}

function showWaterForm() {
  if (!Water.loginConfigured()) return;
  select('life');
  $('waterForm').hidden = false;
  $('phone').focus();
}

async function runWater(action) {
  if (!native || waterBusy) return;
  waterBusy = true;
  waterMessage = '正在请求慧生活798…';
  refreshSession();
  try {
    await action();
  } catch (error) {
    if (error.kind === 'auth') waterExpired = true;
    waterMessage = error.message;
  } finally {
    waterBusy = false;
    refreshSession();
  }
}

function updateSmsButton() {
  clearTimeout(smsTimer);
  const remaining = Math.max(0, Math.ceil((smsUntil - Date.now()) / 1000));
  $('sendSms').textContent = remaining ? '重发 · ' + remaining + ' 秒' : '发送短信';
  $('sendSms').disabled = !Water.loginConfigured() || waterBusy || !captchaReady || remaining > 0;
  if (remaining) smsTimer = setTimeout(updateSmsButton, 1000);
}

function sendSms() {
  const phone = $('phone').value.trim();
  const graph = $('graph').value.trim();
  if (!Water.loginConfigured() || Date.now() < smsUntil || !captchaReady) return;
  if (!/^1\d{10}$/.test(phone) || !graph) {
    toast('请输入 11 位手机号和图形验证码');
    return;
  }
  runWater(async () => {
    $('sms').value = '';
    await Water.sendSms(phone, captcha.key, graph);
    smsUntil = Date.now() + 60000;
    updateSmsButton();
    waterMessage = '短信已发送，请输入收到的验证码。';
  });
}

function loginWater(event) {
  event.preventDefault();
  const phone = $('phone').value.trim();
  const sms = $('sms').value.trim();
  if (!/^1\d{10}$/.test(phone) || !/^\d{4,10}$/.test(sms)) {
    toast('请输入有效的手机号和短信验证码');
    return;
  }
  runWater(async () => {
    await Water.login(phone, sms);
    waterExpired = false;
    waterMessage = '登录状态已保存。可刷新余额与设备。';
    resetWaterView();
    hideWaterForm();
  });
}

function currency(amount) {
  return typeof amount === 'number' ? '¥' + amount.toFixed(2) : '金额未读到';
}

function refreshWater() {
  runWater(async () => {
    const errors = [];
    try {
      $('balance').textContent = currency(await Water.balance());
    } catch (error) {
      if (error.kind === 'auth') throw error;
      errors.push('余额 · ' + error.message);
      $('balance').textContent = '未读到';
    }
    try {
      const devices = await Water.devices();
      showDevices(devices);
      $('deviceStatus').textContent = devices.length ? '刚刚更新' : '没有设备记录';
    } catch (error) {
      if (error.kind === 'auth') throw error;
      errors.push('设备 · ' + error.message);
      $('deviceStatus').textContent = '更新失败，保留已有设备记录';
    }
    waterMessage = errors.join('；') || '余额和设备已更新。';
  });
}

function queryBills(more) {
  if (more && !moreBills) return;
  runWater(async () => {
    const page = more ? billPage + 1 : 0;
    const result = await Water.bills(page, 20);
    if (!more) empty($('bills'));
    result.items.forEach(item => {
      const date = item.at ? time(item.at) : '时间未读到';
      $('bills').appendChild(resultRow(item.msg || '消费记录',
        [currency(item.money), date, item.did ? '设备 ' + item.did : ''].filter(Boolean).join(' · ')));
    });
    billPage = page;
    moreBills = result.more;
    $('billStatus').textContent = $('bills').childElementCount
      ? '已显示 ' + $('bills').childElementCount + ' 条记录' : '没有消费记录';
    waterMessage = '消费记录已更新。';
  });
}

function renderAccounts() {
  const cx = native && native.cxHasLogin();
  const water = native ? Water.state() : { linked: false };
  $('studyAccount').textContent = cx ? '已登录' : '未连接';
  $('studyAccountAction').textContent = cx ? '退出' : '前往登录';
  $('studyAccountAction').disabled = studyBusy;
  $('waterAccount').textContent = waterExpired || water.broken ? '会话已失效'
    : water.linked ? '已登录' : '未连接';
  $('waterAccountAction').textContent = water.linked || water.broken ? '退出' : '前往服务';
  $('waterAccountAction').disabled = waterBusy;
  $('clearWebCache').disabled = !native;
}

function renderZhuli() {
  const status = zhuli.status();
  const button = $('zhuliOpen');
  button.hidden = status === 'unavailable';
  button.textContent = status === 'external-store' ? '在应用宝查看' : '打开官方 App';
  const label = status === 'external-app' ? '外部服务 · 账号由住理生活管理'
    : status === 'external-store' ? '外部服务 · 尚未安装住理生活' : '当前环境无法打开住理生活。';
  if ($('zhuliStatus').textContent !== label) $('zhuliStatus').textContent = label;
}

function selectLifeService(service) {
  document.querySelectorAll('[data-life]').forEach(button => {
    const active = button.dataset.life === service;
    button.setAttribute('aria-pressed', String(active));
    $(button.getAttribute('aria-controls')).hidden = !active;
  });
  if (service === 'zhuli') renderZhuli();
}

function refreshSession() {
  renderStudy();
  renderWater();
  renderAccounts();
  if (!$('page-life').hidden && !$('life-zhuli').hidden) renderZhuli();
}
window.refreshSession = refreshSession;

const uiTheme = $('appTheme');
const themeMedia = matchMedia('(prefers-color-scheme: dark)');
try {
  const saved = localStorage.getItem('jct.theme.v1');
  if (['system', 'light', 'dark'].includes(saved)) uiTheme.value = saved;
} catch (_) { /* Use the system setting when storage is unavailable. */ }
function applyUiTheme() {
  const dark = uiTheme.value === 'dark' || (uiTheme.value === 'system'
    && (native?.systemUiDark?.() ?? themeMedia.matches));
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  native?.setUiTheme?.(dark);
}
window.applyUiTheme = applyUiTheme;
uiTheme.addEventListener('change', () => {
  try { localStorage.setItem('jct.theme.v1', uiTheme.value); }
  catch (_) { toast('外观设置仅本次有效'); }
  applyUiTheme();
});
themeMedia.addEventListener?.('change', applyUiTheme);
applyUiTheme();

$('studyAccountAction').addEventListener('click', () => {
  if (!native || !native.cxHasLogin()) {
    select('study');
    return;
  }
  if (!window.confirm('退出学习通并清除本机学习通缓存？')) return;
  try {
    native.cxClear();
    clearStudyCache(true);
    studyMessage = '已退出学习通。';
  } catch (error) {
    studyMessage = '无法清除学习通登录状态。';
    toast(studyMessage);
  }
  refreshSession();
});

$('waterAccountAction').addEventListener('click', () => {
  const state = native && Water.state();
  if (!state || (!state.linked && !state.broken)) {
    selectLifeService('water');
    select('life');
    return;
  }
  if (!window.confirm('退出慧生活798并清除本机会话？')) return;
  try {
    Water.logout();
    waterExpired = false;
    waterMessage = '已退出慧生活798。';
    resetWaterView();
    hideWaterForm();
  } catch (error) {
    toast('无法清除慧生活798登录状态');
  }
  refreshSession();
});

tabs.forEach(button => button.addEventListener('click', () => select(button.dataset.tab)));
document.querySelectorAll('[data-life]').forEach(button => {
  button.addEventListener('click', () => selectLifeService(button.dataset.life));
});
$('zhuliOpen').addEventListener('click', () => {
  if (!zhuli.open()) toast('无法打开住理生活，请在应用商店搜索。');
});
$('studyLogin').addEventListener('click', openStudyLogin);
$('studyRefresh').addEventListener('click', () => queryStudy(null));
$('waterLoginOpen').addEventListener('click', showWaterForm);
$('waterOfficial').addEventListener('click', () => native.openOfficialWater());
$('waterLoginCancel').addEventListener('click', hideWaterForm);
$('phone').addEventListener('input', () => {
  Water.clearLoginAttempt();
  $('sms').value = '';
  $('graph').value = '';
  captcha = null;
  captchaReady = false;
  $('captcha').hidden = true;
  $('captcha').removeAttribute('src');
  waterMessage = '';
  renderWater();
});
$('loadCaptcha').addEventListener('click', showCaptcha);
$('captcha').addEventListener('load', () => {
  if (!captcha) return;
  captchaReady = true;
  waterMessage = '请输入图形验证码后发送短信。';
  renderWater();
});
$('captcha').addEventListener('error', () => {
  if (!captcha) return;
  captchaReady = false;
  waterMessage = '验证码加载失败，请手动重试。';
  renderWater();
});
$('sendSms').addEventListener('click', sendSms);
$('waterForm').addEventListener('submit', loginWater);
$('waterRefresh').addEventListener('click', refreshWater);
$('billRefresh').addEventListener('click', () => queryBills(false));
$('billMore').addEventListener('click', () => queryBills(true));
$('sheetClose').addEventListener('click', closeCourseDetails);
$('sheetMask').addEventListener('click', event => {
  if (event.target === $('sheetMask')) closeCourseDetails();
});
$('clearWebCache').addEventListener('click', () => {
  native.clearWebCache();
  toast('已请求清理网页缓存');
});

days.forEach((name, index) => $('day').add(new Option(name, index + 1)));
$('scheduleSync').addEventListener('click', syncSchedule);
$('term').addEventListener('change', () => loadSelectedTerm());
$('academicBind').disabled = !native;
$('academicBind').addEventListener('click', () => {
  if (schoolTransport) receiveSchoolAuthorization(false);
  else native.openAcademicBinding();
});
$('academicOfficial').disabled = !native;
$('academicOfficial').addEventListener('click', () => {
  native.openAcademicPortal();
});
$('previousWeek').addEventListener('click', () => { week--; renderSchedule(); });
$('nextWeek').addEventListener('click', () => { week++; renderSchedule(); });
$('week').addEventListener('change', event => { week = Number(event.target.value); renderSchedule(); });
$('day').addEventListener('change', event => { day = Number(event.target.value); renderSchedule(); });
$('weekView').addEventListener('click', () => { daily = false; renderSchedule(); });
$('dayView').addEventListener('click', () => { daily = true; renderSchedule(); });
$('appVersion').textContent = '版本 ' + APP_VERSION + ' · Debug';

refreshSession();
function showSchoolStatus() {
  const state = schoolSync.snapshot();
  $('academicBindingState').textContent = state.state === 'authorized' ? '本人课表授权已验证。'
    : state.state === 'reauthorize' ? '教务会话已失效，已保留本机课表。请主动重新绑定。'
    : state.state === 'unverified' ? '已显示本机课表，需要刷新时会核验教务会话。'
    : '请绑定教务，完成校方认证后同步本人课表。';
  if (academicPanel !== 'timetable') renderAcademicRecords();
}

function selectAcademicPanel(panel) {
  const previous = recordViews[academicPanel];
  if (previous && $('recordResults').firstElementChild === previous.node) {
    previous.scrollTop = $('academic-records').scrollTop;
  }
  academicPanel = panel;
  const timetable = panel === 'timetable';
  document.querySelectorAll('[data-academic]').forEach(button => {
    button.setAttribute('aria-pressed', button.dataset.academic === panel ? 'true' : 'false');
  });
  $('academic-timetable').hidden = !timetable;
  $('scheduleSync').hidden = !timetable;
  $('academic-records').hidden = timetable;
  if (!timetable) renderAcademicRecords();
}

async function renderAcademicRecords(force = false) {
  const request = ++recordRender;
  const panel = academicPanel;
  const grades = panel === 'grades';
  const title = grades ? '学业成绩' : '考试安排';
  const scope = schoolSync.snapshot();
  const adapter = recordAdapters[panel];
  const status = $('recordStatus');
  const results = $('recordResults');
  const term = $('recordTerm');
  const isCurrent = () => request === recordRender && academicPanel === panel;
  $('recordTitle').textContent = title;
  term.labels[0].textContent = grades ? '成绩学期' : '教务学期';
  $('recordPortal').disabled = true;
  $('recordPortal').hidden = scope.state === 'reauthorize' || scope.state === 'unbound';
  $('recordBack').hidden = !['reauthorize', 'unbound'].includes(scope.state);
  $('recordRefresh').hidden = !adapter.available;
  $('recordRefresh').disabled = true;
  const messages = {
    unavailable: '校方数据格式尚未核实，可在校方教务查看。',
    'needs-auth': '请先在课表页完成教务授权。',
    expired: '教务会话已失效，请主动重新绑定。',
    empty: grades ? '暂无成绩。' : '暂无考试安排。',
    unpublished: grades ? '本学期成绩尚未发布。' : '本学期考试安排尚未公布。',
    network: '网络查询失败，请稍后重试。',
    timeout: '教务查询超时，请稍后刷新。',
    denied: '校方拒绝了本次查询。',
    busy: '教务窗口正在使用，请稍后刷新。',
    term: '校方页面未开放查询所选学期。',
    format: '无法识别教务数据格式。',
    'account-changed': '教务账号已切换，请重新查询。'
  };
  status.dataset.tone = '';
  const previous = recordViews[panel];
  const reuse = previous && previous.account === scope.accountKey
    && ['authorized', 'unverified'].includes(scope.state)
    && (!recordTerms[panel] || recordTerms[panel] === previous.term);
  if (!reuse) empty(results);
  else if (results.firstElementChild !== previous.node) {
    results.replaceChildren(previous.node);
    $('academic-records').scrollTop = previous.scrollTop;
  }
  let options = scope.terms;
  let catalog;
  if (grades) {
    term.disabled = true;
    status.textContent = adapter.available ? '正在读取成绩学期…' : messages.unavailable;
    catalog = await gradeTerms.load(scope, '', force);
    if (!isCurrent()) return;
    if (scope.accountKey !== schoolSync.snapshot().accountKey) {
      renderAcademicRecords();
      return;
    }
    const labels = (catalog.cached || catalog).rows?.map(row => row.label) || [];
    options = [...new Set(labels)].sort().reverse().map(label => ({ term: label, termId: label }));
  }
  const selected = recordTerms[panel] || (grades ? options[0]?.termId : scope.selected);
  empty(term);
  options.forEach(item => term.add(new Option(item.term, item.termId)));
  if (options.some(item => item.termId === selected)) term.value = selected;
  if (!options.length) term.add(new Option(grades ? '暂无可选成绩学期' : '绑定后显示教务学期', ''));
  term.disabled = !options.length;
  const selectedTerm = term.value;
  if (reuse && previous.term !== selectedTerm) empty(results);
  if (!grades || selectedTerm) status.textContent = adapter.available ? '正在查询…' : messages.unavailable;
  const data = grades && !selectedTerm ? catalog : await adapter.load(scope, selectedTerm, force);
  if (!isCurrent()) return;
  const current = schoolSync.snapshot();
  if (scope.accountKey !== current.accountKey || (current.state === 'reauthorize'
      && !['expired', 'account-changed'].includes(data.state))) {
    renderAcademicRecords();
    return;
  }
  const needsBinding = ['unbound', 'reauthorize'].includes(current.state);
  $('recordPortal').hidden = needsBinding;
  $('recordPortal').disabled = !native || needsBinding;
  $('recordBack').hidden = !needsBinding;
  $('recordRefresh').disabled = (!grades && !selectedTerm) || needsBinding;
  const displayed = data.cached || data;
  const gradeCount = grades && displayed.state === 'ready' ? displayed.rows.length + ' 门有效成绩' : '';
  const catalogError = catalog?.cached ? '成绩学期更新失败 · ' + messages[catalog.state] : '';
  status.textContent = [catalogError, messages[data.state], gradeCount,
    displayed.at ? '更新于 ' + time(displayed.at) : ''].filter(Boolean).join(' · ');
  status.dataset.tone = catalogError || ['expired', 'term', 'busy'].includes(data.state) ? 'warning'
    : ['network', 'timeout', 'denied', 'format'].includes(data.state) ? 'error' : '';
  if (displayed.state !== 'ready') {
    empty(results);
    delete recordViews[panel];
    return;
  }
  if (reuse && previous.term === selectedTerm && previous.rows === displayed.rows) return;
  const scrollTop = reuse && previous.term === selectedTerm ? $('academic-records').scrollTop : 0;
  const card = node('div');
  let group = node('section', null, 'card pad');
  if (grades) card.appendChild(group);
  const rows = displayed.rows.slice();
  const today = new Date().toLocaleDateString('sv-SE');
  const upcoming = item => !!item.date && item.date >= today;
  if (!grades) rows.sort((a, b) => Number(upcoming(b)) - Number(upcoming(a))
    || (a.date || '9999').localeCompare(b.date || '9999') || a.start.localeCompare(b.start));
  let previousDate = null;
  rows.forEach(item => {
    const date = item.date || '';
    if (!grades && date !== previousDate) {
      group = node('section', null, 'card pad exam-day');
      group.appendChild(node('h2', upcoming(item) ? '即将考试 · ' + item.date : item.date || '日期待定'));
      card.appendChild(group);
      previousDate = date;
    }
    const row = node('article', null, 'result-row ' + (grades ? 'grade-row' : 'exam-row'));
    const summary = node('div');
    summary.appendChild(node('strong', item.name, 'course-name'));
    const details = grades
      ? [item.earnedCredits && '获得学分 ' + item.earnedCredits, item.gpa && '绩点 ' + item.gpa,
        item.creditPoints && '学分绩点 ' + item.creditPoints, item.category, item.nature, item.assessment, item.note]
      : [[item.campus, item.building, item.room].filter(Boolean).join(' · '),
        item.seat && '座位 ' + item.seat, item.mode, item.status];
    summary.appendChild(node('p', details.filter(Boolean).join(' · '), 'sub'));
    if (grades) {
      const grade = node('div', null, 'grade-value');
      grade.appendChild(node('strong', item.grade || '未提供'));
      if (item.credits) grade.appendChild(node('small', item.credits + ' 学分'));
      row.append(summary, grade);
    } else {
      row.append(node('span', item.timeText || [item.start, item.end].filter(Boolean).join('–') || '时间待定', 'exam-time'), summary);
    }
    group.appendChild(row);
  });
  results.replaceChildren(card);
  $('academic-records').scrollTop = scrollTop;
  recordViews[panel] = { account: scope.accountKey, term: selectedTerm, rows: displayed.rows, node: card, scrollTop };
}

document.querySelectorAll('[data-academic]').forEach(button => {
  button.addEventListener('click', () => selectAcademicPanel(button.dataset.academic));
});
$('recordTerm').addEventListener('change', event => {
  recordTerms[academicPanel] = event.target.value;
  renderAcademicRecords();
});
$('recordRefresh').addEventListener('click', () => renderAcademicRecords(true));
$('recordBack').addEventListener('click', () => {
  selectAcademicPanel('timetable');
  $('academicBind').focus();
  $('academicBind').scrollIntoView({ block: 'nearest' });
});
$('recordPortal').addEventListener('click', () => { if (native) native.openAcademicBinding(); });

function queueSchoolRead(action) {
  const job = schoolReads.then(action);
  schoolReads = job.catch(() => {});
  return job;
}

function requestRecordPortal(kind, account, termId) {
  return queueSchoolRead(() => {
    const scope = schoolSync.snapshot();
    if (scope.accountKey !== account) throw { code: 'account-changed' };
    if (scope.state === 'reauthorize') throw { code: 'expired' };
    if (!navigator.onLine || !native.academicOnline()) throw { code: 'network' };
    return new Promise((resolve, reject) => {
      const id = ++nextRecordRequest;
      const timer = setTimeout(() => window.academicRecordsReturned(id, '', 'timeout'), 35000);
      recordPending = { id, timer, resolve, reject, termId };
      const label = kind === 'exams' ? JufeAcademicAdapter.portalTermLabel(termId) : termId;
      if (!native.openAcademicRecords(id, kind, label,
          JufeAcademicAdapter.portalTermLabel(scope.selected), account)) {
        window.academicRecordsReturned(id, '', 'format');
      }
    });
  });
}

window.academicRecordsReturned = function (id, capture, error) {
  const pending = recordPending;
  if (!pending || id !== pending.id) return;
  recordPending = null;
  clearTimeout(pending.timer);
  if (error) {
    pending.reject({ code: error === 'request' ? 'network' : error });
    if (error === 'expired' || error === 'account-changed') schoolSync.requireReauthorization();
    return;
  }
  try {
    pending.resolve({ ...JSON.parse(capture), termId: pending.termId });
  } catch (_) {
    pending.reject({ code: 'format' });
  }
};

function requestSchoolPortal(termId, interactive) {
  return queueSchoolRead(() => readSchoolPortal(termId, interactive));
}

function readSchoolPortal(termId, interactive) {
  if (!navigator.onLine || !native.academicOnline()) return Promise.reject(new Error('当前离线，已保留本机课表'));
  if (portalPending) return Promise.reject(new Error('已有教务窗口正在读取'));
  const label = JufeAcademicAdapter.portalTermLabel(termId);
  return new Promise((resolve, reject) => {
    portalPending = { resolve, reject, interactive };
    if (!native.openAcademicSync(label, interactive)) {
      portalPending = null;
      reject(new Error('无法打开教务窗口'));
    }
  });
}

async function receiveSchoolAuthorization(restore, manual = false) {
  if (!schoolTransport) {
    showSchoolStatus();
    return;
  }
  if (schoolAuthorizing || portalPending || (restore && !manual
      && (schoolVerificationFailed || !schoolSync.needsRefresh()))) return;
  const saved = schoolSync.snapshot();
  if (restore && (saved.state !== 'unverified' || !navigator.onLine || !native.academicOnline())) return;
  schoolAuthorizing = true;
  $('academicBind').disabled = true;
  $('academicBindingState').textContent = restore ? '正在刷新本人课表…' : '请在校方窗口完成认证。';
  let previousTerm = '';
  try {
    const result = await requestSchoolPortal(restore ? saved.selected : '', !restore);
    const candidate = { accountKey: result.accountKey, handle: {
      accountKey: result.accountKey, terms: result.terms, pending: result
    } };
    previousTerm = $('term').value;
    if (previousTerm.startsWith(schoolPrefix)) {
      snapshot = null;
      empty($('schedule'));
      empty($('week'));
      $('scheduleStatus').textContent = '正在核验教务授权…';
    }
    let entry;
    try {
      entry = await (restore ? schoolSync.restore(candidate, manual) : schoolSync.bind(candidate));
      schoolVerificationFailed = false;
    } finally {
      candidate.handle.pending = null;
    }
    const selected = schoolSync.snapshot().selected;
    if (selected) {
      renderTermOptions(schoolPrefix + selected, entry);
    }
    showSchoolStatus();
  } catch (error) {
    if (restore) {
      schoolVerificationFailed = true;
      if (error.code === 'expired') schoolSync.requireReauthorization();
    }
    if (previousTerm.startsWith(schoolPrefix)) {
      const selected = schoolSync.snapshot().selected;
      renderTermOptions(selected ? schoolPrefix + selected : '');
    }
    $('academicBindingState').textContent = error.message;
    if (academicPanel !== 'timetable') renderAcademicRecords();
  } finally {
    schoolAuthorizing = false;
    $('academicBind').disabled = false;
  }
}

function completeSchoolPortal(capture, syncError, interactive) {
  if (portalPending && portalPending.interactive === interactive) {
    const pending = portalPending;
    portalPending = null;
    try {
      if (!capture) {
        if (syncError === 'expired') {
          const error = new Error('教务会话已失效，请重新绑定。已保留本机课表');
          error.code = 'expired';
          throw error;
        }
        throw new Error(syncError ? '未能读取教务课表，已保留本机课表' : '已退出教务窗口');
      }
      const data = JSON.parse(capture);
      if (!/^[A-Za-z0-9_-]{43}$/.test(data.accountKey) || !Array.isArray(data.terms)) throw new Error('教务账号校验失败');
      if (schoolSync.protectAccount(data.accountKey)) {
        if ($('term').value.startsWith(schoolPrefix)) renderTermOptions('');
        if (!interactive) {
          const error = new Error('教务账号已切换，请主动重新绑定。');
          error.code = 'account-changed';
          throw error;
        }
      }
      const response = { format: 'jufe-portal-grid', content: data.grid };
      const schedule = JufeAcademicAdapter.parseSchedule(response, JufeAcademicAdapter.schoolParsers);
      const terms = JufeAcademicAdapter.verifiedPortalTerms(data.terms, data.current);
      if (!terms.some(item => item.termId === schedule.termId) || terms.filter(item => item.current).length !== 1) {
        throw new Error('无法核对课表学期与校方当前学期');
      }
      pending.resolve({ accountKey: data.accountKey, terms, schedule, response });
    } catch (error) { pending.reject(error); }
    return true;
  }
  return false;
}

window.academicBackgroundReturned = (capture, error) => completeSchoolPortal(capture, error, false);

window.academicPortalReturned = function (structure, grid, capture, syncError) {
  if (completeSchoolPortal(capture, syncError, true)) return;
  const summary = $('academicStructure');
  summary.hidden = !structure && !grid;
  summary.textContent = structure ? '本机脱敏结构 · ' + structure : '';
  if (grid) {
    try {
      const schedule = JufeAcademicAdapter.parseSchedule({ format: 'jufe-portal-grid', content: grid },
        JufeAcademicAdapter.schoolParsers);
      summary.textContent += '\n已读取并校验 ' + schedule.courses.length + ' 个上课时段，未写入缓存。';
    } catch (error) {
      summary.textContent += '\n' + error.message;
    }
  }
};

async function refreshSchool(termId, manual) {
  const selected = schoolPrefix + termId;
  $('term').disabled = true;
  $('scheduleSync').disabled = true;
  try {
    const pending = schoolSync.refresh(termId, manual);
    const cached = schoolSync.snapshot().entry;
    if (cached && $('term').value === selected) installSchedule(cached, '本机缓存', '江财教务');
    const entry = await pending;
    if ($('term').value === selected) {
      if (entry) installSchedule(entry, entry.status === 'fallback' ? '同步未完成 · 保留旧课表'
        : entry.status === 'fresh' ? '已同步' : '本机缓存', '江财教务');
      else {
        snapshot = null;
        empty($('schedule'));
        empty($('week'));
        $('scheduleStatus').textContent = '此学期尚无可用课表';
      }
    }
    showSchoolStatus();
    if (schoolSync.snapshot().state === 'unverified' && !schoolAuthorizing
        && (manual || schoolSync.needsRefresh())) receiveSchoolAuthorization(true, manual);
  } catch (error) {
    if (error.code === 'account-changed') renderTermOptions('');
    $('academicBindingState').textContent = error.message;
    if (academicPanel !== 'timetable') renderAcademicRecords();
  } finally {
    $('term').disabled = false;
    $('scheduleSync').disabled = false;
  }
}

window.resumeAcademicSync = function () {
  const termId = $('term').value;
  if (termId.startsWith(schoolPrefix) && !schoolSync.snapshot().syncing && !schoolAuthorizing && !portalPending) {
    refreshSchool(termId.slice(schoolPrefix.length), false);
  }
};

function renderTermOptions(selected, entry) {
  const term = $('term');
  empty(term);
  schoolSync.snapshot().terms.forEach(item => term.add(new Option('江财 · ' + item.term, schoolPrefix + item.termId)));
  demoTerms.forEach(item => term.add(new Option(item.term, item.termId)));
  importedSchedules.list().forEach(item => {
    term.add(new Option('本地 · ' + item.term, importedPrefix + item.termId));
  });
  if (selected) term.value = selected;
  if (!term.value) term.selectedIndex = 0;
  loadSelectedTerm(entry);
}

function loadSelectedTerm(entry) {
  const termId = $('term').value;
  const imported = termId.startsWith(importedPrefix);
  if (termId.startsWith(schoolPrefix)) {
    $('academicRemove').hidden = true;
    $('scheduleSync').textContent = '刷新课表';
    if (entry) installSchedule(entry, entry.status === 'fresh' ? '已同步' : '本机缓存', '江财教务');
    else refreshSchool(termId.slice(schoolPrefix.length), false);
    return;
  }
  $('academicRemove').hidden = !imported;
  $('scheduleSync').textContent = imported ? '读取本地课表' : '同步示例';
  if (imported) {
    const entry = importedSchedules.read(termId.slice(importedPrefix.length));
    if (entry) installSchedule(entry, '导入时间', '本地导入');
    return;
  }
  const cached = scheduleRepo.read(termId);
  if (cached) installSchedule(cached, '已读取离线缓存');
  else {
    snapshot = null;
    empty($('schedule'));
    empty($('week'));
    $('previousWeek').disabled = true;
    $('nextWeek').disabled = true;
    syncSchedule();
  }
}

$('academicFormat').addEventListener('change', event => {
  $('academicImport').textContent = event.target.value === 'school' ? '检查原始样本' : '校验并导入';
});
let importing = false;
$('academicImport').addEventListener('click', async () => {
  if (importing) return;
  const file = $('academicFile').files[0];
  const pasted = $('academicPaste').value;
  const status = $('academicImportStatus');
  if (file && pasted.trim()) {
    status.textContent = '请只使用一种导入方式，清空文件或粘贴内容后重试。';
    return;
  }
  importing = true;
  $('academicImport').disabled = true;
  try {
    const content = file ? await AcademicImport.readFile(file) : pasted;
    const result = $('academicFormat').value === 'school'
      ? AcademicImport.inspectSchoolSample(content)
      : { schedule: AcademicImport.parse(content) };
    if (!result.schedule) {
      $('academicFile').value = '';
      $('academicPaste').value = '';
      status.textContent = result.summary + '。当前尚无对应的学校解析器，本次只检查结构，原课表保留。';
      return;
    }
    const schedule = result.schedule;
    try {
      importedSchedules.save(schedule);
    } catch (error) {
      if (error.code !== 'empty-replacement') throw error;
      if (!window.confirm('样本声明此学期没有课程。用空课表替换已有课表？')) {
        status.textContent = error.message;
        return;
      }
      importedSchedules.save(schedule, { replaceWithEmpty: true });
    }
    $('academicFile').value = '';
    $('academicPaste').value = '';
    renderTermOptions(importedPrefix + schedule.termId);
    status.textContent = '已保存到本机 · ' + schedule.courses.length + ' 个上课时段';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    importing = false;
    $('academicImport').disabled = false;
  }
});

$('academicRemove').addEventListener('click', () => {
  const selected = $('term').value;
  if (!selected.startsWith(importedPrefix) || !window.confirm('移除当前导入学期的本地课表？')) return;
  const status = $('academicImportStatus');
  try {
    importedSchedules.remove(selected.slice(importedPrefix.length));
    renderTermOptions();
    status.textContent = '已移除本地导入课表';
  } catch (error) {
    status.textContent = error.message;
  }
});

Academic.mockAdapter.listTerms().then(terms => {
  demoTerms = terms;
  const saved = schoolSync.snapshot().selected;
  renderTermOptions(saved ? schoolPrefix + saved : '');
  if (!saved) showSchoolStatus();
});
scheduleStudyUpdates(1500);
