/* HuiLife798 device-account module from Hobson2233/hangyuantong, web/native.js.
 * Copyright (c) Hobson2233 and contributors. MIT, see LICENSE.
 * JCT integration points: native request callback, local build salt, account switching,
 * and device-account access to account info and bill detail.
 */
(function () {
  'use strict';

  var WATER = {
    BASE: 'https://i.ilife798.com/api/v1',
    // 官方客户端的 UA。第三方项目用 "WaterWidget/5.5.0" 也能通，说明服务端
    // 不是硬校验；取官方那个是为了兼容（万一哪天按 UA 分流）。
    // 🔴 2026-11-06：官方发到 3.1.10（versionCode 31010）。我们一直自称 3.1.9，
    //    登录被平台用「请升级最新版应用」挡回来。UA 和 VersionCode 必须一起跟到
    //    官方当前版本，只改一个等于冒称一个不存在的客户端。
    OFFICIAL_VER: '3.1.10',
    UA: 'Android_ilife798_3.1.10',
    T_ACCOUNT: '1,5',
    T_DEVICE: '1,1',
    // 服务端 API 版本号（**和客户端版本无关**，原版按用途写死不同的值）。
    // 漏了不会报错，只会拿到「另一个版本」的响应 —— 那种错最难查。
    V_ACCOUNT: '2.0.83',
    V_SCORE: '2.0.178',
    V_DEVICE: '3.1.10',
    SALT_APP: /* local authorized build */ "",
    SIGN_MSG: '平台的校验没通过：先看看手机时间准不准',
    srvOffsetMs: 0
  };

  function pfHttp(method, url, body, headers) {
    return window.nativeRequest(method, url, body, '', headers);
  }

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
    if (!js || !/^-?\d+$/.test(String(js.code))) {
      throw wErr('饮水服务未返回有效业务码', 'data');
    }
    // 设备路顺手校准时差（签名要用，见 WATER.srvOffsetMs）。积分路不碰。
    // `date` 是原生层给的响应头 Date（秒）；老壳没有这个字段，就当没收到。
    if (at === WATER.T_DEVICE && r && r.date > 0) {
      WATER.srvOffsetMs = r.date * 1000 - Date.now();
    }
    return js;
  }

  /** 统一判 code。0 成功；-99 登录过期；其余按服务端 msg 说。 */
  function wCheck(js) {
    var code = Number(js && js.code);
    if (code === 0) return (js && js.data);
    if (code === -99) throw wErr('登录状态过期了，要重新登录一次', 'auth', code);
    var msg = String((js && js.msg) || '');
    // 签名被拒要单独标出来：签名里有个 30 秒的时间桶，**本机时间偏太多**
    // 就会被判「验签失败」—— 这是用户自己能动的那一种（另外一种是平台换盐，
    // 那得我们改）。以前这里只说「可能需要更新 App」，等于什么都没说。
    // 🔴 这句话和 water.py 的 SIGN_MSG **一字不差**（对拍）。
    if (/签名|sign/i.test(msg)) throw wErr(WATER.SIGN_MSG, 'sign', code);
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

  /** 登录签名：md5("authCode=" + 验证码 + "&un=" + 手机号 + SALT_APP)。
   *  **和 water.py 的 sign_login 一字不差**（两边算出来必须一样）。
   *  只给设备路用；积分路官方不带，别抄过去。 */
  function wSignLogin(phone, sms) {
    return wMd5('authCode=' + String(sms == null ? '' : sms)
                + '&un=' + String(phone == null ? '' : phone) + WATER.SALT_APP);
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
    loginConfigured: function () {
      return !!(WATER.SALT_APP && window.Android && typeof Android.req2 === 'function');
    },

    account: function () {
      return wViewInfo(wDev(wLoad()), true);
    },

    // Store the upstream UI's last local operation with the current device account.
    live: function () {
      var st = wLoad();
      return wAcct(st, 'device') && st.live || null;
    },

    rememberUse: function (record) {
      var st = wLoad();
      wDev(st);
      if (record) st.live = record;
      else delete st.live;
      var why = wSave(st);
      if (why && why !== 'soft') throw wErr('本机未能保存设备操作记录', 'data');
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

    /** Exchange the SMS code for the device-account token. */
    login: async function (phone, sms) {
      var k = 'device';
      var body = { authCode: sms, un: phone };
      var path = '/acc/login?sign=' + wSignLogin(phone, sms);
      var js = await wReq('POST', path, null, body, WATER.T_DEVICE, WATER.V_DEVICE);
      var data = wCheck(js) || {};
      var al = (data.al && typeof data.al === 'object') ? data.al : data;
      var token = String((al && al.token) || '').trim();
      if (!token) throw wErr('登录成功了，但没拿到登录凭据，请重试', 'data');
      var st = wLoad() || {};
      // JCT allows switching water accounts directly from this form.
      var previous = wAcct(st, k);
      if (!previous || previous.phone !== phone || (previous.uid && (al.uid || al.id)
          && previous.uid !== String(al.uid || al.id))) {
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
      var st = wLoad();
      var js = await wReq('GET', '/ui/app/master', wDev(st), null, WATER.T_DEVICE);
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

    billDetail: async function (bid) {
      var st = wLoad();
      var id = String(bid == null ? '' : bid).trim();
      if (!id) throw wErr('没给账单号', 'biz');
      var js = await wReq('GET', '/bill/view-full?id=' + encodeURIComponent(id),
                          wDev(st), null, WATER.T_DEVICE);
      var data = wCheck(js) || {};
      var bill = (data && typeof data === 'object' && !Array.isArray(data)
                  && data.bill && typeof data.bill === 'object') ? data.bill : null;
      if (!bill) throw wErr('账单详情暂不可读', 'data');
      var got = String(bill.id == null ? '' : bill.id).trim();
      if (got && got !== id) {
        throw wErr('查到的是另一张账单（' + got + ' ≠ ' + id + '）', 'data');
      }
      var stt = wInt(bill.status);
      var dd = bill.data || {}, dv = bill.dev || {};
      return { id: id, status: stt, settled: stt === 3,
               money: wNum(bill.payment), at: wMs(bill.utime || bill.ctime),
               did: String(dv.id || bill.did || dd.did || dd.deviceId || '') };
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
  };

  window.Water = Object.freeze(WaterApi);
})();
