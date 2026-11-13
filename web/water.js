/* HuiLife798 from HangYuanTong 0.52.0 (Hobson2233 and contributors, MIT). */
(function () {
  'use strict';

  function pfHttp(method, url, body, headers) {
    return window.nativeRequest(method, url, body, '', headers);
  }

  var WATER = {
    BASE: 'https://i.ilife798.com/api/v1',
    // 官方客户端的 UA。第三方项目用 "WaterWidget/5.5.0" 也能通，说明服务端
    // 不是硬校验；取官方那个是为了兼容（万一哪天按 UA 分流）。
    // 🔴 2026-11-08：**必须留在 3.1.9**。11-06 顶到 3.1.10（当时以为平台在挡
    //    旧客户端），结果真登录直接「验签失败」—— 服务端按这个版本号选一套盐
    //    来验签，3.1.10 那套盐在加固包里、明文搜不到。3.1.9 配 3.1.9 的盐
    //    实测 code:0。别再跟着官方发版往上顶。
    OFFICIAL_VER: '3.1.9',
    UA: 'Android_ilife798_3.1.9',
    T_ACCOUNT: '1,5',
    T_DEVICE: '1,1',
    // 服务端 API 版本号（**和客户端版本无关**，原版按用途写死不同的值）。
    // 漏了不会报错，只会拿到「另一个版本」的响应 —— 那种错最难查。
    V_ACCOUNT: '2.0.83',
    V_SCORE: '2.0.178',
    V_DEVICE: '3.1.9',
    // 积分签名的两个盐（2026-10-30 从官方 Release APK 的 dex 里读出来的，
    // 见 water.py 开头那段）。它们不是服务端密钥，是**客户端常量**。
    SALT_APP: /* P7F:SALT_APP */ "",
    SALT_MINI: /* P7F:SALT_MINI */ "",
    // ⚠️ 这个 cid 是**广告渠道**编号，不是登录参数 —— 登录 body 里塞它会回
    //    「请升级最新版应用」。2026-11-08 起登录不再发它，留着给别的接口备用。
    CID: /* P7F:CID */ "",
    // 平台说「签名不对」时给用户看的那句话。**和 water.py 的 SIGN_MSG
    // 一字不差**（check_water_api 逐字对拍），四份实现共用这一句。
    SIGN_MSG: '慧生活没认这次的操作，隔一分钟再试一次',
    // 登录被拒时的那句话 —— **不能沿用 SIGN_MSG**（和 water.py 的
    // LOGIN_SIGN_MSG 一字不差）。登录签名里**没有时间桶**，「手机时间不准」
    // 对登录无从谈起；11-06 就是拿那句话解释「验签失败」，白查两天版本号。
    LOGIN_SIGN_MSG: '慧生活没认这次的登录，先用官方「慧生活798」App 登录一次',
    // 🔴 下面这些是**查出来的字段名，不是猜的**（2026-10-30 对着原项目
    //    life-798 5.5.0 源码核对过；细则见 mobile/water.py 那一大段注释）。
    //    data.missions[i] = {refId, name, score, limit}
    //      · 响应里叫 refId，请求 body 里才叫 adId —— 两个名字一个东西
    //      · data.accScoreRsp.limits[j].limit 是**已做次数**（-1=不限次），
    //        和 missions[i].limit（总次数）同名反义，剩余要自己减
    //    data.dailyRSP = {adId, score, config:[{rule,score,msg}]}
    //      · rule 是连签奖励的位掩码；已签掩码在 accScoreRsp.daily.week
    //    ⇒ 和 water.py 的 missions() **必须逐条对应**（红线：两份实现要对拍）。
    MISSION_SKIP: ['免费权益', '借贷', '贷款'],
    // 加分类型码要特殊处理的 adId。原版写死 `"1705776998".equals(adId) ? 2 : 4`。
    // ⚠️ 这**不是**签到任务（原项目单测里它 name 是 "video"）。
    SIGN_AD_ID: '1705776998',
    // 🔴 服务端与本机的时差（毫秒），只对**设备路**的签名有意义。
    //    签名里有个 30 秒的时间桶，本机时间偏出十几秒就可能差一格 ⇒ 验签失败。
    //    官方客户端拿响应头里的 Date 校准（life-798 的 appServerTimeOffsetMillis）。
    //    🔴 2026-11-08：`date` 的单位是**毫秒**（原生 getDate()），按秒再乘
    //       1000 会算出 1.7e15 ⇒ 设备路每次提交都「验签失败」（真踩过）。
    //    积分路（1,5）官方本来就用本机时间，别一起改。
    srvOffsetMs: 0
  };

  function wErr(msg, kind, code) {
    var e = new Error(msg);
    e.kind = kind || 'net';
    e.code = (code == null ? null : code);
    return e;
  }

  /** 图形验证码的会话串。原项目用 10 位随机字母数字，照做。 */
  function wKey() {
    var cs = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var s = '';
    for (var i = 0; i < 10; i++) s += cs.charAt(Math.floor(Math.random() * cs.length));
    return s;
  }

  /** 纯 JS 的 MD5（按 **UTF-8 字节**算，和 Python 的 hashlib.md5(s.encode('utf-8')) 一致）。
   *
   *  🔴 APK 里没有 Python，签名只能在这儿算；而水.py 那边是 hashlib。
   *     两份实现算出来**必须逐字节相同**，否则同一次任务在网页版和 APK 里
   *     一个能跑一个报「签名不对」，而那种错看着像服务端的问题。
   *     `check_water_api.py` 拿同一批输入对拍两边（红线 54）。
   *
   *  ⚠️ 不要图省事用 charCodeAt 直接算：只要有一个非 ASCII 字符（服务端
   *     将来把 adId 换成中文、或者 token 里带 emoji），两边就会分叉。
   */
  function wMd5(str) {
    function toBytes(s) {
      var out = [], i, c;
      for (i = 0; i < s.length; i++) {
        c = s.charCodeAt(i);
        if (c < 0x80) {
          out.push(c);
        } else if (c < 0x800) {
          out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
        } else if (c < 0xD800 || c >= 0xE000) {
          out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        } else {
          i++;
          var c2 = s.charCodeAt(i) || 0;
          var cp = 0x10000 + (((c & 0x3FF) << 10) | (c2 & 0x3FF));
          out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63),
                   0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        }
      }
      return out;
    }
    var K = [], i;
    for (i = 0; i < 64; i++) {
      K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    }
    var S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

    var bytes = toBytes(String(str == null ? '' : str));
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    var lo = bitLen >>> 0, hi = Math.floor(bitLen / 4294967296) >>> 0;
    bytes.push(lo & 255, (lo >>> 8) & 255, (lo >>> 16) & 255, (lo >>> 24) & 255);
    bytes.push(hi & 255, (hi >>> 8) & 255, (hi >>> 16) & 255, (hi >>> 24) & 255);

    var a0 = 0x67452301, b0 = 0xEFCDAB89, c0 = 0x98BADCFE, d0 = 0x10325476;
    for (var off = 0; off < bytes.length; off += 64) {
      var M = [];
      for (i = 0; i < 16; i++) {
        M[i] = (bytes[off + i * 4] | (bytes[off + i * 4 + 1] << 8)
                | (bytes[off + i * 4 + 2] << 16) | (bytes[off + i * 4 + 3] << 24)) | 0;
      }
      var A = a0, B = b0, C = c0, D = d0;
      for (i = 0; i < 64; i++) {
        var F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        F = (F + A + K[i] + M[g]) | 0;
        var sh = S[(i >> 4) * 4 + (i % 4)];
        A = D; D = C; C = B;
        B = (B + (((F << sh) | (F >>> (32 - sh))) | 0)) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0;
      c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    function hex(n) {
      var s = '';
      for (var j = 0; j < 4; j++) {
        s += ('0' + (((n >>> (j * 8)) & 255).toString(16))).slice(-2);
      }
      return s;
    }
    return hex(a0) + hex(b0) + hex(c0) + hex(d0);
  }

  async function wReq(method, path, token, body, appType, version) {
    var at = appType || WATER.T_DEVICE;
    var headers = {
      'User-Agent': WATER.UA,
      'Accept': 'application/json, text/plain, */*',
      // 官方的 OkHttp 拦截器给**每个**请求都写这两行（GET 也写）。
      // 平台开始按「像不像官方客户端」挑毛病之后，缺项就不再无关紧要。
      'Accept-Language': 'zh-Hans-CN;q=1',
      'Content-Type': 'application/json',
      'ApplicationType': at,
      // 原版每个请求都带 VersionCode，服务端按它决定返回哪套结构。
      'VersionCode': version || (at === WATER.T_DEVICE
        ? WATER.V_DEVICE : WATER.V_ACCOUNT)
    };
    if (token) headers['Authorization'] = token;

    var r;
    try {
      r = await pfHttp(method, WATER.BASE + path,
                       body == null ? '' : JSON.stringify(body), headers);
    } catch (e) {
      throw wErr('连不上饮水服务：' + ((e && e.message) || e), 'net');
    }
    // 🔴 202 = 限流。和 502 一样，不单独判的话会被当成「服务器挂了」，
    //    而用户该做的事完全不同（等几分钟 vs 换个网）。
    if (r && r.status === 202) throw wErr('请求太频繁，等几分钟再试', 'limit');
    if (!r || r.status !== 200) {
      throw wErr('饮水服务没响应', 'net');
    }
    var js;
    try { js = JSON.parse(r.body); } catch (e) {
      throw wErr('饮水服务可能在维护，过一会儿再试', 'data');
    }
    if (!js || !/^-?\d+$/.test(String(js.code))) throw wErr('饮水服务未返回有效业务码', 'data');
    // 设备路顺手校准时差（签名要用，见 WATER.srvOffsetMs）。积分路不碰。
    //
    // 🔴 `date` 的单位要看清楚（2026-11-08 查出来的）：原生层给的是
    //    `HttpURLConnection.getDate()`，它返回的**已经是毫秒**，不是秒。
    //    这里原来写死 `r.date * 1000`，于是时差被算成 ~1.7e15 毫秒，
    //    时间桶跟着飞掉 ⇒ 设备路每个签名都「验签失败」。
    //    老壳（没有 req2 那批）万一给的是秒，就按量级判断补一次 —— 1e11 毫秒
    //    是 1973 年，秒级的数永远小于它，两种都能认。
    if (at === WATER.T_DEVICE && r && r.date > 0) {
      var dms = Number(r.date) || 0;
      if (dms > 0 && dms < 1e11) dms *= 1000;
      var off = dms - Date.now();
      // 离谱的值宁可不校准：宁可用本机时间，也别拿一个荒唐的偏移去签名。
      if (dms > 0 && Math.abs(off) < 30 * 86400000) WATER.srvOffsetMs = off;
    }
    return js;
  }

  /** 统一判 code。0 成功；-99 登录过期；其余按服务端 msg 说。 */
  function wCheck(js, what) {
    var code = Number(js && js.code);
    if (code === 0) return (js && js.data);
    if (code === -99) throw wErr('登录状态过期了，要重新登录一次', 'auth', code);
    var msg = String((js && js.msg) || '');
    // 签名被拒要单独标出来：任务/签到的签名里有个 30 秒的时间桶，**本机时间
    // 偏太多**就会被判「验签失败」—— 这是用户自己能动的那一种（另外一种是
    // 平台改常量，那得我们改）。以前这里只说「可能需要更新 App」，等于没说。
    // 🔴 平台原话是「**验签**失败」，不含「签名」二字 —— 只认「签名|sign」
    //    时它掉进最后那条兜底，平台原话就原样蹦到屏幕上。
    if (/签名|验签|sign/i.test(msg)) {
      // 登录这条路没有时间桶，「先看看手机时间」在这儿是错的提示，单给一句。
      throw wErr(what === '登录' ? WATER.LOGIN_SIGN_MSG : WATER.SIGN_MSG, 'sign', code);
    }
    if (/频繁|限流/.test(msg)) throw wErr(msg, 'limit', code);
    // 平台原话「请升级最新版应用」—— 照抄显示，用户会以为**我们**这个 App 该更新。
    // 说清是慧生活那边的要求，并给出这段时间唯一的办法。
    if (/升级/.test(msg) && /应用/.test(msg)) {
      throw wErr('慧生活那边现在只认它最新版的 App，我们这边暂时被挡在外面；'
                 + '这段时间接水、积分先用官方「慧生活798」App', 'client', code);
    }
    throw wErr(msg || '操作没成功', 'biz', code);
  }

  /** 整数。认字符串，认不出来返回 null（**不兜底成 0**）。 */
  function wInt(v) {
    if (v == null || typeof v === 'boolean') return null;
    if (typeof v === 'number') return isFinite(v) ? Math.trunc(v) : null;
    var n = parseFloat(String(v).trim());
    return isFinite(n) ? Math.trunc(n) : null;
  }

  /** 时间戳统一成毫秒。服务端有的给秒（10 位），有的给毫秒（13 位）。 */
  function wMs(v) {
    var n = wInt(v);
    if (n == null || n <= 0) return 0;
    return n < 10000000000 ? n * 1000 : n;
  }

  /** 列表类响应的记录数组。null = 这个键不存在（结构变了）；[] = 确实没有。 */
  function wRecords(js) {
    var d = js && js.data;
    if (Array.isArray(d)) return d;
    if (!d || typeof d !== 'object') return null;
    var ks = ['records', 'items', 'list', 'content'];
    for (var i = 0; i < ks.length; i++) {
      if (Array.isArray(d[ks[i]])) return d[ks[i]];
    }
    return null;
  }

  /** 从 data 里取出「积分那一坨」。套着 accScoreRsp 就剥一层，没套就用 data 本身。
   *
   *  🔴 两种形状都要认，因为两条接口不一样（2026-10-30 查源码确认）：
   *     GET /acc/score/acc-score   → data 本身就是 {validScore, totalScore, limits, daily}
   *     GET /acc/score/mission-lst → data.accScoreRsp 才是那一坨
   *     原版 IlifeApi.taskDataWithToken 干的就是 `missions.data.accScoreRsp = score.data`。
   *
   *  返回 null = 这一坨压根不存在（**不是**「0 分」）。
   *  **和 water.py 的 _score_rsp 逐条对应**。 */
  function wScoreRsp(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    var inner = data.accScoreRsp;
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner;
    if ('validScore' in data || 'totalScore' in data) return data;
    return null;
  }

  /** accScoreRsp.limits → {refId: 已做次数}。**-1 表示不限次**。
   *  **和 water.py 的 _limits 逐条对应**。 */
  function wLimits(rsp) {
    var out = {};
    if (!rsp || typeof rsp !== 'object' || !Array.isArray(rsp.limits)) return out;
    for (var i = 0; i < rsp.limits.length; i++) {
      var it = rsp.limits[i];
      if (!it || typeof it !== 'object') continue;
      var rid = String(it.refId || '').trim();
      var n = wInt(it.limit);
      if (rid && n != null && n >= -1) out[rid] = n;
    }
    return out;
  }

  /** 今天星期几，1=周一 … 7=周日（和原版 Calendar 的换算一致）。
   *  ⚠️ 只能用本机日期 —— 服务端没给。**和 water.py 的 _today_weekday 对应**。 */
  function wTodayWeekday() {
    var d = new Date().getDay();     // 0=周日 … 6=周六
    return d === 0 ? 7 : d;
  }

  /** 每日签到状态。返回 {adId, score, week, weekday, signed, rewards}；没有就 null。
   *  **和 water.py 的 _daily 逐条对应**。
   *  ⚠️ 星期几只能用本机日期（服务端没给）。**不补签、不自动签**（用户 2026-10-30 定）。 */
  function wDaily(data) {
    if (!data || typeof data !== 'object') return null;
    var rsp = data.dailyRSP;
    if (!rsp || typeof rsp !== 'object') return null;
    var adid = String(rsp.adId || '').trim();
    if (!adid) return null;
    var week = 0;
    var sc = data.accScoreRsp;
    if (sc && typeof sc === 'object' && sc.daily && typeof sc.daily === 'object') {
      week = wInt(sc.daily.week) || 0;
    }
    var wd = wTodayWeekday();
    var rewards = [];
    if (Array.isArray(rsp.config)) {
      for (var i = 0; i < rsp.config.length; i++) {
        var r = rsp.config[i];
        if (!r || typeof r !== 'object') continue;
        var mask = wInt(r.rule), sco = wInt(r.score);
        if (mask && mask > 0 && sco) {
          rewards.push({ rule: mask, score: sco, msg: String(r.msg || '').trim() });
        }
      }
    }
    return {
      adId: adid,
      score: wInt(rsp.score),
      week: week,
      weekday: wd,
      signed: !!(week & (1 << (wd - 1))),
      rewards: rewards
    };
  }

  function wNum(v) {
    if (v == null || typeof v === 'boolean') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var n = parseFloat(String(v).trim());
    return isFinite(n) ? n : null;
  }

  function wLoad() {
    if (!(window.Android && typeof Android.loadWater === 'function')) return null;
    var s = '';
    try { s = String(Android.loadWater() || ''); } catch (e) { return null; }
    if (!s) return null;
    var d;
    try { d = JSON.parse(s); } catch (e) { return null; }
    if (!d || typeof d !== 'object') return null;
    // 老状态（只有一个顶层 token）就地迁移成 device 那一格 ——
    // 不迁移的话老用户升级后会被判成「没登录」，而 token 明明还在。
    if (d.token && (!d.device || typeof d.device !== 'object')) {
      d.device = { token: String(d.token || ''), uid: String(d.uid || ''),
                   eid: String(d.eid || ''), phone: String(d.phone || ''),
                   at: Number(d.at || 0) };
      delete d.token; delete d.uid; delete d.eid; delete d.phone;
    }
    return d;
  }

  /** 取某一套账号。null = 这个账号没登。**和 bridge.py 的 water_acct 对应**。 */
  function wAcct(st, kind) {
    if (!st || typeof st !== 'object') return null;
    var a = st[kind];
    if (a && typeof a === 'object' && a.token) return a;
    return null;
  }

  /** 设备账号的 token。余额 / 设备 / 接水**只用它**。 */
  function wDev(st) {
    var a = wAcct(st, 'device');
    if (!a) {
      throw wErr('设备账号没登录 —— 接水、余额、设备列表要用「设备登录」那个账号',
                 'auth');
    }
    return a.token;
  }

  /** 积分类接口用哪个账号。优先积分账号（1,5），没登就退设备账号（1,1）——
   *  原版也是这个优先级（`useApp = !account.hasToken()`）。
   *  返回 {token, useApp}。**和 bridge.py 的 water_score_lane 对应**。 */
  function wScoreLane(st) {
    var s = wAcct(st, 'score');
    if (s) return { token: s.token, useApp: false };
    var d = wAcct(st, 'device');
    if (d) return { token: d.token, useApp: true };
    throw wErr('还没登录', 'auth');
  }

  /** 这个操作要哪个账号。返回空串 = 能过，非空 = 该说的话。
   *
   *  🔴 **不能统一按 `state === 'ok'` 判**（0.26.2 修的）：两套账号并存以后，
   *     只登了积分账号时 `state()` 是 `'partial'` —— 按 ok 判会把「明明能做」
   *     的积分/任务/签到全挡住，还报「还没登录」，用户刚登过。
   *     所以要按**这个操作实际需要哪个账号**分别判。
   *  `kind='device'`：接水 / 余额 / 设备列表，只认设备账号（1,1 那一路）；
   *  `kind='any'`：积分 / 任务 / 签到，有一个就行（water_score_lane 会兜底）。 */
  function wGate(kind) {
    var st = wLoad();
    var dev = wAcct(st, 'device'), sco = wAcct(st, 'score');
    if (kind === 'device') {
      if (dev) return '';
      return sco
        ? '这个功能要用「设备登录」那个账号（接水、余额、设备列表都归它）'
        : '还没登录';
    }
    return (dev || sco) ? '' : '还没登录';
  }

  /** 算积分/签到的签名。**两条路都签，没有不签的分支。**
   *  md5(adId + 30×(毫秒/30000) + token后8位 + uid后8位 + 盐)
   *  **和 water.py 的 sign_score 逐条对应**（两边算出来必须一模一样）。
   *  ⚠️ 时间桶：设备路用**服务端时间**（本机 + srvOffsetMs），积分路用本机时间。
   *     官方就是这两套，别合在一起。 */
  function wSignScore(adId, token, uid, useApp, nowMs) {
    var now = (nowMs == null
      ? Date.now() + (useApp ? (WATER.srvOffsetMs || 0) : 0)
      : Number(nowMs));
    var bucket = 30 * Math.floor(now / 30000);
    var tok = String(token == null ? '' : token);
    var u = String(uid == null ? '' : uid);
    return wMd5(String(adId == null ? '' : adId) + String(bucket)
                + tok.slice(-8) + u.slice(-8)
                + (useApp ? WATER.SALT_APP : WATER.SALT_MINI));
  }

  /** 登录签名：md5("authCode=" + 验证码 + "&un=" + 手机号 + 盐)。
   *  **和 water.py 的 sign_login 一字不差**（两边算出来必须一样）。
   *  🔴 两条路都要签，盐不一样：设备路 SALT_APP、积分路 SALT_MINI。
   *  以前这里写「积分路官方不带」是错的 —— 1,5 不带 sign，服务端回
   *  「请升级最新版应用」，那句话把人骗去查版本号，其实缺的是签名。 */
  function wSignLogin(phone, sms, salt) {
    return wMd5('authCode=' + String(sms == null ? '' : sms)
                + '&un=' + String(phone == null ? '' : phone)
                + (salt || WATER.SALT_APP));
  }

  /** 账户信息（含账号编号）。**和 water.py 的 view_info 对应**。
   *  参考项目（life-798 的 fetchUidSync）在 uid 为空时就是来这里补的：
   *  `/acc/view-info` 的 `data.id` 才是签名要的那个编号。 */
  async function wViewInfo(token, useApp) {
    var js = await wReq('GET', '/acc/view-info', token, null,
                        useApp ? WATER.T_DEVICE : WATER.T_ACCOUNT,
                        useApp ? WATER.V_DEVICE : WATER.V_ACCOUNT);
    var d = wCheck(js);
    return (d && typeof d === 'object') ? d : {};
  }

  /** 签名要 uid 的后 8 位。登录没带回 uid 时补一次账户信息。
   *  **和 water.py 的 ensure_uid 同义**：返回 {uid, why}，why 空 = 拿到了。 */
  async function wEnsureUid(token, useApp, uid) {
    var u = String(uid == null ? '' : uid).trim();
    if (u) return { uid: u, why: '' };
    var d;
    try {
      d = await wViewInfo(token, useApp);
    } catch (e) {
      return { uid: '', why: (e && e.message) || String(e) };
    }
    var got = String((d && (d.id || d.uid)) || '').trim();
    return got ? { uid: got, why: '' }
               : { uid: '', why: '账户信息里也没有账号编号' };
  }

  /** 存。空串 = 成功，其余是原因（和 CredStore.save 同构）。
   *  🔴 `'none'` 这个原因是有来历的：0.23.0 的 APK 里**压根没有** saveWater
   *     （CredStore 写好了、NativeBridge 漏了转发），用户登录成功却看到
   *     「token 存不进本机（none）」。现在有 check_bridge_methods.py 对账。 */
  function wSave(obj) {
    if (!(window.Android && typeof Android.saveWater === 'function')) return 'none';
    try { return String(Android.saveWater(JSON.stringify(obj)) || ''); }
    catch (e) { return 'fail: ' + ((e && e.message) || e); }
  }

  /** 「没登录」和「存着但解不开」必须分开。
   *  解不开 = 换过手机 / 清过数据 / Keystore 换了密钥 ⇒ 重新登录一次就好；
   *  混成一句「没登录」，用户只会觉得「怎么又要登」。 */
  function wBroken() {
    if (!(window.Android && typeof Android.waterState === 'function')) return false;
    try { return String(Android.waterState() || '') === 'broken'; }
    catch (e) { return false; }
  }

  var WaterApi = {
    /** 这个壳能不能用（老 APK 没有 req2 / saveWater）。 */
    available: function () {
      return !!(window.Android && typeof Android.req2 === 'function'
                && typeof Android.saveWater === 'function');
    },

    captchaKey: wKey,

    /** 图形验证码图片地址。给 <img src> 直接用，不经过我们的代码。 */
    captchaUrl: function (key) {
      return WATER.BASE + '/captcha/?s=' + encodeURIComponent(key) + '&r=' + Date.now();
    },

    /** 发短信。`graph` 是用户**自己看图读出来**的 —— 和门户那道一样，绝不自动识别。 */
    sendSms: async function (phone, key, graph) {
      var js = await wReq('POST', '/acc/login/code', null,
                          { un: phone, authCode: graph, s: key }, WATER.T_DEVICE);
      wCheck(js);
      return true;
    },

    /** 短信验证码换 token。`kind` = 'device'（1,1）或 'score'（1,5）。
     *
     *  🔴 **只覆盖登录的那一格**，另一格原样留着。整套覆盖的话，登完积分账号
     *     会把设备账号踢掉 —— 接水立刻不能用了，而用户以为自己只是「补登了一个」。
     */
    login: async function (phone, sms, kind) {
      var k = (kind === 'score') ? 'score' : 'device';
      var useApp = (k === 'device');
      var body = { authCode: sms, un: phone };
      // 🔴 两条路的 body 都是**裸的**，不许带 cid / openCode（2026-11-08 实测）。
      //    以前积分路往 body 里塞了 openCode + cid，服务端就当「这不是官方客户端」，
      //    回「请升级最新版应用」—— 那句话是挡请求的，不是让人去应用商店升级。
      //    两条路都要带 sign，只是盐不同：设备路 SALT_APP、积分路 SALT_MINI。
      var path = '/acc/login?sign='
        + (useApp ? wSignLogin(phone, sms) : wSignLogin(phone, sms, WATER.SALT_MINI));
      var js = await wReq('POST', path, null, body,
                          useApp ? WATER.T_DEVICE : WATER.T_ACCOUNT,
                          useApp ? WATER.V_DEVICE : WATER.V_ACCOUNT);
      var data = wCheck(js, '登录') || {};
      var al = (data.al && typeof data.al === 'object') ? data.al : data;
      var token = String((al && al.token) || '').trim();
      if (!token) throw wErr('登录成功了，但没拿到登录凭据，请重试', 'data');
      var st = wLoad() || {};
      // Do not display cached devices from a previous device account.
      var old = wAcct(st, k);
      var same = old && old.phone === phone
          && (!old.uid || !(al.uid || al.id) || old.uid === String(al.uid || al.id));
      if (useApp && !same) {
        st.devices = [];
        st.at = 0;
        delete st.live;
      }
      st[k] = {
        token: token, phone: String(phone || ''),
        uid: String((al && (al.uid || al.id)) || ''),
        eid: String((al && al.eid) || ''),
        at: Date.now()
      };
      if (same && old.exchangeRecords) st[k].exchangeRecords = old.exchangeRecords;
      if (!Array.isArray(st.devices)) st.devices = [];
      var why = wSave(st);
      // 🔴 `'soft'` 是**存好了**，只是 Keystore 用不了、退到了备用加密方式
      //    （见 CredStore.savePlain 的第二层）。它和 `'fail: …'` 是两回事。
      //    0.26.3 及以前这里写的是 `if (why)`，把 `'soft'` 也当失败抛了 ——
      //    于是明明存上了，用户每次登录都看到「token 存不进本机（soft）」，
      //    而且因为抛错，调用方走的是失败分支、整页不刷新 ⇒ 出水功能看起来
      //    **完全不能用**。这两句话是同一件事，别当成两个 bug 修。
      //    对照 app.js 的 credSaved()：那边一直是 `s === 'soft' → ok:true`。
      if (why && why !== 'soft') {
        // 'none' = 这个壳里根本没有 saveWater（0.23.0 就是），不是磁盘满了。
        // 两种原因要分开说，否则用户只能反复重登。
        throw wErr(why === 'none'
          ? '这个版本还记不住登录（装 0.24.0 以上就好），'
            + '现在关掉 App 就得重登'
          : '登录成功了，但没记住（' + why + '），关掉 App 就得重登',
          'data');
      }
      return { phone: st[k].phone, uid: st[k].uid, kind: k, soft: why === 'soft' };
    },

    /** 本机状态。**不探网** —— 每次切进这一页都探一次等于白等。
     *  两套账号**分开报**，缺哪个要能看出来缺哪个。 */
    state: function () {
      var st = wLoad();
      var dev = wAcct(st, 'device'), sco = wAcct(st, 'score');
      if (!dev && !sco) {
        // 「存着但解不开」不等于「没登录」—— 前者重登一次就好，后者是第一次用。
        return { ok: true, state: wBroken() ? 'broken' : 'none', accounts: {} };
      }
      function brief(a) {
        if (!a) return null;
        return { phone: String(a.phone || ''), uid: String(a.uid || ''),
                 at: Number(a.at || 0) };
      }
      return { ok: true, state: (dev && sco) ? 'ok' : 'partial',
               accounts: { device: brief(dev), score: brief(sco) },
               phone: (dev && dev.phone) || '',
               devices: (st && st.devices) || [], at: (st && st.at) || 0 };
    },

    /** 退出。给了 kind 只退那一格 —— 退积分账号不该把接水也弄坏。 */
    logout: function (kind) {
      var k = (kind === 'device' || kind === 'score') ? kind : '';
      if (k) {
        var st = wLoad();
        if (st) {
          delete st[k];
          if (k === 'device') {
            delete st.devices;
            delete st.at;
            delete st.live;
          }
          if (!wAcct(st, 'device') && !wAcct(st, 'score')) {
            if (window.Android && typeof Android.clearWater === 'function') {
              try { Android.clearWater(); } catch (e) { /* 清不掉也别崩 */ }
            }
          } else {
            wSave(st);
          }
        }
        return true;
      }
      if (window.Android && typeof Android.clearWater === 'function') {
        try { Android.clearWater(); } catch (e) { /* 清不掉也别崩 */ }
      }
      return true;
    },

    /** 查余额。取不到返回 null —— **不返回 0**（「没读到」≠「钱没了」）。 */
    balance: async function () {
      var st = wLoad();
      var js = await wReq('GET', '/acc/wallet/owner', wDev(st), null, WATER.T_DEVICE);
      var data = wCheck(js) || {};
      var cands = [];
      if (data.aw && typeof data.aw === 'object') cands.push(data.aw);
      if (Array.isArray(data.eps)) {
        data.eps.forEach(function (x) { if (x && typeof x === 'object') cands.push(x); });
      }
      for (var i = 0; i < cands.length; i++) {
        var ks = ['total', 'olCash', 'balance'];
        for (var j = 0; j < ks.length; j++) {
          var v = wNum(cands[i][ks[j]]);
          if (v != null) return v;
        }
      }
      return null;
    },

    /** 列设备。🔴 favos 键不存在 = 响应变了（报错）；存在但是空 = 真没有设备。 */
    devices: async function () {
      var token = wDev(wLoad());
      var js = await wReq('GET', '/ui/app/master', token, null, WATER.T_DEVICE);
      var data = wCheck(js) || {};
      if (!('favos' in data)) throw wErr('设备列表没读出来，平台可能改版了', 'data');
      var favos = data.favos || [];
      var out = [];
      for (var i = 0; i < favos.length; i++) {
        var it = favos[i];
        if (!it || typeof it !== 'object') continue;
        var did = String(it.id || '').trim();
        if (!did) continue;
        out.push({ id: did, name: String(it.name || '').trim() });
      }
      // 顺手记进本机：下次进来先画缓存，不用等网络
      var st = wLoad();
      if (wDev(st) !== token) throw wErr('设备账号已切换', 'auth');
      st.devices = out;
      st.at = Date.now();
      wSave(st);
      return out;
    },

    /** 启动一台设备。**唯一有副作用的调用**，界面那边必须二次确认。
     *
     *  成功返回的是**文案**（不是 true）—— 和 water.py 的 `dev_start`
     *  返回 `(True, msg)` 是同一个意思。文案只有这一个来源：
     *  以前 handle() 那边另抄了一句「已经启动了，接完记得点结束」，
     *  两边各改各的就会分叉，而分叉了**不报错**。 */
    start: async function (did) {
      var st = wLoad();
      if (!wAcct(st, 'device') && !wAcct(st, 'score')) throw wErr('还没登录', 'auth');
      var path = '/dev/start?did=' + encodeURIComponent(String(did || ''))
               + '&upgrade=true&ptype=91&rcp=false';
      var js = await wReq('GET', path, wDev(st), null, WATER.T_DEVICE);
      var code = Number(js && js.code);
      if (code === 0) return '已经启动了，接完记得点结束';
      // 这些 code 是协议里定死的业务含义，逐条翻成人话 ——
      // 统一说「操作失败」等于什么都没说，而每条用户该做的事都不一样。
      var map = {
        '-99': ['登录状态过期了，要重新登录一次', 'auth'],
        '-21': ['这个账号没有设备控制权限，得先在慧生活798 里登录一次设备端', 'biz'],
        '-88': ['还没签约代扣协议，要去慧生活798 里签一下', 'biz'],
        '-87': ['代扣签约过期了，要去慧生活798 里重新签', 'biz'],
        '-52': ['账户欠费了，先充值', 'biz'],
        '-20': ['还没绑定一卡通，要先去慧生活798 里绑', 'biz'],
        '-19': ['设备正在准备，等几秒再点一次', 'biz'],
        '-82': ['需要先支付', 'biz']
      };
      var hit = map[String(code)];
      if (hit) throw wErr(hit[0], hit[1], code);
      throw wErr(String((js && js.msg) || ('启动失败（code=' + code + '）')), 'biz', code);
    },

    /* ==============================================================
       0.24.0 新增：停止接水 / 积分 / 消费记录 / 套餐 / 签到 / 收藏设备
       --------------------------------------------------------------
       这一批照 WaterWidget（nocookies111/life-798，MIT）公开的协议**自己
       重写**，没有复制它的代码。和 water.py 逐条对应（红线 54：两份实现，
       改一边忘另一边不报错 ⇒ check_water_api.py 拿同一批响应对拍）。

       🔴 充值不下单：原版 /bill/save 建单 + /trans/prepay/21 取支付宝 SDK
          串。我们是 WebView 壳没有那个 SDK；而且那是真钱交易，金额错了、
          退款、纠纷都落在用户身上。⇒ 只做 /prd/lst 展示 + 让用户去官方 App。
       🔴 积分任务只列不批量跑：作者自己 README 写着「积分冻结、任务提示成功
          但没到账，原因尚未确认」。
       🔴 签到不带 sign：盐是别人没公开的配置，不挖、不写进公开仓库。
          先不带 sign 试，失败报 kind='sign'，再和用户商量。
       ============================================================== */

    /** 停止接水。**第二个有副作用的调用**（结束计费），要二次确认。
     *  🔴 不自动重试：同一台设备可能不止一个人在用，重试可能停掉别人的水。 */
    end: async function (did) {
      var st = wLoad();
      if (!wAcct(st, 'device') && !wAcct(st, 'score')) throw wErr('还没登录', 'auth');
      var path = '/dev/end?did=' + encodeURIComponent(String(did || ''))
               + '&rcp=false';
      var js = await wReq('GET', path, wDev(st), null, WATER.T_DEVICE);
      var code = Number(js && js.code);
      if (code === 0) return '停止请求已发出，等设备结束和账单结算';
      if (code === -99) throw wErr('登录状态过期了，要重新登录一次', 'auth', code);
      throw wErr(String((js && js.msg) || ('停止失败（code=' + code + '）')), 'biz', code);
    },

    /** 可用积分。{valid, total}，读不到的项是 null（「没读到」≠「0 分」）。 */
    score: async function () {
      var st = wLoad();
      var lane = wScoreLane(st);
      var js = await wReq('GET', '/acc/score/acc-score', lane.token, null,
                          lane.useApp ? WATER.T_DEVICE : WATER.T_ACCOUNT,
                          lane.useApp ? WATER.V_DEVICE : WATER.V_SCORE);
      var data = wCheck(js) || {};
      var rsp = wScoreRsp(data);
      if (!rsp) return { valid: null, total: null };
      var valid = wInt(rsp.validScore);
      var total = wInt(rsp.totalScore);
      if (total == null) total = valid;
      return { valid: valid, total: total };
    },

    /** 钱包列表 —— 积分兑换要的 endpointId 就在这儿。
     *  [{endpointId, name, ownerId, balance}]
     *
     *  🔴 和 water.py 的 wallets() **逐条对应**：`data.aw`（单个）+
     *     `data.eps[]`（多个端点），`ep.id` 是兑换要的端点 id，
     *     `owner.id` 是用户 id，余额取 total → olCash → balance。
     *  ⚠️ 一个钱包都没有 ⇒ 空数组（不是报错）；`data` 整个不是对象才报错 ——
     *     前者是「你确实没有水卡」，后者是「响应变了」。
     */
    wallets: async function () {
      var st = wLoad();
      var lane = wScoreLane(st);
      var js = await wReq('GET', '/acc/wallet/owner', lane.token, null,
                          lane.useApp ? WATER.T_DEVICE : WATER.T_ACCOUNT,
                          lane.useApp ? WATER.V_DEVICE : WATER.V_SCORE);
      // 🔴 不能写 `wCheck(js) || {}`：空数组 / 空字符串都是**假值**，
      //    那样 `data: []` 会被悄悄换成 `{}` ⇒「响应结构变了」被说成
      //    「你一个钱包都没有」。两个相反的结论，只差一个 `||`。
      var data = wCheck(js);
      if (data == null) data = {};
      if (typeof data !== 'object' || Array.isArray(data)) {
        throw wErr('钱包没读出来，平台可能改版了', 'data');
      }
      var cands = [];
      if (data.aw && typeof data.aw === 'object') cands.push(data.aw);
      if (Array.isArray(data.eps)) {
        for (var i = 0; i < data.eps.length; i++) {
          if (data.eps[i] && typeof data.eps[i] === 'object') cands.push(data.eps[i]);
        }
      }
      var out = [], seen = {};
      for (var j = 0; j < cands.length; j++) {
        var w = cands[j];
        var ep = (w.ep && typeof w.ep === 'object') ? w.ep : null;
        if (!ep) continue;
        var eid = String(ep.id == null ? '' : ep.id).trim();
        if (!eid) continue;
        var ow = (w.owner && typeof w.owner === 'object') ? w.owner : {};
        var oid = String(ow.id == null ? '' : ow.id).trim();
        var key = eid + '\u0000' + oid;
        if (seen[key]) continue;
        seen[key] = 1;
        var bal = null;
        var ks = ['total', 'olCash', 'balance'];
        for (var k = 0; k < ks.length; k++) {
          bal = wNum(w[ks[k]]);
          if (bal != null) break;
        }
        out.push({
          endpointId: eid,
          name: String(ep.name == null ? '' : ep.name).trim() || eid,
          ownerId: oid,
          balance: bal
        });
      }
      return out;
    },

    /** 积分兑换余额。返回账单号（`data.sn`）。**有副作用，失败不重试。**
     *
     *  🔴 协议（原版 `ScoreExchangeParser.requestBody`）：
     *         POST /acc/score/score-use
     *         body {"ep":{"id":…},"score":N,"type":1}
     *     只传**总积分**、不传份数 —— 份数由 app.js 的 `wtExTotalOf` 乘出来
     *     （网页版和 APK 跑的是同一份 app.js，这条规则只有那一处）。
     *  ⚠️ 拿到 sn **不等于兑换完成**：要 `exchangeBill()` 查到 status 3 才算。
     *     网络结果不明确时**绝不自动重试**（重试 = 再扣一次积分）。
     */
    scoreExchange: async function (eid, score) {
      var st = wLoad();
      var id = String(eid == null ? '' : eid).trim();
      if (!id) throw wErr('没选兑换到哪个钱包', 'biz');
      var n = wInt(score);
      if (n == null) throw wErr('兑换积分不是数字（' + score + '）', 'data');
      if (n <= 0 || n % 100 !== 0) {
        throw wErr('兑换积分要是 100 的整数倍（现在是 ' + n + '）', 'data');
      }
      var lane = wScoreLane(st);
      var js = await wReq('POST', '/acc/score/score-use', lane.token,
                          { ep: { id: id }, score: n, type: 1 },
                          lane.useApp ? WATER.T_DEVICE : WATER.T_ACCOUNT,
                          lane.useApp ? WATER.V_DEVICE : WATER.V_SCORE);
      var data = wCheck(js) || {};
      if (typeof data !== 'object' || Array.isArray(data)) {
        throw wErr('兑换结果没读出来，平台可能改版了', 'data');
      }
      var sn = String(data.sn == null ? '' : data.sn).trim();
      if (!sn || sn === 'null') {
        throw wErr('没确认成功，也没给账单号（结果未知，别重复兑换）', 'data');
      }
      return sn;
    },

    /** 查兑换账单。{id, status, done}。`status === 3` 才算完成。 */
    exchangeBill: async function (bid) {
      var st = wLoad();
      var id = String(bid == null ? '' : bid).trim();
      if (!id) throw wErr('没给账单号', 'biz');
      var lane = wScoreLane(st);
      var js = await wReq('GET', '/bill/view-full?id=' + encodeURIComponent(id),
                          lane.token, null,
                          lane.useApp ? WATER.T_DEVICE : WATER.T_ACCOUNT,
                          lane.useApp ? WATER.V_DEVICE : WATER.V_SCORE);
      var data = wCheck(js) || {};
      var bill = (data && typeof data === 'object' && !Array.isArray(data)
                  && data.bill && typeof data.bill === 'object') ? data.bill : null;
      if (!bill) throw wErr('兑换账单还没出（过一会儿再看，别重复兑换）', 'data');
      var got = String(bill.id == null ? '' : bill.id).trim();
      if (got && got !== id) {
        throw wErr('查到的是另一张账单（' + got + ' ≠ ' + id + '）', 'data');
      }
      var stt = wInt(bill.status);
      return { id: id, status: (stt == null ? -1 : stt), done: stt === 3 };
    },

    /** 消费记录一页。{items:[{id,at,money,did,kind,msg}], more, total}
     *  🔴 money 取不到是 null，不兜底成 0（显示 ¥0.00 会让人以为这单免费）。 */
    bills: async function (page, size) {
      var st = wLoad();
      if (!wAcct(st, 'device') && !wAcct(st, 'score')) throw wErr('还没登录', 'auth');
      var pg = (page == null ? 0 : page), sz = (size == null ? 20 : size);
      var path = '/bill/lst-owner?page=' + pg + '&size=' + sz;
      var js = await wReq('GET', path, wDev(st), null, WATER.T_DEVICE);
      wCheck(js);
      var recs = wRecords(js);
      if (recs == null) throw wErr('消费记录没读出来，平台可能改版了', 'data');
      var out = [];
      for (var i = 0; i < recs.length; i++) {
        var it = recs[i];
        if (!it || typeof it !== 'object') continue;
        var dd = (it.data && typeof it.data === 'object') ? it.data : {};
        var dv = (it.dev && typeof it.dev === 'object') ? it.dev : {};
        var did = dv.id || it.did || dd.did || dd.deviceId || '';
        out.push({
          id: String(it.id || '').trim(),
          at: wMs(it.utime || it.ctime),
          money: wNum(it.payment),
          did: String(did).trim(),
          kind: wInt(it.type),
          msg: String(it.msg || '').trim()
        });
      }
      var total = null;
      if (js.data && typeof js.data === 'object' && !Array.isArray(js.data)) {
        total = wInt(js.data.total != null ? js.data.total : js.data.totalCount);
      }
      var more = (total != null) ? ((pg + 1) * sz < total) : (out.length >= sz);
      return { items: out, more: more, total: total };
    },

    /** 积分任务列表 + 签到状态。
     *  {items:[{refId,name,score,limit,used,left}], skipped, daily:{…}|null}
     *
     *  🔴 和 water.py 的 missions() **逐条对应**（红线：两份实现必须对拍）。
     *  🔴 字段名是查出来的（原项目 5.5.0 源码），不是猜的：
     *     missions[i] = {refId, name, score, limit}
     *     已做次数在 accScoreRsp.limits[j] = {refId, limit}（-1 = 不限次）
     *     ⇒ left = limit - used，**自己算**，响应里没有现成的剩余。
     *  🔴 读不到就抛，**绝不返回空数组**冒充「你没有任务」。
     */
    /** 任务列表（**一个平台**）。**和 water.py 的 missions() 逐条对应**。 */
    missions: async function (token, useApp) {
      var js = await wReq('GET', '/acc/score/mission-lst', token, null,
                          useApp ? WATER.T_DEVICE : WATER.T_ACCOUNT,
                          useApp ? WATER.V_DEVICE : WATER.V_SCORE);
      var data = wCheck(js);
      // 🔴 报错要说人话，键名进控制台。
      //    2026-11-02：原来这里只说「平台可能改版了」，拿到截图也无从下手
      //    （不知道是字段改名还是返回了别的东西）。但把 `foo/bar` 这种键名
      //    直接印在界面上，用户看不懂 —— 所以分两处：屏幕上说发生了什么，
      //    控制台里留排查线索。
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        console.warn('[missions] 返回的不是对象：', js);
        throw wErr('积分平台改了返回格式，这个版本读不出来', 'data');
      }
      var recs = data.missions;
      if (!Array.isArray(recs)) {
        console.warn('[missions] data 里没有 missions，实际有：',
                     Object.keys(data).join('/') || '(空)');
        throw wErr('积分平台改了返回格式，这个版本读不出来', 'data');
      }
      var done = wLimits(wScoreRsp(data));
      var out = [], skipped = 0;
      for (var i = 0; i < recs.length; i++) {
        var it = recs[i];
        if (!it || typeof it !== 'object') { skipped++; continue; }
        var rid = String(it.refId || '').trim();
        if (!rid) { skipped++; continue; }
        var name = String(it.name || it.title || '').trim();
        var hit = false;
        for (var k = 0; k < WATER.MISSION_SKIP.length; k++) {
          if (name && name.indexOf(WATER.MISSION_SKIP[k]) >= 0) { hit = true; break; }
        }
        if (hit) { skipped++; continue; }      // 原版也跳这类
        var limit = wInt(it.limit);
        var used = (rid in done) ? done[rid] : null;
        var left = null;
        if (limit != null && limit > 0 && used !== -1) {
          left = Math.max(0, limit - (used || 0));
        }
        out.push({
          refId: rid,
          name: name || rid,
          score: wInt(it.score),
          limit: limit,
          used: used,
          left: left,
          // 任务自带签名就带上。**实测响应里没有这个字段**（原版 postScore
          // 两条路都自己算签名），保留转发只是「服务端哪天给了不用改代码」。
          sign: String(it.sign || '').trim()
        });
      }
      return { items: out, skipped: skipped, daily: wDaily(data) };
    },

    /** 两个平台的**任务合并**（原版 TaskMissionPlanner.merge 的行为）。
     *  **和 water.py 的 missions_all 逐条对应**。
     *
     *  🔴 一个平台读失败**不拖垮另一个**，但也不许安静吞掉：失败记在 lanes 里，
     *     界面要能说出「少的是哪个平台」，否则看起来就像「任务只有这些」。 */
    missionsAll: async function () {
      var st = wLoad();
      if (!wAcct(st, 'device') && !wAcct(st, 'score')) {
        throw wErr('还没登录', 'auth');
      }
      var dev = wAcct(st, 'device'), sco = wAcct(st, 'score');
      var lanes = {}, errs = {}, items = [], skipped = 0, daily = null;
      // 顺序：积分平台在前（原版 merge 也是先 main 后 app，同 refId 以 main 为准）
      var plan = [
        { lane: 'score', tok: sco ? sco.token : null, useApp: false },
        { lane: 'device', tok: dev ? dev.token : null, useApp: true }
      ];
      for (var i = 0; i < plan.length; i++) {
        var p = plan[i];
        if (!p.tok) { lanes[p.lane] = 'missing'; continue; }
        var got;
        try {
          got = await WaterApi.missions(p.tok, p.useApp);
        } catch (e) {
          lanes[p.lane] = 'error';
          errs[p.lane] = (e && e.message) || String(e);
          continue;
        }
        lanes[p.lane] = 'ok';
        skipped += (got.skipped || 0);
        if (daily == null && got.daily) daily = got.daily;
        for (var j = 0; j < got.items.length; j++) {
          var it = got.items[j];
          it.platform = p.lane;
          items.push(it);
        }
      }
      // 按 refId 去重，先到的留下
      var seen = {}, uniq = [];
      for (var k = 0; k < items.length; k++) {
        if (seen[items[k].refId]) continue;
        seen[items[k].refId] = 1;
        uniq.push(items[k]);
      }
      var anyOk = false, ks = Object.keys(lanes);
      for (var m = 0; m < ks.length; m++) if (lanes[ks[m]] === 'ok') anyOk = true;
      if (!uniq.length && !anyOk) {
        // 一个都没读成功 ⇒ 这是真失败，不是「没有任务」
        var detail = Object.keys(errs).map(function (x) {
          return x + '：' + errs[x];
        }).join('；') || '没有可用的账号';
        var isAuth = false;
        Object.keys(errs).forEach(function (x) {
          if (errs[x].indexOf('登录') >= 0) isAuth = true;
        });
        throw wErr('两个平台的任务都没读到（' + detail + '）',
                   isAuth ? 'auth' : 'data');
      }
      return { items: uniq, skipped: skipped, daily: daily,
               lanes: lanes, errors: errs };
    },

    /** 执行一个积分任务。**有副作用**，界面二次确认，失败不重试。
     *
     *  🔴 签名是必须的（0.26.2 之前这里不带 sign，是错的）：
     *     md5(adId + 30×桶 + token尾8 + uid尾8 + 盐)，见 wSignScore。
     *     `platform` 决定用哪个账号、哪套盐和请求头。
     *  ⚠️ 返回成功**不等于到账**，界面跑完要重新读积分核验。
     *  addScore 读不到就不发 —— 发一个错的比不发更糟。
     */
    missionDone: async function (adId, addScore, platform) {
      var st = wLoad();
      var adid = String(adId || '').trim();
      if (!adid) throw wErr('这个任务做不了，平台没给必要的信息', 'biz');
      var lane, useApp;
      if (platform === 'device') {
        lane = { token: wDev(st), useApp: true };
        useApp = true;
      } else {
        // 🔴 用 `lane.useApp`，别写死 false：wScoreLane 在没登积分账号时会
        //    退回设备 token 并把 useApp 置 true。写死 false 就是
        //    「设备 token 配积分盐 + 1,5 头」⇒ 服务端按无效 token 拒掉。
        //    signIn 一直是跟着回退走的，这里原来跟它不一致。
        lane = wScoreLane(st);
        useApp = lane.useApp;
      }
      var acct = wAcct(st, useApp ? 'device' : 'score') || wAcct(st, 'device') || {};
      // 🔴 签名用的是 uid 后 8 位。登录没带回 uid 时，拿空编号去签，服务端一律
      //    回「验签失败」—— 界面上看就是「任务一直失败」，重登换网都不变。
      //    补一次账户信息，补到就存回本机（和 water.py / bridge.py 同一套）。
      var uid = String(acct.uid || '');
      if (!uid) {
        var g = await wEnsureUid(lane.token, useApp, uid);
        if (!g.uid) {
          throw wErr('拿不到账号编号（' + g.why + '），签名算不出来；'
                     + '在「我的」里把慧生活重登一次', 'data');
        }
        uid = g.uid;
        var lk = useApp ? 'device' : 'score';
        var latest = wLoad();
        var current = wAcct(latest, lk);
        if (!current || current.token !== lane.token) throw wErr('账号已切换', 'auth');
        current.uid = uid;
        wSave(latest);
      }
      var sig = wSignScore(adid, lane.token, uid, useApp);
      var q = '?sign=' + encodeURIComponent(sig);
      if (useApp) q += '&s=1';
      var body = { adId: adid, type: 101 };
      if (useApp && addScore != null && isFinite(addScore)) {
        body.addScore = Number(addScore);
        body.addScoreType = (adid === WATER.SIGN_AD_ID) ? 2 : 4;
      }
      var js = await wReq('POST', '/acc/score/score-send' + q, lane.token, body,
                          useApp ? WATER.T_DEVICE : WATER.T_ACCOUNT,
                          useApp ? WATER.V_DEVICE : WATER.V_SCORE);
      return wDoneResult(js, '任务');
    },

    /** 每日签到。**有副作用**，失败不重试。
     *  body 的键名两条路不一样（原版就这样，不是笔误）：
     *    App 路 {weekday, addScore, addScoreType:1, adId} / 积分路 {weekDay, adId}
     *  **和 water.py 的 sign_in 逐条对应**。 */
    signIn: async function (adId, weekday, score) {
      var st = wLoad();
      var adid = String(adId || '').trim();
      if (!adid) throw wErr('这个签到做不了，平台没给必要的信息', 'biz');
      var wd = wInt(weekday);
      if (wd == null || wd < 1 || wd > 7) {
        throw wErr('星期几算错了（' + weekday + '），不敢签', 'data');
      }
      var lane = wScoreLane(st);
      var useApp = lane.useApp;
      var acct = wAcct(st, useApp ? 'device' : 'score') || wAcct(st, 'device') || {};
      var uid = String(acct.uid || '');
      if (!uid) {
        var g = await wEnsureUid(lane.token, useApp, uid);
        if (!g.uid) {
          throw wErr('拿不到账号编号（' + g.why + '），签名算不出来；'
                     + '在「我的」里把慧生活重登一次', 'data');
        }
        uid = g.uid;
        var lk = useApp ? 'device' : 'score';
        var latest = wLoad();
        var current = wAcct(latest, lk);
        if (!current || current.token !== lane.token) throw wErr('账号已切换', 'auth');
        current.uid = uid;
        wSave(latest);
      }
      var sig = wSignScore(adid, lane.token, uid, useApp);
      var q = '?sign=' + encodeURIComponent(sig);
      if (useApp) q += '&s=1';
      var body = useApp
        ? { weekday: wd, addScore: (wInt(score) || 0), addScoreType: 1, adId: adid }
        : { weekDay: wd, adId: adid };
      var js = await wReq('POST', '/acc/score/score-send' + q, lane.token, body,
                          useApp ? WATER.T_DEVICE : WATER.T_ACCOUNT,
                          useApp ? WATER.V_DEVICE : WATER.V_SCORE);
      return wDoneResult(js, '签到');
    }
  };

  /** score-send 的公共收尾：0 = 提交成功（**不等于到账**），其余按 code 说话。
   *  **和 water.py 的 _done_result 逐条对应**。 */
  function wDoneResult(js, what) {
    var code = Number(js && js.code);
    if (code === 0) {
      return String((js && js.msg) || '').trim() || (what + '已提交');
    }
    if (code === -99) throw wErr('登录状态过期了，要重新登录一次', 'auth', code);
    var msg = String((js && js.msg) || '').trim();
    if (/签名|验签|sign/i.test(msg)) throw wErr(WATER.SIGN_MSG, 'sign', code);
    if (/频繁|限流/.test(msg)) throw wErr(msg, 'limit', code);
    throw wErr(msg || (what + '没成功'), 'biz', code);
  }

  function configured() {
    return WaterApi.available() && !!WATER.SALT_APP && !!WATER.SALT_MINI;
  }

  // Retain real order references with the account that submitted them.
  function exchangeRecords() {
    var state = wLoad();
    var account = wAcct(state, 'score') || wAcct(state, 'device');
    return account && Array.isArray(account.exchangeRecords) ? account.exchangeRecords : [];
  }

  function rememberExchange(record) {
    var state = wLoad();
    var account = wAcct(state, 'score') || wAcct(state, 'device');
    if (!account || !record.id) return;
    var existing = Array.isArray(account.exchangeRecords) ? account.exchangeRecords : [];
    account.exchangeRecords = [record].concat(existing.filter(function (item) {
      return item.id !== record.id;
    })).slice(0, 30);
    return wSave(state);
  }

  async function handle(path, body) {
      body = body || {};
      // 网页版的 api() 把参数拼在路径里（/api/notice?limit=60），APK 这边
      // 得自己拆。拆完把 path 还原成不带参数的，下面那些精确比较
      // （=== '/api/state'）才照旧成立。
      var q = {};
      path = String(path || '');
      var qi = path.indexOf('?');
      if (qi >= 0) {
        var pairs = path.slice(qi + 1).split('&');
        for (var pi = 0; pi < pairs.length; pi++) {
          if (!pairs[pi]) continue;
          var eq = pairs[pi].indexOf('=');
          var k = eq < 0 ? pairs[pi] : pairs[pi].slice(0, eq);
          var v = eq < 0 ? '' : pairs[pi].slice(eq + 1);
          try { q[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); }
          catch (e0) { q[k] = v; }
        }
        path = path.slice(0, qi);
      }
      try {
        // ---------------- 慧生活798（直饮水） ----------------
        // 和 bridge.py 的 /api/water/* **一一对应**（路径、字段、错误形状都一样），
        // 所以 app.js 那边只写一套，不用 `if (NATIVE)` 分叉。
        if (path === '/api/water/state') return WaterApi.state();
        if (path === '/api/water/captcha') {
          var wk = WaterApi.captchaKey();
          return { ok: true, key: wk, url: WaterApi.captchaUrl(wk) };
        }
        if (path === '/api/water/sms') {
          if (!configured()) return { ok: false, error: '当前构建缺少航院通 0.52.0 参考配置' };
          await WaterApi.sendSms(body.phone, body.key, body.graph);
          return { ok: true };
        }
        if (path === '/api/water/login') {
          if (!configured()) return { ok: false, error: '当前构建缺少航院通 0.52.0 参考配置' };
          var wl = await WaterApi.login(body.phone, body.sms, body.kind);
          // soft 要带上去：'soft' = 存好了但走的是备用加密方式。
          // 它是**成功**，只是调用方有权知道一句（换手机/清数据后要重登）。
          return { ok: true, phone: wl.phone, kind: wl.kind, soft: !!wl.soft };
        }
        if (path === '/api/water/home') {
          var g0 = wGate('device');
          if (g0) return { ok: false, error: g0, kind: 'auth' };
          var wout = { ok: true };
          // 🔴 余额和设备分开报错：一个挂了不该把另一个也变成「读不到」，
          //    也不许安静吞掉。和 bridge.py 那段是同一套规则。
          try {
            wout.balance = await WaterApi.balance();
          } catch (e1) {
            if (e1 && e1.kind === 'auth') {
              return { ok: false, error: e1.message, kind: 'auth' };
            }
            wout.balance = null;
            wout.balanceError = (e1 && e1.message) || String(e1);
          }
          try {
            wout.devices = await WaterApi.devices();
          } catch (e2) {
            if (e2 && e2.kind === 'auth') {
              return { ok: false, error: e2.message, kind: 'auth' };
            }
            wout.devices = WaterApi.state().devices || [];
            wout.devicesError = (e2 && e2.message) || String(e2);
          }
          return wout;
        }
        if (path === '/api/water/start') {
          // 文案由 WaterApi.start 给，**不在这里另写一句** ——
          // 两份文案各改各的会分叉，而且不报错（和 water.py 对照的测试抓得到）。
          var wmsg = await WaterApi.start(body.did);
          return { ok: true, msg: wmsg };
        }
        if (path === '/api/water/logout') {
          WaterApi.logout(body.kind);
          return { ok: true, kind: body.kind || '' };
        }
        // ---------------- 0.24.0：和 bridge.py 逐条对应 ----------------
        if (path === '/api/water/score') {
          var g1 = wGate('any');
          if (g1) return { ok: false, error: g1, kind: 'auth' };
          var sc = await WaterApi.score();
          return { ok: true, valid: sc.valid, total: sc.total };
        }
        if (path === '/api/water/bills') {
          var g2 = wGate('device');
          if (g2) return { ok: false, error: g2, kind: 'auth' };
          var bp = parseInt(q.page, 10);
          var got = await WaterApi.bills(isFinite(bp) ? bp : 0, 20);
          return { ok: true, items: got.items, more: got.more, total: got.total };
        }
        if (path === '/api/water/missions') {
          var g3 = wGate('any');
          if (g3) return { ok: false, error: g3, kind: 'auth' };
          var mg = await WaterApi.missionsAll();
          // 🔴 `daily` / `lanes` / `errors` 必须一起转发（同 bridge.py 那条注释）：
          //    漏了 daily ⇒ 签到卡永远藏着；漏了 lanes ⇒ 界面不知道
          //    「少一半任务是没登积分账号」，只会显得「任务就是这些」。
          return { ok: true, items: mg.items, skipped: mg.skipped,
                   daily: mg.daily, lanes: mg.lanes, errors: mg.errors };
        }
        if (path === '/api/water/signin') {
          if (!String(body.adId || '').trim()) {
            return { ok: false, error: '签到信息不全，做不了' };
          }
          var si = await WaterApi.signIn(body.adId, body.weekday, body.score);
          return { ok: true, msg: si };
        }
        if (path === '/api/water/end') {
          var g4 = wGate('device');
          if (g4) return { ok: false, error: g4, kind: 'auth' };
          if (!String(body.did || '').trim()) {
            return { ok: false, error: '没给设备号' };
          }
          return { ok: true, msg: await WaterApi.end(body.did) };
        }
        if (path === '/api/water/mission') {
          var g5 = wGate('any');
          if (g5) return { ok: false, error: g5, kind: 'auth' };
          if (!String(body.adId || '').trim()) {
            return { ok: false, error: '没给任务 id' };
          }
          var as = (body.score == null || body.score === '') ? null : Number(body.score);
          var mm = await WaterApi.missionDone(body.adId,
                     isFinite(as) ? as : null, String(body.platform || ''));
          return { ok: true, msg: mm };
        }
        // ---------------- 0.27.1：积分兑换余额 ----------------
        // 和 bridge.py 一一对应（路径、字段、错误形状都一样）。
        if (path === '/api/water/wallets') {
          var gw = wGate('any');
          if (gw) return { ok: false, error: gw, kind: 'auth' };
          return { ok: true, wallets: await WaterApi.wallets() };
        }
        if (path === '/api/water/exchange') {
          var ge = wGate('any');
          if (ge) return { ok: false, error: ge, kind: 'auth' };
          if (!String(body.eid || '').trim()) {
            return { ok: false, error: '没选兑换到哪个钱包' };
          }
          if (body.score == null || body.score === '') {
            return { ok: false, error: '没给要兑换的积分' };
          }
          try {
            return { ok: true, sn: await WaterApi.scoreExchange(body.eid, body.score) };
          } catch (e) {
            var ek = (e && e.kind) || '';
            // 🔴 网络类失败**不代表没扣分**：请求可能已经到服务端了。
            //    文案必须让用户先去核验，不能让他「再点一次」—— 那就是再扣一次。
            if (!ek || ek === 'net' || ek === 'limit') {
              return { ok: false, kind: ek || 'net',
                       error: '兑换结果未知（' + ((e && e.message) || e)
                              + '），先别重复兑换' };
            }
            return { ok: false, error: (e && e.message) || String(e), kind: ek };
          }
        }
        if (path === '/api/water/exchange-bill') {
          var gb = wGate('any');
          if (gb) return { ok: false, error: gb, kind: 'auth' };
          var bid = String((q && q.id) || '').trim();
          if (!bid) return { ok: false, error: '没给账单号' };
          try {
            var eb = await WaterApi.exchangeBill(bid);
            return { ok: true, id: eb.id, status: eb.status, done: eb.done };
          } catch (e2) {
            return { ok: false, error: (e2 && e2.message) || String(e2),
                     kind: (e2 && e2.kind) || '' };
          }
        }
        return { ok: false, error: '未知的饮水服务操作' };
      } catch (e) {
        return { ok: false, error: (e && e.message) || String(e),
                 kind: (e && e.kind) || '', code: (e && e.code) };
      }
  }

  window.Water = Object.freeze({ handle, configured, state: WaterApi.state, exchangeRecords, rememberExchange });
})();
