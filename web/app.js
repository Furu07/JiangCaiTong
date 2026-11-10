'use strict';

const APP_VERSION = '0.6.3';
const $ = id => document.getElementById(id);
const tabs = Array.from(document.querySelectorAll('[data-tab]'));
const native = window.Android;
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
function showDetails(title, lines) {
  previousFocus = document.activeElement;
  $('detailTitle').textContent = title;
  empty($('detailBody'));
  lines.forEach(line => $('detailBody').appendChild(node('p', line)));
  $('sheetMask').hidden = false;
  $('sheetClose').focus();
}

function closeDetails() {
  if ($('sheetMask').hidden) return false;
  $('sheetMask').hidden = true;
  if (previousFocus) previousFocus.focus();
  return true;
}
window.closeDetails = closeDetails;

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
const recordTerms = {};
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
  button.appendChild(node('span', course.name));
  button.appendChild(node('small', periodLabel(course)));
  const location = [course.campus, course.building, course.location].filter(Boolean).join(' · ');
  button.appendChild(node('small', location || '地点待定', 'course-location'));
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
  visibleDays.forEach(weekday => {
    const date = Academic.dayDate(schedule, week, weekday);
    const column = node('section', null, 'weekday');
    column.appendChild(node('h2', days[weekday - 1], 'weekday-title'));
    column.appendChild(node('p', (date.getUTCMonth() + 1) + '/' + date.getUTCDate(), 'date'));
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

const studyKey = 'jct.study.v2';
const activeStudyScope = () => native ? native.cxSessionKey() : '';
const emptyStudyCache = scope => ({ scope, courses: [], details: {}, at: 0 });

function readStudyCache(scope) {
  try {
    // The old cache had no account marker, so it cannot be attributed safely.
    localStorage.removeItem('jct.study.v1');
    const entry = JSON.parse(localStorage.getItem(studyKey));
    if (scope && entry && entry.scope === scope && Array.isArray(entry.courses) && entry.details) return entry;
    if (entry) localStorage.removeItem(studyKey);
  } catch (error) { /* Invalid or inaccessible cache. */ }
  return emptyStudyCache(scope);
}

let studyCache = readStudyCache(activeStudyScope());
let selectedCourse = '';
let studyAttempt = null;
let studyBusy = false;
let studyMessage = '';

function courseKey(course) {
  return String(course.courseId) + ':' + String(course.classId);
}

function reconcileStudyCache() {
  const scope = activeStudyScope();
  if (studyCache.scope !== scope) {
    studyCache = readStudyCache(scope);
    selectedCourse = '';
    studyAttempt = null;
    studyMessage = scope ? '已接收学习通会话，请查询课程确认授权。' : '';
  }
  return scope;
}

function saveStudyCache() {
  if (!studyCache.scope || activeStudyScope() !== studyCache.scope) return;
  try {
    localStorage.setItem(studyKey, JSON.stringify(studyCache));
  } catch (error) {
    toast('学习通结果仅本次可用，缓存写入失败');
  }
}

function clearStudyCache() {
  studyCache = emptyStudyCache(activeStudyScope());
  selectedCourse = '';
  studyAttempt = null;
  try {
    localStorage.removeItem(studyKey);
  } catch (error) { /* This session cannot be displayed without its matching scope. */ }
}

function showCourseResults(course) {
  const target = $('studyDetails');
  empty(target);
  const key = courseKey(course);
  const entry = studyCache.details[key];
  const sections = studyAttempt && studyAttempt.key === key ? studyAttempt.sections : entry && entry.sections;
  const card = node('section', null, 'card pad');
  card.appendChild(node('h2', course.title || '课程详情'));
  const refresh = node('button', '刷新学习任务', 'btn');
  refresh.disabled = studyBusy;
  refresh.addEventListener('click', () => queryStudy(course));
  card.appendChild(refresh);
  if (!sections) card.appendChild(node('p', studyBusy ? '正在读取…' : '尚无任务缓存。', 'sub'));
  (sections || []).forEach(section => {
    const group = node('details', null, 'result-group');
    const state = section.error ? (section.cached ? ' · 旧缓存' : ' · 查询失败')
      : ' · ' + section.items.length + ' 项';
    group.appendChild(node('summary', section.title + state));
    if (section.error) {
      group.open = true;
      group.appendChild(node('p', section.error, 'sub'));
    }
    if (section.items && (section.at || entry)) {
      group.appendChild(node('p', '数据时间 · ' + time(section.at || entry.at), 'sub'));
    }
    if (section.items && !section.items.length) group.appendChild(node('p', '暂无' + section.title, 'sub'));
    (section.items || []).forEach(item => {
      const signed = item.kind === 'sign' && !item.status
        ? item.signed === true ? '已签' : item.signed === false ? '未签' : '签到状态未知' : '';
      const status = [item.kindName, item.status || signed, item.left].filter(Boolean).join(' · ');
      group.appendChild(resultRow(item.title, status));
    });
    card.appendChild(group);
  });
  target.appendChild(card);
}

function resultRow(title, subtitle) {
  const row = node('div', null, 'result-row');
  row.appendChild(node('strong', title));
  if (subtitle) row.appendChild(node('p', subtitle, 'sub'));
  return row;
}

function renderStudy() {
  const linked = !!reconcileStudyCache();
  $('studyLogin').disabled = !native || studyBusy;
  $('studyRefresh').disabled = !linked || studyBusy;
  $('studyStatus').textContent = studyMessage || (linked
    ? '已载入本机会话，请查询课程确认授权。' : '在超星官方页面完成登录后，点「完成登录并返回」。');
  const target = $('studyCourses');
  empty(target);
  if (studyCache.at) {
    const card = node('section', null, 'card pad');
    card.appendChild(node('h2', '课程 · ' + studyCache.courses.length + ' 门'));
    card.appendChild(node('p', '本机结果 · ' + time(studyCache.at), 'sub'));
    if (!studyCache.courses.length) card.appendChild(node('p', '没有课程记录', 'sub'));
    studyCache.courses.forEach(course => {
      const key = courseKey(course);
      const button = node('button', (course.title || '未命名课程') +
        (course.alias && course.alias !== course.title ? ' · ' + course.alias : ''), 'course-list-item');
      button.disabled = studyBusy || (!linked && !studyCache.details[key]);
      button.setAttribute('aria-pressed', String(selectedCourse === key));
      button.addEventListener('click', () => {
        selectedCourse = key;
        if (!studyCache.details[key]) queryStudy(course);
        else {
          renderStudy();
          $('studyDetails').scrollIntoView({ block: 'nearest' });
        }
      });
      card.appendChild(button);
    });
    target.appendChild(card);
  }
  const current = studyCache.courses.find(course => courseKey(course) === selectedCourse);
  if (current) showCourseResults(current);
  else empty($('studyDetails'));
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

async function queryStudy(course) {
  if (!native || studyBusy) return;
  const scope = reconcileStudyCache();
  if (!scope) return;
  if (course) selectedCourse = courseKey(course);
  studyBusy = true;
  studyMessage = course ? '正在读取作业、考试与活动…' : '正在读取课程…';
  refreshSession();
  try {
    if (course) {
      const sections = await Learning.readCourse(course, scope);
      if (activeStudyScope() !== scope) return;
      const key = courseKey(course);
      const previous = studyCache.details[key];
      const merged = Learning.mergeCourseResults(previous, sections, Date.now());
      studyAttempt = { key, sections: merged.sections };
      if (merged.cache && merged.cache !== previous) studyCache.details[key] = merged.cache;
      studyMessage = sections.every(section => section.error) ? '任务刷新失败，请查看各类别的状态。'
        : sections.some(section => section.error) ? '部分学习任务未更新，请查看各类别的状态。' : '学习任务读取完成。';
    } else {
      const courses = await Learning.courses(scope);
      if (activeStudyScope() !== scope) return;
      const details = {};
      courses.forEach(item => {
        const key = courseKey(item);
        if (studyCache.details[key]) details[key] = studyCache.details[key];
      });
      studyCache = { scope, courses, details, at: Date.now() };
      studyAttempt = null;
      studyMessage = courses.length ? '课程查询成功，会话已验证。' : '课程查询成功，该账号暂无课程。';
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
      if (studyCache.scope === scope) {
        studyMessage = cleared ? '学习通会话已过期，请重新授权。' : '学习通会话已过期，本地登录状态清理失败。';
        clearStudyCache();
      }
    } else if (activeStudyScope() === scope) {
      studyMessage = error.message + (studyCache.at ? '。下方保留上次结果。' : '');
    }
  } finally {
    studyBusy = false;
    refreshSession();
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
    ? '已载入饮水服务登录状态。' : !canStart && native
      ? '本构建缺少经授权的 798 用水登录签名配置，暂不可申请短信。' : state.broken
      ? '本机登录状态已失效，请重新登录。'
      : '使用手机号、图形验证码和短信验证码登录。');
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
  $('studyAccount').textContent = '学习通 · ' + (cx ? '已载入本机登录状态' : '未连接');
  $('studyAccountAction').textContent = cx ? '退出学习通' : '前往学习通';
  $('studyAccountAction').disabled = studyBusy;
  $('waterAccount').textContent = '慧生活798 · ' +
    (waterExpired || water.broken ? '会话已失效' : water.linked ? '本机已保存会话' : '未连接');
  $('waterAccountAction').textContent = water.linked || water.broken ? '退出慧生活798' : '前往慧生活798';
  $('waterAccountAction').disabled = waterBusy;
  $('clearWebCache').disabled = !native;
}

function refreshSession() {
  renderStudy();
  renderWater();
  renderAccounts();
}
window.refreshSession = refreshSession;

$('studyAccountAction').addEventListener('click', () => {
  if (!native || !native.cxHasLogin()) {
    select('study');
    return;
  }
  if (!window.confirm('退出学习通并清除本机学习通缓存？')) return;
  try {
    native.cxClear();
    clearStudyCache();
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
$('sheetClose').addEventListener('click', closeDetails);
$('sheetMask').addEventListener('click', event => {
  if (event.target === $('sheetMask')) closeDetails();
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
  const selected = recordTerms[panel] || scope.selected;
  $('recordTitle').textContent = title;
  empty(term);
  scope.terms.forEach(item => term.add(new Option(item.term, item.termId)));
  if (scope.terms.some(item => item.termId === selected)) term.value = selected;
  if (!scope.terms.length) term.add(new Option('绑定后显示教务学期', ''));
  term.disabled = !scope.terms.length;
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
  empty(results);
  status.textContent = adapter.available ? '正在查询…' : messages.unavailable;
  const data = await adapter.load(scope, term.value, force);
  if (request !== recordRender || academicPanel !== panel) return;
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
  $('recordRefresh').disabled = !term.value || needsBinding;
  const displayed = data.cached || data;
  const gradeCount = grades && displayed.state === 'ready' ? '有效成绩 · ' + displayed.rows.length + ' 条' : '';
  status.textContent = [messages[data.state], gradeCount, displayed.at ? '更新于 ' + time(displayed.at) : ''].filter(Boolean).join(' ');
  if (displayed.state !== 'ready') return;
  const card = node('section', null, 'card pad');
  const rows = displayed.rows.slice();
  const today = new Date().toLocaleDateString('sv-SE');
  const upcoming = item => !!item.date && item.date >= today;
  if (!grades) rows.sort((a, b) => Number(upcoming(b)) - Number(upcoming(a))
    || (a.date || '9999').localeCompare(b.date || '9999') || a.start.localeCompare(b.start));
  let previousDate;
  rows.forEach(item => {
    if (!grades && item.date !== previousDate) {
      card.appendChild(node('h2', upcoming(item) ? '即将考试 · ' + item.date : item.date || '日期待定'));
      previousDate = item.date;
    }
    const row = node('article', null, 'result-row');
    row.appendChild(node('strong', item.name));
    const details = grades
      ? [item.grade ? '成绩 ' + item.grade : '成绩未提供', item.credits && '学分 ' + item.credits,
        item.earnedCredits && '获得学分 ' + item.earnedCredits, item.gpa && '绩点 ' + item.gpa,
        item.creditPoints && '学分绩点 ' + item.creditPoints, item.category, item.nature, item.assessment, item.note]
      : [item.timeText || [item.start, item.end].filter(Boolean).join('–'),
        [item.campus, item.building, item.room].filter(Boolean).join(' · '), item.seat && '座位 ' + item.seat, item.mode, item.status];
    row.appendChild(node('p', details.filter(Boolean).join(' · '), 'sub'));
    card.appendChild(row);
  });
  results.appendChild(card);
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
      if (!native.openAcademicRecords(id, kind, JufeAcademicAdapter.portalTermLabel(termId),
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
