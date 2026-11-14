'use strict';

const $ = id => document.getElementById(id);
const tabs = Array.from(document.querySelectorAll('[data-tab]'));
const native = window.Android;
const zhuli = Zhuli.create(native);
const zhuliDevicePage = ZhuliDevicePage.mount(ZhuliDevices.create());
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

let accountsReturn = 'me';

function select(tab) {
  const onAccounts = tab === 'accounts';
  if (!onAccounts && !$('page-accounts').hidden) {
    WaterPage.cancelLogin();
    closeStudyCredentials();
  }
  $('page-accounts').hidden = !onAccounts;
  tabs.forEach(button => {
    const active = button.dataset.tab === tab;
    $('page-' + button.dataset.tab).hidden = !active;
    button.classList.toggle('active', active || (onAccounts && button.dataset.tab === 'me'));
    if (active || (onAccounts && button.dataset.tab === 'me')) button.setAttribute('aria-current', 'page');
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
window.closeDetails = () => closeStudyCredentials() || WaterPage.close() || window.closeTodoEditor?.() || closeCourseDetails()
  || (!$('page-accounts').hidden && (select(accountsReturn), true));
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
const activeStudyScope = Learning.restore;
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
const studyConnectionKey = 'jct.study.connection';
function studyConnection(value) {
  try {
    if (value) localStorage.setItem(studyConnectionKey, value);
    return localStorage.getItem(studyConnectionKey) || '';
  } catch (_) { return ''; }
}
let showInactiveStudyCourses = false;
let studyListState = [];
const studyOpenSections = new Map();
let studyForeground = true;
let studyAutoFailedAt = 0;

function courseKey(course) {
  return String(course.courseId) + ':' + String(course.classId);
}

function reconcileStudyCache() {
  const scope = activeStudyScope();
  if (studyCache.scope !== scope) {
    if (scope) studyConnection('saved');
    else if (studyCache.scope && studyConnection() !== 'disconnected') studyConnection('expired');
    studyCache = readStudyCache(scope);
    selectedCourse = '';
    studyAttempt = null;
    showInactiveStudyCourses = false;
    studyOpenSections.clear();
    studyAutoFailedAt = 0;
    studyMessage = scope ? '已接收学习通会话，请查询课程确认授权。'
      : studyConnection() === 'expired' ? '学习通会话已过期，请重新连接。' : '';
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
  studyAutoFailedAt = 0;
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
      if (item.url) {
        const button = node('button', null, 'study-task');
        button.type = 'button';
        button.append(node('span', item.title, 'task-name'),
          node('span', [status, '打开学习通'].filter(Boolean).join(' · '), 'course-meta'));
        button.addEventListener('click', () => native?.openStudyTask?.(item.url));
        group.appendChild(button);
      } else group.appendChild(resultRow(item.title, status));
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

const studyKinds = { work: '作业', exam: '考试', quiz: '随堂练习', sign: '签到与签退',
  topic: '主题讨论', notice: '通知', other: '其他活动' };
const studyFilter = { kind: 'all', state: 'todo', order: 'urgent' };

function studyDeadline(item) {
  if (item.kind === 'notice') return '';
  if (item.deadlineEstimated) return item.left || '';
  if (Number.isFinite(item.endAt) && item.endAt > 0) return '截止 ' + time(item.endAt * 1000);
  return item.left && !/剩余|开始|发布时间|发布于/.test(item.left) ? item.left : '';
}

function studyTaskTiming(item, state) {
  const due = studyDeadline(item);
  if (state !== 'todo' || item.kind === 'notice' || item.deadlineEstimated) return due;
  const minutes = Learning.minLeft(item);
  if (minutes == null || minutes < 0 || (item.kind === 'sign' && !item.endAt)) return due;
  return [Learning.leftLabel(minutes), due].filter(Boolean).join(' · ');
}

function pendingHomework(entry) {
  const now = Date.now() / 1000;
  return entry?.sections?.find(section => section.title === '作业')?.items
    ?.filter(item => item.kind === 'work' && Learning.taskState(item, now) === 'todo');
}

function openStudyTask(item, course) {
  if (item.url && native?.openStudyTask?.(item.url)) return;
  openStudyCourse(course);
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

function cxItemHtml(item, showCourse, now) {
  const course = item.courseRecord;
  const state = item.taskState;
  const button = node('button', null, 'study-task');
  button.type = 'button';
  const isNew = item.newAt > 0 && now >= item.newAt && now - item.newAt < 24 * 3600000;
  const label = item.title.includes(studyKinds[item.kind]) ? '' : studyKinds[item.kind];
  const status = state === 'closed' ? '已截止' : state === 'done' ? item.status || '已完成'
    : state === 'todo' ? item.status || '未完成' : item.status;
  const minutes = state === 'todo' && item.kind !== 'notice' ? Learning.minLeft(item) : null;
  button.append(node('span', item.title, 'task-name'),
    node('span', [showCourse ? course.title : '', label, status, studyTaskTiming(item, state),
      isNew ? '新发现' : '', item.url ? '打开学习通' : ''].filter(Boolean).join(' · '), 'course-meta'));
  if (minutes != null && minutes >= 0 && minutes <= 1440) button.dataset.urgent = 'true';
  button.addEventListener('click', () => openStudyTask(item, course));
  return button;
}

function cxPaintTodo(courses) {
  const target = $('studyTasks');
  const now = Date.now();
  const tasks = [];
  let loaded = 0;
  for (const course of courses) {
    const sections = studyCache.details[courseKey(course)]?.sections || [];
    if (!sections.some(section => Array.isArray(section.items))) continue;
    loaded++;
    const seen = new Set();
    const work = sections.find(section => section.title === '作业')?.items || [];
    for (const section of sections) {
      for (const item of section.items || []) {
        if (section.title === '活动' && item.kind === 'work'
            && work.some(row => (row.id && row.id === item.id) || row.title === item.title)) continue;
        const key = item.id && item.kind + ':' + item.id;
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        tasks.push({ course, item, state: Learning.taskState(item, now / 1000) });
      }
    }
  }
  $('studyFilters').hidden = !loaded;
  if (!loaded) { target.replaceChildren(); return; }
  const section = node('section');
  const selected = tasks.filter(task => (studyFilter.kind === 'all' || task.item.kind === studyFilter.kind)
    && (studyFilter.state === 'todo' ? Learning.visibleTodo(task.item, now / 1000)
      : studyFilter.state === 'all' || task.state === studyFilter.state));
  const fresh = tasks.filter(({ item }) => item.newAt > 0 && now >= item.newAt && now - item.newAt < 24 * 3600000);
  section.appendChild(sectionHeading('学习任务', selected.length + ' 项 · 已读 ' + loaded + ' 门课程'
    + (fresh.length ? ' · ' + fresh.length + ' 项新发现' : '')));
  const items = selected.map(task => ({ ...task.item, courseId: task.course.courseId,
    classId: task.course.classId, course: task.course.title, courseRecord: task.course, taskState: task.state }));
  const ordered = Learning.sortItems(items);
  const list = node('div', null, 'card task-list');
  if (!selected.length) list.appendChild(node('p', '当前筛选下没有任务。', 'empty-state'));
  if (studyFilter.order === 'course') {
    for (const group of Learning.groupByCourse(ordered)) {
      const fold = node('details', null, 'result-group');
      fold.open = true;
      fold.append(node('summary', group.course + ' · ' + group.items.length + ' 项'),
        ...group.items.map(task => cxItemHtml(task, false, now)));
      list.appendChild(fold);
    }
  } else {
    ordered.slice(0, 6).forEach(task => list.appendChild(cxItemHtml(task, true, now)));
    if (ordered.length > 6) {
      const more = node('details', null, 'result-group study-hidden');
      more.open = target.querySelector('details')?.open || false;
      more.appendChild(node('summary', '其余 ' + (ordered.length - 6) + ' 项'));
      ordered.slice(6).forEach(task => more.appendChild(cxItemHtml(task, true, now)));
      list.appendChild(more);
    }
  }
  section.appendChild(list);
  target.replaceChildren(section);
}

function renderStudy() {
  const linked = !!reconcileStudyCache();
  $('studyLogin').hidden = linked;
  $('studyLogin').textContent = studyConnection() === 'expired' ? '重新连接学习通' : '管理学习通账号';
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
  cxPaintTodo(active);
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
  $('studyCredentials').hidden = false;
  $('studyCredentialError').textContent = '';
  $('studySavedLogin').hidden = !native.cxHasSavedLogin();
  $('studyCredentials').scrollIntoView({ block: 'nearest' });
  $('studyUsername').focus();
}

function openOfficialStudyLogin() {
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
  if (!$('page-accounts').hidden) setAccountMessage(studyMessage);
  renderStudy();
}

function scheduleStudyUpdates() {
  const scope = reconcileStudyCache();
  if (!studyBusy && navigator.onLine && Learning.autoScan({
    linked: !!scope, visible: studyForeground && !document.hidden && !$('page-study').hidden,
    lastAt: studyCache.scanAt ?? studyCache.at, failedAt: studyAutoFailedAt
  })) queryStudy(null, true);
}

window.pauseStudyUpdates = () => { studyForeground = false; };
window.resumeStudyUpdates = () => {
  studyForeground = true;
  scheduleStudyUpdates();
};
document.addEventListener('visibilitychange', scheduleStudyUpdates);
window.addEventListener('online', scheduleStudyUpdates);

async function queryStudy(course, automatic = false) {
  if (!native || studyBusy) return;
  const scope = reconcileStudyCache();
  if (!scope) return;
  if (course) selectedCourse = courseKey(course);
  studyBusy = true;
  studyMessage = '正在读取学习通…';
  refreshSession();
  const timetable = schoolSync.snapshot();
  const term = timetable.terms.find(item => item.current && item.termId === timetable.selected);
  const names = !course && term ? timetable.entry?.schedule?.courses?.map(item => ({ name: item.name, teacher: item.teacher })) : null;
  let checked = 0;
  let failed = 0;
  let processed = 0;
  let hasUsefulData = false;
  const sectionsRead = { 作业: 0, 考试: 0, 活动: 0 };
  const scanChanges = new Map();
  try {
    const result = await Learning.scan(scope, {
      course,
      names,
      semester: term?.term || '',
      force: !automatic,
      lastAt: studyCache.scanAt,
      rest: studyCache.scan?.rest || {},
      courses(courses) {
        if (activeStudyScope() !== scope || course) return;
        studyCache = { ...studyCache, courses, at: Date.now() };
        studyConnection('verified');
        saveStudyCache();
        renderStudy();
      },
      full(item) {
        const record = studyCache.updates[courseKey(item)];
        return !!course || !automatic || ((!record?.reliable || StudyActivity.hiddenReason(record))
          && StudyActivity.needsFullCheck(record, Date.now()));
      },
      capture(item, sections) {
        if (activeStudyScope() !== scope) return;
        const key = courseKey(item);
        const at = Date.now();
        const tagged = sections.map(section => ({ ...section, courseId: item.courseId, classId: item.classId }));
        const merged = Learning.mergeCourseResults(studyCache.details[key], tagged, at);
        for (const section of sections) if (!section.error) {
          hasUsefulData = true;
          sectionsRead[section.title] += section.items.length;
        }
        if (sections.some(section => section.error || section.complete === false)) failed++;
        else checked++;
        const work = sections.find(section => section.title === '作业');
        const activities = sections.find(section => section.title === '活动');
        scanChanges.set(key, { at, merged, sections, work, activities });
      },
      progress(scan) {
        if (activeStudyScope() !== scope) return;
        studyMessage = '正在检查学习通 · ' + (++processed) + '/' + (course ? 1 : studyCache.courses.length)
          + (scan.phase ? ' · ' + scan.phase : '');
        $('studyStatus').textContent = studyMessage;
      }
    });
    if (!result || activeStudyScope() !== scope) return;
    for (const [key, change] of scanChanges) {
      const { at, merged, sections, work, activities } = change;
      if (work && activities) studyCache.updates[key] = StudyActivity.update(studyCache.updates[key], sections, at);
      else if (activities) studyCache.updates[key] = StudyActivity.observeActivities(studyCache.updates[key], activities, at);
      studyCache.details[key] = merged.cache;
      if (course) studyAttempt = { key, sections: merged.sections };
    }
    if (!course) {
      studyCache.scanAt = result.at * 1000;
      studyCache.scan = { rest: result.rest, skipped: result.skipped, counts: result.counts,
        failed: result.failed, paused: result.paused };
    }
    if (!course || hasUsefulData) studyConnection('verified');
    studyAutoFailedAt = 0;
    studyMessage = (course ? '课程任务检查完成' : '课程检查完成 · ' + checked + ' 门已读取'
      + ' · 作业 ' + sectionsRead['作业'] + '、考试 ' + sectionsRead['考试'] + '、活动 ' + sectionsRead['活动'])
      + (failed ? '，' + failed + ' 门部分未读全。' : '。');
    if (result.persistError) studyMessage += ' 本次会话更新未保存。';
    saveStudyCache();
  } catch (error) {
    if (activeStudyScope() !== scope) return;
    if (error.kind === 'auth') {
      native.cxInvalidate(scope);
      studyConnection('expired');
      clearStudyCache();
      studyMessage = '学习通会话已过期，请重新连接。';
    } else {
      if (automatic) studyAutoFailedAt = Date.now();
      studyMessage = error.message + (studyCache.at ? '。保留上次可用结果。' : '');
    }
  } finally {
    studyBusy = false;
    refreshSession();
    if (course && studyCache.details[selectedCourse] && !$('page-study').hidden) {
      $('studyDetails').scrollIntoView({ block: 'nearest' });
    }
  }
}

function openAccounts() {
  if (!$('page-accounts').hidden) return;
  setAccountMessage('');
  accountsReturn = tabs.find(button => button.getAttribute('aria-current') === 'page')?.dataset.tab || 'me';
  select('accounts');
}
window.openServiceAccounts = openAccounts;

let academicDisconnecting = false;
let academicDisconnectTimer;
function setAccountMessage(message) {
  $('accountsStatus').textContent = message;
  $('accountsStatus').hidden = !message;
}

async function disconnectAcademic() {
  if (academicDisconnecting || schoolAuthorizing || portalPending || recordPending || schoolSync.snapshot().syncing) {
    setAccountMessage('请等待当前教务查询结束。');
    return;
  }
  if (!window.confirm('断开江财教务？已下载的课表会保留在本机，重新绑定后可查看。')) return;
  academicDisconnecting = true;
  renderAccounts();
  if (native.disconnectAcademic()) {
    academicDisconnectTimer = setTimeout(() => window.academicDisconnected('timeout'), 12000);
  } else window.academicDisconnected('request');
}

window.academicDisconnected = function (error) {
  if (!academicDisconnecting) return;
  clearTimeout(academicDisconnectTimer);
  try {
    if (error) throw new Error('暂时无法断开教务，请稍后再试。');
    schoolSync.disconnect();
    schoolVerificationFailed = false;
    recordRender++;
    for (const key of Object.keys(recordViews)) delete recordViews[key];
    for (const key of Object.keys(recordTerms)) delete recordTerms[key];
    renderTermOptions($('term').value.startsWith(schoolPrefix) ? '' : $('term').value);
    updateAcademicViews();
    setAccountMessage('江财教务已断开。');
  } catch (failure) {
    setAccountMessage(failure.message);
  } finally {
    academicDisconnecting = false;
    renderAccounts();
  }
};

function disconnectStudy() {
  if (!window.confirm('退出学习通并清除本机学习通缓存？')) return;
  try {
    native.cxClear();
    studyConnection('disconnected');
    clearStudyCache(true);
    studyMessage = '已退出学习通。';
    setAccountMessage(studyMessage);
  } catch (_) {
    setAccountMessage('无法清除学习通登录状态。');
  }
  refreshSession();
}

function connectAcademic() {
  if (schoolTransport) receiveSchoolAuthorization(false);
  else native.openAcademicBinding();
}

function renderAccounts() {
  $('clearWebCache').disabled = !native;
  if ($('page-accounts').hidden) return;
  const school = schoolSync.snapshot();
  const cx = !!activeStudyScope();
  const water = native ? Water.state() : { state: 'unknown', accounts: {} };
  const schoolState = ({ authorized: '已连接', unverified: '已绑定 · 会话待核验',
    reauthorize: '会话过期', unbound: '未连接' })[school.state];
  const connection = studyConnection();
  const studyState = !native ? '状态未知' : cx
    ? (studyCache.at || connection === 'verified' ? '已连接' : '已保存会话 · 待核验')
    : connection === 'expired' ? '会话过期'
      : ['saved', 'verified'].includes(connection) ? '状态未知' : '未连接';
  const rows = [
    { id: 'school', name: '江西财经大学教务', state: native ? schoolState : '状态未知',
      connect: connectAcademic, disconnect: school.accountKey ? disconnectAcademic : null,
      busy: schoolAuthorizing || academicDisconnecting || school.syncing },
    { id: 'study', name: '超星学习通', state: studyState,
      connect: openStudyLogin, disconnect: cx ? disconnectStudy : null, busy: studyBusy },
    ...['device', 'score'].map(kind => {
      const account = water.accounts?.[kind];
      const expired = WaterPage.expired(kind) || water.state === 'broken';
      const phone = String(account?.phone || '');
      const masked = /^\d{11}$/.test(phone) ? ' · ' + phone.slice(0, 3) + '****' + phone.slice(-4) : '';
      return { id: 'water-' + kind, name: kind === 'device' ? '慧生活798 设备' : '慧生活798 积分',
        state: (expired ? '会话过期' : account ? (WaterPage.verified(kind) ? '已连接' : '已保存会话')
          : native ? '未连接' : '状态未知') + masked,
        connect: () => WaterPage.login(kind), disconnect: account ? () => WaterPage.logout(kind) : null,
        busy: WaterPage.busy(), disabled: !Water.configured() };
    }),
    { id: 'zhuli', name: '住理生活', state: '未接入酱菜通账号',
      label: zhuli.status() === 'external-store' ? '查看官方应用' : '打开官方应用',
      connect: () => zhuli.open(), disabled: zhuli.status() === 'unavailable' }
  ];
  const target = $('accountsList');
  const focus = document.activeElement?.dataset.accountAction;
  target.replaceChildren(...rows.map(row => {
    const item = node('div', null, 'setting-row account-row');
    const text = node('div', null, 'account-description');
    text.append(node('h2', row.name), node('p', row.state, 'sub'));
    const actions = node('div', null, 'account-actions');
    const connect = node('button', row.label || (row.disconnect || row.state.startsWith('会话过期') ? '重连' : '连接'), 'btn');
    connect.type = 'button';
    connect.dataset.accountAction = row.id + '-connect';
    connect.disabled = !native || !!row.busy || !!row.disabled;
    connect.addEventListener('click', () => { setAccountMessage(''); row.connect(); });
    actions.append(connect);
    if (row.disconnect) {
      const disconnect = node('button', '断开', 'btn');
      disconnect.type = 'button';
      disconnect.dataset.accountAction = row.id + '-disconnect';
      disconnect.disabled = !!row.busy;
      disconnect.addEventListener('click', row.disconnect);
      actions.append(disconnect);
    }
    item.append(text, actions);
    return item;
  }));
  if (focus) target.querySelector('[data-account-action="' + focus + '"]')?.focus({ preventScroll: true });
}
window.renderServiceAccounts = renderAccounts;

function renderZhuli() {
  zhuliDevicePage.render();
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
  WaterPage.update();
}

function refreshSession() {
  renderStudy();
  WaterPage.update();
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

function closeStudyCredentials() {
  if ($('studyCredentials').hidden) return false;
  $('studyCredentials').hidden = true;
  $('studyCredentialForm').reset();
  return true;
}

async function submitStudyCredentials(saved) {
  if (studyBusy) return;
  const user = saved ? '' : $('studyUsername').value.trim();
  const password = saved ? '' : $('studyPassword').value;
  const remember = $('studyRemember').checked;
  $('studyPassword').value = '';
  studyBusy = true;
  $('studyCredentialSubmit').disabled = $('studySavedLogin').disabled = $('studyOfficialLogin').disabled = true;
  $('studyCredentialError').textContent = '正在连接学习通…';
  renderAccounts();
  try {
    const result = await Learning.relink(user, password, remember);
    if (!result) return;
    reconcileStudyCache();
    studyCache = { ...studyCache, courses: result.courses, at: Date.now(), scanAt: 0 };
    studyConnection('verified');
    saveStudyCache();
    closeStudyCredentials();
    setAccountMessage(result.saveError ? '学习通已连接。' + result.saveError : '学习通已连接。');
  } catch (error) {
    $('studyCredentialError').textContent = error.message;
    $('studySavedLogin').hidden = !native.cxHasSavedLogin();
  } finally {
    studyBusy = false;
    $('studyCredentialSubmit').disabled = $('studySavedLogin').disabled = $('studyOfficialLogin').disabled = false;
    refreshSession();
    scheduleStudyUpdates();
  }
}

$('studyCredentialForm').addEventListener('submit', event => {
  event.preventDefault();
  submitStudyCredentials(false);
});
$('studySavedLogin').addEventListener('click', () => submitStudyCredentials(true));
$('studyOfficialLogin').addEventListener('click', () => {
  closeStudyCredentials();
  openOfficialStudyLogin();
});
$('studyCredentialCancel').addEventListener('click', closeStudyCredentials);
$('accountsOpen').addEventListener('click', openAccounts);
$('accountsBack').addEventListener('click', () => select(accountsReturn));

tabs.forEach(button => button.addEventListener('click', () => select(button.dataset.tab)));
document.querySelectorAll('[data-life]').forEach(button => {
  button.addEventListener('click', () => selectLifeService(button.dataset.life));
});
$('zhuliOpen').addEventListener('click', () => {
  if (!zhuli.open()) toast('无法打开住理生活，请在应用商店搜索。');
});
$('studyLogin').addEventListener('click', openAccounts);
$('studyRefresh').addEventListener('click', () => queryStudy(null));
function renderFilteredStudyTasks() {
  cxPaintTodo(studyCache.courses.filter(course => !StudyActivity.hiddenReason(studyCache.updates[courseKey(course)])));
}
$('studyTaskOrder').addEventListener('click', event => {
  const grouped = studyFilter.order !== 'course';
  studyFilter.order = grouped ? 'course' : 'urgent';
  event.currentTarget.setAttribute('aria-pressed', String(grouped));
  event.currentTarget.textContent = grouped ? '按紧急度排序' : '按课程分组';
  renderFilteredStudyTasks();
});
function setStudyTaskState(state) {
  studyFilter.state = state;
  $('studyTaskState').querySelectorAll('[data-task-state]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.taskState === state));
  });
  renderFilteredStudyTasks();
}
$('studyTaskState').addEventListener('click', event => {
  const button = event.target.closest('[data-task-state]');
  if (button) setStudyTaskState(button.dataset.taskState);
});
$('studyKind').addEventListener('change', event => {
  studyFilter.kind = event.target.value;
  if (studyFilter.kind === 'notice') setStudyTaskState('all');
  else renderFilteredStudyTasks();
});
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
$('previousWeek').addEventListener('click', () => { week--; renderSchedule(); });
$('nextWeek').addEventListener('click', () => { week++; renderSchedule(); });
$('week').addEventListener('change', event => { week = Number(event.target.value); renderSchedule(); });
$('day').addEventListener('change', event => { day = Number(event.target.value); renderSchedule(); });
$('weekView').addEventListener('click', () => { daily = false; renderSchedule(); });
$('dayView').addEventListener('click', () => { daily = true; renderSchedule(); });

refreshSession();

function updateAcademicViews() {
  renderAccounts();
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
    'needs-auth': '请先在账号管理中连接教务。',
    expired: '教务会话已失效，请在账号管理中重连。',
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
$('recordBack').addEventListener('click', openAccounts);
$('recordPortal').addEventListener('click', () => { if (native) native.openAcademicBinding(); });

function queueSchoolRead(action) {
  const job = schoolReads.then(() => {
    if (academicDisconnecting) throw new Error('教务正在断开');
    return action();
  });
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
    updateAcademicViews();
    return;
  }
  if (academicDisconnecting || schoolAuthorizing || portalPending || (restore && !manual
      && (schoolVerificationFailed || !schoolSync.needsRefresh()))) return;
  const saved = schoolSync.snapshot();
  if (restore && (saved.state !== 'unverified' || !navigator.onLine || !native.academicOnline())) return;
  schoolAuthorizing = true;
  if (!restore && !$('page-accounts').hidden) setAccountMessage('请在校方窗口完成认证。');
  renderAccounts();
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
    updateAcademicViews();
    if (!restore && !$('page-accounts').hidden) setAccountMessage('江财教务已连接。');
  } catch (error) {
    if (restore) {
      schoolVerificationFailed = true;
      if (error.code === 'expired') schoolSync.requireReauthorization();
    }
    if (previousTerm.startsWith(schoolPrefix)) {
      const selected = schoolSync.snapshot().selected;
      renderTermOptions(selected ? schoolPrefix + selected : '');
    }
    if (!restore && !$('page-accounts').hidden) setAccountMessage(error.message);
    else if (manual) toast(error.message);
    updateAcademicViews();
  } finally {
    schoolAuthorizing = false;
    renderAccounts();
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

window.academicPortalReturned = (_structure, _grid, capture, error) => completeSchoolPortal(capture, error, true);

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
    updateAcademicViews();
    const state = schoolSync.snapshot().state;
    if (state === 'unverified' && !schoolAuthorizing && (manual || schoolSync.needsRefresh())) {
      receiveSchoolAuthorization(true, manual);
    } else if (manual && state === 'reauthorize') {
      toast('教务会话已失效，请在账号管理中重连。');
    }
  } catch (error) {
    if (error.code === 'account-changed') renderTermOptions('');
    if (manual) toast(error.message);
    updateAcademicViews();
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
    $('scheduleSync').textContent = '刷新课表';
    if (entry) installSchedule(entry, entry.status === 'fresh' ? '已同步' : '本机缓存', '江财教务');
    else refreshSchool(termId.slice(schoolPrefix.length), false);
    return;
  }
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

Academic.mockAdapter.listTerms().then(terms => {
  demoTerms = terms;
  const saved = schoolSync.snapshot().selected;
  renderTermOptions(saved ? schoolPrefix + saved : '');
  if (!saved) updateAcademicViews();
});
scheduleStudyUpdates();
