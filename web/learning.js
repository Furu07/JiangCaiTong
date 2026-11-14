/* HangYuanTong 0.52.1 Chaoxing business core. Copyright © 2026 Hobson, MIT.
 * Host changes keep scoped Android sessions, preserve per-class history and feed P4.
 */
(function () {
  'use strict';

  const CX_SIGN_LIVE_SEC = 4 * 3600;
  var CXS = {
    LOGIN_PAGE: 'https://passport2.chaoxing.com/login?fid=&refer=',
    LOGIN_API: 'https://passport2.chaoxing.com/fanyalogin',
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

  // 🔴 「待互评」是**要我去评别人** ⇒ 算 todo。以前两边都不在，落到「其他」并被
  //    排除在待办之外，等于把一件该做的事藏了。
  // 🔴 「待批阅 / 已批阅」是**我已经交了**、等老师 ⇒ 算 done。全算「要交」会让人
  //    一进门看到 76，滑三屏才发现只有 7 条真没交（2026-10-23 南师侧实测）。
  //    改这里必须同步 chaoxing.py 的 TODO_STATES / DONE_STATES。
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


  /** 活动详情页地址：按 activeType 分。
   *  🔴 不是猜的，是从学习通活动列表页模板的 activeRowClick() 那个 switch 里抄的
   *  （_lab/cx/ml/active_page.html）。参数只用课程对象里现成的
   *  courseId / classId / fid（= schoolId）。和 chaoxing.py 的 ACTIVE_PAGE 一致。 */
  var CX_BASE = 'https://mobilelearn.chaoxing.com';
  var CX_ACTIVE_PAGE = {
    '2': '/page/sign/signIn',                              // 签到
    '74': '/page/sign/signIn',                             // 签退
    '50': '/page/topicDiscuss/student/stu_reply_discuss',  // 主题讨论
    '42': '/page/quiz/stu/answerQuestion2',                // 随堂练习
    '14': '/page/quiz/stu/answerQuestion',                 // 问卷
    '43': '/page/qvote/stu/answerQvote',                   // 投票
    '68': '/page/interactivepractice/stu/answerQu'         // 互动练习
  };

  /** 每门课之间的间隔。加抖动，别让请求节奏整齐得像机器。
   *
   *  🔴 0.44.1：0.9 秒 → 1.8 秒。用户原话「点重新检查显示检查的太频繁了，
   *     你把频率降低些」。
   *
   *     原来的算法有个自己骗自己的地方：这门课 4 个请求（课程页 / 作业 /
   *     考试 / 活动）是**连发**的，中间不等，然后才 sleep。所以「间隔 0.9 秒」
   *     真实节奏是「4 个请求挤在一瞬间，再停 1 秒」—— 30 门课就是 120 个请求
   *     在四十来秒里砸过去，学习通那边直接 202。
   *
   *     现在两头都放缓：请求之间也隔一下（CX_REQ_GAP），课与课之间 1.8 秒。
   *     一轮从约 45 秒变成约 2 分钟 —— 慢，但查得成比查得快重要。
   */
  var CX_GAP = 1800;
  var CX_JITTER = 600;

  /** 同一个学习通会话里，两个请求之间至少隔这么久（毫秒）。
   *
   *  为什么要在 cxHttp 里统一做，而不是在每个调用点加 sleep：
   *  一门课 4 个请求分散在 cxScanAll / cxCourseMeta / cxWorkList / cxExamList /
   *  cxActiveList 五个函数里，逐个加迟早漏一个；漏掉的那个正好就是「连发」
   *  的那一发。节流放在唯一的出口上，谁都绕不过去。
   *
   *  ⚠️ 别调到 0：学习通认的就是请求频率，0 等于退回改之前的样子。
   */
  var CX_REQ_GAP = 450;
  var cxLastReqAt = 0;          // cxHttp 的节流水位（毫秒时间戳）

  /** 被 202 拦下之后的冷静期（秒）。
   *
   *  🔴 为什么不是「过几分钟再试」这种口头建议：学习通的风控窗口是分钟级的，
   *     而 app.js 那边手点的冷却只有 90 秒。用户在窗口里点一次、失败一次，
   *     每失败一次还会把窗口续上 —— 他越试，好得越慢。
   *     所以撞一次就把「几点之前别再试」记下来，期间一个请求都不发。 */
  var CX_BUSY_COOL = 15 * 60;
  var CX_BUSY_KEY = 'cx.busyUntil';

  function cxBusyUntil() {
    try {
      return Number(localStorage.getItem(CX_BUSY_KEY) || 0) || 0;
    } catch (e) { return 0; }
  }

  function cxBusyMark() {
    try {
      localStorage.setItem(CX_BUSY_KEY,
        String(Math.floor(Date.now() / 1000) + CX_BUSY_COOL));
    } catch (e) { /* 存不下就只在这一次有效，不影响功能 */ }
  }

  function cxBusyClear() {
    try { localStorage.removeItem(CX_BUSY_KEY); } catch (e) { /* 同上 */ }
  }

  // ---- 结课判定 -----------------------------------------------------
  // 🔴 必须和 chaoxing.py 的 REST_STREAK / REST_SPAN / REST_GAP 完全一致。
  //    APK 里没有 Python，这两份是各写一遍的 —— 只改一边不报错，
  //    只是手机上和网页上「哪些课算结课」会得出不同答案。
  //
  // 判据：四个请求全成功 + 三个列表全空，连续 REST_STREAK 次，且跨度 >= REST_SPAN。
  // 之后每 REST_GAP 才扫一次。
  //
  // 🔴 为什么不能「首次扫到空就判」：开学第一周课都还没发作业，
  //    实测 32 门里 13 门是空的，其中「线性代数」「高等数学」是本学期的课。
  //    首次就判会把整个学期的课全判死。
  // 🔴 为什么是降频不是永不扫：判据一定会错，永不扫就永远发现不了。
  var CX_REST_STREAK = 3;
  var CX_REST_SPAN = 7 * 86400;

  // ---- 冷课判定（0.39.0）----
  // 上面那条要求「三个列表全空」—— 但历史学期的课**不空**：上学期的作业还挂着。
  // 于是 37 门里 22 门一个学期都判不出结课，每次刷新仍然全量扫。
  // 换证据：**有内容，但最新那条已经是 CX_COLD_DAY 之前的事**。
  // 🔴 冷课「一次就降频」，空课要攒 3 次 + 7 天：
  //    空 = 没有证据（老师可能还没发作业）；冷 = 有证据（东西都在，都很旧）。
  var CX_COLD_DAY = 90 * 86400;

  // 0.44.0：**没有教务课表**时用的冷课门槛，比上面那条更狠。
  // 有课表时「这门课不在本学期名单里」本身就是证据，90 天够了；没课表时
  // 只剩内容时间这一条证据，那就得多要一点：一学期通常 20 周，上学期的课
  // 到 11 月，最新一条内容至少也是 5 个月前的事；而本学期还在上的课，
  // 哪怕老师只在开学第一周发过东西，也在 150 天以内。
  // ⚠️ 过了这道线只是**每 7 天扫一次**（CX_REST_GAP），不是永远不扫。
  var CX_COLD_NO_WHITE = 150 * 86400;

  // ---- 0.47.0：只看本学期的课 ----
  // 用户 2026-11-06：「听学长说教务系统可以直接看本学期课程……现在我每次都
  // 还是需要扫 37 个课程，但我这个学期只有十几个课程」。
  // 判据换成**教务系统里本学期在修的课表**：
  //   课表里有的 → 每轮全扫（4 个请求）
  //   课表里没有 → 判结课，只花 1 个请求看活动列表（签到在里面）
  // 为什么结课的课还留那 1 个请求：签到的时效是「几分钟」，漏了就没了；
  // 而「点名专用」这类课教务课表里根本没有、唯一的内容恰恰就是签到。
  var CX_ACT_PROBE_GAP = 7 * 86400;   // 结课的课多久探一次活动列表
  var CX_WARM_ACT = 30 * 86400;       // 探到这么久以内还有活动 ⇒ 下轮恢复全扫
  var CX_STALE_END = 7 * 86400;       // 早已结束的作业/考试，不再列进待办

  /** 这条是不是「早就结束了」—— 不再往界面上摆。
   *  用户 2026-11-06：「已经结束一段时间了的就别显示了，除非是需要互评的作业」。
   *  🔴 必须要求 endAt 存在：实测真有「未交但没写截止时间」的作业，
   *     那是「不知道什么时候结束」，不是「早就结束」，不能藏。
   *  🔴 要回去互评的不算：截止之后还得评别人的作业，藏起来就是漏了一件事。
   *  ⚠️ 和 chaoxing.py 的 is_stale 逐条对齐。 */
  function cxIsStale(it, nowSec) {
    if (!it) return false;
    if (it.kind !== 'work' && it.kind !== 'exam') return false;
    if (String(it.status || '').indexOf('互评') >= 0) return false;
    if (!it.endAt) return false;
    var n = nowSec == null ? Math.floor(Date.now() / 1000) : nowSec;
    return (n - it.endAt) >= CX_STALE_END;
  }

  /** 结课状态的 key：`<courseId>:<classId>`。和 `chaoxing.rest_key` 逐字对齐。
   *  🔴 必须带 classId：同一个 courseId 下可能挂着不同学期的教学班，
   *     只按 courseId 存会让本学期的班被上学期的班判成「已结课」。 */
  function cxRestKey(courseId, classId) {
    return String(courseId) + ':' + (classId == null ? '' : String(classId));
  }

  /** 按 (courseId, classId) 去重。和 `chaoxing.unique_courses` 逐条对齐。
   *  🔴 0.39.0 之前只按 courseId 去重，注释写着「不同 classId 的作业/考试/活动
   *     都是同一套」—— 那句是错的。同一个 courseId 下面可能挂着**不同学期**的
   *     教学班，压成一个就只查了其中一个班，顺序一换本学期作业全没了。 */
  function cxUniqueCourses(courses) {
    var seen = {}, out = [];
    if (!Array.isArray(courses)) return out;
    for (var i = 0; i < courses.length; i++) {
      var c = courses[i];
      if (!c || typeof c !== 'object') continue;
      var k = cxRestKey(c.courseId, c.classId);
      if (seen[k]) continue;
      seen[k] = 1;
      out.push(c);
    }
    return out;
  }

  // ---- 教务课表白名单（和 chaoxing.py 的 _norm_name / _in_white 逐字对齐）----
  var CX_ROMAN = { 'Ⅰ': 'I', 'Ⅱ': 'II', 'Ⅲ': 'III', 'Ⅳ': 'IV',
                   'Ⅴ': 'V', 'Ⅵ': 'VI', 'Ⅶ': 'VII', 'Ⅷ': 'VIII' };

  /** 课名归一化：全角转半角、罗马数字统一、去掉空白和标点、转大写。 */
  function cxNormName(s) {
    var t = String(s == null ? '' : s);
    // 全角 → 半角
    t = t.replace(/[\uFF01-\uFF5E]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    }).replace(/\u3000/g, ' ');
    for (var k in CX_ROMAN) {
      if (CX_ROMAN.hasOwnProperty(k)) t = t.split(k).join(CX_ROMAN[k]);
    }
    t = t.replace(/[\s\u3000·・,，。、;；:：!！?？'"“”‘’()（）\[\]【】<>《》/\\|+*#\-]/g, '');
    return t.toUpperCase();
  }

  /** 教务课表 → [{n: 归一化课名, t: 归一化老师名}]。
   *  0.47.0 起前端把老师名一起传下来 —— 光靠课名分不清哪一门是本学期的：
   *  实测「高等数学（理工类）」同时挂着 25-26-1 / 25-26-2 / 非当前 三个班。
   *  兼容老格式：纯字符串、{name,teacher}、{n,t} 都认。
   *  ⚠️ 和 chaoxing.py 的 _norm_white 逐条对齐。 */
  function cxNormWhite(names) {
    if (!Array.isArray(names)) return [];
    var out = [];
    for (var i = 0; i < names.length; i++) {
      var x = names[i], n = '', t = '';
      if (x && typeof x === 'object') {
        n = cxNormName(x.name || x.n || '');
        t = cxNormName(x.teacher || x.t || '');
      } else {
        n = cxNormName(x);
      }
      if (n.length >= 2 || t.length >= 2) out.push({ n: n, t: t });
    }
    return out;
  }

  /**「2026-2027 学年第 1 学期」→ [26, 27, 1]。认不出返回 null。
   *  ⚠️ 和 chaoxing.py 的 cur_term 逐条对齐。 */
  function cxCurTerm(semester) {
    var s = String(semester == null ? '' : semester);
    var m = /(20\d{2})\s*[-—–~至]\s*(20\d{2})/.exec(s);
    if (!m) return null;
    var y1 = parseInt(m[1], 10);
    var n = /第\s*([12一二])\s*学期/.exec(s);
    var k = n ? ({ '一': 1, '二': 2, '1': 1, '2': 2 }[n[1]] || 1) : 1;
    return [y1 % 100, (y1 + 1) % 100, k];
  }

  /** 从课名 / 班级名里认「这是哪个学期」。认不出返回 null。
   *  三种实测写法：25-26-2 / 26年秋 / 2026.9。
   *  ⚠️ 和 chaoxing.py 的 course_term 逐条对齐 —— 认不出就必须返回 null，
   *  绝不当成「不是本学期」，那是把不知道说成知道。 */
  function cxCourseTerm(text) {
    var s = String(text == null ? '' : text);
    var m = /(?<!\d)(?:20)?(\d{2})\s*[-–—]\s*(?:20)?(\d{2})\s*[-–—]\s*([12])(?!\d)/.exec(s);
    if (m) return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
    m = /(?<!\d)(?:20)?(\d{2})\s*(?:级|年)?\s*([春秋])/.exec(s);
    if (m) {
      var y = parseInt(m[1], 10);
      return [y, (y + 1) % 100, m[2] === '秋' ? 1 : 2];
    }
    m = /(?<!\d)(20\d{2})\.(\d{1,2})(?!\d)/.exec(s);
    if (m) {
      var yy = parseInt(m[1], 10), mo = parseInt(m[2], 10);
      var kk = (mo >= 8 && mo <= 12) ? 1 : 2;
      var y1 = kk === 1 ? yy : yy - 1;
      return [y1 % 100, (y1 + 1) % 100, kk];
    }
    return null;
  }

  function cxTermEq(a, b) {
    return !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  }

  /** 这门课是不是「本学期教务课表里在修」。**故意宽松** ——
   *  误放行只是多扫一门，漏放行等于把真的作业档住。
   *  唯一的反向证据：课名/班级名里写着学期，而且不是当前学期。
   *  ⚠️ 和 chaoxing.py 的 is_active_course 逐条对齐。 */
  function cxIsActiveCourse(course, white, term) {
    if (!white || !white.length) return false;
    var title = (course && course.title) || '';
    var alias = (course && course.alias) || '';
    var t = cxNormName(title);
    var a = cxNormName(alias);
    if (term) {
      var t1 = cxCourseTerm(title), t2 = cxCourseTerm(alias);
      if ((t1 && !cxTermEq(t1, term)) || (t2 && !cxTermEq(t2, term))) return false;
    }
    for (var i = 0; i < white.length; i++) {
      var w = white[i] || {}, n = w.n || '', tea = w.t || '';
      if (n && t) {
        if (n === t || t.indexOf(n) >= 0 || n.indexOf(t) >= 0) return true;
        if (n.length >= 4 && t.length >= 4 && n.slice(0, 4) === t.slice(0, 4)) return true;
      }
      if (tea.length >= 2 && a && a.indexOf(tea) >= 0) return true;
      if (n.length >= 4 && a && a.indexOf(n) >= 0) return true;
    }
    return false;
  }

  /** 扫描进度。和 bridge.py 的 _CX_SCAN 同构，前端只认这几个键。 */
  var CX_SCAN = { state: 'idle', at: 0, i: 0, n: 0, course: '', phase: '',
                  err: '', kind: '' };

  function cxErr(msg, kind) {
    var e = new Error(msg);
    e.kind = kind || 'net';
    return e;
  }

  function cxSleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  /** 学习通请求。不走 http()：那个每次要等 POLITE_MS（1.2 秒），
   *  32 门课就是 77 秒白等。节奏由 cxScan 自己按 CX_GAP 控制。
   *
   *  🔴 0.44.1：这里加了 CX_REQ_GAP 的全局限流。以前所有请求都是**立刻**发，
   *     连发的那几发（一门课的课程页 / 作业 / 考试 / 活动）在服务端看起来
   *     就是「同一个会话每秒问四次」，这是 202 的主要来源。
   *     现在每个请求都排在上一个之后至少 0.45 秒 —— 一门课约 1.4 秒，
   *     加上课间 1.8 秒，30 门课约 1 分 40 秒。 */
  // Use the bundled bridge's shared callback registry and the current account scope.
  let requestScope = '';

  async function cxHttp(method, url, body, referer, headers) {
    const scope = requestScope;
    await cxSleep(Math.max(0, CX_REQ_GAP - (Date.now() - cxLastReqAt)));
    cxLastReqAt = Date.now();
    const result = await nativeRequest(method, url, body, referer, headers, scope);
    if (result.status === 202 || result.status === 429) cxStatusOk(result, '学习通');
    return result;
  }

  function cxEndFromLeft(leftMin, nowSec) {
    if (leftMin == null) return null;
    var now = (nowSec == null) ? Date.now() / 1000 : nowSec;
    return Math.floor(now + leftMin * 60);
  }

  /** 「剩余32小时54分钟」→ 1974（分钟）。认不出来返回 null。
   *
   *  🔴 不兜底成 0：0 分钟意味着「已经到期」，那是完全相反的意思。 */
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

  /** 「结束时间：10-20 15:00」→ unix 秒。认不出返回 null。
   *  作业 / 考试列表在**有绝对时间**时会写这一行；倒计时那行过期以后就没了。
   *  只认「2026-10-20 15:00」和「10-20 15:00」（跨年自己猜）。
   *  ⚠️ 和 chaoxing.py 的 parse_due 逐条对齐。 */
  function cxParseDue(text, nowSec) {
    if (!text) return null;
    var str = String(text);
    if (!/(结束|截止)/.test(str) && /发布时间|发布于/.test(str)) return null;
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

  /** 一条作业/考试的「截止时间 + 剩余分钟」。
   *  有绝对时间就以它为准（倒计时那行会随读取时刻漂移，过期以后还没有）；
   *  只有倒计时时才拿它换算。
   *  ⚠️ 和 chaoxing.py 里 parse_work / parse_exam 的这两行逐条对齐。 */
  function cxDue(raw, nowSec) {
    var left = cxLeft(raw);
    var end = cxParseDue(raw, nowSec);
    if (end == null) return { leftMin: left, endAt: cxEndFromLeft(left, nowSec), estimated: left != null };
    if (left == null) {
      var now = (nowSec == null) ? Date.now() / 1000 : nowSec;
      left = Math.floor((end - now) / 60);
    }
    return { leftMin: left, endAt: end };
  }

  /** 状态归三档。不认识的返回 'other' —— 不往任何一边凑。 */
  function cxBucket(status) {
    var s = String(status || '').replace(/^\s+|\s+$/g, '');
    for (var i = 0; i < CX_TODO.length; i++) if (CX_TODO[i] === s) return 'todo';
    for (var j = 0; j < CX_DONE.length; j++) if (CX_DONE[j] === s) return 'done';
    return 'other';
  }

  /** backclazzdata 的 JSON → 课程列表。字段位置是实测出来的：
   *    courseId = content.course.data[0].id
   *    classId  = content.id
   *    cpi      = channel.cpi
   *    title    = data[0].name（干净课名）
   *    alias    = content.name（带老师/周次，不能当课名用）
   *    schoolId = data[0].belongSchoolId（学校 id，活动列表接口要这个；郑航是 1286） */
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

  /** activeType → 分类。认不出来归 'other'，不往任何一类里凑。 */
  function cxKindOf(activeType) {
    var t = String(activeType == null ? '' : activeType).replace(/^\s+|\s+$/g, '');
    if (/\.0$/.test(t)) t = t.slice(0, -2);      // 万一给了 5.0
    for (var k in CX_KIND_BUCKET) {
      if (!CX_KIND_BUCKET.hasOwnProperty(k)) continue;
      if (CX_KIND_BUCKET[k].indexOf(t) >= 0) return k;
    }
    return 'other';
  }

  /** 签到的「我到底签了没」→ true / false / null。
   *
   *  🔴 认不出来就返回 null，**绝不兜底成 false**。兜成「没签」等于凭空
   *     告诉用户「你漏签了」—— 那是会让人白跑一趟教务处的错。
   *     ⚠️ 这份判定必须和 chaoxing.py 的 sign_state() 一模一样：
   *        网页版走 Python，APK 走这里，两边不一致的话同一份数据
   *        会算出两种「漏签次数」，而且不报错。 */
  function cxSignState(text) {
    var t = String(text == null ? '' : text).replace(/^\s+|\s+$/g, '');
    if (!t) return null;
    if (t.indexOf('已签') >= 0) return true;              // 已签到 / 已签退
    if (t.indexOf('未签') >= 0 || t.indexOf('缺勤') >= 0) return false;
    return null;
  }

  /** 毫秒时间戳 → 秒。空/0/非数字返回 null。
   *  🔴 学习通的 0 表示「没有这个时间」，不是 1970 年。当成 0 会算出一个
   *     五十多年前的倒计时，然后被当成「早就过期」悄悄丢掉。 */
  function cxMsToSec(v) {
    var n = parseInt(v, 10);
    if (!isFinite(n) || n <= 0) return null;
    return Math.floor(n / 1000);
  }

  /** 补全协议。学习通给的多半是 `//mobilelearn.chaoxing.com/...`。 */
  function cxAbsUrl(value, base) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const url = new URL(value, base || CX_BASE);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port
        && /^(?:[a-z0-9-]+\.)*chaoxing\.com$/.test(url.hostname) ? url.href : '';
    } catch (_) { return ''; }
  }

  /** 活动 JSON 的 content 里带的 stuUrl（学习通自己用的兜底地址）。
   *  🔴 content 有时是对象、有时是 JSON 字符串 —— 两种都认。 */
  function cxContentStuUrl(a) {
    var c = a ? a.content : null;
    if (typeof c === 'string') {
      try { c = JSON.parse(c); } catch (e) { return ''; }
    }
    if (!c || typeof c !== 'object') return '';
    return cxAbsUrl(c.stuUrl);
  }

  /** 一条活动 → 详情页地址。拼不出来返回空串（界面就不显示小箭头）。
   *  只做「上面这些参数就够」的类型：直播(17)/分组任务(35)/在线课堂(56)
   *  要先调别的接口拿 liveId / uuid，宁可**不给链接**，也别给个点开就报错的。 */
  function cxActiveUrl(a, course) {
    var u = cxContentStuUrl(a);
    if (u) return u;
    var path = CX_ACTIVE_PAGE[String(a && a.activeType != null ? a.activeType : '').trim().replace(/\.0$/, '')];
    if (!path) return '';
    var c = course || {};
    var cid = String(c.courseId == null ? '' : c.courseId).trim();
    var clid = String(c.classId == null ? '' : c.classId).trim();
    var fid = String(c.schoolId == null ? '' : c.schoolId).trim();
    var aid = cxStableId(a.id);
    if (!(cid && clid && fid && aid)) return '';
    var q = 'courseId=' + cid + '&classId=' + clid + '&activeId=' + aid + '&fid=' + fid;
    if (path.indexOf('stu_reply_discuss') >= 0) {
      var cpi = String(c.cpi == null ? '' : c.cpi).trim();
      if (cpi) q += '&cpi=' + cpi;
      q += '&showOnScreenShare=true';
    }
    return CX_BASE + path + '?' + q;
  }

  /** 活动列表 JSON → 条目（签到 / 主题讨论 / 通知 / 作业提醒 …）。
   *
   *  字段名不是猜的，是从学习通自己的任务列表页模板里逐条抄的
   *  （_lab/cx/ml/active_page.html，191 KB 真实抓取）：
   *      nameOne   标题
   *      nameTwo   状态文字（可能为空）
   *      nameFour  倒计时文字，🔴 只有 status=='1' 才渲染
   *      startTime / endTime  毫秒时间戳
   *      status    '1' 进行中 / '2' 已结束 / 其他 未开始
   *
   *  🔴 result != 1 必须抛，不能返回空数组 —— 空数组会被前端显示成
   *     「这门课没有活动」，而真相是「没读到」。 */
  function cxStableId(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
    return /^[A-Za-z0-9_-]{1,80}$/.test(String(value ?? '')) ? String(value) : null;
  }

  function cxParseActive(j, nowSec, course) {
    if (!j || typeof j !== 'object') throw cxErr('无法识别活动列表', 'parse');
    if (cxJsonLoggedOut(j)) throw cxErr('学习通登录已过期，请重新授权', 'auth');
    var res = j.result;
    if (!(res === 1 || res === '1' || res === true)) {
      throw cxErr(String(j.errorMsg || j.msg || '活动列表返回失败'), 'deny');
    }
    var rows = j.data?.activeList;
    if (!Array.isArray(rows)) throw cxErr('无法识别活动列表', 'parse');
    // nowSec 只是给对拍脚本固定时间用的（不传就是当前时间）——
    // 不然「从 endTime 算倒计时」那几条，JS 和 Python 会差个几十秒。
    var now = (typeof nowSec === 'number' && nowSec > 0) ? nowSec : Date.now() / 1000;
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var a = rows[i];
      if (!a || typeof a !== 'object') continue;
      var title = String(a.nameOne == null ? '' : a.nameOne).trim();
      if (!title) {
        if (['notice', 'work'].includes(cxKindOf(a.activeType))) throw cxErr('通知或作业记录缺少标题', 'parse');
        continue;
      }
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
        id: cxStableId(a.id),
        kindName: CX_ACTIVE_KIND[String(a.activeType).replace(/\.0$/, '')] || '活动',
        title: title,
        status: String(a.nameTwo == null ? '' : a.nameTwo).trim(),
        state: state,
        left: name4,
        leftMin: leftMin,
        startAt: start,
        endAt: end,
        // 只有签到/签退才有；别的活动一律 null（不是 false）。
        signed: kd === 'sign' ? cxSignState(a.nameTwo) : null,
        url: cxActiveUrl(a, course)
      });
    }
    if (rows.length && !out.length) throw cxErr('无法识别活动记录', 'parse');
    const hasMore = [j, j.data].some(page => [page.hasMore, page.hasNext]
      .some(flag => /^(1|true)$/i.test(String(flag))) || Number(page.totalCount ?? page.total) > rows.length
      || Number(page.totalPages ?? page.pageCount) > 1);
    return Object.assign(out, { complete: !hasMore });
  }

  /** 考试列表页 → 条目。
   *
   *  结构从这一页自己的样式表反推（_lab/cx/ml/exam-list.css，127 个类名），
   *  和作业列表页**同构**：
   *      li > .tag + .right-content > p.overHidden2（标题）+ p.status（状态）
   *         + .time / .time.notOver（倒计时）
   *
   *  🔴 有 aria-label 就用（作业页就是这条路），没有就退回读文字。
   *     两条路都留着 —— 页面改版时至少有一条能撑住，而不是静默返回 0 条。 */
  function cxMarkup(html) {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    return template.content;
  }

  function cxTaskResult(doc, items, name) {
    if (items.length || doc.textContent.includes('暂无' + name)) return items;
    throw cxErr('无法确认' + name + '列表是否为空', 'parse');
  }

  function cxTaskId(url, ...keys) {
    if (!url) return null;
    const params = new URL(url).searchParams;
    for (const key of keys) {
      const id = cxStableId(params.get(key));
      if (id) return id;
    }
    return null;
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
      const url = cxAbsUrl(li.getAttribute('data'), CXS.EXAM_LIST);
      out.push({
        kind: 'exam',
        kindName: '考试',
        title: title,
        status: status,
        state: /已截止|已过期|已结束/.test(status) && !/已交卷|已参加|待批阅|已批阅/.test(status) ? 'closed' : done ? 'done' : 'todo',
        left: raw,
        leftMin: de.leftMin,
        startAt: null,
        endAt: de.endAt,
        id: cxTaskId(url, 'examId', 'examid', 'relationId'),
        deadlineEstimated: de.estimated === true,
        url
      });
    }
    return Object.assign(cxTaskResult(doc, out, '考试'), { complete: !cxHasMore(doc) });
  }

  /** 这条还值不值得摆到人面前。 */
  function cxIsOpen(it) {
    return it && (it.state === 'todo' || it.state === 'live' || it.state === 'pending');
  }

  function cxTaskStatus(status) {
    const bucket = cxBucket(status);
    return bucket !== 'done' && /已截止|已过期|已结束|已关闭/.test(status) ? 'closed' : bucket;
  }

  /** 作业列表页 → 作业数组。
   *
   *  每条 li：
   *    aria-label = "标题 ; 状态"   ← 最干净的来源（标题和状态一次拿全）
   *    .time                       ← 「剩余32小时54分钟」，没有就没有倒计时
   *    data="..."                  ← 详情页地址
   *
   *  🔴 用 lastIndexOf(';') 而不是 indexOf：万一标题里带分号，
   *     状态仍然是最后一段。 */
  function cxHasMore(doc) {
    return !!(doc.querySelector('#page')?.children.length
      || doc.querySelector('a[rel=next], [data-has-more="true"]'));
  }

  function cxPublishedAt(text) {
    const publication = /(?:发布时间|发布于)\s*[：:]?\s*(20\d\d-\d\d-\d\d)\s+(\d\d:\d\d)(?::(\d\d))?/.exec(text);
    if (!publication) return null;
    const dateText = publication[1] + 'T' + publication[2] + ':' + (publication[3] || '00');
    const parsed = Date.parse(dateText + '+08:00');
    return Number.isFinite(parsed) && new Date(parsed + 8 * 3600000).toISOString().slice(0, 19) === dateText
      ? parsed : null;
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
      const publishedAt = cxPublishedAt(li.textContent);

      const url = cxAbsUrl(li.getAttribute('data'), CXS.WORK_LIST);
      out.push({
        kind: 'work',
        publishedAt,
        kindName: '作业',
        title: title,
        status: status,
        state: cxTaskStatus(status),
        left: raw,
        leftMin: dw.leftMin,
        startAt: null,
        endAt: dw.endAt,
        id: cxTaskId(url, 'workId'),
        deadlineEstimated: dw.estimated === true,
        url
      });
    }
    return Object.assign(cxTaskResult(doc, out, '作业'), { complete: !cxHasMore(doc) && out.length === lis.length && !ul?.querySelector('li[data]:not([aria-label])') });
  }

  // ---------------------------------------------------------- cookie 持久化

  async function cxLogin(user, pwd) {
    var enc = '';
    try {
      if (pwd) enc = String(Android.cxAes(String(pwd)) || '');
      else {
        const saved = JSON.parse(Android.cxSavedLoginForm() || 'null');
        user = saved?.u;
        enc = saved?.p || '';
      }
    } catch (e) { enc = ''; }
    // 🔴 加密失败**不能**拿明文顶上：学习通只认密文，发明文等于拿错的密码去撞
    if (!enc || !user) throw cxErr('无法读取登录信息，请重新输入账号和密码', 'parse');

    // 先开一次登录页，拿到 passport2 域的 JSESSIONID / route
    //
    // 🔴 这一步失败时以前直接把底层那句「原生请求失败：…」抛上去，
    //    用户读到的是机器的语言。网络没通和校园网没认证在现象上一样
    //    （请求根本出不去），但在**该做什么**上完全一样：先看网络。
    try {
      const page = await cxHttp('GET', CXS.LOGIN_PAGE, '', '');
      if (page.status !== 200) cxStatusOk(page, '登录页');
    } catch (e) {
      if (e.busy) throw e;
      throw cxErr('连不上学习通：网络没通，或者校园网还没登录', 'net');
    }

    var body = form({
      fid: '-1',
      uname: user,
      password: enc,
      // 这个值本身已经是 URL 编码过的，form() 会再编一次 —— 和 Python 版
      // 用 requests 发出去的结果一致（服务端认的就是这个双重编码）。
      refer: 'http%3A%2F%2Fi.mooc.chaoxing.com',
      t: 'true',                 // 🔴 只有 true 时前端才加密密码
      forbidotherlogin: '0',
      validate: '',              // 首次登录不需要验证码
      _blank: '1',
      retainlogin: '2',
      pcxxtpage: '0',
      needVcode: ''
    });

    var r;
    try {
      r = await cxHttp('POST', CXS.LOGIN_API, body, CXS.LOGIN_PAGE,
                       { 'X-Requested-With': 'XMLHttpRequest' });
    } catch (e) {
      if (e.busy) throw e;
      throw cxErr('连不上学习通：网络没通，或者校园网还没登录', 'net');
    }

    var j = null;
    try { j = JSON.parse(String((r && r.body) || '')); }
    catch (e) {
      // 校园网没认证时，网关会拿一个登录页当成功响应塞回来（200 + HTML）。
      // 那既不是「改版」也不是「密码错」，是网络被拦了 —— 说成改版，
      // 用户只能干等更新。
      if (/<html/i.test(String((r && r.body) || ''))) {
        throw cxErr('连不上学习通：网络好像被拦了（校园网可能要先登录）', 'net');
      }
      throw cxErr('登录没成功，学校系统可能改版了', 'parse');
    }

    var ok = j?.status === true || String(j?.status).toLowerCase() === 'true';
    if (!ok) {
      var mes = String((j && j.mes) || '').replace(/^\s+|\s+$/g, '');
      if (mes.indexOf('验证码') >= 0 || (j && j.needVcode)) {
        throw cxErr('学习通要求验证码，请使用官方页面登录', 'auth');
      }
      throw cxErr(mes || '账号或密码不对', 'auth');
    }
    return true;
  }

  async function cxCourses() {
    var r = await cxHttp('GET', CXS.COURSE_API, '', CXS.COURSE_REF);
    cxStatusOk(r, '课程列表');
    var t = String((r && r.body) || '');
    if (!t.trim()) throw cxErr('学习通课程列表响应为空', 'parse');
    // 🔴 登录页要单独认出来。不认的话会掉进下面 JSON.parse 失败那条，
    //    报「课程列表不是 JSON，接口可能变了」—— 那是**假话**：
    //    接口没变，只是没登录，服务器把我们 302 到登录页了。
    //    用户按「接口变了」去理解，唯一能做的事是等更新，而真正该做的是重连。
    if (cxLooksLoggedOut(t)) {
      throw cxErr('学习通的登录态过期了，点「重新连接」再试一次', 'auth');
    }
    var j;
    try { j = JSON.parse(t); }
    catch (e) { throw cxErr('课程列表没读出来，学校系统可能改版了', 'parse'); }
    // 🔴 2026-11-12 补：没登录时学习通回的是**合法 JSON**（见 cxJsonLoggedOut），
    //    不判这一条就会把它说成「改版了」，而且归成 parse ⇒ 不停扫描、不提示重连。
    if (cxJsonLoggedOut(j)) {
      throw cxErr('学习通的登录态过期了，点「重新连接」再试一次', 'auth');
    }
    var rows = cxUniqueCourses(cxParseCourses(j).filter(c => c.courseId && c.classId));
    if (!Array.isArray(j?.channelList) || (!rows.length && j.channelList.length)) {
      throw cxErr('课程列表没读出来，学校系统可能改版了', 'parse');
    }
    return rows;
  }

  /** 这段内容是不是「登录页」而不是接口数据。
   *
   *  ⚠️ 必须和 chaoxing.py 的 `_looks_logged_out()` 逐字对齐（对拍脚本会验）。
   *
   *  🔴 先判「像不像 JSON」再判关键字：正常响应里 courseName 之类的字段
   *     完全可能带「用户登录」四个字（比如一门叫《用户登录与鉴权》的课），
   *     只看关键字会把正常数据判成没登录 —— 那比反过来更糟，
   *     因为它会让人白白重连一次。
   */
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

  /** 解析出来的 JSON 是不是「没登录」。
   *
   *  🔴 2026-11-12 实测（匿名请求一次 `backclazzdata`，不带任何账号）：
   *     学习通对**没登录的请求**回的是 **200 + 合法 JSON**：
   *       {"result":0,"msg":"请重新登录","status":false,"errorMsg":"请重新登录"}
   *     而上面那个 `cxLooksLoggedOut` 只认 HTML 登录页（见到 `{` 就返回 false）。
   *     于是这条掉进「没有 channelList」那个分支，报成
   *     「课程列表没读出来，学校系统可能改版了」—— **这是假话**：
   *     接口一个字都没变，是我们没登录。用户照着「等更新」去做，
   *     等一辈子也等不到；而且它被归成 `parse` 不是 `auth`，
   *     扫描不会停、也不会提示重连，后台每隔一两小时再撞一次，
   *     表现就是「后台一直检查失败」。
   *
   *  ⚠️ 判定必须**同时**满足「失败态」和「文案里有登录」两条：
   *     `result:0` 也可能表示别的业务失败（比如课程被归档），
   *     只看 `result` 会把那种情况说成「登录过期」，用户白重连一次。
   *  ⚠️ 必须和 chaoxing.py 的 `_json_logged_out()` 逐字对齐（对拍会验）。
   */
  function cxJsonLoggedOut(j) {
    if (!j || typeof j !== 'object') return false;
    var bad = (j.status === false) || (j.result === 0) || (j.result === '0');
    if (!bad) return false;
    var s = String(j.msg || j.errorMsg || j.message || '');
    return s.indexOf('登录') >= 0 || /login/i.test(s);
  }

  /** 非 200 一律当服务端/网络错误。
   *
   *  🔴 必须显式判：Java 那边只把响应体交回来，502 的 HTML 和「真的没作业」
   *     在解析层长得一模一样（`cxParseWork` 找不到 <ul> 就返回 []），
   *     于是「服务器挂了」会被静默当成「这门课没有作业」。
   *
   *  实测（`_lab/cx/probe_502.py`，两门课全部 502）修之前的样子：
   *      work   → code=noentry「没给作业入口」      ← 假话
   *      exam   → code=noentry「没给考试入口」      ← 假话
   *      active → code=auth    「登录态可能失效了」  ← 假话，而且更糟：
   *                扫描见到 auth 就停，**第二门课根本不查、也不记录**。
   *
   *  ⚠️ 这个函数必须和 `chaoxing.py` 的 `_status_ok()` 逐字对齐 ——
   *     APK 没有 Python，两边是各写一份。只改一边不报错。
   */
  function cxStatusOk(r, what) {
    var code = (r && r.status) || 0;
    // 🔴 2026-10-25 补：401 是「未授权」，不是「服务器出错」。
    //    以前 401 走下面那条「学习通服务器出错了，不是你的问题」——
    //    那句话会让用户干等着，而他真正该做的是点「重新连接」。
    //    而且 401 判成 net 之后扫描不会停，剩下几十门课各发一次注定 401 的请求。
    //    ⚠️ 403 仍然算 net：学习通的 403 多半是风控拦的，不是账号问题。
    //    ⚠️ 必须和 `chaoxing.py` 的 `_status_ok()` 逐字一致（对拍会验）。
    if (code === 401 || (code === 200 && (r.url && new URL(r.url).hostname === 'passport2.chaoxing.com' || cxLooksLoggedOut(r.body)))) {
      throw cxErr(what + '打不开，登录过期了，点「重新连接」再试一次', 'auth');
    }
    // 🔴 202 = Accepted：请求收到了但没给内容，学习通那边通常是风控在排队。
    //    和 chaoxing.py 的 _status_ok 逐字一致（对拍会比对文案本身）。
    //    说「服务器出错了」会让用户以为没事、接着点，越点越封。
    if (code === 202 || code === 429) {      // 0.44.1：把「过几分钟」改成具体的 15 分钟，和下面的冷静期一致 ——
      // 说「过几分钟」的话，用户三分钟后又点，撞上同一堵墙，还以为我们
      // 在随便打发他。
      var e202 = cxErr(what + '查得太频繁了，等 15 分钟再试', 'net');
      // 🔴 0.44.0：给错误打个标记，让扫描知道「这是被拦了」而不是「这一门课
      //    恰好没读到」。两者在文案上一模一样，但处理方式相反：
      //    前者要**立刻停手**（再问下去只会被封得更久），后者继续下一门。
      //    不加这个标记的话，31 门课会各撞一次墙，最后界面上写着
      //    「31 门课没查到」—— 用户读到的是「31 门都没查」，而事实是
      //    「查到第 4 门就被拦了，剩下 27 门一个请求都没发」。
      e202.busy = true;
      throw e202;
    }
    // 🔴 status 0 = 请求**根本没发出去**（断网、DNS、被网关拦、超时）。
    //    以前它和真的 500 走同一句「学习通服务器出错了，不是你的问题」——
    //    那句会让人什么都不做地等着。真正该做的是先看网络。
    if (!code) {
      throw cxErr('连不上学习通：网络没通，或者校园网还没登录', 'net');
    }
    if (code !== 200) {
      throw cxErr(what + '返回 ' + code + '（学习通服务器出错了，不是你的问题）', 'net');
    }
  }

  /** 进课程页，拿 stuenc + workEnc。两个必须来自同一次加载。 */
  async function cxCourseMeta(c) {
    var url = CXS.COURSE_PAGE + '?courseid=' + c.courseId + '&clazzid=' + c.classId
            + '&cpi=' + c.cpi + '&ismooc2=1&v=2';
    var r = await cxHttp('GET', url, '', '');
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

  async function cxWorkList(c, meta) {
    // 🔴 kind 用 'noentry' 而不是 'deny'：界面上这是**完全不同**的两句话。
    //    deny = 被拒绝（账号可能有问题），noentry = 这门课的页面里压根没这个
    //    入口（多半已结课归档）。混成一种，用户只能看到「拿不到入口」。
    if (!meta.stuenc || !meta.workEnc) throw cxErr('没给作业入口', 'noentry');
    var url = CXS.WORK_LIST + '?courseId=' + c.courseId + '&classId=' + c.classId
            + '&cpi=' + c.cpi + '&ut=s&t=' + Date.now()
            + '&stuenc=' + meta.stuenc + '&enc=' + meta.workEnc;
    var r = await cxHttp('GET', url, '', meta.referer);
    cxStatusOk(r, '作业列表');
    var t = String((r && r.body) || '');
    if (t.indexOf('无权限的操作') >= 0 || t.indexOf('无效的用户') >= 0) {
      throw cxErr('作业列表读不了，重新连接一次再试', 'deny');
    }
    return Object.assign(cxParseWork(t), { serverTime: r.serverTime });
  }

  /** 一门课的活动列表。🔴 不需要 stuenc，所以不用先进课程页 —— 省一次请求。 */
  async function cxActiveList(c) {
    if (!c.schoolId) throw cxErr('这门课没带学校 id，活动查不了', 'parse');
    var url = CXS.ACTIVE_LIST + '?fid=' + c.schoolId
            + '&courseId=' + c.courseId + '&classId=' + c.classId
            + '&showNotStartedActive=0&_=' + Date.now();
    var referer = CXS.COURSE_PAGE + '?courseid=' + c.courseId
                + '&clazzid=' + c.classId + '&cpi=' + c.cpi;
    var r = await cxHttp('GET', url, '', referer, { 'X-Requested-With': 'XMLHttpRequest' });
    cxStatusOk(r, '活动列表');
    var t = String((r && r.body) || '');
    // 没登录时会 302 到登录页，回来的是一大坨 HTML 而不是 JSON
    var head = t.replace(/^\s+/, '').slice(0, 1);
    if (head !== '{' && head !== '[') {
      // 🔴 非 JSON **不再一律判 auth**。原来只要不是 JSON 就说「登录态可能失效了」，
      //    可 auth 会让扫描直接停下 —— 一个维护页 / 接口改版，就能让后面
      //    所有课**一门都不查**，而用户看到的是「登录失效」。
      //    现在只有真的看到登录页特征才判 auth，其余判 parse（照常往下查）。
      var hs = t.slice(0, 4000);
      if (hs.indexOf('用户登录') >= 0 || hs.indexOf('passport2') >= 0
          || hs.toLowerCase().indexOf('login') >= 0) {
        throw cxErr('活动列表跳到登录页了（登录态失效）', 'auth');
      }
      throw cxErr('活动列表没读出来，学校系统可能改版了', 'parse');
    }
    var j;
    try { j = JSON.parse(t); }
    catch (e) { throw cxErr('活动列表没读出来，学校系统可能改版了', 'parse'); }
    // 详情页地址要 courseId / classId / fid，而接口**不回**这三个
    // （它本来就是按课查的），所以把课程对象带进去自己拼。
    return Object.assign(cxParseActive(j, null, c), { serverTime: r.serverTime });
  }

  /** 一门课的考试列表。需要 stuenc，必须在 cxCourseMeta 之后调。 */
  async function cxExamList(c, meta) {
    if (!meta.stuenc) throw cxErr('没给考试入口', 'noentry');
    var url = CXS.EXAM_LIST + '?courseid=' + c.courseId + '&clazzid=' + c.classId
            + '&cpi=' + c.cpi + '&ut=s&t=' + Date.now() + '&stuenc=' + meta.stuenc;
    var r = await cxHttp('GET', url, '', meta.referer);
    cxStatusOk(r, '考试列表');
    var t = String((r && r.body) || '');
    if (t.indexOf('这次操作没成功，重试一次') >= 0) {
      throw cxErr('考试读不出来，学习通可能改版了', 'parse');
    }
    if (t.indexOf('无权限的操作') >= 0 || t.indexOf('无效的用户') >= 0) {
      throw cxErr('考试列表被拒（登录态失效）', 'deny');
    }
    if (t.slice(0, 3000).indexOf('用户登录') >= 0) {
      throw cxErr('考试页跳到登录了（登录态失效）', 'auth');
    }
    return Object.assign(cxParseExam(t), { serverTime: r.serverTime });
  }

  /** 把每门课的**作业 + 考试 + 课堂活动**都读一遍。
   *  返回结构与 bridge.py 的 scan() 完全一致（前端只写一套分支）。 */
  /** 算一门课这一轮扫描之后的「结课判定」状态。**纯函数**。
   *
   * st       上一轮的状态（可能没有）
   * okAll    这一轮四个请求是不是全部成功（课程页 + 作业 + 考试 + 活动）
   * isEmpty  三个列表是不是都为空
   * now      现在（unix 秒）
   * newest   这门课最新一条内容的时间（unix 秒）。None/null = 有内容但没给时间。
   *           **0.39.0 新增**，见 CX_COLD_DAY。
   *
   * 🔴 这是 `chaoxing.py` 的 `rest_next` 的**第二份实现**（APK 里没有 Python）。
   *    两份靠 `_lab/cx/check_cx_js.py` 逐条对拍 —— 只改一边不报错，
   *    只是手机上和网页上「哪些课算结课」会得出不同答案，用户看不出来。
   *
   * 🔴 okAll=false 时**原样返回**：既不加次数（那是拿「没读到」当「没有」），
   *    也不清零（那会让好不容易攒的次数白费）。这是整个判据里最要紧的一条。
   */
  function cxRestNext(st, okAll, isEmpty, now, newest) {
    st = (st && typeof st === 'object') ? st : {};
    if (!okAll) return st;
    if (isEmpty) {
      var streak = (st.streak || 0) + 1;
      var since = st.since || now;
      return {
        streak: streak, since: since, lastAt: now,
        // 次数够 + 跨度够 才真的停扫。只满足一条不算：一天点三次刷新
        // 也能凑够 3 次，但那才过了半天，分不清「结课」和「今天还没发作业」。
        resting: !!(streak >= CX_REST_STREAK && now - since >= CX_REST_SPAN)
      };
    }
    // 有内容，但最新那条已经很旧 ⇒ 冷课，这一轮就降频。
    // 🔴 newest 不是数字时**不判冷**：那是「不知道多旧」，不是「很旧」。
    // 🔴 只认数字和数字字符串。**不能直接 Number(newest)**：
    //    `Number([]) === 0`、`Number(null) === 0`、`Number('') === 0` ——
    //    空数组会被当成「1970 年」，`now - 0` 是个天文数字 ⇒ 直接判成冷课，
    //    一门课就这么被永久降频了。对拍时 `newest=[]` 就是这么红的。
    var cold = false;
    var nv = NaN;
    if (typeof newest === 'number') nv = newest;
    else if (typeof newest === 'string' && newest !== '') nv = Number(newest);
    if (isFinite(nv)) cold = (now - nv) >= CX_COLD_DAY;
    if (cold) {
      return {
        streak: (st.streak || 0) + 1,
        since: st.since || now, lastAt: now,
        resting: true
      };
    }
    // 有内容且是新的 ⇒ 立刻恢复。这是判错时的自我纠错。
    return { streak: 0, since: now, lastAt: now, resting: false };
  }

  async function cxScanAll(prevRest, force, preCourses, activeNames, semester, options) {
    // preCourses 由 /api/cx/scan 在没有 UID 时先探一次拿到（见那里的注释）。
    // ⚠️ 只在「真的是个数组」时采信：`cxCourses()` 拿不到会抛，不会返回空数组，
    //    所以走到这里还拿到空数组 = 上游传错了，重取一次更稳。
    var courses = (Array.isArray(preCourses) && preCourses.length)
      ? preCourses : await cxCourses();

    // 🔴 0.39.0：按 (courseId, classId) 去重，不再只按 courseId。
    //    以前那句「不同 classId 的作业/考试/活动都是同一套」是错的：
    //    同一个 courseId 下可能挂着**不同学期**的教学班 —— 实测这个账号的
    //    「大学物理实验」同时有 26-27-1 和 25-26-2 两个班。压成一个 ⇒
    //    只查了其中**一个**班，顺序一换本学期的作业就一条都不在了。
    var uniq = cxUniqueCourses(courses);
    options.courses(uniq);

    var items = [], failed = [];
    var PHASE = '作业 · 考试 · 课堂活动';
    var nowSec = Math.floor(Date.now() / 1000);
    prevRest = (prevRest && typeof prevRest === 'object') ? prevRest : {};
    // 先整体继承上一轮的状态，再逐门覆盖扫过的课。
    // 🔴 不能只写「这次扫过的课」：中途 auth 失效 break 之后，剩下的课没扫，
    //    状态丢了它们攒的 streak 就白攒了 —— 等于每次从零数。
    var rest = {};
    for (var rk in prevRest) {
      // ⚠️ 只继承新格式的 key（带 `:`）。0.38 及以前按裸 courseId 存，
      //    那个口径本身就是错的（一个 courseId 压了多个学期的班）。
      if (prevRest.hasOwnProperty(rk) && prevRest[rk] &&
          typeof prevRest[rk] === 'object' && String(rk).indexOf(':') >= 0) {
        rest[rk] = prevRest[rk];
      }
    }
    var paused = [];              // 这次因为「已结课」而没扫的课
    var white = cxNormWhite(activeNames);
    var term = cxCurTerm(semester);
    // 🔴 0.47.2：进度条的分母按**这学期**算。
    //    用户 2026-11-06：「仍然是类似于 12/37 这样，后面的总数也改成
    //    当前学期的」。以前 n 一直是 uniq.length（含历史学期），哪怕只细查
    //    17 门，进度也写「第 12 / 37 门课」—— 看着就像范围没收窄。
    //    有课表 ⇒ 分母 = 这学期在修的课数，分子只数全扫过的课；
    //    没有课表 ⇒ 分母照旧全部（那时确实一门一门全扫）。
    var scope = white.length ? 'term' : 'all';
    var deepTotal = uniq.length;
    if (white.length) {
      deepTotal = 0;
      for (var dt = 0; dt < uniq.length; dt++) {
        if (cxIsActiveCourse(uniq[dt], white, term)) deepTotal++;
      }
      if (!deepTotal) { deepTotal = uniq.length; scope = 'all'; }
    }
    var deepDone = 0;             // 进度分子：只数「全扫」的课
    // 0.47.0：全扫了几门 / 只看了签到几门。
    var deepN = 0, actN = 0;
    // 0.44.0：这一轮撞上「查得太频繁」就整轮停手（见 cxStatusOk 的 202 分支）。
    var busyOut = false;

    for (var k = 0; k < uniq.length; k++) {
      if (!options.current()) throw cxErr('学习通会话已变更', 'cancel');
      var c = uniq[k];
      var ckey = cxRestKey(c.courseId, c.classId);

      // ---- 这门课要全扫，还是只看一眼签到 ----
      // 🔴 0.47.0：判据从「三个列表全空攒 3 次 / 最新内容 90 天前」换成
      //    **教务系统里本学期在修的课表**。老判据对历史学期的课判不动 ——
      //    它们不空（上学期的作业还挂着），于是 37 门课一个学期都判不出结课，
      //    每轮全量扫。用户 2026-11-06：「我这个学期只有十几个课程」。
      //      deep = 全扫（课程页 + 作业 + 考试 + 活动，4 个请求）
      //      act  = 判它结课了，只查活动列表（1 个请求）—— 签到在里面
      // 🔴 没有教务课表时**不降级成 act**，退回 0.44 的老口径，其余照旧全扫。
      //    没有权威名单的时候少查一门就可能漏一门作业，那比慢几十秒严重得多。
      var st = prevRest[ckey] || {};
      var tier;
      // 🔴 2026-11-06：**课表优先于 force**。手动点「重新检查」走 force，
      //    以前会 37 门全扫 —— 用户点完看到「共 37 门课」，以为收范围没生效。
      //    「现在去问一遍」≠「把结课的也问一遍」：结课的课再扫 4 个请求
      //    也多不出一条作业，签到那 1 个请求（act 档）手动刷新照样发。
      if (white.length) tier = cxIsActiveCourse(c, white, term) ? 'deep' : 'act';
      else if (force) tier = 'deep';
      else tier = (st.cold === true) ? 'act' : 'deep';

      if (options.full(c)) tier = 'deep';

      // 结课的课也不是每轮都探。探过一次就隔 CX_ACT_PROBE_GAP 再来。
      // 🔴 认的是 st.act 这个标记（= 已经按新办法探过一次），不是 lastAt：
      //    从老版本升上来时 rest 里没有这个键，照着 lastAt 直接跳过的话，
      //    那批课 7 天内一次签到也看不到。
      if (tier === 'act' && st.act === true && !force &&
          nowSec - (st.lastAt || 0) < CX_ACT_PROBE_GAP) {
        // why 是给界面选句子用的：term = 教务课表里这学期没有（有依据）；
        // cold = 没有课表，只能靠「内容很旧」判（说得软一点）。
        paused.push({ course: c.title, courseId: c.courseId,
                      classId: c.classId, lastAt: st.lastAt || 0,
                      why: white.length ? 'term' : 'cold' });
        // 进度照报，但**分子不动**：这学期要查的已经查完了，这里只是顺手
        // 看一眼结课那批的签到。分母是 17，分子就停在 17 ——
        // 别让它跑到「第 37 / 17 门」这种看着就错的地方。
        CX_SCAN.i = deepDone;
        CX_SCAN.n = deepTotal;
        CX_SCAN.course = c.title;
        CX_SCAN.phase = '已结课，跳过';
        options.progress();
        continue;
      }

      // 这门课这一轮读到的条目，用来算「最新内容时间」（冷课判据要）
      var mine = [];
      var sections = [];
      var push = function (rows) {
        for (var x = 0; x < rows.length; x++) {
          rows[x].course = c.title;
          rows[x].courseId = c.courseId;
          rows[x].classId = c.classId;
          items.push(rows[x]);
          mine.push(rows[x]);
        }
      };
      // part / code 是给**界面**用的分类键，不是给人看的字（和 chaoxing.py
      // 的 note() 同一个口径）。界面拿它们把「20 门课各缺作业 + 各缺考试」
      // 合成一句人话。
      function capture(title, rows) {
        sections.push({ title, items: rows, complete: rows.complete !== false, serverTime: rows.serverTime });
        push(rows);
      }
      var note = function (why, part, code) {
        const title = { work: '作业', exam: '考试', active: '活动' }[part];
        if (title) sections.push({ title, error: String(why), kind: code });
        failed.push({ course: c.title, classId: c.classId, courseId: c.courseId, why: String(why).slice(0, 60),
                      part: part || 'other', code: String(code || '') });
      };

      // ---- 结课的课：只看一眼签到 ----
      // 作业和考试**一个请求都不发** —— 教务课表里没有这门课，判它结课了。
      // 唯一还可能变的是签到：它是个几分钟的窗口，而「点名专用」这类课
      // 教务课表里根本没有、唯一的内容就是签到，所以必须留这一眼。
      if (tier === 'act') {
        var warm = false;
        try {
          var aRows0 = await cxActiveList(c);
          capture('活动', aRows0);
          var newestAct = null;
          for (var ai = 0; ai < aRows0.length; ai++) {
            var at2 = aRows0[ai].startAt || aRows0[ai].endAt;
            if (at2 && (newestAct === null || at2 > newestAct)) newestAct = at2;
          }
          warm = !!newestAct && (nowSec - newestAct) < CX_WARM_ACT;
        } catch (e0) {
          note((e0 && e0.message) || e0, 'active', e0 && e0.kind);
          if (e0 && e0.kind === 'auth') throw e0;
          if (e0 && e0.busy) { busyOut = true; break; }
        }
        // 探到「最近还有活动」⇒ 这门课其实还在动，下一轮恢复全扫。
        // 不清 resting 的话，它会被自己的结课结论永远锁在 act 档。
        if (warm) {
          rest[ckey] = { streak: 0, since: nowSec, lastAt: nowSec,
                         resting: false, title: c.title, cold: false, act: true };
        } else {
          var nx0 = {};
          for (var pk in st) if (st.hasOwnProperty(pk)) nx0[pk] = st[pk];
          nx0.lastAt = nowSec; nx0.title = c.title; nx0.act = true;
          // cold 只在「真的读到过内容且都旧」时才算证据。活动列表一条都没有
          // ≠ 内容旧 —— 那是「没动静」，和作业页「没读到」是两回事。
          if (!('cold' in nx0)) nx0.cold = true;
          rest[ckey] = nx0;
        }
        actN++;
        CX_SCAN.i = deepDone;
        CX_SCAN.n = deepTotal;
        CX_SCAN.course = c.title;
        CX_SCAN.phase = '已结课，只看了签到';
        options.capture(c, sections);
        options.progress();
        if (k < uniq.length - 1) {
          await cxSleep(CX_GAP + Math.random() * CX_JITTER);
        }
        continue;
      }

      var meta = null;
      // 这一轮三个模块各自「读到了没有、读到几条」。
      // 🔴 只有三个都 ok 才谈得上「这门课是空的」—— 少一个都不算，
      //    因为没读到的那块可能正好装着作业。
      var wOk = false, eOk = false, aOk = false;
      var wN = 0, eN = 0, aN = 0;

      try {
        meta = await cxCourseMeta(c);
      } catch (e) {
        if (e && e.kind === 'auth') throw e;
        // 被风控拦下：第一门课就停，不再挨个去撞同一堵墙。
        if (e && e.busy) { busyOut = true; break; }
        note((e && e.message) || e, 'course', e && e.kind);
      }

      // 三个模块各查各的：一个挂了不能连累另外两个。
      // 🔴 每个失败都要记进 failed —— 否则「没读到」会被当成「没有」。
      var stop = false;
      if (meta) {
        try {
          var wRows = await cxWorkList(c, meta);
          wN = wRows.length; wOk = wRows.complete !== false; capture('作业', wRows);
        } catch (e2) {
          note((e2 && e2.message) || e2, 'work', e2 && e2.kind);
          if (e2 && e2.kind === 'auth') throw e2;
          if (e2 && e2.busy) { busyOut = true; stop = true; }
        }
        if (!stop) {
          try {
            var eRows = await cxExamList(c, meta);
            eN = eRows.length; eOk = eRows.complete !== false; capture('考试', eRows);
          } catch (e3) {
            note((e3 && e3.message) || e3, 'exam', e3 && e3.kind);
            if (e3 && e3.kind === 'auth') throw e3;
            if (e3 && e3.busy) { busyOut = true; stop = true; }
          }
        }
      } else {
        // 课程页没打开 ⇒ 作业和考试也查不了（两个都要课程页里的 stuenc）。
        // 🔴 必须**分别**记下来。只写一句「进不了课程页」的话，界面上
        //    「作业」和「考试」两项就静默消失了，用户会以为这门课没有。
        //    code=nocourse 是给界面看的：这两条和 course 那条是**同一件事**，
        //    界面上要并成一句，不能数成「17 门 + 34 门」。
        //    和 chaoxing.py 的 scan() 逐字对齐。
        note('课程页没打开，没查', 'work', 'nocourse');
        note('课程页没打开，没查', 'exam', 'nocourse');
      }

      // 活动列表不需要 stuenc，课程页挂了也能查
      if (!stop) {
        try {
          var aRows = await cxActiveList(c);
          aN = aRows.length; aOk = aRows.complete !== false; capture('活动', aRows);
        } catch (e4) {
          note((e4 && e4.message) || e4, 'active', e4 && e4.kind);
          if (e4 && e4.kind === 'auth') throw e4;
          if (e4 && e4.busy) { busyOut = true; stop = true; }
        }
      }

      // 被拦了就到此为止。剩下的课**一个请求都不发** —— 越问封得越久，
      // 而且它们本来就不该出现在「没查到」的名单里。
      if (busyOut) break;

      deepN++;
      deepDone++;
      CX_SCAN.i = deepDone;
      CX_SCAN.n = deepTotal;
      CX_SCAN.course = c.title;
      CX_SCAN.phase = PHASE;

      // ---- 结课判定 ----
      // 🔴 只有「课程页打开 + 作业/考试/活动三个列表全部成功返回」才算一次
      //    有效的观察。失败、noentry、课程页没打开**都不算空** —— 那是「没读到」。
      //    和 chaoxing.py 的 scan() 逐条对齐。
      if (meta && wOk && eOk && aOk) {
        // newest = 这门课最新一条内容的时间。0.39.0 起它是「冷课」的证据：
        //   历史学期的课**不是空的**（上学期的作业还挂着），只按「全空」
        //   永远判不出结课，于是每次刷新都全量扫。改成看「最新一条有多旧」。
        //   只认 endAt / startAt，两者都没有就是 null（= 不知道多旧，不判冷）。
        var newest = null;
        for (var mi = 0; mi < mine.length; mi++) {
          var mt = mine[mi].endAt || mine[mi].startAt;
          if (mt && (newest === null || mt > newest)) newest = mt;
        }
        var nxt = cxRestNext(st, true, wN + eN + aN === 0, nowSec, newest);
        nxt.title = c.title;
        // 0.44.0：单独记一份「够冷」的证据，给「没有教务课表」那条路用。
        // 不放进 cxRestNext 里，是因为那个函数要和 chaoxing.py 逐条对拍，
        // 动它的返回值就得同时动 Python 那份；这个字段只是扫描器的备注。
        var nv2 = (typeof newest === 'number') ? newest : NaN;
        nxt.cold = isFinite(nv2) && (nowSec - nv2) >= CX_COLD_NO_WHITE;
        rest[ckey] = nxt;
      }
      // 没读到 ⇒ streak / since 原地不动：既不加（那是拿失败当空），
      // 也不清零（那会让好不容易攒的次数白费）。rest 里已经继承了原值。

      options.capture(c, sections);
      options.progress();
      if (k < uniq.length - 1) {
        await cxSleep(CX_GAP + Math.random() * CX_JITTER);
      }
    }

    // 🔴 0.44.0：撞上风控就整轮作废，**不返回半份结果**。
    //    以前的做法是继续往下扫，每门课各记一条「查得太频繁」—— 于是
    //    「查到第 4 门被拦」在界面上变成「31 门课没查到」，用户以为
    //    31 门都查过了、都坏了，实际上剩下 27 门一个请求都没发。
    //    抛出去之后上层不落盘，界面上留着上次那份完整数据 + 一句
    //    「这次没查成：学习通查得太频繁了，过几分钟再试」—— 这是事实。
    if (busyOut) {
      throw cxErr('学习通查得太频繁了，等 15 分钟再点就好（这段时间里再点只会更久）',
                  'busy');
    }

    // ---- 归类 ----
    // 签到单独留一份**完整**的（含已结束）：用户问的是「我漏了哪几次」，
    // 那只有看历史才知道。只留 live 的话，「查看签到」等于什么都没查。
    // 🔴 仍然只读：这里只是把读到的排出来，不代签、不点任何按钮。
    var signs = [];
    for (var s1 = 0; s1 < items.length; s1++) {
      if (items[s1].kind === 'sign') signs.push(items[s1]);
    }
    // 新的排前面。没有 startAt 的垫底，别当 0 —— 那会变成「最老」。
    signs.sort(function (a, b) { return (b.startAt || 0) - (a.startAt || 0); });

    // 作业里状态认不出来的（比如「已互评」）不往任何一类里凑，单独说清楚。
    var odd = [];
    var open = [];
    var doneN = 0, endedN = 0, staleN = 0;
    for (var t1 = 0; t1 < items.length; t1++) {
      var it = items[t1];
      if (it.kind === 'work' && it.state === 'other') { odd.push(it); continue; }
      if (it.state === 'done') { doneN++; continue; }
      if (it.state === 'ended' || it.state === 'closed') { endedN++; continue; }
      // 🔴 签到不进待办列表 —— 它在顶部那张签到卡里，单独一个位置。
      //    签到的时效是「几分钟」，和「还剩 3 天的作业」排一起会被挤到下面；
      //    而且同一条会同时出现在卡里和列表里，像重复了。
      if (it.kind === 'sign') continue;
      // 🔴 0.47.0：**早就结束的**不再列出来。用户 2026-11-06：
      //    「已经结束一段时间了的就别显示了，除非是需要互评的作业」。
      //    这类和「已交 / 已结束」不同：那些是**做完了**，这些是
      //    **没做也没戏了**，一直挂着只会把真正要交的挤下去。
      if (cxIsStale(it, nowSec)) { staleN++; continue; }
      if (cxIsOpen(it)) open.push(it);
    }

    // 有倒计时的排前面（越少越急），没倒计时的垫底。
    // 🔴 垫底 ≠ 已过期：实测真有「未交但没写截止时间」的作业。
    // 🔴 三段排序，不是两段：
    //      rank 0 还能赶上的（按剩余分钟升序）
    //      rank 1 没有截止时间的（按标题）
    //      rank 2 已经过期的（按标题，**绝不能排最前面**）
    //    以前只有「有/没有」两段：过期那条 endAt 在过去、算出来是负数，
    //    负数最小 ⇒ 一年前的通知排首屏第一行，真要交的作业掉到第三屏。
    //    改这里必须同步 chaoxing.py 的 open_items.sort。
    var nowSort = Math.floor(Date.now() / 1000);
    function cxSortRank(x) {
      if (x.leftMin == null) return 1;
      if (x.endAt && x.endAt < nowSort) return 2;
      return 0;
    }
    open.sort(function (a, b2) {
      var ra = cxSortRank(a), rb = cxSortRank(b2);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return (a.leftMin || 0) - (b2.leftMin || 0);
      var ta = String(a.title || ''), tb = String(b2.title || '');
      return ta < tb ? -1 : (ta > tb ? 1 : 0);
    });

    var counts = { work: 0, exam: 0, sign: 0, topic: 0, notice: 0, other: 0 };
    for (var t2 = 0; t2 < open.length; t2++) {
      var kk = open[t2].kind || 'other';
      counts[kk] = (counts[kk] || 0) + 1;
    }

    return {
      ok: true,
      at: Math.floor(Date.now() / 1000),
      // 🔴 0.47.2：给的是**分母那个数**（有课表时 = 这学期的门数），
      //    不是学习通里一共有多少教学班。界面靠它说「本学期 N 门」。
      courses: deepTotal,
      scanned: deepN + actN,
      total: items.length,
      todo: open.length,
      counts: counts,
      // 0.47.0：全扫了几门 / 只看了签到几门。
      // 0.47.2：`scope` 说明分母是「这学期」还是「全部」。
      scope: scope,
      deep: deepN,
      act: actN,
      skipped: { done: doneN, ended: endedN, odd: odd.length,
                 stale: staleN },
      failed: failed,
      items: open,
      // 每门课的结课判定状态。下一轮扫描要原样传回来（`prevRest`），
      // 断了就每次都从零数，永远判不出结课。
      rest: rest,
      // 这次因为「已结课」而没扫的课。空数组 ≠ 没有结课 ——
      // 也可能是这一轮全都到点了、全扫了。
      paused: paused,
      // 全部签到（含已结束），给「签到」卡用。老前端没有这个字段也能跑。
      signs: signs,
      // 老字段，前端 0.12 及以前在用，留着别删
      other: odd.length,
      otherItems: odd
    };
  }

  function cxScanState() {
    return {
      state: CX_SCAN.state, at: CX_SCAN.at, i: CX_SCAN.i,
      n: CX_SCAN.n, course: CX_SCAN.course, phase: CX_SCAN.phase,
      err: CX_SCAN.err, kind: CX_SCAN.kind
    };
  }

function cxMinLeft(it) {
  if (!it) return null;
  if (it.endAt) return Math.round((it.endAt - Date.now() / 1000) / 60);
  if (it.leftMin != null) return it.leftMin;
  // 🔴 0.46.0：只有开始时间的签到，窗口用 CX_SIGN_LIVE_SEC 推出来。
  //    以前这里到 `leftMin == null` 就返回 null，于是「能签、但算不出还剩多久」
  //    的那类签到，行上什么都不写，落到「已结束」那一支去 —— 和卡头的
  //    「N 个正在进行」直接打架。判据必须和 cxSignOpen 用同一个窗口。
  if (it.kind === 'sign' && it.startAt) {
    return Math.round((it.startAt + CX_SIGN_LIVE_SEC - Date.now() / 1000) / 60);
  }
  return null;
}

function cxLeftLabel(min) {
  if (min == null) return '';
  if (min < 1) return '不到 1 分钟';
  if (min < 60) return min + ' 分钟';
  const h = Math.floor(min / 60); const m = min % 60;
  if (h < 24) return m ? h + ' 小时 ' + m + ' 分钟' : h + ' 小时';
  const d = Math.floor(h / 24); const hh = h % 24;
  return hh ? d + ' 天 ' + hh + ' 小时' : d + ' 天';
}
function cxSortRank(it) {
  const m = cxMinLeft(it);
  if (m == null) return 1;
  if (it.endAt && it.endAt < Date.now() / 1000) return 2;
  return 0;
}

function cxSortItems(items) {
  return items.slice().sort((a, b) => {
    const ra = cxSortRank(a); const rb = cxSortRank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) {
      const x = cxMinLeft(a); const y = cxMinLeft(b);
      return (x || 0) - (y || 0);
    }
    return String(a.course || a.title || '')
      .localeCompare(String(b.course || b.title || ''));
  });
}

