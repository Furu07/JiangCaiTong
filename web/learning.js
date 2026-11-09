/* 学习通查询逻辑移植自航院通，登录由独立的官方页面处理。 */
(function () {
  'use strict';

  var CXS = {
    COURSE_API: 'https://mooc1-api.chaoxing.com/mycourse/backclazzdata?view=json&rss=1',
    COURSE_REF: 'https://mooc2-ans.chaoxing.com/mooc2-ans/visit/interaction',
    COURSE_PAGE: 'https://mooc1.chaoxing.com/visit/stucoursemiddle',
    WORK_LIST: 'https://mooc1.chaoxing.com/mooc2/work/list',
    // 考试列表。参数照抄 course-stu.js 点导航时的拼法 —— 缺一个就回
    // 「参数传递不正确」，而 HTTP 状态码还是 200。
    EXAM_LIST: 'https://mooc1.chaoxing.com/exam-ans/mooc2/exam/exam-list',
    // 课程活动（签到/讨论/通知）。返回 JSON，比抓 HTML 稳得多。
    // 🔴 fid 是**学校 id**（course.schoolId），不是课程页隐藏字段那个 id="fid"。
    ACTIVE_LIST: 'https://mobilelearn.chaoxing.com/v2/apis/active/student/activelist',
  };

  var CX_TODO = ['未交', '未开始', '待互评'];
  var CX_DONE = ['已完成', '待批阅', '已批阅', '已互评'];

  /** 考试：只有**明确表示已经考完/考过**的才算做完。
   *  没见过的取值一律留在待办里 —— 宁可多显示一条，
   *  也不能把一场还没考的考试藏起来。
   *
   *  🔴 0.46.0 补「待批阅」，和 chaoxing.py 的 DONE_EXAM_STATES 同步。
   *     作业那边早就算 done（见上面 CX_DONE），考试这边漏了同一个词 ——
   *     结果「2023级开学测试 · 待批阅」「2024-9-12课堂笔记提交 · 待批阅」
   *     这种两年前的卷子天天挂在「2 条考试」里（用户 2026-11-06 截图）。
   *     交卷后学习通给的就是「待批阅」，它和「我已经交了」是同义的。 */
  var CX_DONE_EXAM = ['已完成', '已结束', '已交卷', '已参加', '待批阅', '已批阅', '已过期'];

  /** activeType → 分类。表和 mobile/chaoxing.py 的 KIND_BUCKET 一致，
   *  来源是学习通任务列表页的 Vue 模板（_lab/cx/ml/active_page.html）。 */
  var CX_KIND_BUCKET = {
    sign: ['2', '74'],      // 签到 / 签退
    topic: ['5', '50'],     // 主题讨论
    work: ['19'],           // 作业
    notice: ['34', '45'],   // 通知。34 老版本 / 45 新版本，同一件事的两种 type。
                            // 🔴 45 是南师侧拿原始响应实测的（content 里是老师名、
                            //    extraInfo 里是 noticeId），不是猜的。只认 34 会让新版
                            //    通知全落进「其他」。改这里必须同步 chaoxing.py。
    // 随堂练习 / 互动练习（0.39.0）。用户 2026-11-01：「还很容易错过…还有随堂练习」。
    // 以前落到 other，和「白板 / 教案 / PDF 文档」挤在同一格 —— 那格是垃圾桶，
    // 真正的任务淹在里面等于没提示。单独一类，排在做作业后面。
    quiz: ['42', '68']
  };

  /** activeType → 中文名。30 种，从模板里的 aria-label 逐条抄的。 */
  var CX_ACTIVE_KIND = {
    '2': '签到', '4': '抢答', '5': '主题讨论', '11': '选人', '14': '问卷',
    '17': '直播', '19': '作业', '23': '评分', '34': '通知', '35': '分组任务',
    '42': '随堂练习', '43': '投票', '45': '通知', '46': '群聊', '47': '计时器', '48': '课程章节',
    '49': '白板', '50': '主题讨论', '51': '同步课堂', '56': '泛雅课堂',
    '57': 'PPT文档', '58': '教案', '59': '抽签', '60': '教案', '61': 'WORD文档',
    '62': 'PDF文档', '63': '阅读任务', '68': '互动练习', '74': '签退',
    '75': '思政资源库', '77': 'AI实践'
  };

  function cxUniqueCourses(courses) {
    var seen = {}, out = [];
    if (!Array.isArray(courses)) return out;
    for (var i = 0; i < courses.length; i++) {
      var c = courses[i];
      if (!c || !c.courseId || !c.classId) continue;
      var k = String(c.courseId) + ':' + String(c.classId);
      if (seen[k]) continue;
      seen[k] = 1;
      out.push(c);
    }
    return out;
  }

  function cxErr(msg, kind) {
    var e = new Error(msg);
    e.kind = kind || 'net';
    return e;
  }

  function cxSleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function cxEndFromLeft(leftMin, nowSec) {
    if (leftMin == null) return null;
    var now = (nowSec == null) ? Date.now() / 1000 : nowSec;
    return Math.floor(now + leftMin * 60);
  }

  function cxLeft(text) {
    if (!text) return null;
    var s = String(text);
    if (s.indexOf('剩余') < 0) return null;
    var d = /(\d+)\s*天/.exec(s);
    var h = /(\d+)\s*小时/.exec(s);
    var m = /(\d+)\s*分/.exec(s);
    if (!d && !h && !m) return null;
    return (d ? parseInt(d[1], 10) * 1440 : 0)
         + (h ? parseInt(h[1], 10) * 60 : 0)
         + (m ? parseInt(m[1], 10) : 0);
  }

  function cxParseDue(text, nowSec) {
    if (!text) return null;
    var str = String(text);
    // 考试页的 .time 也可能是「开始时间：…」。那是开始，不是截止。
    if (str.indexOf('开始') >= 0 && str.indexOf('结束') < 0 &&
        str.indexOf('截止') < 0) return null;
    // 两行并在一个格子里时只认结束那一半（和 chaoxing.py 的 parse_due 一致）。
    var kws = ['结束时间', '截止时间', '结束', '截止'];
    for (var kwi = 0; kwi < kws.length; kwi++) {
      var ki = str.indexOf(kws[kwi]);
      if (ki >= 0) { str = str.slice(ki); break; }
    }
    var now = (nowSec == null) ? Date.now() / 1000 : nowSec;
    var m = /(\d{4})-(\d{1,2})-(\d{1,2})[\sT]+(\d{1,2}):(\d{2})/.exec(str);
    if (m) {
      var t1 = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1,
                        parseInt(m[3], 10), parseInt(m[4], 10),
                        parseInt(m[5], 10), 0);
      if (isNaN(t1.getTime())) return null;
      return Math.floor(t1.getTime() / 1000);
    }
    m = /(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/.exec(str);
    if (!m) return null;
    var mo = parseInt(m[1], 10), dd = parseInt(m[2], 10);
    var hh = parseInt(m[3], 10), mi = parseInt(m[4], 10);
    var yr = new Date(now * 1000).getFullYear();
    var d0 = new Date(yr, mo - 1, dd, hh, mi, 0);
    if (isNaN(d0.getTime())) return null;
    var t = Math.floor(d0.getTime() / 1000);
    // 差半年以上就归到相邻的那一年：1 月看到「12-31」是去年，反之是明年。
    if (t > now + 180 * 86400 || t < now - 180 * 86400) {
      var y2 = t > now ? yr - 1 : yr + 1;
      var d1 = new Date(y2, mo - 1, dd, hh, mi, 0);
      if (isNaN(d1.getTime())) return null;
      t = Math.floor(d1.getTime() / 1000);
    }
    return t;
  }

  function cxDue(raw, nowSec) {
    var left = cxLeft(raw);
    var end = cxParseDue(raw, nowSec);
    if (end == null) return { leftMin: left, endAt: cxEndFromLeft(left, nowSec) };
    if (left == null) {
      var now = (nowSec == null) ? Date.now() / 1000 : nowSec;
      left = Math.floor((end - now) / 60);
    }
    return { leftMin: left, endAt: end };
  }

  function cxBucket(status) {
    var s = String(status || '').replace(/^\s+|\s+$/g, '');
    for (var i = 0; i < CX_TODO.length; i++) if (CX_TODO[i] === s) return 'todo';
    for (var j = 0; j < CX_DONE.length; j++) if (CX_DONE[j] === s) return 'done';
    return 'other';
  }

  function cxParseCourses(j) {
    var out = [];
    var chs = (j && j.channelList) || [];
    for (var i = 0; i < chs.length; i++) {
      var ch = chs[i] || {};
      var ct = ch.content || {};
      var rows = (ct.course && ct.course.data) || [];
      if (!rows.length) continue;
      var d = rows[0] || {};
      out.push({
        courseId: encodeURIComponent(String(d.id || '')),
        classId: encodeURIComponent(String(ct.id || '')),
        cpi: encodeURIComponent(String(ch.cpi || ct.cpi || '')),
        title: d.name || ct.name || '',
        alias: ct.name || '',
        schoolId: encodeURIComponent(String(d.belongSchoolId || ''))
      });
    }
    return out;
  }

  function cxKindOf(activeType) {
    var t = String(activeType == null ? '' : activeType).replace(/^\s+|\s+$/g, '');
    if (/\.0$/.test(t)) t = t.slice(0, -2);      // 万一给了 5.0
    for (var k in CX_KIND_BUCKET) {
      if (!CX_KIND_BUCKET.hasOwnProperty(k)) continue;
      if (CX_KIND_BUCKET[k].indexOf(t) >= 0) return k;
    }
    return 'other';
  }

  function cxSignState(text) {
    var t = String(text == null ? '' : text).replace(/^\s+|\s+$/g, '');
    if (!t) return null;
    if (t.indexOf('已签') >= 0) return true;              // 已签到 / 已签退
    if (t.indexOf('未签') >= 0 || t.indexOf('缺勤') >= 0) return false;
    return null;
  }

  function cxMsToSec(v) {
    var n = parseInt(v, 10);
    if (!isFinite(n) || n <= 0) return null;
    return Math.floor(n / 1000);
  }

  function cxParseActive(j, nowSec) {
    if (!j || typeof j !== 'object') throw cxErr('无法识别活动列表', 'parse');
    var res = j.result;
    if (!(res === 1 || res === '1' || res === true)) {
      throw cxErr(String(j.errorMsg || j.msg || '活动列表返回失败'), 'deny');
    }
    var rows = j.data && j.data.activeList;
    if (!Array.isArray(rows)) throw cxErr('无法识别活动列表', 'parse');
    // nowSec 只是给对拍脚本固定时间用的（不传就是当前时间）——
    // 不然「从 endTime 算倒计时」那几条，JS 和 Python 会差个几十秒。
    var now = (typeof nowSec === 'number' && nowSec > 0) ? nowSec : Date.now() / 1000;
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var a = rows[i];
      if (!a || typeof a !== 'object') continue;
      var title = String(a.nameOne == null ? '' : a.nameOne).trim();
      if (!title) continue;
      var st = String(a.status == null ? '' : a.status).trim();
      var name4 = String(a.nameFour == null ? '' : a.nameFour).trim();
      var end = cxMsToSec(a.endTime);
      var start = cxMsToSec(a.startTime);

      var leftMin = null;
      if (st === '1') {
        leftMin = cxLeft(name4);
        // 🔴 不夹 0：过点但 status 还是 1 的活动，留负数让排序把它归到「已过期」，
        //    夹成 0 会写成「还剩 不到 1 分钟」。改这里必须同步 chaoxing.py。
        if (leftMin == null && end) leftMin = Math.floor((end - now) / 60);
      }
      var state = st === '1' ? 'live' : (st === '2' ? 'ended' : 'pending');

      var kd = cxKindOf(a.activeType);
      // 🔴 通知的 endTime 是**活动自己的生命周期终点**，不是待办截止时间。
      //    拿它渲染「截止 X」，一条公告会显示成「已截止 2025-09-30」，像漏了件事。
      //    改这里必须同步 chaoxing.py 的 parse_active。
      if (kd === 'notice') { end = null; leftMin = null; }

      out.push({
        kind: kd,
        kindName: CX_ACTIVE_KIND[String(a.activeType)] || '活动',
        title: title,
        status: String(a.nameTwo == null ? '' : a.nameTwo).trim(),
        state: state,
        left: name4,
        leftMin: leftMin,
        startAt: start,
        endAt: end,
        // 只有签到/签退才有；别的活动一律 null（不是 false）。
        signed: kd === 'sign' ? cxSignState(a.nameTwo) : null,
      });
    }
    if (rows.length && !out.length) throw cxErr('活动列表含无法识别的记录', 'parse');
    return out;
  }

  function cxMarkup(html) {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    return template.content;
  }

  function cxTaskResult(doc, items, name) {
    if (items.length || doc.textContent.includes('暂无' + name)) return items;
    throw cxErr('无法确认' + name + '列表是否为空', 'parse');
  }

  function cxParseExam(html, nowSec) {
    var doc = cxMarkup(html);
    var lis = doc.querySelectorAll('li');
    var out = [];
    for (var i = 0; i < lis.length; i++) {
      var li = lis[i];
      // 筛选栏、翻页那些 li 没有 .right-content，不是任务
      var right = li.querySelector('.right-content');
      if (!right) continue;

      var title = '', status = '';
      var lab = li.getAttribute('aria-label');
      if (lab) {
        var cut = lab.lastIndexOf(';');
        title = (cut >= 0 ? lab.slice(0, cut) : lab).replace(/^\s+|\s+$/g, '');
        status = cut >= 0 ? lab.slice(cut + 1).replace(/^\s+|\s+$/g, '') : '';
      }
      if (!title) {
        var tEl = right.querySelector('.overHidden2');
        if (tEl) title = String(tEl.textContent || '').replace(/\s+/g, ' ').trim();
      }
      if (!status) {
        var sEl = right.querySelector('.status');
        if (sEl) status = String(sEl.textContent || '').replace(/\s+/g, ' ').trim();
      }
      if (!title) continue;

      var wEl = li.querySelector('.time');
      var raw = wEl ? String(wEl.textContent || '').replace(/\s+/g, ' ').trim() : '';

      var done = false;
      for (var d = 0; d < CX_DONE_EXAM.length; d++) {
        if (status.indexOf(CX_DONE_EXAM[d]) >= 0) { done = true; break; }
      }
      var de = cxDue(raw, nowSec);
      out.push({
        kind: 'exam',
        kindName: '考试',
        title: title,
        status: status,
        state: done ? 'done' : 'todo',
        left: raw,
        leftMin: de.leftMin,
        startAt: null,
        endAt: de.endAt,
      });
    }
    return cxTaskResult(doc, out, '考试');
  }

  function cxParseWork(html, nowSec) {
    var doc = cxMarkup(html);
    var ul = doc.querySelector('ul');
    var lis = ul ? ul.querySelectorAll('li[aria-label]') : [];
    var out = [];
    for (var i = 0; i < lis.length; i++) {
      var li = lis[i];
      var lab = li.getAttribute('aria-label');
      if (lab == null) continue;
      var cut = lab.lastIndexOf(';');
      var title = (cut >= 0 ? lab.slice(0, cut) : lab).replace(/^\s+|\s+$/g, '');
      var status = cut >= 0 ? lab.slice(cut + 1).replace(/^\s+|\s+$/g, '') : '';
      if (!title) continue;

      var tEl = li.querySelector('.time');
      var raw = tEl ? String(tEl.textContent || '').replace(/\s+/g, ' ').trim() : '';

      var dw = cxDue(raw, nowSec);
      out.push({
        kind: 'work',
        kindName: '作业',
        title: title,
        status: status,
        state: cxBucket(status),
        left: raw,
        leftMin: dw.leftMin,
        startAt: null,
        endAt: dw.endAt,
      });
    }
    return cxTaskResult(doc, out, '作业');
  }

  async function cxCourses(scope) {
    var r = await cxHttp('GET', CXS.COURSE_API, '', CXS.COURSE_REF, null, scope);
    cxStatusOk(r, '课程列表');
    var t = String((r && r.body) || '');
    var j;
    try { j = JSON.parse(t); }
    catch (e) { throw cxErr('课程列表没读出来，学校系统可能改版了', 'parse'); }
    if (!j || !Array.isArray(j.channelList)) {
      throw cxErr('课程列表没读出来，学校系统可能改版了', 'parse');
    }
    const courses = cxUniqueCourses(cxParseCourses(j));
    if (j.channelList.length && !courses.length) throw cxErr('课程列表含无法识别的记录', 'parse');
    return courses;
  }

  function cxLooksLoggedOut(body) {
    const text = String(body || '').trim();
    if (text[0] !== '<') return false;
    const markup = cxMarkup(text);
    if (markup.querySelector('form[action*="fanyalogin" i], form[action*="/login" i] input[type="password"]')) {
      return true;
    }
    const title = markup.querySelector('title');
    return !!(title && /^(学习通登录|超星登录|用户登录)$/.test(title.textContent.trim())
      && markup.querySelector('input[type="password"]'));
  }

  async function cxCourseMeta(c, scope) {
    var url = CXS.COURSE_PAGE + '?courseid=' + c.courseId + '&clazzid=' + c.classId
            + '&cpi=' + c.cpi + '&ismooc2=1&v=2';
    var r = await cxHttp('GET', url, '', '', null, scope);
    cxStatusOk(r, '课程页');
    // 原生层已经把重定向跟完并把**最终地址**带回来了，stuenc 就在里面
    var u = String((r && r.url) || '') || url;
    var stu = /[?&]enc=([0-9a-fA-F]{32})/.exec(u);
    var work = /id="workEnc"[^>]*value="([0-9a-fA-F]{32})"/.exec(String((r && r.body) || ''));
    return {
      stuenc: stu ? stu[1] : '',
      workEnc: work ? work[1] : '',
      referer: u
    };
  }

  async function cxWorkList(c, meta, scope) {
    // 🔴 kind 用 'noentry' 而不是 'deny'：界面上这是**完全不同**的两句话。
    //    deny = 被拒绝（账号可能有问题），noentry = 这门课的页面里压根没这个
    //    入口（多半已结课归档）。混成一种，用户只能看到「拿不到入口」。
    if (!meta.stuenc || !meta.workEnc) throw cxErr('没给作业入口', 'noentry');
    var url = CXS.WORK_LIST + '?courseId=' + c.courseId + '&classId=' + c.classId
            + '&cpi=' + c.cpi + '&ut=s&t=' + Date.now()
            + '&stuenc=' + meta.stuenc + '&enc=' + meta.workEnc;
    var r = await cxHttp('GET', url, '', meta.referer, null, scope);
    cxStatusOk(r, '作业列表');
    var t = String((r && r.body) || '');
    if (t.indexOf('无权限的操作') >= 0 || t.indexOf('无效的用户') >= 0) {
      throw cxErr('作业列表读不了，重新连接一次再试', 'deny');
    }
    return cxParseWork(t);
  }

  async function cxActiveList(c, scope) {
    if (!c.schoolId) throw cxErr('这门课没带学校 id，活动查不了', 'parse');
    var url = CXS.ACTIVE_LIST + '?fid=' + c.schoolId
            + '&courseId=' + c.courseId + '&classId=' + c.classId
            + '&showNotStartedActive=0&_=' + Date.now();
    var referer = CXS.COURSE_PAGE + '?courseid=' + c.courseId
                + '&clazzid=' + c.classId + '&cpi=' + c.cpi;
    var r = await cxHttp('GET', url, '', referer, { 'X-Requested-With': 'XMLHttpRequest' }, scope);
    cxStatusOk(r, '活动列表');
    var t = String((r && r.body) || '');
    // 没登录时会 302 到登录页，回来的是一大坨 HTML 而不是 JSON
    var head = t.replace(/^\s+/, '').slice(0, 1);
    if (head !== '{' && head !== '[') {
      throw cxErr('活动列表没读出来，学校系统可能改版了', 'parse');
    }
    var j;
    try { j = JSON.parse(t); }
    catch (e) { throw cxErr('活动列表没读出来，学校系统可能改版了', 'parse'); }
    return cxParseActive(j);
  }

  async function cxExamList(c, meta, scope) {
    if (!meta.stuenc) throw cxErr('没给考试入口', 'noentry');
    var url = CXS.EXAM_LIST + '?courseid=' + c.courseId + '&clazzid=' + c.classId
            + '&cpi=' + c.cpi + '&ut=s&t=' + Date.now() + '&stuenc=' + meta.stuenc;
    var r = await cxHttp('GET', url, '', meta.referer, null, scope);
    cxStatusOk(r, '考试列表');
    var t = String((r && r.body) || '');
    if (t.indexOf('这次操作没成功，重试一次') >= 0) {
      throw cxErr('考试读不出来，学习通可能改版了', 'parse');
    }
    if (t.indexOf('无权限的操作') >= 0 || t.indexOf('无效的用户') >= 0) {
      throw cxErr('考试列表被拒（登录态失效）', 'deny');
    }
    return cxParseExam(t);
  }

  let lastRequest = 0;
  let limitedUntil = 0;

  async function cxHttp(method, url, body, referer, headers, scope) {
    if (Date.now() < limitedUntil) throw cxErr('学习通限制了查询频率，请稍后再试', 'busy');
    await cxSleep(Math.max(0, 450 - (Date.now() - lastRequest)));
    lastRequest = Date.now();
    return nativeRequest(method, url, body, referer, headers, scope);
  }

  function cxStatusOk(response, section) {
    const status = response.status;
    const loginPage = response.url && new URL(response.url).hostname === 'passport2.chaoxing.com';
    if (status === 401 || loginPage || (status === 200 && cxLooksLoggedOut(response.body))) {
      throw cxErr('学习通登录已过期，请重新授权', 'auth');
    }
    if (status === 202 || status === 429) {
      limitedUntil = Date.now() + 15 * 60 * 1000;
      throw cxErr('学习通限制了查询频率，请在 15 分钟后再试', 'busy');
    }
    if (status === 403) throw cxErr(section + '访问被拒绝', 'deny');
    if (status !== 200) {
      throw cxErr(status ? section + '返回 HTTP ' + status : section + '连接失败', 'net');
    }
  }

  async function readCourse(course, scope) {
    let meta;
    let metaError;
    try {
      meta = await cxCourseMeta(course, scope);
    } catch (error) {
      if (error.kind === 'auth') throw error;
      metaError = error;
    }
    const sections = [
      ['作业', () => cxWorkList(course, meta, scope)],
      ['考试', () => cxExamList(course, meta, scope)],
      ['活动', () => cxActiveList(course, scope)],
    ];
    const result = [];
    for (const [title, read] of sections) {
      try {
        if (metaError && title !== '活动') throw metaError;
        result.push({ title, items: await read() });
      } catch (error) {
        if (error.kind === 'auth') throw error;
        result.push({ title, error: error.message });
      }
    }
    return result;
  }

  function mergeCourseResults(previous, attempts, at) {
    const oldSections = previous ? previous.sections : [];
    const sections = attempts.map(result => {
      if (!result.error) return { title: result.title, items: result.items, at };
      const saved = oldSections.find(section => section.title === result.title && !section.error && Array.isArray(section.items));
      return { title: result.title, error: result.error, ...(saved ? {
        items: saved.items, at: saved.at || previous.at, cached: true
      } : {}) };
    });
    const successful = attempts.some(result => !result.error);
    return {
      sections,
      cache: successful ? { at, sections: sections.filter(section => section.items).map(section => ({
        title: section.title, items: section.items, at: section.at
      })) } : previous
    };
  }

  window.Learning = { courses: cxCourses, readCourse, mergeCourseResults };
})();
