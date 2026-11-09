/* 慧生活798查询与手动验证码登录移植自航院通。 */
(function () {
  'use strict';

  const WATER = {
    BASE: 'https://i.ilife798.com/api/v1',
    UA: 'Android_ilife798_3.1.10',
    T_DEVICE: '1,1',
    V_DEVICE: '3.1.10',
    SIGN_MSG: '慧生活拒绝了请求签名，请检查客户端兼容性'
  };

  let smsAttempt = null;
  let loginBusy = false;
  const diagnostics = [];
  const diagnosticEnabled = () => !!(window.Android && Android.debugDiagnosticsEnabled
    && Android.debugDiagnosticsEnabled());
  const loginConfigured = () => !!(window.Android && Android.waterLoginConfigured
    && Android.waterLoginConfigured());
  const protocolState = () => ({ channel: 'app', protocolVersion: WATER.V_DEVICE, signingConfigured: loginConfigured() });

  function requireLoginConfig() {
    if (!loginConfigured()) throw wErr('本构建缺少经授权的 798 用水登录签名配置', 'config');
  }

  function clearLoginAttempt() {
    if (smsAttempt && window.Android && Android.clearWaterAttempt) Android.clearWaterAttempt(smsAttempt.id);
    smsAttempt = null;
  }

  async function authOperation(phase, challenge, action) {
    const context = { phase };
    const started = performance.now();
    let failure;
    try {
      if (loginBusy) throw wErr('已有验证码请求正在处理', 'session');
      loginBusy = true;
      try { return await action(context); }
      finally { loginBusy = false; }
    } catch (error) {
      failure = error;
      if (!context.exception && !error.kind) context.exception = error.name;
      throw error;
    } finally {
      if (diagnosticEnabled()) {
        const kinds = ['net', 'data', 'limit', 'sign', 'client', 'params', 'deny',
          'otp-invalid', 'otp-expired', 'otp-rejected', 'captcha', 'session', 'storage', 'config'];
        const exceptions = ['Timeout', 'TLS', 'Policy', 'IO', 'Other', 'TypeError', 'SyntaxError'];
        diagnostics.push({
          phase, ...protocolState(),
          http: Number.isInteger(context.http) ? context.http : null,
          code: Number.isInteger(context.code) && Math.abs(context.code) < 1000000 ? context.code : null,
          kind: failure ? (kinds.includes(failure.kind) ? failure.kind : 'data') : 'success',
          challenge, cookieSent: context.cookieSent === true, cookiePresent: context.cookiePresent === true,
          setCookiePresent: context.setCookiePresent ?? null,
          messageField: context.messageField ?? null,
          accountEnvelope: context.accountEnvelope ?? null, tokenPresent: context.tokenPresent ?? null,
          elapsedMs: Math.round(performance.now() - started),
          exception: exceptions.includes(context.exception) ? context.exception : null
        });
        if (diagnostics.length > 10) diagnostics.shift();
      }
    }
  }

  function wErr(msg, kind, code) {
    var e = new Error(msg);
    e.kind = kind || 'net';
    e.code = (code == null ? null : code);
    return e;
  }

  function wKey() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return Array.from(crypto.getRandomValues(new Uint8Array(10)), value => chars[value % chars.length]).join('');
  }

  function wCheck(js, phase, context) {
    const raw = js && js.code;
    const code = typeof raw === 'number' || (typeof raw === 'string' && /^-?\d+$/.test(raw)) ? Number(raw) : NaN;
    if (context) context.code = code;
    if (!Number.isInteger(code)) throw wErr('饮水服务响应缺少有效业务码', 'data');
    if (code === 0) return (js && js.data);
    if (code === -99 && !phase) throw wErr('登录状态过期了，要重新登录一次', 'auth', code);
    const messageField = (phase ? ['msg', 'message', 'errorMessage'] : ['msg'])
      .find(field => typeof js[field] === 'string' && js[field].trim());
    if (context) context.messageField = messageField;
    const msg = phase ? (messageField ? js[messageField].trim() : '') : String(js.msg || '');
    if (/签名|sign/i.test(msg)) throw wErr(WATER.SIGN_MSG, 'sign', code);
    if (/频繁|限流/.test(msg)) throw wErr('请求太频繁，请稍后再试', 'limit', code);
    // 平台原话「请升级最新版应用」—— 照抄显示，用户会以为**我们**这个 App 该更新。
    // 说清是慧生活那边的要求，并给出这段时间唯一的办法。
    if (/升级|最新版|版本过低/.test(msg) && /应用|客户端|app|版本/i.test(msg)) {
      throw wErr('798 要求升级客户端，当前请求未通过版本校验', 'client', code);
    }
    if (phase) {
      if (code === -99 || /会话|不匹配|不一致/.test(msg)) {
        throw wErr('798 返回验证码会话已失效或不匹配，请手动获取新短信', 'session', code);
      }
      if (/参数|手机号格式/.test(msg)) throw wErr('798 拒绝了请求参数', 'params', code);
      if (/验证码/.test(msg)) {
        if (phase === 'sms') throw wErr('798 未接受图形验证码，请重新加载图片', 'captcha', code);
        const invalid = /错误|不正确|无效/.test(msg);
        const expired = /过期|失效/.test(msg);
        if (expired && !invalid) throw wErr('798 返回短信验证码已过期，请手动获取新短信', 'otp-expired', code);
        if (invalid && !expired) throw wErr('798 返回短信验证码不正确，请核对本次短信', 'otp-invalid', code);
        throw wErr('798 返回短信验证码错误或失效，无法区分原因，请核对本次短信', 'otp-rejected', code);
      }
      const codeLabel = Math.abs(code) < 1000000 ? '（业务码 ' + code + '）' : '';
      throw wErr('798 拒绝了' + (phase === 'sms' ? '发送验证码' : '本次登录')
        + codeLabel + '，原因未能识别', 'deny', code);
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

  async function wReq(method, path, token, body, attempt, context) {
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
                                         body == null ? '' : JSON.stringify(body), '', headers, '', attempt);
    if (context) {
      context.http = response.status;
      context.cookieSent = response.sessionSent;
      context.cookiePresent = response.sessionPresent;
      if (typeof response.setCookiePresent === 'boolean') context.setCookiePresent = response.setCookiePresent;
      context.exception = response.exception;
    }
    if (response.status === 202 || response.status === 429) throw wErr('请求太频繁，请稍后再试', 'limit');
    if (context && [400, 401, 403].includes(response.status)) {
      let body;
      try { body = JSON.parse(response.body); } catch (error) { /* HTTP fallback below. */ }
      if (body) {
        try {
          wCheck(body, context.phase, context);
        } catch (error) {
          if (error.kind !== 'deny' && error.kind !== 'data') throw error;
        }
      }
    }
    if (response.status === 401 || response.status === 403) {
      throw context ? wErr('798 拒绝了本次验证码请求', 'deny')
        : wErr('慧生活登录已失效或请求被拒绝', 'auth');
    }
    if (context && response.status === 400) throw wErr('798 拒绝了请求参数', 'params');
    if (response.status !== 200) throw wErr('饮水服务未返回有效响应', 'net');
    try {
      return JSON.parse(response.body);
    } catch (error) {
      if (context) context.exception = 'SyntaxError';
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
      clearLoginAttempt();
      const key = wKey();
      return { key, url: WATER.BASE + '/captcha/?s=' + encodeURIComponent(key) + '&r=' + Date.now() };
    },

    sendSms: function (phone, key, graph) {
      return authOperation('sms', !!key && !!graph, async context => {
        requireLoginConfig();
        if (!/^1\d{10}$/.test(phone) || !key || !graph) throw wErr('请输入手机号和图形验证码', 'params');
        clearLoginAttempt();
        const id = wKey();
        const pending = { id, phone, issued: false };
        smsAttempt = pending;
        try {
          wCheck(await wReq('POST', '/acc/login/code', null, { un: phone, authCode: graph, s: key }, id, context), 'sms', context);
          if (smsAttempt !== pending) throw wErr('验证码会话已取消，请重新获取', 'session');
          pending.issued = true;
        } catch (error) {
          clearLoginAttempt();
          throw error;
        }
      });
    },

    login: function (phone, sms) {
      return authOperation('login', !!(smsAttempt && smsAttempt.issued), async context => {
        requireLoginConfig();
        if (!/^1\d{10}$/.test(phone) || typeof sms !== 'string' || !/^\d{4,10}$/.test(sms)) {
          throw wErr('请输入有效的手机号和短信验证码', 'params');
        }
        if (!smsAttempt || !smsAttempt.issued || smsAttempt.phone !== phone) {
          throw wErr('手机号与本次短信会话不匹配，请为该号码在应用内获取验证码', 'session');
        }
        const pending = smsAttempt;
        const signature = Android.signWaterLogin(phone, sms);
        if (!/^[0-9a-f]{32}$/.test(signature)) throw wErr('本机未能生成 798 登录签名', 'config');
        const path = '/acc/login?sign=' + signature;
        let data;
        try {
          data = wCheck(await wReq('POST', path, null, { un: phone, authCode: sms }, pending.id, context), 'login', context);
        } catch (error) {
          if (error.kind === 'otp-expired' || error.kind === 'session') clearLoginAttempt();
          throw error;
        }
        if (smsAttempt !== pending) throw wErr('验证码会话已取消，未保存登录状态', 'session');
        clearLoginAttempt();
        const account = data && data.al;
        context.accountEnvelope = !!account && typeof account === 'object' && !Array.isArray(account);
        const token = context.accountEnvelope && typeof account.token === 'string' ? account.token.trim() : '';
        context.tokenPresent = !!token;
        if (!token || token.length > 4096 || /[\x00-\x1f\x7f]/.test(token)) {
          throw wErr('798 返回成功，但未提供有效的用水账号会话', 'data');
        }
        const failure = wSave({ token, devices: [], at: 0 });
        if (failure) throw wErr('798 已通过验证，但本机未能安全保存会话', 'storage');
      });
    },

    clearLoginAttempt, loginConfigured,
    canLogin: phone => !!(smsAttempt && smsAttempt.issued && smsAttempt.phone === phone),
    diagnostics: () => diagnosticEnabled()
      ? [{ phase: 'configuration', ...protocolState() }, ...diagnostics.map(entry => ({ ...entry }))] : [],
    logout: function () { clearLoginAttempt(); Android.clearWater(); },

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