/** 按课程分堆。堆的顺序看「这堆里最急的那条」——
 *  一门课有明天到期的，就该排在只有下周到期的课前面。 */
function cxGroupByCourse(items) {
  const map = new Map();
  items.forEach((it) => {
    const k = cxRestKey(it.courseId, it.classId);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  });
  const out = [];
  map.forEach((list, course) => {
    let min = null;
    list.forEach((it) => {
      const mm = cxMinLeft(it);
      if (mm != null && (min == null || mm < min)) min = mm;
    });
    out.push({ course: list[0].course || '未命名课程', items: cxSortItems(list), min: min });
  });
  out.sort((a, b) => {
    if (a.min == null && b.min == null) return a.course.localeCompare(b.course);
    if (a.min == null) return 1;
    if (b.min == null) return -1;
    return a.min - b.min;
  });
  return out;
}

function cxItemKey(it) {
  return cxRestKey(it.courseId, it.classId) + '|' + it.kind + '|' + (it.id || it.title);
}

/** 一份扫描结果里所有条目的 key。签到也算 —— 「漏了一次签到」正是要看的东西。 */
function cxKeysOf(d) {
  const set = new Set();
  if (!d) return set;
  for (const field of ['items', 'signs', 'otherItems']) {
    const rows = Array.isArray(d[field]) ? d[field] : [];
    for (const it of rows) set.add(cxItemKey(it));
  }
  return set;
}

