/* 慧生活798查询与手动验证码登录移植自航院通。 */
(function () {
  'use strict';

  const WATER = {
    BASE: 'https://i.ilife798.com/api/v1',
    UA: 'Android_ilife798_3.1.10',
    T_DEVICE: '1,1',
    V_DEVICE: '3.1.10',
    SALT_APP: '[REDACTED_798_SIGNING_MATERIAL]',
    SIGN_MSG: '慧生活拒绝了请求签名，请检查客户端兼容性'
  };

  function wErr(msg, kind, code) {
    var e = new Error(msg);
    e.kind = kind || 'net';
    e.code = (code == null ? null : code);
    return e;
  }

  function wKey() {
    var cs = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var s = '';
    for (var i = 0; i < 10; i++) s += cs.charAt(Math.floor(Math.random() * cs.length));
    return s;
  }

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

  function wCheck(js) {
    var code = js && js.code != null ? Number(js.code) : NaN;
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

  function wInt(v) {
    if (v == null || typeof v === 'boolean') return null;
    if (typeof v === 'number') return isFinite(v) ? Math.trunc(v) : null;
    var n = parseFloat(String(v).trim());
    return isFinite(n) ? Math.trunc(n) : null;
  }

  function wMs(v) {
    var n = wInt(v);
    if (n == null || n <= 0) return 0;
    return n < 10000000000 ? n * 1000 : n;
  }

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

  function wSignLogin(phone, sms) {
    return wMd5('authCode=' + String(sms == null ? '' : sms)
                + '&un=' + String(phone == null ? '' : phone) + WATER.SALT_APP);
  }

  async function wReq(method, path, token, body) {
    const headers = {
      'User-Agent': WATER.UA,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-Hans-CN;q=1',
      'Content-Type': 'application/json',
      'ApplicationType': WATER.T_DEVICE,
      'VersionCode': WATER.V_DEVICE
    };
    if (token) headers.Authorization = token;
    const response = await nativeRequest(method, WATER.BASE + path,
                                         body == null ? '' : JSON.stringify(body), '', headers);
    if (response.status === 202) throw wErr('请求太频繁，请稍后再试', 'limit');
    if (response.status === 401 || response.status === 403) {
      throw wErr('慧生活登录已失效或请求被拒绝', 'auth');
    }
    if (response.status !== 200) throw wErr('饮水服务未返回有效响应', 'net');
    try {
      return JSON.parse(response.body);
    } catch (error) {
      throw wErr('无法读取饮水服务响应', 'data');
    }
  }

  function wLoad() {
    const raw = Android.loadWater();
    if (!raw) return null;
    try {
      const session = JSON.parse(raw);
      return session && session.token ? session : null;
    } catch (error) {
      return null;
    }
  }

  function wDev(session) {
    if (!session) throw wErr('请先登录慧生活798', 'auth');
    return session.token;
  }

  function wSave(session) {
    return Android.saveWater(JSON.stringify(session));
  }

  const Water = {
    state: function () {
      const session = wLoad();
      return session
        ? { linked: true, devices: session.devices || [], at: session.at || 0 }
        : { linked: false, broken: Android.waterState() !== 'none' };
    },

    captcha: function () {
      const key = wKey();
      return { key, url: WATER.BASE + '/captcha/?s=' + encodeURIComponent(key) + '&r=' + Date.now() };
    },

    sendSms: async function (phone, key, graph) {
      wCheck(await wReq('POST', '/acc/login/code', null, { un: phone, authCode: graph, s: key }));
    },

    login: async function (phone, sms) {
      const path = '/acc/login?sign=' + wSignLogin(phone, sms);
      const data = wCheck(await wReq('POST', path, null, { un: phone, authCode: sms })) || {};
      const account = data.al || data;
      const token = String(account.token || '').trim();
      if (!token) throw wErr('平台未返回登录会话', 'data');
      const failure = wSave({ token, devices: [], at: 0 });
      if (failure) throw wErr(failure, 'data');
    },

    logout: function () { Android.clearWater(); },

    balance: async function () {
      var st = wLoad();
      var js = await wReq('GET', '/acc/wallet/owner', wDev(st), null);
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
      var js = await wReq('GET', '/ui/app/master', wDev(st), null);
      var data = wCheck(js) || {};
      if (!Array.isArray(data.favos)) throw wErr('设备列表没读出来，平台可能改版了', 'data');
      var favos = data.favos;
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

    bills: async function (page, size) {
      var st = wLoad();
      var pg = (page == null ? 0 : page), sz = (size == null ? 20 : size);
      var path = '/bill/lst-owner?page=' + pg + '&size=' + sz;
      var js = await wReq('GET', path, wDev(st), null);
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

  window.Water = Water;
})();
