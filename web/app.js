'use strict';

const APP_VERSION = '0.5.0';
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

const schoolTransport = JufeAcademicAdapter.schoolTransport;
const schoolSync = JufeSync.create(JufeAcademicAdapter.create({
  transport: schoolTransport, parsers: JufeAcademicAdapter.schoolParsers
}), window.localStorage);
const schoolPrefix = 'jufe/';
const scheduleRepo = Academic.createRepository(Academic.mockAdapter, window.localStorage);
const importedSchedules = AcademicImport.createStore(window.localStorage);
const importedPrefix = 'import/';
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
  $('waterStatus').textContent = waterMessage || (connected
    ? '已载入饮水服务登录状态。' : state.broken
      ? '本机登录状态已失效，请重新登录。'
      : '使用手机号、图形验证码和短信验证码登录。');
  $('waterLoginOpen').hidden = connected;
  $('waterRefresh').hidden = !connected;
  $('waterResults').hidden = !connected;
  ['waterLoginOpen', 'waterRefresh', 'waterLogin', 'loadCaptcha', 'waterLoginCancel', 'billRefresh', 'billMore']
    .forEach(id => { $(id).disabled = !native || waterBusy; });
  $('sendSms').disabled = !native || waterBusy || !captchaReady || Date.now() < smsUntil;
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
  captcha = Water.captcha();
  captchaReady = false;
  $('graph').value = '';
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
  $('sendSms').disabled = !native || waterBusy || !captchaReady || remaining > 0;
  if (remaining) smsTimer = setTimeout(updateSmsButton, 1000);
}

function sendSms() {
  const phone = $('phone').value.trim();
  const graph = $('graph').value.trim();
  if (Date.now() < smsUntil || !captchaReady) return;
  if (!/^1\d{10}$/.test(phone) || !graph) {
    toast('请输入 11 位手机号和图形验证码');
    return;
  }
  runWater(async () => {
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
$('waterLoginCancel').addEventListener('click', hideWaterForm);
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
$('term').addEventListener('change', loadSelectedTerm);
$('academicBind').disabled = !native;
$('academicBind').addEventListener('click', () => {
  $('academicBindingState').textContent = '请在学校页面自行认证并打开本人课表。';
  native.openAcademicBinding();
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
    : state.state === 'reauthorize' ? '显示已保存课表，请重新完成校方授权。'
    : '等待验证本人课表。校方在线查询接口尚未配置。';
}

async function receiveSchoolAuthorization(restore) {
  if (!schoolTransport) {
    showSchoolStatus();
    return;
  }
  try {
    const candidate = await (restore ? schoolTransport.resumeAuthorization() : schoolTransport.completeAuthorization());
    if (candidate) {
      await (restore ? schoolSync.restore(candidate) : schoolSync.bind(candidate));
      const selected = schoolSync.snapshot().selected;
      if (selected) renderTermOptions(schoolPrefix + selected);
    }
    showSchoolStatus();
  } catch (error) {
    $('academicBindingState').textContent = error.message;
  }
}

window.academicPortalReturned = function (structure) {
  $('academicStructure').hidden = !structure;
  $('academicStructure').textContent = structure ? '本机脱敏结构 · ' + structure : '';
  receiveSchoolAuthorization(false);
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
  } catch (error) {
    $('academicBindingState').textContent = error.message;
  } finally {
    $('term').disabled = false;
    $('scheduleSync').disabled = false;
  }
}

window.resumeAcademicSync = function () {
  const termId = $('term').value;
  if (termId.startsWith(schoolPrefix) && !schoolSync.snapshot().syncing) {
    refreshSchool(termId.slice(schoolPrefix.length), false);
  }
};

function renderTermOptions(selected) {
  const term = $('term');
  empty(term);
  schoolSync.snapshot().terms.forEach(item => term.add(new Option('江财 · ' + item.term, schoolPrefix + item.termId)));
  demoTerms.forEach(item => term.add(new Option(item.term, item.termId)));
  importedSchedules.list().forEach(item => {
    term.add(new Option('本地 · ' + item.term, importedPrefix + item.termId));
  });
  if (selected) term.value = selected;
  if (!term.value) term.selectedIndex = 0;
  loadSelectedTerm();
}

function loadSelectedTerm() {
  const termId = $('term').value;
  const imported = termId.startsWith(importedPrefix);
  if (termId.startsWith(schoolPrefix)) {
    $('academicRemove').hidden = true;
    $('scheduleSync').textContent = '刷新课表';
    refreshSchool(termId.slice(schoolPrefix.length), false);
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
  receiveSchoolAuthorization(true);
});