function cxDiffNew(prev, now) {
  const out = new Set();
  if (!prev || !now) return out;
  if (!Array.isArray(prev.failed)) return out;
  if (!Array.isArray(prev.items)) return out;

  const blind = new Set();
  for (const src of [prev, now]) {
    for (const f of (Array.isArray(src.failed) ? src.failed : [])) {
      if (f) blind.add(cxRestKey(f.courseId, f.classId));
    }
  }
  const oldKeys = cxKeysOf(prev);
  for (const field of ['items', 'signs', 'otherItems']) {
    const rows = Array.isArray(now[field]) ? now[field] : [];
    for (const it of rows) {
      if (blind.has(cxRestKey(it.courseId, it.classId))) continue;
      const k = cxItemKey(it);
      if (!oldKeys.has(k)) out.add(k);
    }
  }
  return out;
}

  const CX_CLOSED = /已截止|已过期|已结束|已关闭/;
  function taskState(item, now) {
    if (item.signed === true || (item.state === 'done' && !CX_CLOSED.test(item.status))) return 'done';
    if (item.kind === 'notice') return 'notice';
    if (item.state === 'closed' || item.state === 'ended' || CX_CLOSED.test(item.status)
        || (item.endAt > 0 && item.endAt <= now)) return 'closed';
    if (item.kind === 'sign') {
      if (item.state !== 'live') return 'unknown';
      return item.startAt && !item.endAt && now - item.startAt >= CX_SIGN_LIVE_SEC ? 'closed' : 'todo';
    }
    if (['todo', 'live', 'pending'].includes(item.state)
        && (item.kind !== 'other' || item.state === 'live')) return 'todo';
    return 'unknown';
  }

  function cxVisibleTodo(item, now) {
    return cxIsOpen(item) && !cxIsStale(item, now) && taskState(item, now) === 'todo';
  }

  function taskKey(item) {
    return item.id ? item.kind + ':' + item.id : '';
  }

  function mergeCourseResults(previous, attempts, at) {
    const oldSections = previous ? previous.sections : [];
    const sections = oldSections.map(section => ({ ...section }));
    const byTitle = new Map(sections.map((section, i) => [section.title, i]));
    for (const result of attempts) {
      const index = byTitle.get(result.title);
      const saved = sections[index];
      let section;
      if (result.error || result.complete === false) {
        section = { title: result.title, error: result.error || '列表尚未读全', complete: false,
          ...(saved?.items ? { items: saved.items, at: saved.at || previous.at, cached: true }
            : result.items ? { items: result.items, at } : {}) };
      } else {
        const stamp = item => ({ ...item, courseId: result.courseId, classId: result.classId });
        const oldItems = saved && !saved.error && saved.complete !== false ? saved.items : null;
        const known = oldItems ? oldItems.filter(taskKey).map(stamp) : [];
        const incoming = result.items.filter(taskKey).map(stamp);
        const fresh = cxDiffNew(oldItems ? { items: known, failed: [] } : null, { items: incoming, failed: [] });
        const previousNew = new Map((saved?.items || []).map(item => [taskKey(item), item.newAt]));
        const items = result.items.map(item => {
          const key = taskKey(item);
          const newAt = key && fresh.has(cxItemKey(stamp(item))) ? at : previousNew.get(key);
          return newAt ? { ...item, newAt } : item;
        });
        section = { title: result.title, items, at, complete: true };
      }
      if (index == null) sections.push(section);
      else sections[index] = section;
    }
    return {
      sections,
      cache: { at, sections }
    };
  }


  let running = false;
  const scope = () => window.Android?.cxSessionKey() || '';
  let lastManualScan = 0;
  function cxRestore() { return scope(); } // Android Application restores its Keystore session.
  function cxPersist(key) { return window.Android.cxPersist(key); }

  async function cxScanStart(key, { course, names, semester, force, lastAt, ...options }) {
    if (running || !key || key !== scope()) return;
    const until = cxBusyUntil();
    if (until > Date.now() / 1000) throw cxErr('学习通查询受限，请稍后再试', 'busy');
    if (force && !course) {
      const waited = Date.now() - Math.max(lastAt || 0, lastManualScan);
      if (waited < 90000) throw cxErr('刚检查过，请在 ' + Math.ceil((90000 - waited) / 1000) + ' 秒后刷新。', 'cooldown');
      lastManualScan = Date.now();
    }
    running = true;
    requestScope = key;
    Object.assign(CX_SCAN, { state: 'scanning', i: 0, n: 0, course: '', phase: '', err: '', kind: '' });
    try {
      const result = await cxScanAll(options.rest, force, course ? [course] : null, names, semester, {
        ...options, progress: () => options.progress(cxScanState()), current: () => scope() === key
      });
      if (scope() !== key) throw cxErr('学习通会话已变更', 'cancel');
      result.persistError = cxPersist(key);
      cxBusyClear();
      Object.assign(CX_SCAN, { state: 'done', at: result.at });
      return result;
    } catch (error) {
      if (error.busy || error.kind === 'busy') cxBusyMark();
      Object.assign(CX_SCAN, { state: 'error', err: error.message, kind: error.kind || 'net' });
      throw error;
    } finally {
      running = false;
      requestScope = '';
    }
  }

  function cxAutoScan({ linked, visible, lastAt, failedAt }) {
    const now = Date.now();
    return linked && visible && !running && now / 1000 >= cxBusyUntil()
      && (!lastAt || now - lastAt >= 30 * 60000) && (!failedAt || now - failedAt >= 30 * 60000);
  }

  function form(fields) {
    return Object.keys(fields).map(key => encodeURIComponent(key) + '=' + encodeURIComponent(fields[key])).join('&');
  }

  async function cxRelink(user, password, remember) {
    if (running) return;
    if (cxBusyUntil() > Date.now() / 1000) throw cxErr('学习通请求受限，请稍后再连接', 'busy');
    const Android = window.Android;
    const saved = !password;
    if (saved && !Android.cxHasSavedLogin()) throw cxErr('请先输入学习通账号和密码', 'auth');
    if (!saved && !user) throw cxErr('请输入学习通账号和密码', 'auth');
    const ticket = Android.cxBeginLogin();
    if (!ticket) throw cxErr('已有学习通登录正在进行', 'busy');
    running = true;
    requestScope = ticket;
    try {
      await cxLogin(user, password);
      const courses = await cxCourses();
      const failure = Android.cxFinishLogin(ticket);
      if (failure) throw cxErr(failure, 'data');
      const saveError = !saved
        ? Android.cxSaveCredentials(remember ? JSON.stringify({ u: user, p: password }) : '') : '';
      return { courses, saveError };
    } catch (error) {
      if (error.busy) cxBusyMark();
      if (saved && error.kind === 'auth' && !error.message.includes('验证码')) Android.cxSaveCredentials('');
      throw error;
    } finally {
      Android.cxCancelLogin(ticket);
      running = false;
      requestScope = '';
    }
  }

  window.Learning = { scan: cxScanStart, autoScan: cxAutoScan, restore: cxRestore, relink: cxRelink,
    mergeCourseResults, taskState, visibleTodo: cxVisibleTodo, officialUrl: cxAbsUrl,
    sortItems: cxSortItems, groupByCourse: cxGroupByCourse,
    minLeft: cxMinLeft, leftLabel: cxLeftLabel };
})();
