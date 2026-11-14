/* HuiLife798 UI from HangYuanTong 0.52.0 (Hobson2233 and contributors, MIT). */
(function () {
'use strict';

const $ = id => document.getElementById(id);
const api = (path, body) => Water.handle(path, body);
const visible = () => !$('page-life').hidden && !$('life-water').hidden;
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem('jct.water.' + key)) ?? fallback; }
    catch (_) { return fallback; }
  },
  set(key, value) {
    localStorage.setItem('jct.water.' + key, JSON.stringify(value));
  },
  del(key) {
    localStorage.removeItem('jct.water.' + key);
  }
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
const escAttr = esc;
const ntStamp = seconds => new Date(seconds * 1000).toLocaleString('zh-CN', { hour12: false });
function agoText(seconds) {
  const days = Math.floor((Date.now() / 1000 - seconds) / 86400);
  return days < 1 ? '今天' : days < 30 ? days + ' 天前' : ntStamp(seconds);
}
function openWater() { window.Android?.openOfficialWater(); }

let activeDialog;
function waterDialog(title, hint, build) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'jct-water jct-water-dialog';
    const h = document.createElement('h2');
    h.textContent = title;
    dialog.append(h);
    if (hint) {
      const p = document.createElement('p');
      p.className = 'sub';
      p.textContent = hint;
      dialog.append(p);
    }
    const finish = value => {
      dialog.close();
      dialog.remove();
      activeDialog = null;
      resolve(value);
    };
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
    const button = (label, value, primary = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn' + (primary ? ' primary' : '');
      b.textContent = label;
      b.addEventListener('click', () => finish(typeof value === 'function' ? value() : value));
      return b;
    };
    activeDialog = () => finish(null);
    build(dialog, button, finish);
    dialog.append(button('取消', null));
    document.body.append(dialog);
    dialog.showModal();
  });
}
function openInput(title, hint, placeholder, action, value = '') {
  return waterDialog(title, hint, (dialog, button, finish) => {
    const input = document.createElement('input');
    input.placeholder = placeholder;
    input.setAttribute('aria-label', placeholder);
    input.value = value;
    input.addEventListener('keydown', event => { if (event.key === 'Enter') finish(input.value.trim()); });
    dialog.append(input, button(action, () => input.value.trim(), true));
  });
}
function openPick(title, hint, groups, selected) {
  return waterDialog(title, hint, (dialog, button) => {
    for (const group of groups) {
      for (const item of group.items) {
        dialog.append(button(item.name, item.id, item.id === selected));
      }
    }
  });
}
function askConfirm(title, hint, action) {
  return waterDialog(title, hint, (dialog, button) => dialog.append(button(action, true, true)));
}

const WT = {
  key: '',      // 图形验证码的会话串（服务端按它认这张图）
  busy: false,  // 有请求在飞 —— 防连点，不是防重复提交
  cd: 0,        // 短信倒计时还剩几秒
  timer: 0,
  phone: '',
  bal: null,    // null = 没读到（**不是 0**）
  balErr: '',
  devs: [],
  devErr: '',
  loadedAt: 0,  // 余额最后一次读到的时间（ms）
  expired: false, // 登录态过期了 —— 过期卡已经解释过，别再在别处重复

  // ---- 0.24.0：积分 / 积分任务 / 消费记录 ----
  score: null,       // {valid,total}；null = 没读到（**不是 0 分**）
  scoreErr: '',
  // [{refId,name,score,limit,used,left}]
  // 🔴 是 refId 不是 adId —— 响应里就叫 refId，只有请求 body 里才叫 adId
  //    （2026-10-30 查原项目 5.5.0 源码确认）。0.25.0 按 adId 找，所以
  //    真机上一直报「找不到带 adId 的数组」。
  missions: [],
  missionErr: '',
  missionSkipped: 0, // 列表里被跳过的条数（没 refId / 属于「不做的类别」）
  daily: null,       // 签到状态 {adId,score,week,weekday,signed,rewards}；null=没这功能
  run: {},           // refId -> 'wait'|'ok'|'bad'，这一轮跑出来的状态
  running: false,    // 批量任务正在跑（和 busy 分开：busy 是防连点）
  cur: '',           // 正在跑的那个 refId，界面上高亮那一行

  // ---- 0.26.2：两套账号 ----
  // 设备登录（1,1）管接水/余额/设备；积分登录（1,5）管积分/任务/签到。
  // 两个 token 互不通用，任务列表按平台各返回一份。
  accounts: { device: null, score: null },
  // 🔴 0.40.0：设备账号没登时，余额 / 消费记录 / 积分 / 今日任务四张卡
  //    各说一遍「没读到：要用「设备登录」那个账号……」—— 同一个原因说四遍，
  //    加起来近百像素，真机上这一页就装不下。置真之后各卡不再重复原因，
  //    只在页顶说一次（见 wtPaintOffNote）。
  offNote: false,
  loginKind: '',     // '' = 不显示登录表单；'device' / 'score' = 正在登哪个
  lanes: null,       // {device:'ok'|'missing'|'error', score:…}；null = 还没读
  laneErr: {},       // 平台 -> 读失败的原因
  runStop: false,    // 用户点了「停」—— 跑任务时每一轮都要看它
  runGap: 0,         // 两次提交之间的间隔（ms），0 = 用默认 30 秒
  runDone: 0,        // 这一轮已经提交了几次（不是几个任务）
  runTotal: 0,       // 这一轮一共要提交几次
  // 这一轮**到目前为止挣到的分**（按任务列表里写的分值累加）。
  // 只用来在跑的时候把「可用」显示成 `35+25`；跑完以服务端读回来的为准。
  // 🔴 它是**估的**：平台给不给、给多少，只有重读积分才知道 —— 所以它
  //    只活在跑的这一段时间里，跑完立刻清零（见 wtRunAll 末尾）。
  runGain: 0,
  bills: [],         // 消费记录（翻页是往里追加，不是替换）
  billErr: '',
  billsPage: 0,
  billsMore: false,
  billsLoaded: false,
  live: null,        // {did,name,at} 本地记的「刚才你启动了」——**不是**服务端状态
  last: null,        // {did,name,at,money|null} 刚停完那一次的结算（内存，不落盘）

  // ---- 0.27.1：积分兑换余额 ----
  ex: {
    open: false,     // 兑换那块默认收起（这一页已经很长）
    unit: 100,       // 档位，只有 100 / 1000（原版 amounts）
    qty: 1,          // 份数
    eid: '',         // 选中的钱包端点 id（空 = 用第一个）
    wallets: null,   // null = 还没读；[] = 确实没有钱包
    err: '',         // 读钱包失败的原因
    busy: false,     // 提交中（防连点，不是防重复提交）
  },
};

/** 把 kind 翻译成「用户下一步该做什么」。
 *  原样抛 `msg` 等于什么都没说 —— 每条错误用户要做的事都不一样。 */
function wtErrText(kind, msg) {
  const m = msg || '操作失败';
  if (kind === 'limit') return m + '。先别急着重试，等几分钟再点。';
  if (kind === 'net') return m + '。换个网络再试。';
  if (kind === 'sign') return m;
  return m;
}

/** 页内提示。说明用灰字（.note），出错才加 .bad。
 *  🔴 光写 `class="tip"` 是红字居中 —— 那是错误样式，不是提示样式。 */
function wtTip(msg, bad) {
  const el = $('wtTip');
  if (!msg) { el.hidden = true; el.textContent = ''; el.classList.remove('bad'); return; }
  el.hidden = false;
  el.textContent = msg;
  el.classList.toggle('bad', !!bad);
}

/** 换一张图形验证码。
 *  🔴 服务端按 `s=key` 认这张图，所以**必须**先拿到新 key 再换 src，
 *     不能只改 src 上的时间戳 —— 那样图变了、key 还是旧的，发短信必错。 */
async function wtNewCaptcha() {
  const img = $('wtCapImg');
  try {
    const r = await api('/api/water/captcha');
    if (!r || !r.ok) { wtTip((r && r.error) || '拿不到图形验证码', true); return; }
    WT.key = r.key;
    img.classList.remove('bad');
    img.src = r.url;
    $('wtGraph').value = '';
  } catch (e) {
    wtTip('拿不到图形验证码：' + e.message, true);
  }
}

/** 短信倒计时。倒计时里按钮是禁用的 —— 不禁用的话用户会连点，
 *  服务端按 202 限流，报出来是「请求太频繁」，看着像我们坏了。 */
function wtCountdown(sec) {
  clearInterval(WT.timer);
  const btn = $('wtSend');
  let n = sec;
  const paint = () => {
    if (n <= 0) {
      clearInterval(WT.timer);
      WT.timer = 0; WT.cd = 0;
      btn.disabled = false;
      btn.textContent = '发送';
      return;
    }
    WT.cd = n;
    btn.disabled = true;
    btn.textContent = n + 's';
    n -= 1;
  };
  paint();
  WT.timer = setInterval(paint, 1000);
}

function wtShowOff(reason) {
  WT.expired = false;      // 卡要藏起来了，标记必须一起清（见 wtExpire 注释）
  // 🔴 账号卡在两种状态下都要显示 —— 它是「哪半功能缺账号」的唯一说明处。
  //    藏起来的话，用户只看到「没登录」，不知道该登哪个。
  wtPaintAccounts();
  $('waterOff').hidden = !WT.loginKind;   // 只有点了某一行才展开表单
  $('waterOn').hidden = true;
  $('jctWaterRefresh').hidden = true;
  $('wtExpired').hidden = true;
  // 这一页的主体是直饮水，没登录时给一句「还没登录 + 去登录」，
  // 登录表在「我的 → 账号管理 → 慧生活账号」。
  $('wtNeedLogin').hidden = !!WT.loginKind;
  // 🔴 「没登过」和「这次没读到登录状态」是两件事（reason='unknown'）。
  //    后者说成「还没登录」，人照着去登一遍，回来还是同一句 —— 白折腾。
  const unknown = (reason === 'unknown');
  $('wtNeedTitle').textContent = unknown ? '这次没读到登录状态' : '还没登录慧生活';
  $('wtNeedSub').textContent = unknown
    ? '网络或服务暂时没回话。已经登录过的账号不会丢，点下面重试。'
    : '接水、余额、积分任务都要先登录。';
  $('wtGoLogin').textContent = unknown ? '重试' : '去登录';
  $('wtGoLogin').dataset.act = unknown ? 'retry' : '';
  $('wtGoLogin').disabled = !unknown && !Water.configured();
  if (!unknown && !Water.configured()) $('wtNeedSub').textContent = '当前构建缺少航院通 0.52.0 参考配置。';
  // 进这一页就该看见一张能读的图。没有 key 才去要 —— 有 key 就说明
  // 刚才那张还没用过，换掉反而让用户白读一次。
  if (WT.loginKind && !WT.key) wtNewCaptcha();
}

/** 直饮水「还没连上」的那一行。
 *  🔴 只讲**要做的事**：去哪登、登完能看什么。四张卡里各自那句
 *     「没读到：要用「设备登录」那个账号……」是同一件事的四个副本，
 *     它们占的高度正是这一页在真机上要滑的那 50px。 */
function wtPaintOffNote() {
  const el = $('wtOffNote');
  if (!el) return;
  const off = !WT.accounts.device;
  WT.offNote = off;
  el.hidden = !off || WT.expired;
  el.textContent = off
    ? '饮水还没连，去「账号管理」登设备账号。'
    : '';
}

function wtShowOn() {
  WT.expired = false;
  wtPaintAccounts();
  wtPaintOffNote();
  $('waterOff').hidden = !WT.loginKind;
  $('waterOn').hidden = false;
  $('jctWaterRefresh').hidden = false;
  $('wtNeedLogin').hidden = true;
  $('wtExpired').hidden = true;
  // 手机号打码：屏幕可能被别人看到，截图也会外传。露头尾够自己认就行
  // （和 maskUid 同一个理由）。
  const dev = WT.accounts.device;
  WT.phone = (dev && dev.phone) || '';
  // 右边这格是「这个号」。没登设备账号时写「未登录」，不写「—」：
  // 一个破折号在这一行看起来像「功能坏了」，而它其实是「还没登」。
  $('wtPhoneShown').textContent = WT.phone ? wtMaskPhone(WT.phone) : '未登录';
}

/** 画两行账号。**哪一行没登就说清缺它少什么** —— 只说「未登录」等于没说。
 *
 *  🔴 这张卡**永远显示**，包括一个账号都没登的时候。
 *     0.26.2 第一版写的是「有账号或有 loginKind 才显示」，结果
 *     「一个都没登」时卡片藏着、表单也藏着 ⇒ 整页只剩一个标题，
 *     用户找不到任何能点的地方（而且不报错）。
 *     它本来就是「哪半功能缺账号」的唯一说明处，藏起来等于把说明书藏了。 */
function wtPaintAccounts() {
  const dev = WT.accounts.device, sco = WT.accounts.score;
  if (typeof wtPaintOffNote === 'function') wtPaintOffNote();
  window.renderServiceAccounts?.();
}

/** 138****5678。太短的不打码（打完全看不出是什么了）。 */
function wtMaskPhone(p) {
  const s = String(p || '').replace(/\s+/g, '');
  if (s.length < 7) return s;
  return s.slice(0, 3) + '****' + s.slice(-4);
}

/** 登录过期。数据留着（能留的都留着），只把「要重登」这件事摆到最上面 ——
 *  整块换成登录表单的话，用户看到的是「数据没了」，其实只是票过期了。
 *
 *  🔴 **这一张卡是唯一的声音**：不把服务端那句「登录状态过期了，要重新登录
 *     一次」再拼进来 —— 拼出来是「…要重新登录一次。重新登录一次就行…」，
 *     同一句话说两遍。而且余额和设备那两处也不再加红字，否则同屏三遍。
 *     固定的文案写在 index.html 的 `.sub` 里，这里只管显示。 */
const expiredAccounts = new Set();
const verifiedAccounts = new Set();

function wtExpire(kind) {
  if (kind) {
    expiredAccounts.add(kind);
    verifiedAccounts.delete(kind);
  }
  window.renderServiceAccounts?.();
  WT.expired = true;
  // 🔴 必须点名是哪个账号。两个账号各管一半：只写「登录过期了」，
  //    用户重登了另一个回来还是这一句 —— 2026-11-08 就是这么转圈的。
  WT.expiredKind = (kind === 'device' || kind === 'score') ? kind : '';
  const k = WT.expiredKind;
  const name = k === 'device' ? '设备账号' : (k === 'score' ? '积分账号' : '');
  $('wtExpiredTitle').textContent = name ? (name + '登录过期了') : '登录过期了';
  $('wtExpiredSub').textContent = name
    ? (k === 'device'
        ? '接水、余额要用它，重新登一次就恢复，别的都不用动。'
        : '积分、任务要用它，重新登一次就恢复，别的都不用动。')
    : '隔一段时间会失效，重登一次就行。';
  $('wtRelogin').textContent = name ? ('重登' + name) : '重新登录';
  $('wtExpired').hidden = false;
}

/** 画余额。🔴 `null` 走「没读到」，绝不兜底成 0。 */
function wtPaintBal() {
  const v = $('wtBalV'), tip = $('wtBalTip');
  if (typeof WT.bal === 'number' && isFinite(WT.bal)) {
    v.className = 'wtbal-v';
    // 金额只有两位小数，拼进 innerHTML 也安全；unit 单独一个 span 是为了
    // 让 ¥ 比数字小一号（和 iOS 的金额排版一致）。
    v.innerHTML = '<span class="unit">¥</span>' + WT.bal.toFixed(2);
  } else {
    v.className = 'wtbal-v unknown';
    // 🔴 0.52.1：没登设备账号 ≠ 读失败。以前两种情况都写「没读到」，
    //    可前者要人「去登录」、后者要人「重试」，该做的事相反。
    //    这一页顶上那句（wtOffNote）已经把「去哪登」说清楚了，这里只补状态。
    v.textContent = WT.accounts.device ? '没读到' : '登录后显示';
  }
  if (WT.balErr && !WT.expired && !WT.offNote) {
    tip.hidden = false;
    tip.classList.add('bad');
    tip.textContent = '余额没读到：' + WT.balErr;
  } else {
    tip.hidden = true;
    tip.classList.remove('bad');
    tip.textContent = '';
  }
  $('wtBalWhen').textContent = WT.loadedAt ? agoText(WT.loadedAt / 1000) + '更新' : '';
}

/** 画设备列表。🔴「一台都没有」和「没读到」必须分开说：
 *  前者要去慧生活798 里绑一台，后者是网络/接口问题 —— 该做的事完全不同。 */
/* --------------------------------------- 手动添加的设备（0.28.1）
 * 场景：教学楼的机器不在「我的设备」里，扫一下二维码就知道它是哪台。
 *
 * 🔴 归一是照原版 `DeviceIdParser.normalize()` **逐条**抄的：
 *      · 先 URL-decode 一次（二维码里常常是编码过的）
 *      · 键值形式：`?did=xxx` / `&deviceId:xxx` / `{"id":"xxx"}`
 *      · hnkzy.com 的路径里取最后一段 8~32 位纯数字
 *      · 路径里有 device/did/bind/q/qr 这类标记时，取标记**之后**那段
 *        （6~64 位字母数字，而且**必须含数字** —— 纯字母的 "bind" 不算编号）
 *      · 都没有就把整串当设备号
 *    ⚠️ `_lab/out/check_device_id.py` 拿一张表钉着这套规则，改一边必须改另一边。
 *
 * 🔴 **不扫相机**：WebView 读相机要额外的二维码解码库 + 相机权限（那会在
 *    第一次接水时弹一个「允许使用相机」，为了一件偶尔才做的事不值得），
 *    而系统相机本来就会读二维码，复制过来是同一个结果。
 */
const WT_DEV_KEY = 'wt.devs.local';
/* 0.37.0：自己起的名字。服务端那几台的名字是慧生活798 里的设备名（常常是
   「3号机」这种），楼里好几台都叫这个。这里存的是**本机别名**，只覆盖显示，
   不发给服务端 —— 我们没有改名的接口，假装改了只会让下次刷新白回来。 */
const WT_NAME_KEY = 'wt.names.local';
/* 0.37.0：「在本机隐藏」。服务端绑的那几台删不掉（删了下次刷新又回来），
   但用户可能就是想让它别占这一行 —— 记在本地，不画出来，随时能恢复。 */
const WT_HIDE_KEY = 'wt.hide.local';

function wtLocalDevs() {
  const a = store.get(WT_DEV_KEY, []);
  return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x) : [];
}

/** 本机别名表。键是设备编号，值是最多 20 字的显示名。 */
function wtNames() {
  const o = store.get(WT_NAME_KEY, {});
  if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
  const out = {};
  Object.keys(o).forEach((k) => {
    if (typeof o[k] === 'string' && o[k]) out[k] = o[k];
  });
  return out;
}

function wtSetName(id, name) {
  const o = wtNames();
  if (name) o[id] = String(name).slice(0, 20);
  else delete o[id];
  store.set(WT_NAME_KEY, o);
}

function wtHidden() {
  const a = store.get(WT_HIDE_KEY, []);
  return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x) : [];
}

function wtHideDev(id) {
  const a = wtHidden();
  if (a.indexOf(id) < 0) a.push(id);
  store.set(WT_HIDE_KEY, a.slice(-50));
}

function wtUnhideAll() {
  store.set(WT_HIDE_KEY, []);
}

function wtSaveLocalDev(id) {
  const a = wtLocalDevs();
  if (a.indexOf(id) < 0) a.push(id);
  // 只留最近 20 个：这是「快捷入口」，不是通讯录。旧的不清会一直涨。
  store.set(WT_DEV_KEY, a.slice(-20));
  // 重新加回来的时候顺手从「已隐藏」里摘掉 —— 不然加了却看不见，
  // 用户只会以为「加失败了」（这两件事都不报错）。
  const h = wtHidden().filter((x) => x !== id);
  store.set(WT_HIDE_KEY, h);
}

function wtDropLocalDev(id) {
  store.set(WT_DEV_KEY, wtLocalDevs().filter((x) => x !== id));
}

function wtDevFromUrl(value) {
  let u = null;
  try { u = new URL(value); } catch (e) { return ''; }
  const scheme = String(u.protocol || '').replace(':', '').toLowerCase();
  if (scheme !== 'http' && scheme !== 'https' && scheme !== 'ilife'
      && scheme !== 'hyt') return '';
  const dec = (v) => { try { return decodeURIComponent(v); } catch (e) { return v; } };
  const segs = String(u.pathname || '').split('/')
    .map(dec).map((x) => x.trim()).filter(Boolean);
  if (!segs.length) return '';
  // 我们自己的贴纸（0.52.0 v7）：hyt://water/<编号>。
  // 不走下面那套「找关键词、再找 8~32 位数字」的启发式 —— 这个地址是我们
  // 自己写上去的，格式确定，按确定格式解比猜准。机器上的二维码那种
  // 各家平台格式不一，才需要猜。
  if (scheme === 'hyt') {
    if (String(u.hostname || '').toLowerCase() !== 'water') return '';
    return String(segs[segs.length - 1] || '').slice(0, 64);
  }
  const strong = (v) => /^\d{8,32}$/.test(v);
  const flex = (v) => /^[A-Za-z0-9][A-Za-z0-9_-]{5,63}$/.test(v) && /\d/.test(v);
  const host = String(u.hostname || '').toLowerCase();
  if (host === 'hnkzy.com' || host.endsWith('.hnkzy.com')) {
    for (let i = segs.length - 1; i >= 0; i -= 1) if (strong(segs[i])) return segs[i];
  }
  const MARK = ['device', 'devices', 'did', 'bind', 'binding', 'q', 'qr'];
  let idx = -1;
  for (let i = segs.length - 1; i >= 0; i -= 1) {
    if (MARK.indexOf(segs[i].toLowerCase()) >= 0) { idx = i; break; }
  }
  if (idx >= 0) {
    for (let i = segs.length - 1; i > idx; i -= 1) if (flex(segs[i])) return segs[i];
  }
  const last = segs[segs.length - 1];
  return strong(last) ? last : '';
}

/** 二维码内容 / 手动输入 → 设备编号。认不出就返回空串（**不编一个**）。 */
function wtNormDevice(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  try { s = decodeURIComponent(s); } catch (e) { /* 不是编码过的，原样用 */ }
  const KEY = /(?:[?&#;,\s{]|^)["']?(?:did|deviceId|device_id|id)["']?\s*(?:=|:)\s*["']?([^&#\/,}\s"']+)/i;
  const m = KEY.exec(s);
  let got = m ? m[1] : '';
  if (!got) got = wtDevFromUrl(s);
  if (!got) got = s;
  got = got.trim();
  // 原版是 removeSurrounding("\"") 再 removeSurrounding("'")：**两端都有**才去掉，
  // 只有一端不动；而且两步是**先后**做的（'"abc"' 会先掉双引号再掉单引号）。
  const rm = (v, q) => (v.length >= 2 && v[0] === q && v[v.length - 1] === q)
    ? v.slice(1, -1) : v;
  got = rm(rm(got, '"'), "'");
  // 同样两步、同样区分大小写：原版只认 "did:" 和 "DID:" 这两种写法。
  if (got.slice(0, 4) === 'did:') got = got.slice(4);
  else if (got.slice(0, 4) === 'DID:') got = got.slice(4);
  return got.slice(0, 160);
}

/** 服务端设备 + 本机手动添加的，按 id 去重（服务端优先，名字更准）。
 *  0.37.0：再过两道本机的闸 —— 别名覆盖、已隐藏的不画。 */
function wtDevRows() {
  const server = Array.isArray(WT.devs) ? WT.devs : [];
  const names = wtNames(), hide = wtHidden();
  const out = [], seen = {};
  server.forEach((d) => {
    const id = String((d && d.id) || '').trim();
    if (!id || seen[id]) return;
    seen[id] = 1;
    out.push({ id: id, name: names[id] || (d && d.name) || '', local: false });
  });
  wtLocalDevs().forEach((id) => {
    if (seen[id]) return;
    seen[id] = 1;
    out.push({ id: id, name: names[id] || '', local: true });
  });
  return out.filter((d) => hide.indexOf(d.id) < 0);
}

/** 被隐藏了几台。**只数还在列表里的那些** —— 设备早就不在服务端了
 *  （在慧生活798 里解绑了），隐藏记录还留着的话，这个数会一直虚高。 */
function wtHiddenCount() {
  const hide = wtHidden();
  if (!hide.length) return 0;
  const alive = {};
  (Array.isArray(WT.devs) ? WT.devs : []).forEach((d) => {
    const id = String((d && d.id) || '').trim();
    if (id) alive[id] = 1;
  });
  wtLocalDevs().forEach((id) => { alive[id] = 1; });
  return hide.filter((id) => alive[id]).length;
}

/** 存之前再看一眼：这一串**像不像**设备编号。
 *
 *  🔴 只挡「明显不是」的三种：整条链接（含 `/`）、一句话（含空白）、
 *     长得离谱（>64）。不设「至少几位数字」这种门槛 —— 门槛是编出来的，
 *     真设备号多长我们并不知道；而接水时服务端认不认，本来就是最终判据。
 *     之所以要挡，是因为扫到「官网二维码」时归一的结果就是整条 URL，
 *     存进去之后接水才报错，用户会以为是我们的问题。 */
function wtDevIdOk(id) {
  const s = String(id || '');
  if (!s || s.length > 64) return false;
  if (/[\/\s]/.test(s)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(s);
}

/** 「扫码」那枚图标：有相机就扫码，没有就直接给输入框。
 *  没有 `getUserMedia`（桌面浏览器、http 的网页版）时弹一个永远黑的浮层
 *  是最糟的选择 —— 用户只会以为坏了。 */
function wtAddDevStart() {
  if (wtScanReady()) { wtScanOpen(); return; }
  wtAddDev();
}

/** 「手动输入」那枚图标（0.37.0）：**不进相机**，直接要编号。
 *  和扫码分开是有必要的 —— 扫码那条路在没相机时会退化成输入框，但反过来
 *  不行：用户明确点了「手动输入」，再给他弹一次相机权限是答非所问。
 *  机器身上印的编号、同学发来的一串数字、二维码里的整段内容，都走这里。 */
async function wtAddDev() {
  const raw = await openInput('添加饮水机',
    '机器上印的编号，或者二维码里的那串内容',
    '设备编号', '添加');
  if (raw == null) return;                    // 点了取消
  const id = wtNormDevice(raw);
  if (!id) { toast('没读到内容，再贴一次'); return; }
  if (!wtDevIdOk(id)) { toast('这不是设备编号'); return; }
  wtSaveLocalDev(id);
  wtPaintDevs();
  toast('已添加');
}

/* ---- 扫码（0.31.0） --------------------------------------------------
   为什么自己解：系统相机确实能读二维码，但要用户「拍照→回相册→复制文字
   →切回来粘贴」，四步。这里点一下、对着码停半秒就好了。
   解码用 jsQR（见 jsqr.js），相机用 getUserMedia —— WebView 从 5.0 起就支持，
   前提是原生那边把相机权限批给网页（MainActivity.onPermissionRequest）。

   🔴 三条容易踩的：
     ① 关浮层必须 stop 轨道，否则相机一直开着、指示灯常亮，下次再开还会
        报「被占用」（NotReadableError）。
     ② 打开相机是异步的，等的过程中用户可能已经把浮层关了 ⇒ 拿到流之后
        要再确认一次浮层还在，不在就立刻掐掉。
     ③ 视频还没出画面时 videoWidth 是 0，往 canvas 上画会得到空图 ⇒ 每帧
        先看 videoWidth，画布尺寸也按它算。 */

const WT_SCAN = { stream: null, timer: 0, waitT: 0, last: '', cv: null };

/** 能不能扫。少任何一样都给粘贴那条路，不硬来。
 *  ⚠️ 这里**不再检查 `window.jsQR`** —— 它现在按需加载，点开扫码之前
 *     本来就不在。真正用之前会 `await wtLoadJsQR()`（见 wtScanOpen）。 */
function wtScanReady() {
  return !!(navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === 'function'
    && typeof document.createElement('canvas').getContext === 'function');
}

/** 把 jsQR 那个 250KB 的解析器装上。**只在点扫码时调**。
 *
 *  为什么从 <script> 里挪走（0.42.0）：它原来在首屏同步加载，于是每次冷启动
 *  都要先解析完这 250KB 才能继续 —— 而它只在「扫码加饮水机」用过一次。
 *  挪走之后启动少一段主线程时间；代价是第一次点扫码要多等它装一下，
 *  用「正在打开相机…」那句遮住就够了（相机本身也要几百毫秒才出画面）。
 *
 *  🔴 同一个 Promise 复用：连点两下不能注入两个 <script>。
 *     失败要**清掉缓存的 Promise**，否则一次失败之后永远不再重试。 */
let jsqrPromise = null;
function wtLoadJsQR() {
  if (window.jsQR) return Promise.resolve(true);
  if (jsqrPromise) return jsqrPromise;
  jsqrPromise = new Promise((done) => {
    const s = document.createElement('script');
    s.src = 'jsqr.js';
    s.async = true;
    s.onload = () => { done(!!window.jsQR); };
    s.onerror = () => { jsqrPromise = null; done(false); };
    document.head.appendChild(s);
  });
  return jsqrPromise;
}

function wtScanSay(msg) { $('wtScanTip').textContent = msg; }
/** 取景器正中间那句话。同一条信息放这儿比放底部 hint 更靠眼睛，
 *  但只放**状态**；怎么解决写在底部 hint 里。 */
function wtScanWait(msg) { $('wtScanWaitT').textContent = msg; }

/** 相机起不来时统一收尾：撤掉取景框，图标转红，把话说清楚。 */
function wtScanFail(head, why) {
  $('wtScan').classList.add('bad');
  $('wtScanWait').hidden = false;
  wtScanWait(head);
  wtScanSay(why);
}

async function wtScanOpen() {
  if (!$('wtScan').hidden) return;
  WT_SCAN.last = '';
  $('wtScan').hidden = false;
  $('wtScan').classList.remove('bad');
  $('wtScanWait').hidden = false;
  wtScanWait('正在打开相机…');
  wtScanSay('把二维码放进框里');

  // 解码器现在按需装（见 wtLoadJsQR 的注释）。**先装再开相机**：
  // 反过来就是相机已经亮了、却发现解不了码，用户会以为是相机坏了。
  // 装不上也不报「出错」—— 说清楚还有另一条路就行。
  if (!(await wtLoadJsQR())) {
    if (!$('wtScan').hidden) {
      wtScanFail('这台设备现在扫不了码', '用下面「粘贴二维码内容」添加，效果一样。');
    }
    return;
  }
  // 装脚本这段时间用户可能已经把浮层关了。相机不许开（开了也没人看，
  // 还亮着指示灯）。
  if ($('wtScan').hidden) return;

  // 🔴 5 秒没动静就把话说清楚。
  //    有些机器上 getUserMedia 会**一直不 resolve**（系统权限框被吞掉、
  //    WebView 没把请求交出去），表现就是永远停在「正在打开相机…」。
  //    这里**不 reject、也不放弃**：用户之后点了「允许」，画面照样会来；
  //    只是别让他在那 5 秒之后还以为「再等等就好」。
  const slow = setTimeout(() => {
    if (WT_SCAN.stream) return;
    wtScanFail('相机还没起来', '可能没给相机权限。用不了就点下面粘贴。');
  }, 5000);

  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },   // 手机上有后置就用后置
      audio: false,
    });
  } catch (e) {
    clearTimeout(slow);
    // 「没给权限」和「没有相机」要说不同的话：一种能去设置里打开，
    // 另一种只能换个办法。
    const n = (e && e.name) || '';
    if (n === 'NotAllowedError' || n === 'SecurityError') {
      wtScanFail('没给相机权限',
        '去「设置 → 应用 → 航院通」打开相机权限，或点下面粘贴。');
    } else if (n === 'NotFoundError') {
      wtScanFail('这台设备没有相机', '用「粘贴二维码内容」添加，效果一样。');
    } else {
      wtScanFail('相机打不开',
        '可能被别的 App 占着。关掉那个再试，或者点下面粘贴。');
    }
    return;                                     // 浮层留着，「粘贴」在下面
  }
  clearTimeout(slow);

  // ① 等相机的这段时间里浮层可能已经被关了
  if ($('wtScan').hidden) {
    stream.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} });
    return;
  }

  WT_SCAN.stream = stream;
  const v = $('wtScanV');
  v.srcObject = stream;
  try { await v.play(); } catch (e) { /* 静音自动播放；个别 WebView 仍会拒，下面按帧等画面 */ }

  // ② 拿到流 ≠ 有画面（有些机器要一两秒才出第一帧）。
  //    以 videoWidth 为准再撤占位层，不然会先闪一下黑，再出现那个大三角。
  const show = () => {
    if (WT_SCAN.stream !== stream) return;
    if (!v.videoWidth) return;
    $('wtScanWait').hidden = true;
    $('wtScan').classList.remove('bad');
    wtScanSay('把二维码放进框里');
    if (WT_SCAN.waitT) { clearInterval(WT_SCAN.waitT); WT_SCAN.waitT = 0; }
  };
  show();
  WT_SCAN.waitT = setInterval(show, 120);

  WT_SCAN.timer = setInterval(wtScanTick, 160);
}

/** 关相机。**幂等**：没开的时候调用什么也不做。 */
function wtScanStop() {
  if (WT_SCAN.timer) { clearInterval(WT_SCAN.timer); WT_SCAN.timer = 0; }
  if (WT_SCAN.waitT) { clearInterval(WT_SCAN.waitT); WT_SCAN.waitT = 0; }
  const s = WT_SCAN.stream;
  WT_SCAN.stream = null;
  if (s) {
    try { s.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} }); } catch (e) {}
  }
  const v = $('wtScanV');
  try { v.pause(); } catch (e) {}
  try { v.srcObject = null; } catch (e) {}
  $('wtScan').hidden = true;
  // 下一次打开要回到干净状态：失败态的「bad」不能带过去，
  // 否则第二次点「添加设备」会先闪一屏红字。
  $('wtScan').classList.remove('bad');
  $('wtScanWait').hidden = false;
  wtScanWait('正在打开相机…');
  WT_SCAN.last = '';
  wtScanSay('把二维码放进框里');
}

/** 每帧：缩到 640 宽再解。手机原图 1280 宽，jsQR 要扫全部像素，
 *  不缩的话低端机上会掉到每秒几帧、还费电；二维码不需要那么细。 */
function wtScanTick() {
  const v = $('wtScanV');
  if (!v || !v.videoWidth) return;              // ③ 还没出画面
  const w = v.videoWidth, h = v.videoHeight;
  const sc = Math.min(1, 640 / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc));
  if (!WT_SCAN.cv) WT_SCAN.cv = document.createElement('canvas');
  const cv = WT_SCAN.cv;
  if (cv.width !== cw) cv.width = cw;
  if (cv.height !== ch) cv.height = ch;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(v, 0, 0, cw, ch);
  let img = null;
  try { img = g.getImageData(0, 0, cw, ch); } catch (e) { return; }
  // 解码器还没装好（或者装失败）就先不认这一帧 —— 相机照常显示，
  // 用户看得见自己在拍什么，不会以为是死界面。
  if (!window.jsQR) return;
  let r = null;
  try {
    r = window.jsQR(img.data, cw, ch, { inversionAttempts: 'dontInvert' });
  } catch (e) { return; }
  if (r && r.data) wtScanTaken(r.data);
}

/** 解出一条码。认不出是设备就**留在相机里**继续扫，只改提示那句。 */
function wtScanTaken(raw) {
  const text = String(raw || '').trim();
  if (!text || text === WT_SCAN.last) return;   // 同一帧会连着解出好几次
  WT_SCAN.last = text;
  const id = wtNormDevice(text);
  if (!wtDevIdOk(id)) { wtScanSay('这不是饮水机的码'); return; }
  wtScanStop();
  wtSaveLocalDev(id);
  wtPaintDevs();
  toast('已添加');
}

/** 移到后台（切 App、锁屏）就关相机：前台服务都没开，凭什么开着摄像头。 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !$('wtScan').hidden) wtScanStop();
});

/* ---- 设备行的「⋯」（0.37.0）----------------------------------------
 * 以前：手动加的那几台有一颗 ✕，服务端绑的那几台**什么都没有** ——
 * 同一行左边一个样右边一个样，看着像「这几台不是我的」。
 * 现在每台都有同一个「⋯」，点开三件事：重命名 / 复制编号 / 移除。
 *
 * 🔴 三件事都**只动本机**，一件都不往服务端发：
 *      · 改名 —— 没有改名接口，发了也没用；
 *      · 复制 —— 只是把编号放进剪贴板，方便发给同学；
 *      · 移除 —— 手动加的删记录，服务端绑的记「本机隐藏」。
 *    服务端那几台真删不掉（下次刷新会回来），所以文案必须说「隐藏」，
 *    说「删除」就是在骗人。
 */

/** 复制到剪贴板。返回是否成功。
 *
 *  🔴 用 `execCommand` 而不是 `navigator.clipboard`：后者要求**安全上下文**，
 *     而 APK 里的页面源是 `https://app.local` —— 不是每个 ROM 都认它是安全的。
 *     认不出时 clipboard 直接 undefined，调用就抛，而且**没有任何提示**。
 */
function wtCopy(text) {
  const s = String(text || '');
  if (!s) return false;
  try {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;'
      + 'opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, s.length);
    const ok = document.execCommand ? document.execCommand('copy') : false;
    document.body.removeChild(ta);
    if (ok) return true;
  } catch (e) { /* 落到下面 */ }
  return false;
}

/** 改名。清空再保存 = 恢复原名（服务端给的那个 / 「手动添加的饮水机」）。 */
async function wtRenameDev(row) {
  const v = await openInput('重命名',
    '只改这台手机上的显示，慧生活798 里的设备名不变',
    '给这台起个名字', '保存', row.name || '');
  if (v == null) return;
  const name = String(v).trim().slice(0, 20);
  wtSetName(row.id, name);
  wtPaintDevs();
  toast(name ? '已重命名' : '已恢复原名');
}

/** 复制编号。复制不了就把编号摊开让用户自己长按 —— 不能只说一句「失败」。 */
async function wtCopyDev(row) {
  if (wtCopy(row.id)) { toast('已复制编号'); return; }
  await openInput('复制编号', '长按下面这串选中，再复制', '', '好', row.id);
}

/** 移除。手动加的删记录，服务端绑的只在本机隐藏。
 *
 *  0.44.0：确认从「底部弹层」改成**气泡**（popconfirm），就地长在「⋯」旁边。
 *  两句话还是原来那两句 —— 服务端那几台真删不掉（下次刷新会回来），
 *  所以文案必须说「隐藏」，说「删除」就是骗人。
 */
function wtRemoveDev(row, anchor) {
  const local = !!row.local;
  const title = local ? '移除这台设备？' : '在这台手机上隐藏？';
  const sub = local
    ? '移除后要接水得重新贴一次二维码'
    : '它还在你的慧生活798 名下，随时能恢复。';
  const yes = local ? '移除' : '隐藏';
  wtPopShow(anchor,
    '<div class="wtpop-t">' + esc(title) + '</div>' +
    '<div class="wtpop-s">' + esc(sub) + '</div>' +
    '<div class="wtpop-btns">' +
      '<button class="wtpop-btn" data-no>取消</button>' +
      '<button class="wtpop-btn danger" data-yes>' + esc(yes) + '</button>' +
    '</div>',
    (el, close) => {
      el.querySelector('[data-no]').addEventListener('click', close);
      el.querySelector('[data-yes]').addEventListener('click', () => {
        close();
        if (local) wtDropLocalDev(row.id);
        else wtHideDev(row.id);
        wtPaintDevs();
      });
    });
}

/* ---------------- 气泡菜单 / 气泡确认（0.44.0） ----------------
 *
 * 用户 2026-11-03：「饮水机右侧那三个点，点击后不要在底部出现弹窗，
 * 改成 popconfirm 这种气泡确认框」。
 *
 * 🔴 为什么底部弹层在这里是错的：点的是列表第三行的「⋯」，弹层却从**屏幕
 *    另一头**升起来，还盖住整页 ——「我在这一行点的东西，怎么跑到下面去了」
 *    是人的第一反应。气泡贴在按钮旁边，源头和结果在同一个地方。
 *
 * 🔴 只做「就地变成问句」，不做整页确认：点「在本机隐藏」时，菜单原地换成
 *    一行问句 + 取消/隐藏。**不换一屏、不改变位置** —— 换屏的话，用户刚要
 *    点的位置变成了别的东西，误触就是一次不可撤销的操作。
 */
// ⚠️ 用 `var` 而不是 `let`：switchTab 在文件更靠前的位置就要能安全地调
//    wtPopClose（换页时关气泡）。`let` 在那一行执行之前是 TDZ，调用即抛。
var wtPop = null;      // { el, down, key, scroll }

/** 关掉当前气泡。重复调用是空操作。 */
function wtPopClose() {
  if (!wtPop) return;
  const p = wtPop;
  wtPop = null;
  document.removeEventListener('pointerdown', p.down, true);
  document.removeEventListener('keydown', p.key, true);
  window.removeEventListener('scroll', p.scroll, true);
  window.removeEventListener('resize', p.scroll);
  if (p.el && p.el.parentNode) p.el.parentNode.removeChild(p.el);
}

/** 在 anchor 旁边开一个气泡。html 是内容，bind(el) 负责绑事件。
 *
 *  ⚠️ 位置一律**夹在屏幕内**：贴着右边缘那一颗「⋯」如果右对齐再往外长，
 *     在窄屏上会有一半跑到屏幕外 —— 而它是 fixed 定位，跑出去就点不到了。
 */
function wtPopShow(anchor, html, bind) {
  wtPopClose();
  if (!anchor || !anchor.getBoundingClientRect) return;
  const el = document.createElement('div');
  el.className = 'wtpop jct-water';
  el.innerHTML = html;
  document.body.appendChild(el);

  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  // 右边缘对齐按钮，再夹进屏幕
  let left = r.right - w;
  if (left < 8) left = 8;
  if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
  // 优先朝下；下面放不下就翻到上面去
  let top = r.bottom + 6, up = false;
  if (top + h > window.innerHeight - 8) {
    const above = r.top - h - 6;
    if (above >= 8) { top = above; up = true; }
    else { top = Math.max(8, window.innerHeight - h - 8); }
  }
  el.style.left = Math.round(left) + 'px';
  el.style.top = Math.round(top) + 'px';
  el.classList.toggle('up', up);

  // 点外面 / 按 Esc / 滚动 —— 三条路都能关。滚动必须关：
  // 气泡是 fixed 的，页面一滚它就悬在别的行上面，指着一台不相干的设备。
  const down = (e) => { if (!el.contains(e.target)) wtPopClose(); };
  const key = (e) => { if (e.key === 'Escape') wtPopClose(); };
  const scroll = () => { wtPopClose(); };
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('keydown', key, true);
  window.addEventListener('scroll', scroll, true);
  window.addEventListener('resize', scroll);

  wtPop = { el, down, key, scroll };
  if (typeof bind === 'function') bind(el, wtPopClose);
  return el;
}

/** 点「⋯」弹出的气泡菜单。
 *
 *  三件事都**只动本机**，一件都不往服务端发（见上面那段老注释）。
 *  选「在本机隐藏 / 移除」时，气泡**就地**变成确认问句（popconfirm）。
 */
function wtDevMenu(row, anchor) {
  const pick = (id) => {
    wtPopClose();
    if (id === 'rename') wtRenameDev(row);
    else if (id === 'copy') wtCopyDev(row);

    else if (id === 'remove') wtRemoveDev(row, anchor);
  };
  const items = [
    { id: 'rename', name: '重命名' },
    { id: 'copy', name: '复制编号' },
    // 碰一碰（0.52.0 v7）：把贴纸写成这台机器。只在 APK 里有 —
    // 网页版没有 NFC，摆一颗点了只会说「用不了」的菜单项是骗人。
    // 位置在「移除」**上面**：下面那颗是不可撤销的那类操作。
  ].concat([
    { id: 'remove', name: row.local ? '移除' : '在本机隐藏', danger: true },
  ]);
  wtPopShow(anchor,
    items.map((it) =>
      '<button class="wtpop-i' + (it.danger ? ' danger' : '') +
      '" data-act="' + escAttr(it.id) + '">' + esc(it.name) + '</button>').join(''),
    (el) => {
      el.querySelectorAll('[data-act]').forEach((b) => {
        b.addEventListener('click', () => pick(b.dataset.act));
      });
    });
}

function wtPaintDevs() {
  const box = $('wtDevs'), tip = $('wtDevTip'), n = $('wtDevN');
  const devs = wtDevRows();
  const hid = wtHiddenCount();
  // 卡头的台数。**读到 0 台时不写「0 台」** —— 那种情况下面的提示文字
  // 已经在说「还没绑」，卡头再喊一句 0 台是同一个坏消息说两遍。
  if (n) n.textContent = devs.length > 1 ? (devs.length + ' 台') : '';
  if (devs.length) {
    // 正在接水的那一台：按钮原地变成「停止」（红色），名字下面多一行小字。
    // 2026-11-10 之前这条是页面顶部单独一条 `#wtLive`（用户：「不要在顶部
    // 单独显示退出，直接把接水按钮换成退出就行了」）。
    const liveDid = (WT.live && WT.live.did) || '';
    box.innerHTML = devs.map((d) => {
      const on = !!liveDid && liveDid === d.id;
      return '<div class="wtdev">' +
        // 0.49.0：设备编号不再显示。用户 2026-11-07：「我的饮水机在饮水机名字
        // 底下的编号不要显示出来，看着很乱」。
        // 🔴 只是不画出来，`data-did` 照样带着真正的编号 —— 接水和菜单都靠它。
        '<span class="wtdev-main' + (on ? ' has-sub' : '') + '">' +
          '<span class="wtdev-name">' + esc(d.name || '手动添加的饮水机') + '</span>' +
          (on ? '<span class="wtdev-sub">' + esc(wtLiveText()) + '</span>' : '') +
        '</span>' +
        '<button class="wtdev-go' + (on ? ' stop' : '') + '" data-did="' + escAttr(d.id) + '"' +
        ' data-name="' + escAttr(d.name || '') + '"' +
        (on ? ' aria-label="停止接水"' : '') + '>' +
        (on ? (wtStopping ? '正在停…' : '停止') : '接水') + '</button>' +
        // 「⋯」放在**最右**：菜单本来就在行尾，而「接水」要是被挤到边上，
        // 主操作就只剩 2px 的余量贴着卡片边缘。
        '<button class="wtdev-more" data-more="' + escAttr(d.id) + '"' +
        ' aria-label="更多操作">' +
          '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.7"/>' +
          '<circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>' +
        '</button>' +
      '</div>';
    }).join('');
    // innerHTML 会把旧节点连同监听一起扔掉 ⇒ 每次重画都重新绑一遍。
    // 不重绑的话第二次进来点了没反应，而且**不报错**。
    // 同一颗按钮两种身份：`.stop` 的是「停这次水」，其余是「接水」。
    box.querySelectorAll('button[data-did]').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.classList.contains('stop')) wtStop();
        else wtStart(b.dataset.did, b.dataset.name);
      });
    });
    box.querySelectorAll('button[data-more]').forEach((b) => {
      b.addEventListener('click', () => {
        const row = wtDevRows().filter((x) => x.id === b.dataset.more)[0];
        // 0.44.0：把**这颗按钮**传下去当锚点 —— 气泡要长在它旁边。
        if (row) wtDevMenu(row, b);
      });
    });
  } else {
    box.innerHTML = '';
  }

  // 「已隐藏 N 台」那一行：**只在本机真藏了东西时出现**。
  const showRow = $('wtDevShow'), showN = $('wtDevHideN');
  if (showRow) {
    showRow.hidden = !hid;
    if (hid && showN) showN.textContent = hid + ' 台 · 恢复';
  }

  if (WT.devErr && !WT.expired) {
    tip.hidden = false;
    tip.classList.add('bad');
    tip.textContent = '设备列表没读到：' + WT.devErr;
  } else if (!devs.length && !WT.expired && !hid) {
    // ⚠️ 全部被隐藏时**不说「还没有绑定」** —— 那是「没有」和「被我藏了」
    //    两件不同的事，说错了用户会去慧生活798 重新绑一台。
    tip.hidden = false;
    tip.classList.remove('bad');
    // 一句话说完。原来那句「要在慧生活798 里先绑一台，绑完这里就能看到」
    // 换行成两行，多占 20px —— 而「去哪儿绑」下面那颗「添加设备」已经说了。
    tip.textContent = '这个账号名下还没有绑定饮水机，去慧生活798 绑一台。';
  } else {
    tip.hidden = true;
    tip.classList.remove('bad');
    tip.textContent = '';
  }

  // 🔴 0.40.0：一台设备都没有的时候，「接水会真的出水扣钱；充值、绑一卡通
  //    去慧生活798 里做。」这句没有对象 —— 没有设备就接不了水，而上面那行
  //    提示已经在说「还没有绑定，去慧生活798 绑一台」。这 22px 换成一句
  //    读不通的话，正是这一页在「刚装好、什么都还没登」时多出来的高度。
  //    有设备时它永远在（风险告知不能省）。
  const risk = $('wtRisk');
  if (risk) risk.hidden = !devs.length;
}

/** 拉一次余额 + 设备。
 *  🔴 这两件事**分开报错**：一个挂了不该把另一个也变成「读不到」，
 *    也不许安静吞掉（「没读到」和「没有」是两件事）。后端已经是这个形状，
 *    这里只负责照着画。 */
async function wtLoad() {
  // 0.27.0：页头只剩一颗刷新（直饮水并进功能页了），忙态挂在它身上。
  // 🔴 只能加 class，**不能设 disabled** —— 这颗按钮现在同时管「刷门户」，
  //    接水那边一请求它就灰掉的话，用户想刷一卡通会点不动（而且不报错）。
  const btn = $('jctWaterRefresh');
  if (btn) btn.classList.add('busy');
  try {
    const r = await api('/api/water/home');
    if (!r || !r.ok) {
      // auth 是唯一需要换页面状态的：其余错误就地把话说清楚
      if (r && r.kind === 'auth') { wtExpire('device'); }
      WT.bal = null;
      WT.balErr = (r && r.error) || '读不到';
      WT.devErr = (r && r.error) || '读不到';
      wtPaintBal();
      wtPaintDevs();
      return;
    }
    WT.expired = false;      // 读到了 ⇒ 票是好的，把过期标记清掉
    if (!r.balanceError || !r.devicesError) {
      expiredAccounts.delete('device');
      verifiedAccounts.add('device');
      window.renderServiceAccounts?.();
    }
    WT.bal = (typeof r.balance === 'number' && isFinite(r.balance)) ? r.balance : null;
    WT.balErr = r.balanceError || '';
    WT.devs = Array.isArray(r.devices) ? r.devices : [];
    WT.devErr = r.devicesError || '';
    WT.loadedAt = Date.now();
    wtPaintBal();
    wtPaintDevs();
  } catch (e) {
    WT.bal = null;
    WT.balErr = e.message;
    WT.devErr = e.message;
    wtPaintBal();
    wtPaintDevs();
  } finally {
    if (btn) btn.classList.remove('busy');
  }
}

/* ---- 0.24.0：积分 / 积分任务 / 消费记录 ----------------------------
   三块各自独立拉、各自独立报错。合成一次请求的话，任务接口挂了余额也会
   跟着变「没读到」，用户会以为账号出问题 —— 而该做的事完全不同。

   🔴 全部守同一条：`null` ≠ `0`。
      积分没读到写「没读到」，金额没读到写「金额没读到」，
      绝不写 0 分 / ¥0.00 —— 前者像「今天没挣到」，后者像「这单免费」。 */

/** 画积分。两个数各自判断：一个读到、一个没读到，也要分开说。 */
function wtPaintScore() {
  const paint = (id, n) => {
    const el = $(id);
    if (typeof n === 'number' && isFinite(n)) {
      el.className = 'wtpair-v';
      el.textContent = String(n);
    } else {
      el.className = 'wtpair-v unknown';
      // 同 wtPaintBal：「积分账号没登」和「读失败」是两件事。
      // 积分归 score 那个账号管，所以看的是 accounts.score，不是 offNote。
      el.textContent = WT.accounts.score ? '没读到' : '登录后显示';
    }
  };
  const sc = WT.score;
  const vEl = $('wtScoreValid');
  paint('wtScoreValid', sc ? sc.valid : null);
  paint('wtScoreTotal', sc ? sc.total : null);

  // 跑任务的时候把「可用」写成 `35+25`：35 是开跑前读到的，+25 是这一轮
  // 已经挣到的（2026-11-08 用户要求）。用主色（和进度条同一个颜色），
  // 一眼能看出后半截是**这次新挣的**，不是余额里本来就有的。
  // 🔴 只在读到基础值、且这一轮真的挣到了分时才加 —— 基础值都没读到时
  //    写「没读到+25」是胡说。
  const gain = Number(WT.runGain) || 0;
  if (vEl && gain > 0 && typeof (sc && sc.valid) === 'number' && isFinite(sc.valid)) {
    const g = document.createElement('span');
    g.className = 'wtgain';
    g.textContent = '+' + gain;
    vEl.appendChild(g);
  }

  const tip = $('wtScoreTip');
  if (WT.scoreErr && !WT.expired && !WT.offNote) {
    tip.hidden = false;
    tip.classList.add('bad');
    tip.textContent = '积分没读到：' + WT.scoreErr;
  } else {
    tip.hidden = true;
    tip.classList.remove('bad');
    tip.textContent = '';
  }
  wtExPaint();
}

/* ---------------------------------------------------- 积分兑换余额（0.27.1）
 * 照出水小部件的 WalletActivity 做的同一件事：
 *   1000 积分 = ¥1，档位只有 100 / 1000，份数从 1 起，**一次提交**。
 *
 * 🔴 请求体只传**总积分**、不传份数（原版 `ScoreExchangeParserTest` 明确断言
 *    body 里没有 `count`）。份数是界面自己乘出来的。
 * 🔴 拿到账单号 ≠ 兑换完成：要再查一次 `bill.status === 3` 才算。
 * 🔴 任何一步失败都**不自动重试** —— 重试等于再扣一次积分。网络类失败连
 *    「到底扣没扣」都不知道，所以文案是「先别重复兑换」，不是「再试一次」。
 */
const WT_EX_UNITS = [100, 1000];

/** 档位 × 份数 = 这次要花的积分；不合法返回 null（**不兜底成 0**）。
 *
 *  和原版 `ScoreExchangeParser.totalScore` 逐条对应：档位只能是 100/1000，
 *  份数 ≥1，且不能超过「可用积分买得起的份数」。
 *  ⚠️ 这条规则**只写这一份** —— 网页版和 APK 跑的是同一份 app.js，
 *     没有第二份需要对齐（再写一份就是「各自合规、其实早已分叉」）。
 */
function wtExTotalOf(unit, qty, avail) {
  const u = Number(unit), q = Number(qty), a = Number(avail);
  if (avail == null || !isFinite(u) || !isFinite(q) || !isFinite(a)) return null;
  if (WT_EX_UNITS.indexOf(u) < 0) return null;
  if (q < 1 || a < 0) return null;
  if (q > Math.floor(a / u)) return null;
  return u * q;
}

/** 「全部兑换」能换几份：可用积分 ÷ 档位，向下取整。
 *  ⚠️ 读不到可用积分时返回 0（= 现在没得换），**不猜一个数** —— 猜大了
 *     提交上去只会被服务端拒，用户以为是按钮坏了。 */
function wtExMaxQty(unit, avail) {
  const u = Number(unit), a = Number(avail);
  if (!isFinite(u) || u <= 0 || !isFinite(a) || a < 0) return 0;
  return Math.floor(a / u);
}

/** 现在选中的钱包。没选过就用第一个（只有一个钱包时这是唯一的那个）。 */
function wtExCurWallet() {
  const ws = Array.isArray(WT.ex.wallets) ? WT.ex.wallets : [];
  if (!ws.length) return null;
  const hit = ws.filter((w) => w.endpointId === WT.ex.eid)[0];
  return hit || ws[0];
}

/** 画兑换那块。入口的显示条件由它自己成不成立决定（红线 50）：
 *  有可用积分、读到了钱包、没在读钱包的错误 —— 三条都满足才给入口。
 *  否则点进去只能说「没有钱包」，那是挖坑。 */
function wtExPaint() {
  const open = $('wtExOpen'), box = $('wtExBox');
  if (!open || !box) return;
  const ws = Array.isArray(WT.ex.wallets) ? WT.ex.wallets : [];
  const avail = (WT.score && typeof WT.score.valid === 'number') ? WT.score.valid : null;
  const can = ws.length > 0 && !WT.ex.err && avail != null && !WT.expired;
  open.hidden = !can;
  if (!can) { box.hidden = true; WT.ex.open = false; return; }
  box.hidden = !WT.ex.open;
  if (!WT.ex.open) return;

  const w = wtExCurWallet();
  // 多个钱包时这一行能点开选择器；只有一个时它就是标签 —— 箭头藏掉、按钮
  // 禁用。**不能**留一颗点了没反应的按钮（那比没有按钮更让人恼火）。
  const more = ws.length > 1;
  $('wtExWallet').textContent = (w && w.name) || '—';
  $('wtExChev').hidden = !more;
  $('wtExTo').disabled = !more;

  $('wtExUnits').querySelectorAll('.wtchip').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.unit) === WT.ex.unit);
  });
  $('wtExQty').textContent = String(WT.ex.qty);

  const total = wtExTotalOf(WT.ex.unit, WT.ex.qty, avail);
  const sum = $('wtExSum');
  if (total == null) {
    sum.textContent = '积分不够换这么多份。';
    sum.classList.add('bad');
  } else {
    sum.classList.remove('bad');
    // 1000 分 = ¥1，所以元 = 分 / 1000。留两位小数，别写成 ¥0.2000000001
    sum.textContent = '消耗 ' + total + ' 积分，兑 ¥' + (total / 1000).toFixed(2);
  }
  const go = $('wtExGo');
  go.disabled = total == null || WT.ex.busy;
  go.textContent = WT.ex.busy ? '兑换中…' : '兑换';
  // 「全部兑换」（0.44.0）。份数已经顶到上限时就没有意义了 —— 置灰，
  // 而不是让它点下去什么都不发生。
  const mx = $('wtExMax');
  if (mx) {
    const max = wtExMaxQty(WT.ex.unit, avail);
    mx.disabled = max < 1 || WT.ex.busy || max === WT.ex.qty;
  }
}

/** 「做完自动换成余额」开关的样子。默认开（老配置里没有这个键）。
 *  单独一个函数：任务卡每次重画都要调它，开关状态必须和 CFG 一致 ——
 *  两处各写一遍的话，会出现「关了但它还亮着」。 */
async function wtLoadWallets() {
  try {
    const r = await api('/api/water/wallets');
    if (!r || !r.ok) {
      WT.ex.wallets = null;
      WT.ex.err = (r && r.error) || '读不到';
    } else {
      WT.ex.wallets = Array.isArray(r.wallets) ? r.wallets : [];
      WT.ex.err = '';
      const cur = wtExCurWallet();
      WT.ex.eid = cur ? cur.endpointId : '';
    }
  } catch (e) {
    WT.ex.wallets = null;
    WT.ex.err = e.message;
  }
  wtExPaint();
}

/** 真正发那一次兑换请求。**只提交一次**，失败不重试。
 *
 *  抽出来是为了「全部兑换」和「做完自动换」共用同一段 —— 这段里有三条
 *  踩过坑的规矩（只提交一次 / 网络类失败说「结果未知，别重复兑换」/
 *  拿到账单号还要核 status === 3），抄第二份就一定会漏一条。
 *
 *  say(text) 是个可选的「进度播报」函数：手动兑换时写进面板，自动兑换时
 *  写进任务卡下面那行提示。
 *  返回 { done, text }。
 */
async function wtExSend(total, w, say) {
  const note = (typeof say === 'function') ? say : function () {};
  WT.ex.busy = true;
  wtExPaint();
  note('正在兑换…');

  let sn = '';
  try {
    const r = await api('/api/water/exchange', { eid: w.endpointId, score: total });
    if (!r || !r.ok) {
      // 🔴 网络类失败时**我们不知道扣没扣**。这时候让用户「再试一次」是最坏的
      //    建议（等于再扣一次），所以文案分开写。
      const netish = !r || !r.kind || r.kind === 'net' || r.kind === 'limit';
      WT.ex.busy = false;
      wtExPaint();
      return {
        done: false,
        text: netish
          ? '兑换结果未知：' + ((r && r.error) || '没连上') + '。先去官方 App 核一下记录，别重复兑换。'
          : wtErrText(r && r.kind, r && r.error),
      };
    }
    sn = r.sn;
  } catch (e) {
    WT.ex.busy = false;
    wtExPaint();
    return { done: false,
             text: '兑换结果未知：' + e.message + '。先去官方 App 核一下记录，别重复兑换。' };
  }

  // 拿到账单号只是「提交成功」。再查一次账单，status === 3 才算真的到账。
  note('已提交，正在核对…');
  const record = { id: sn, at: Date.now(), score: total, done: false };
  Water.rememberExchange(record);
  let done = false, why = '';
  try {
    const b = await api('/api/water/exchange-bill?id=' + encodeURIComponent(sn));
    if (b && b.ok) {
      done = !!b.done;
      if (done) Water.rememberExchange({ ...record, done: true });
      if (!done) why = '（账单状态 ' + b.status + '，还没完成）';
    } else {
      why = '（' + ((b && b.error) || '账单查不到') + '）';
    }
  } catch (e) {
    why = '（' + e.message + '）';
  }

  WT.ex.busy = false;
  wtExPaint();
  if (done) {
    // 余额和积分都变了 —— 两样都重读，别让界面停在旧数上
    if (WT.accounts.device) { wtLoad().catch(() => {}); }
    wtLoadScore().catch(() => {});
    return { done: true,
             text: '兑换完成：¥' + (total / 1000).toFixed(2) + ' 已到「' + w.name + '」。' };
  }
  return { done: false,
           text: '兑换结果待确认' + why + '。先去官方 App 核一下记录，别重复兑换。' };
}

/** 手动兑换：算总数 → 确认 → 发出去 → 把结果写在面板里。 */
async function wtExGo() {
  if (WT.ex.busy) return;
  const w = wtExCurWallet();
  if (!w) return;
  const avail = (WT.score && typeof WT.score.valid === 'number') ? WT.score.valid : null;
  const total = wtExTotalOf(WT.ex.unit, WT.ex.qty, avail);
  if (total == null) return;

  // 这是账号行为、会扣积分，还要真金白银地变成余额 —— 必须二次确认。
  const ok = await askConfirm('兑换积分',
    '用 ' + total + ' 积分兑换 ¥' + (total / 1000).toFixed(2)
      + ' 到「' + w.name + '」。兑换只能提交一次，中途出错不会自动重试。',
    '兑换');
  if (!ok) return;

  const msg = $('wtExMsg');
  msg.hidden = false;
  msg.classList.remove('bad');
  const r = await wtExSend(total, w, (t) => { msg.textContent = t; });
  msg.classList.toggle('bad', !r.done);
  msg.textContent = r.text;
}

/** 任务跑完之后把积分换成余额（0.44.0，默认开）。
 *
 *  🔴 三条不做的事：
 *    1. **不问**。这是用户自己开的开关，每次都弹一个框等于把开关废掉；
 *       而且这时候他正等着看「今天挣了多少」。
 *    2. **不猜金额**。可用积分读不到、钱包读不到、上一次兑换结果未知 ——
 *       一律不动手，只在下面那行提示里说清楚为什么没换。
 *    3. **不重试**。兑换失败就是失败，重试等于再扣一次（见 wtExSend）。
 *
 *  返回一句要接在任务结果后面的话；没换就是空串。
 */
async function wtLoadScore() {
  try {
    const r = await api('/api/water/score');
    if (!r || !r.ok) {
      if (r && r.kind === 'auth') { wtExpire(WT.accounts.score ? 'score' : 'device'); }

      WT.score = null;
      WT.scoreErr = (r && r.error) || '读不到';
    } else {
      if (WT.accounts.score) {
        expiredAccounts.delete('score');
        verifiedAccounts.add('score');
        window.renderServiceAccounts?.();
      }
      WT.score = {
        valid: (typeof r.valid === 'number' && isFinite(r.valid)) ? r.valid : null,
        total: (typeof r.total === 'number' && isFinite(r.total)) ? r.total : null,
      };
      WT.scoreErr = '';
    }
  } catch (e) {
    WT.score = null;
    WT.scoreErr = e.message;
  }
  wtPaintScore();
}

/** 画任务列表。
 *
 *  🔴 「还剩几次」是**自己算的** `limit - used`，响应里没有现成的剩余
 *     （`missions[i].limit` 是总次数，`accScoreRsp.limits[j].limit` 是已做次数，
 *      同名反义 —— 见 water.py 那一大段）。
 *
 *  🔴 按钮的显示条件是 `canRun`（有任务、没读失败）。0.26.0/0.26.1 那两版
 *     写的是「永远不显示，因为盐值没公开」—— 那个前提是错的（盐在官方 APK
 *     里，2026-10-30 取到）。现在签名自己算，不看响应里有没有 `sign`。
 */
/** 「这一页要跑的东西」= 签到（如果有）+ 全部积分任务。
 *
 *  🔴 只写**一处**。列表、计数、确认框、执行循环全部从这里拿 —— 0.26.2 就是
 *     列表和执行各写一遍，结果卡片写「共 3 个」、确认框写「2 个」（红线 59）。
 *  🔴 签到排第一行，因为它是每天必做的那一件；`kind` 决定用哪个请求体：
 *     签到 `{weekday, adId}` / 任务 `{adId, type:101}`。**不能混**（见 wtRunAll）。
 *  ⚠️ 服务端的任务列表里有时也会带一条「每日签到」（refId == daily.adId），
 *     先按 id 剔掉再补我们自己的那一行，否则会重复。
 */
/* ---------------- 今天做完的任务，记在本机（0.49.0） ----------------
 *
 * 用户 2026-11-07：「接水界面的今日任务，每天无论做了多少任务，再次打开都是
 * 待做 8 个」。
 *
 * 🔴 病根是状态只活在内存里：`WT.run` 是这一轮跑出来的，关掉 App 就清零；
 *    而服务端返回的「已做次数」并不总是跟着变（有缓存，也有平台自己没刷的时候）。
 *    两边都不记得 ⇒ 每次打开都是全新的一天，用户看着像白做。
 *
 * 所以按**日期**记一份在本机：今天是哪天、哪几条做完了、一共几条。
 * 换天整体作废 —— 昨天的「已完成」不能拿来标今天。
 * 它只影响界面上的「已完成」标记和「待做 N 个」的计数，**不影响真的会跑哪些**：
 * 真跑什么仍然由服务端给的剩余次数决定（见 wtRunnableRows）。
 */

/** 本机今天。用本地时区，不用 UTC —— `toISOString()` 会把 00:00-08:00 算成前一天。 */
function wtToday() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** 读今天那份记录。日期对不上（换天了）就返回一个空的，不写盘。 */
function wtDoneLoad() {
  const empty = { d: wtToday(), done: {}, total: 0 };
  try {
    const raw = localStorage.getItem('jct.water.wt.done');
    if (!raw) return empty;
    const o = JSON.parse(raw);
    if (!o || o.d !== empty.d) return empty;
    return {
      d: o.d,
      done: (o.done && typeof o.done === 'object') ? o.done : {},
      total: Number(o.total) || 0,
    };
  } catch (e) {
    return empty;
  }
}

function wtDoneSave(o) {
  try {
    localStorage.setItem('jct.water.wt.done', JSON.stringify(o));
  } catch (e) {
    // 存不下不影响这一次的使用，只是下次打开又不记得了。
  }
}

/** 这一条今天是不是已经做完了（本机记的）。 */
function wtDoneHas(refId) {
  if (!refId) return false;
  return !!wtDoneLoad().done[refId];
}

/** 记一条「今天做完了」。跑任务成功后立刻调，**不要等整轮跑完** ——
 *  中途停下 / 断网时，已经成功的那些也算数。 */
function wtDoneMark(refId, total) {
  if (!refId) return;
  const o = wtDoneLoad();
  o.done[refId] = 1;
  if (typeof total === 'number' && total > 0) o.total = total;
  wtDoneSave(o);
}

/** 记下「今天一共有几条任务」—— 桌面小组件要靠它算进度。
 *  只在读列表成功时调；读失败时**不动**旧值（旧的至少是个参考，
 *  清零的话小组件会突然显示 0/0）。 */
function wtDoneTotal(n) {
  if (!(n > 0)) return;
  const o = wtDoneLoad();
  if (o.total === n) return;
  o.total = n;
  wtDoneSave(o);
}

/** 今天做完了几条（用于小组件和「今天的都做完了」那句结论）。 */
function wtDoneCount() {
  const o = wtDoneLoad();
  let n = 0;
  Object.keys(o.done).forEach((k) => { if (o.done[k]) n += 1; });
  return n;
}

function wtTaskRows() {
  const all = Array.isArray(WT.missions) ? WT.missions : [];
  const d = WT.daily;
  const dailyId = (d && d.adId) || '';
  const rest = dailyId ? all.filter((x) => x.refId !== dailyId) : all;
  if (!dailyId) return rest;
  const base = (typeof d.score === 'number' && isFinite(d.score)) ? d.score : null;
  return [{
    kind: 'signin',
    refId: dailyId,
    name: '每日签到',
    score: base,
    left: d.signed ? 0 : 1,
    used: d.signed ? 1 : 0,
    signed: !!d.signed,
  }].concat(rest);
}

/** 真正**还能跑**的那些（签过的签到不算）。
 *  计数、确认文案、按钮的可用性都按它算 —— 和 `wtTaskRows()` 是同一次计算
 *  的两个视角，不是两份数据。 */
function wtRunnableRows() {
  return wtTaskRows().filter((x) => {
    // 签到：平台说今天签过了，就不算这一轮待做
    if (x.kind === 'signin' && x.signed) return false;
    // 🔴 0.35.0：剩余次数被平台算成 0，就是「今天做完了」。
    //    以前只认签到那一行，于是八个任务全跑完、每一行都写着「已完成」，
    //    上面的计数还写着「待做 8 个」—— 同一张卡里两句话互相打架，
    //    用户会以为「一键完成」没生效。
    //    left 是后端用 limit - used 算出来的；None 表示「不限次」或「读不到」，
    //    那种**不能**当成做完了。
    if (typeof x.left === 'number' && x.left <= 0) return false;
    // 🔴 0.49.0：本机记着今天做完了的也不再算待做。
    //    服务端的「已做次数」并不总是立刻跟着变，只信它的话，用户关掉 App
    //    再打开就会看到一个「待做 8 个」的全新页面（他刚才明明做完了）。
    //    这条和上一条不重复：上一条是**平台说**做完了，这条是**我们眼看着**
    //    做完了 —— 两种来源都要认。
    if (wtDoneHas(x.refId)) return false;
    return true;
  });
}

/** 单个任务封顶几次、整轮封顶几次。
 *  30 秒一次 ⇒ 60 次是半小时。上限不是「省事」，是防止平台给一个离谱的
 *  剩余次数（比如 999）把我们变成一台刷分机器。 */
const WT_MAX_PER_TASK = 10;
const WT_MAX_TOTAL = 60;

/** 这个任务这一轮要提交几次。
 *
 *  🔴 0.40.3 修的就是这里。以前**每个任务只提交一次** —— 而平台的任务是
 *     「一天能做 N 次、每做一次给一份分」。于是「看视频 30 分 × 5 次」我们
 *     只拿到 30 分，官方那边拿 150。用户 2026-11-02：「出水小部件每天能搞
 *     二三百积分，你这个却只有不到 100」—— 差的正是没做的那些次。
 *
 *  `left` = 平台算出的剩余次数（limit - used）。null 有两种情况：
 *    · 已做次数是 -1（平台说「不限次」）
 *    · 已做次数压根没读到（limits 里没有这条）
 *  两者都**不是**「做完了」，退回按任务自己的总次数 `limit` 算，
 *  再不行才做一次 —— 不能因为读不到就只做一次，那正是这次的 bug。
 */
function wtTimesOf(x) {
  const cap = (v) => Math.max(1, Math.min(WT_MAX_PER_TASK, Math.floor(v)));
  if (x && x.kind === 'signin') return 1;      // 签到一天就一次
  if (x && typeof x.left === 'number' && isFinite(x.left) && x.left > 0) return cap(x.left);
  if (x && typeof x.limit === 'number' && isFinite(x.limit) && x.limit > 0) return cap(x.limit);
  return 1;
}

/** 跑任务时那一块「正在进行 + 进度条」（0.49.0）。
 *
 *  用户 2026-11-07：「点一键完成的时候别显示全部任务了，点一下直接显示
 *  正在进行任务，可以加个进度条」。
 *
 *  🔴 数字和标题行右边那个「3/8 次」是**同一份**（WT.runDone / WT.runTotal），
 *     不是各算一遍 —— 各算一遍就会出现「进度条走到头、数字还停在 2/8」。
 *  🔴 只做显隐，不重画列表：列表那一棵树跑完要原样露出来，重画会把
 *     刚标上的「已完成」搞丢。
 */
function wtPaintRunNow(items) {
  const box = $('wtRunNow'), list = $('wtMissions');
  if (!box || !list) return;
  box.hidden = !WT.running;
  list.hidden = !!WT.running;
  if (!WT.running) return;

  const total = Number(WT.runTotal) || 0;
  const doneN = Math.min(Number(WT.runDone) || 0, total);
  const row = (items || []).filter((x) => x.refId === WT.cur)[0];

  const nm = $('wtRunNowName');
  // 没有正在跑的那一条（两轮之间那一瞬）别留空标题 —— 空白看起来像卡住了。
  if (nm) nm.textContent = row ? (row.name || '这一条') : '正在做';
  const ct = $('wtRunNowCnt');
  if (ct) ct.textContent = doneN + '/' + total;
  const fill = $('wtRunNowFill');
  // total 为 0 时宽度写 0，不要写 NaN% —— 那会让整条进度条消失。
  if (fill) fill.style.width = (total > 0 ? Math.round(doneN * 100 / total) : 0) + '%';

  const sub = $('wtRunNowSub');
  if (sub) {
    // 两次提交之间要等 30 秒，这段时间最容易让人以为卡住了。
    // 这句话说清「已经做完的不会白做」—— 正好是这次修的那件事。
    sub.hidden = doneN === 0;
    sub.textContent = doneN > 0 ? '做完的已经记下了，关掉这一页也不会丢' : '';
  }
}

function wtPaintMissions() {
  const box = $('wtMissions'), tip = $('wtMissionTip'), btn = $('wtRunAll');
  const items = wtTaskRows();
  const todo = wtRunnableRows();
  // 开关的样子跟着 CFG 走（关掉之后还亮着 = 骗人）

  box.innerHTML = items.map((it) => {
    const st = WT.run[it.refId] || '';
    // 签到已经签过：直接标「已签」，不参与这一轮，也不显示「剩 0 次」那种怪话
    const signed = it.kind === 'signin' && it.signed && !st;
    // 0.35.0：平台算出的剩余次数为 0 —— 今天这个任务到次数了。
    // 和签到同一个待遇：标一句「今天做完了」，不给「剩 0 次」（读起来像还能做零次）。
    const doneToday = !st && typeof it.left === 'number' && it.left <= 0;
    // 🔴 0.49.0：本机记着今天做完了（这次打开是关掉再开的，`WT.run` 已经清零）。
    //    没有这一条，重开 App 后八行又全是空白、卡头又写「待做 8 个」。
    const recorded = !st && !signed && !doneToday && wtDoneHas(it.refId);
    const cls = st === 'ok' ? 'ok' : st === 'bad' ? 'bad' : st ? 'wait'
              : (signed || doneToday || recorded ? 'ok' : '');
    const txt = st === 'ok' ? '已完成' : st === 'bad' ? '失败'
              : st ? '执行中'
              : (signed ? '今天已签'
                        : ((doneToday || recorded) ? '已完成' : ''));
    const money = (typeof it.score === 'number' && isFinite(it.score))
      ? '<span class="wtmission-s">+' + it.score + '</span>'
      : '<span class="wtmission-s unknown">分值没读到</span>';
    // 剩余次数：null = 不限次（或读不到），不显示 —— 别编一个数字出来
    // 签到那条固定「剩 1 次」/已签时不显示，它的次数没有意义
    const doneNow = doneToday || recorded || st === 'ok';
    const left = it.kind === 'signin' ? ''
      : doneNow ? ''
      : (typeof it.left === 'number' && isFinite(it.left))
        ? '<span class="wtmission-l">剩 ' + it.left + ' 次</span>'
        : (it.used === -1 ? '<span class="wtmission-l">不限次</span>' : '');
    return '<div class="wtmission' + (WT.cur === it.refId ? ' on' : '')
             + (signed || doneNow ? ' done' : '') + '">' +
             '<span class="wtmission-t">' + esc(it.name || it.refId) + '</span>' +
             left + money +
             (txt ? '<span class="wtmission-st ' + cls + '">' + txt + '</span>' : '') +
           '</div>';
  }).join('');

  // 🔴 0.26.2 起签名能算了（盐从官方 APK 里取到），所以按钮该出现就出现。
  //    仍然要求「至少有一条可跑的」—— 一条都没有时按钮没意义。
  //    计数用 `todo`（签过的签到不算），和确认文案是**同一个数**。
  const canRun = todo.length > 0 && !WT.missionErr;
  btn.hidden = !canRun || WT.running;
  // 🔴 0.35.0：这一轮已经跑成功的不再算「待做」。
  //    WT.run 记着本轮每一条的结果；不扣的话跑完八个，列表每行都写着
  //    「已完成」，卡头还是「待做 8 个」—— 同一张卡里两句话对着干。
  const pending = todo.filter((x) => WT.run[x.refId] !== 'ok');
  const allDone = todo.length > 0 && pending.length === 0;
  btn.disabled = WT.running || allDone;
  // 0.33.0：按钮从卡片底部的通栏按钮挪到标题行，文案跟着变短 ——
  // 「一键完成全部任务」八个字在标题行里会把它挤到下一行。
  btn.textContent = allDone ? '都做完了' : '一键完成';
  // 自动展开：正在跑的时候必须看得见每一行的状态和「停下」，
  // 否则收起状态跑起来就成了「按了没反应」。
  if (WT.running) {
    $('wtTaskBox').hidden = false;
    $('wtTaskOpen').setAttribute('aria-expanded', 'true');
  }
  // 0.49.0：跑的时候把八行列表换成一块「正在进行 + 进度条」。
  // 🔴 只改显隐，不动 innerHTML —— 列表那一棵还在，跑完原样露出来
  //    （重画反而会把刚标上的「已完成」搞丢）。
  wtPaintRunNow(items);
  const stop = $('wtRunStop');
  if (stop) stop.hidden = !WT.running;

  // 哪个平台没读到/没登，要在这儿说出来 —— 不说的话「任务只有这几条」
  // 看起来就是全部，用户不会想到「另一半在另一个账号里」。
  const laneMsg = (() => {
    const L = WT.lanes || {};
    const out = [];
    if (L.score === 'missing') out.push('积分账号没登，另一个平台的任务看不到');
    if (L.device === 'missing') out.push('设备账号没登，另一个平台的任务看不到');
    if (L.score === 'error') out.push('积分平台任务读失败：' + (WT.laneErr.score || ''));
    if (L.device === 'error') out.push('设备平台任务读失败：' + (WT.laneErr.device || ''));
    return out.join('；');
  })();

  const cnt = $('wtTaskCount');
  if (WT.running) {
    // 0.40.3：跑的时候按**次**报进度。按任务报的话，一个任务做 5 次
    // 界面上从头到尾都是「0/8」，看着像卡住了。
    cnt.textContent = WT.runDone + '/' + (WT.runTotal || 0) + ' 次';
  } else if (todo.length) {
    // 全做完了就说「做完了」。写「待做 0 个」是把一句结论说成一次统计。
    cnt.textContent = pending.length ? '待做 ' + pending.length + ' 个' : '今天的都做完了';
  } else {
    // 🔴 0.40.0：一条可做的都没有时，**结论写在标题行右边**，不再另起一行。
    //    原来这里下面是 `#wtMissionTip` 单独一行「现在没有可做的任务。」，
    //    33px 只说一句「没事可做」—— 这一页最紧的 25 像素就差在这。
    //    签过到、又没有别的任务 ⇒ 不是「没有任务」，是「今天的做完了」；
    //    这两句话对用户是两件事，所以照旧分开说，只是搬到标题行上。
    //    有 laneMsg 时不写，让下面那行提示独占（它才是用户不知道的事）。
    cnt.textContent = laneMsg ? ''
      : (items.length ? '今天的都做完了' : '没有可做的');
  }

  if (WT.missionErr && !WT.expired && !WT.offNote) {
    tip.hidden = false;
    tip.classList.add('bad');
    tip.textContent = '任务列表没读到：' + WT.missionErr;
  } else if (laneMsg) {
    // 哪个平台没读到 / 没登 —— 这句话用户自己看不出来，必须占一整行说
    tip.hidden = false;
    tip.classList.remove('bad');
    tip.textContent = laneMsg;
  } else if (WT.missionSkipped > 0) {
    tip.hidden = false;
    tip.classList.remove('bad');
    tip.textContent = '有 ' + WT.missionSkipped + ' 条跳过了（没有 ID 或者属于不做的类别）。';
  } else {
    tip.hidden = true;
    tip.classList.remove('bad');
    tip.textContent = '';
  }

  // 🔴 0.47.2：一条任务都没有、也没有话要说时，整个「今日任务」块**不画**。
  //    原来这时留着一条标题行，右边写「没有可做的」，点开是一个空列表 ——
  //    52px（上下留白 16 + 标题 32 + 间距 4）只说一句「没事可做」，
  //    而这 52px 正好是把这一页顶出一屏的那 21px（真机 360×712，
  //    内容 615 / 可用 594）。
  //    ⚠️ 不能连着「今天的都做完了」一起藏：那是**结论**（items 里有做完的
  //       条目），不是空状态；也不能在 laneMsg / 读失败 / 有跳过条目时藏，
  //       那些话是用户自己看不出来的事。只在真的什么都没有时藏。
  const nothing = !items.length && !WT.running && !tip.textContent;
  $('wtTaskCard').hidden = nothing;
}

/** 读任务列表（两个平台合并的那种）。
 *
 *  `keepRun` = true 时**保留** `WT.run`（本轮每行跑出来的状态）。
 *  跑完一轮要重新读一次「剩余次数」，但那时如果把状态清了，八行会一起变回
 *  空白 —— 看着像什么都没做。只有列表真的换了（重新登录 / 换账号）才清。
 */
async function wtLoadMissions(keepRun) {
  try {
    const r = await api('/api/water/missions');
    if (!r || !r.ok) {
      if (r && r.kind === 'auth') { wtExpire(WT.accounts.score ? 'score' : 'device'); }
      // 「积分任务一直失败」是 2026-11-06 那轮的主要问题。报上去才知道
      // 是所有人都失败（平台改版），还是只有某类账号失败。

      WT.missions = [];
      WT.missionErr = (r && r.error) || '读不到';
      WT.missionSkipped = 0;
      WT.daily = null;
      WT.lanes = null;
      WT.laneErr = {};
    } else {
      WT.missions = Array.isArray(r.items) ? r.items : [];
      WT.missionErr = '';
      WT.missionSkipped = Number(r.skipped) || 0;
      // 签到状态和任务列表是同一个响应里的两块（dailyRSP / accScoreRsp.daily）
      WT.daily = r.daily || null;
      // 哪个平台读了、哪个没登/读失败 —— 界面要靠它说「少的那半在另一个账号里」
      WT.lanes = r.lanes || null;
      WT.laneErr = r.errors || {};
      // 任务列表换了（比如重新登录），上一轮的状态就没意义了
      if (!keepRun) WT.run = {};
      // 0.49.0：记下「今天一共几条」—— 桌面小组件按它算进度条。
      // 放在 wtPaintMissions 之前，因为那里面会重算「待做 N 个」。
      wtDoneTotal(wtTaskRows().length);
      // 读到了新列表 ⇒ 小组件上那个分母变了。推一次（不推的话，
      // 用户加了平台、任务从 5 条变成 8 条，桌面上还写着 3/5）。

    }
  } catch (e) {
    WT.missions = [];
    WT.missionErr = e.message;
    WT.daily = null;
    WT.lanes = null;
    WT.laneErr = {};
  }
  wtPaintMissions();
}

const wtSleep = (ms) => new Promise((res) => { setTimeout(res, ms); });

/** 两次提交之间等一会儿。**默认 30 秒**，和原版 TokenTaskRateLimiter 一致。
 *
 *  为什么必须等：原版每次提交之间自己压 30 秒，说明打快了会被平台限流
 *  （服务端回 202），更糟的是可能触发风控 —— 而风控的后果是账号被限制、
 *  积分被冻结，不是「重试一下就好」。所以宁可慢。
 *
 *  等待期间每秒更新一次倒计时，并且**随时可以停** —— 让用户干等 30 秒
 *  看着屏幕不动，他会以为卡死了。
 *  返回 false = 用户点了「停」，调用方应该收工。 */
async function wtPace(ms) {
  // 🔴 后台那一路**必须一次睡完**，不能像前台那样「每 250ms 醒一次看时间」。
  //
  //    原因是 WebView 不在窗口上时，Chromium 把它当隐藏页面，`setTimeout`
  //    会被拉到至少 1 秒一次。前台那圈 `while` 循环跑 120 次 = 120 秒，
  //    30 秒的等待变成两分钟；十几次提交叠起来就是二十多分钟 ——
  //    而系统给单个后台任务的上限是 9 分钟，所以**永远跑不完**。
  //    这正是用户说的「积分任务仍然无法后台进行」。
  //
  //    一次 `setTimeout(30000)` 只被拉长一次（而且长定时器基本不受节流影响，
  //    被节流的主要是 1 秒以内的短定时器），误差是几秒不是几倍。
  const box = $('wtRunPace');
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    if (WT.runStop) {
      if (box) { box.hidden = true; box.textContent = ''; }
      return false;
    }
    const left = Math.ceil((endAt - Date.now()) / 1000);
    if (box) {
      box.hidden = false;
      // 光写「等 3 秒再提交下一个」像是在拖时间 —— 得说清是平台在限流，
      // 不是我们慢。这句话只在倒计时那几秒里出现，过了就消失。
      box.textContent = '等 ' + left + ' 秒（连着提交平台会冻结）';
    }
    await wtSleep(250);
  }
  if (box) { box.hidden = true; box.textContent = ''; }
  return !WT.runStop;
}

/** 一键完成全部任务。
 *
 *  🔴 这是**第三个有副作用**的批量操作，而且一次动 N 次账号。三条自我约束：
 *     1. 二次确认，文案要说清「会真的动你的账号、可能被风控」
 *     2. **失败不重试**；连续两个失败就停下 —— 原项目 README 自己写着
 *        「出现异常时请停止任务，勿反复运行期待自动恢复」
 *     3. 跑完**重新读一次积分**来核验。服务端回「成功」不等于到账，
 *        原 README 也写着「请求成功不等于奖励到账」。不信提示，信数字。
 *
 *  🔴 0.40.3：**按次数跑，不是按任务跑**。平台的任务是「一天能做 N 次、
 *     每做一次给一份分」；以前每个任务只提交一次，等于把 N 分之 N-1 丢掉。
 */
async function wtRunAll() {
  if (WT.busy || WT.running) return;
  // 第一次点它：先把风险说清楚。点完「知道了」自动接着走（见 wtNeedTerms）
  if (!wtNeedTerms(() => { wtRunAll(); })) return;
  // 🔴 签到和任务**请求体不一样**，所以在下面的循环里按 `kind` 分派：
  //    签到 `{weekday, adId}` / 任务 `{adId, type:101}`。用错 body 服务端可能
  //    当成一次普通任务，甚至把「签到」记成「做任务」—— 而且**不报错**。
  //    原版也是两条独立的路（DailySignInPlanner / TaskMissionPlanner），
  //    只是被同一个按钮串起来跑。
  //    ⚠️ 用 `wtRunnableRows()` 而**不是**自己再过滤一遍：0.26.2 就是列表和
  //    执行各写一遍，结果列表没剔、执行剔了 ⇒ 卡片一个数、确认框另一个数。
  const items = wtRunnableRows();
  if (!items.length) return;

  // 每个任务做几次 + 这一轮一共几次。两个数都**算一次**，确认框、进度、
  // 循环全用它们 —— 三个地方各算一遍就会出现「说 8 次结果跑 5 次」。
  const plan = items.map((it) => ({ it: it, n: wtTimesOf(it) }));
  let total = plan.reduce((a, p) => a + p.n, 0);
  if (total > WT_MAX_TOTAL) {
    // 砍到上限为止：宁可少做几个，也不要一次把半小时以上排进去
    total = 0;
    for (const p of plan) {
      if (total + p.n > WT_MAX_TOTAL) { p.n = Math.max(0, WT_MAX_TOTAL - total); }
      total += p.n;
    }
  }

  /* 🔴 后台那一轮**必须再砍一刀**（2026-11-11）。
   *
   *     每次提交之间法定要等 30 秒（平台限流）。系统给单个后台任务的
   *     上限是 9 分钟，按 30 秒一次算，**最多也就十几下**。可是任务表
   *     摊开来常常二十几下 —— 一轮从来跑不完，每轮都被判超时，
   *     超时又被记成「失败」，三次之后当天彻底不动。
   *
   *     所以后台一次只做一小批（默认 5 下），剩下的留给下一个小时。
   *     这不是妥协：每小时 5 下，一天醒 8 轮就是 40 下，正常账号一天
   *     的任务量根本到不了这个数，而且每轮都在时限内稳稳跑完。
   *     ⚠️ 前台不受影响：用户点了「一键完成」，就该当场做完。 */
  const multi = plan.some((p) => p.n > 1);

  // 🔴 0.44.0：**不再弹确认框**。用户 2026-11-03：「积分任务点击一键完成时
  //    不要再显示弹窗」。那颗按钮的名字就是「一键完成」—— 点完再问一次
  //    「要开始吗」，等于把它变成两颗按钮。
  //    风险告知没有消失：第一次点的时候那张说明（wtNeedTerms）还在，
  //    而且只出现一次；之后的每一次点击都直接开始。
  void multi;

  WT.running = true;
  WT.runStop = false;
  WT.run = {};
  WT.cur = '';
  WT.missionErr = '';
  WT.runDone = 0;
  WT.runTotal = total;
  WT.runGain = 0;      // 新一轮从 0 开始算「这次挣了多少」
  const before = (WT.score && typeof WT.score.valid === 'number') ? WT.score.valid : null;
  wtPaintMissions();

  let done = 0, fails = 0, stopped = false, firstErr = '', authOut = false;
  let quotaOut = 0;      // 有几个任务是「第二次就被平台拒了」= 剩余次数已经到底
  let needPace = false;  // 两次提交之间至少 30 秒，第一次之前不用等
  let stopAll = false;

  // 🔴 0.40.3：外层是任务，内层是「这个任务做第几次」。
  for (let i = 0; i < plan.length && !stopAll; i += 1) {
    const it = plan[i].it, n = plan[i].n;
    let okCount = 0;      // 这个任务成功提交了几次
    for (let k = 0; k < n; k += 1) {
      // 等 30 秒放在**每次提交之前**（第一次除外）：这样无论上一条是成功、
      // 失败还是跳出，两次真实提交之间都隔着够长的时间。停下指令也在里面看。
      if (needPace && !(await wtPace(WT.runGap || 30000))) {
        stopped = true; stopAll = true; break;
      }
      needPace = true;
      if (k === 0) {
        WT.run[it.refId] = 'wait';
        WT.cur = it.refId;
        wtPaintMissions();
      }

      let bad = '', kind = '';
      try {
        // 🔴 按 kind 分派：签到走 `/api/water/signin`（body 带 weekday），
        //    任务走 `/api/water/mission`（body 带 type）。两条路不能混。
        const d = WT.daily || {};
        const r = (it.kind === 'signin')
          ? await api('/api/water/signin', {
              adId: it.refId,
              weekday: (d.weekday >= 1 && d.weekday <= 7) ? d.weekday : 0,
              score: (typeof it.score === 'number' && isFinite(it.score)) ? it.score : 0,
            })
          : await api('/api/water/mission', {
              adId: it.refId, score: it.score, platform: it.platform || '',
            });
        if (r && r.ok) {
          done += 1;
          okCount += 1;
          fails = 0;                 // 成功一次就重置，判的是「连续」失败
          // 🔴 0.49.0：成功一次就落盘记一笔，**不等整轮跑完**。
          //    中途点「停」/ 断网 / 被平台拦下时，已经成功的那些也算数 ——
          //    不记的话用户重开 App 会看到它们又变回「待做」。
          wtDoneMark(it.refId);
          // 0.50.0：把这一次挣到的分记进「本次新增」，界面上的「可用」
          // 就是 `35+25` 那个样子。分值按**任务列表里写的**算 —— 平台最后
          // 给多少，跑完重读积分才知道（所以它不是账，是进度）。
          if (typeof it.score === 'number' && isFinite(it.score) && it.score > 0) {
            WT.runGain += it.score;
            wtPaintScore();
          }
        } else {
          kind = (r && r.kind) || '';
          bad = wtErrText(kind, r && r.error);
        }
      } catch (e) {
        bad = e.message;
      }
      WT.runDone += 1;

      if (bad) {
        if (!firstErr) firstErr = bad;
        if (kind === 'auth') authOut = true;
        if (k > 0) {
          // 第二次以后被拒 = 这个任务的次数比列表里显示的少（平台当天只剩这么多次）。
          // 这是**可预期**的，不是账号坏了：不计入「连续失败」，也不再重试这个任务。
          quotaOut += 1;
        } else {
          fails += 1;
          WT.run[it.refId] = 'bad';
        }
        break;
      }
      wtPaintMissions();
    }
    // 一个任务全部做完才标「已完成」：做 5 次的那个在第 1 次成功后
    // 就标上的话，后面 4 次还在跑，界面却已经说做完了。
    if (okCount > 0) WT.run[it.refId] = 'ok';
    WT.cur = '';
    wtPaintMissions();
    if (authOut) { wtExpire(); stopped = true; break; }
    if (fails >= 2) { stopped = true; break; }
  }

  WT.running = false;
  WT.runStop = false;
  WT.cur = '';
  const pace = $('wtRunPace');
  if (pace) { pace.hidden = true; pace.textContent = ''; }
  wtPaintMissions();

  // ---- 核验：重新读一次任务（剩余次数要跟着变）和积分，用数字说话 ----
  //     任务列表这一读**保留**本轮每行的「已完成」标记（keepRun），
  //     否则跑完八行全变回空白，看着像没跑。
  await wtLoadMissions(true);
  // 重读之前先把「+N」清掉：屏幕上的可用分马上就要变成服务端那个真数，
  // 再加一个「+25」就成了 60+25 —— 同一笔分算两遍。
  WT.runGain = 0;
  await wtLoadScore();       // 它自己会重画积分
  // 0.49.0：跑完把新的进度推给桌面小组件。
  // 不推的话，用户跑完八个任务回到桌面，那张卡片还写着「0/8」——
  // 而它下一次刷新是系统那半小时一跳（还不保证）。

  const after = (WT.score && typeof WT.score.valid === 'number') ? WT.score.valid : null;

  // 🔴 0.49.0 v10：一个都没成的时候，别写「提交了 0 次（5 个任务），中途停下了」——
  //    用户要的是「为什么没成、我该干嘛」，不是一份执行报告。2026-11-08 那张
  //    截图里，这段报告后面还跟着同一句解释，一共三段，谁都不想读。
  let msg = '';
  const why = firstErr || '';
  if (done === 0 && why) {
    msg = '这次一个都没提交上：' + why;
  } else if (done === 0) {
    msg = '这次一个都没提交上';
  } else {
    msg = '提交了 ' + done + ' 次（' + items.length + ' 个任务）';
    if (stopped) msg += '，中途停下了';
  }
  if (quotaOut > 0) {
    msg += '。有 ' + quotaOut + ' 个任务做到一半平台就不收了（当天的次数已经用完）';
  }
  if (before != null && after != null) {
    const diff = after - before;
    msg += '，可用积分 ' + before + ' → ' + after;
    if (diff > 0) {
      msg += '（+' + diff + '）';
    } else if (diff < 0) {
      // 🔴 变少必须明说。只写「没变」等于把「积分被扣了」说成「什么都没发生」——
      //    用户看到这句就不会去查，而分数确实少了（红线 66g：变多自动接受、
      //    变少必须明说）。
      msg += '（少了 ' + (-diff) + ' 分 —— 积分被扣了，留意一下）';
    } else if (done > 0) {
      msg += '（没变，可能还没到账）';
    }
  } else {
    msg += '，但积分没读到，到账情况核不了';
  }

  // ---- 做完就换（0.44.0，默认开）----
  // 🔴 放在「积分 before → after」之后：先让人看见今天挣了多少，
  //    再说「这些已经换成余额了」。反过来读起来像「白干了」。

  // 已经在上面的「一个都没提交上」里说过了，别重复第二遍
  if (firstErr && done > 0) msg += '。第一个错误：' + firstErr;

  const tip = $('wtMissionTip');
  tip.hidden = false;
  tip.classList.toggle('bad', done === 0 && !!firstErr);
  tip.textContent = msg;
}



/* 🔴 0.40.0：0.39.3 删「今日/本月/本年用水量」那一块时，剪切点选在了
   `function wtPaintBills() {` 这一行**下面** —— 函数头被删掉，52 行函数体
   留在了 `wtRunAll` 后面游离着（顶层执行，还顺手声明了几个同名 const）。
   结果是：三个调用点全报 `wtPaintBills is not defined`，消费记录列表
   整个空着，而且**不报错**的地方看起来一切正常。
   现在把函数原样补回来，只去掉结尾那句 `wtPaintStats()`（用水量三格，
   已随功能一起撤掉）。 */
function wtPaintBills() {
  const box = $('wtBills'), tip = $('wtBillTip'), more = $('wtBillMore');
  const items = Array.isArray(WT.bills) ? WT.bills : [];

  box.innerHTML = items.map((b) => {
    const money = (typeof b.money === 'number' && isFinite(b.money))
      ? '<span class="wtbill-money">¥' + b.money.toFixed(2) + '</span>'
      : '<span class="wtbill-money unknown">金额没读到</span>';
    const when = b.at ? ntStamp(b.at / 1000) : '';
    const sub = [when, b.did ? '设备 ' + b.did : ''].filter(Boolean).join(' · ');
    return '<div class="wtbill">' +
             '<span class="wtbill-main">' +
               '<span class="wtbill-t1">' + esc(b.msg || '消费') + '</span>' +
               (sub ? '<span class="wtbill-t2">' + esc(sub) + '</span>' : '') +
             '</span>' + money +
           '</div>';
  }).join('');

  // 加载更多：只在「确实还有下一页」时出现。靠「这页是不是满的」猜的话，
  // 最后一页正好装满时会多给一个点了是空的按钮。
  more.hidden = !WT.billsMore;

  if (WT.billErr && !WT.expired && !WT.offNote) {
    tip.hidden = false;
    tip.classList.add('bad');
    tip.textContent = '消费记录没读到：' + WT.billErr;
  } else if (!items.length && WT.billsLoaded && !WT.expired) {
    tip.hidden = false;
    tip.classList.remove('bad');
    tip.textContent = '还没有消费记录。';
  } else {
    tip.hidden = true;
    tip.classList.remove('bad');
    tip.textContent = '';
  }

  // 收起时右边那行字：最近一条。不展开也知道刚被扣了多少。
  // 🔴 没读到就说「没读到」，不许写成 ¥0.00 或空着 —— 空着像是「今天没花钱」。
  const brief = $('wtBillBrief');
  if (WT.billErr && !WT.expired) {
    // 同余额：没登设备账号时这句话是「要用设备登录那个账号」，不是读失败。
    brief.textContent = WT.accounts.device ? '没读到' : '登录后显示';
  } else if (!WT.billsLoaded) {
    brief.textContent = '—';
  } else if (!items.length) {
    brief.textContent = '还没有记录';
  } else {
    const b = items[0];
    const money = (typeof b.money === 'number' && isFinite(b.money))
      ? '¥' + b.money.toFixed(2) : '金额没读到';
    brief.textContent = (b.at ? money + ' · ' + agoText(b.at / 1000) : money);
  }
}

/** 拉消费记录。`more` = true 表示翻下一页（往已有列表后面追加）。 */
async function wtLoadBills(more) {
  const btn = $('wtBillMore');
  if (more) btn.disabled = true;
  const page = more ? WT.billsPage + 1 : 0;
  try {
    const r = await api('/api/water/bills?page=' + page);
    if (!r || !r.ok) {
      if (r && r.kind === 'auth') { wtExpire('device'); }
      WT.billErr = (r && r.error) || '读不到';
      if (!more) { WT.bills = []; WT.billsPage = 0; WT.billsMore = false; }
    } else {
      const got = Array.isArray(r.items) ? r.items : [];
      WT.bills = more ? WT.bills.concat(got) : got;
      WT.billsPage = page;
      WT.billsMore = !!r.more;
      WT.billErr = '';
      WT.billsLoaded = true;
    }
  } catch (e) {
    WT.billErr = e.message;
  } finally {
    btn.disabled = false;
  }
  wtPaintBills();
}

/* ---- 接水进行中（本机记的会话，**不是**服务端状态）---------------
   /ui/app/master 只给设备列表，没有「这台正在出水」这个字段。所以这里
   记的是「你在本机点过 start」，不是「设备真的在出水」—— 文案不能装作
   知道设备真实状态。

   🔴 0.38.0：光记一笔**不够**，必须自己判断它什么时候结束。
      用户 2026-11-01：「在饮水机上结束后 APP 里还是显示正在接水」。
      旧写法只有两条路能把它清掉：本机点「停止」、或者等 2 小时过期。
      人在机器上按了结束，APP 就一路挂着「正在出水」两小时 —— 而且那两小时
      里它还会按「正在出水」的样子继续显示，用户以为在一直扣钱。
      照 WaterWidget（nocookies111/life-798，MIT）的做法补两件事：
        ① **查账单**：启动 8 秒后开始，每 10 秒读一次消费记录；
           出现「启动时刻之后」的账单 ⇒ 这次接水结束了，立刻收条子 + 结算。
        ② **超时兜底**：10 分钟（= WaterWidget 的 MAX_MONITOR_MILLIS）
           还没读到账单，就当它已经结束，把条子收掉。
      ⚠️ WaterWidget 的会话**只存内存**、重启就没了；我们存在 localStorage
         （网页版刷新一次不该把「正在出水」弄丢），所以**有效期是唯一的安全阀**
         —— 它必须短，短到「挂着一条假的」比「漏掉一次真的」更烦人。
      ⚠️ 判据只能是「账单里有没有新条目」：设备状态接口不存在，
         「过了 X 秒」只是兜底，不能拿它当结束信号。 */
const WT_LIVE_KEY = 'wt.live';
const WT_LIVE_TTL = 10 * 60 * 1000;   // 10 分钟，对齐 WaterWidget 的最长监测
const WT_POLL_FIRST = 8000;           // 启动后 8 秒先查一次（账单不会立刻出）
const WT_POLL_EVERY = 10000;          // 之后每 10 秒一次
let wtPollTimer = null;
/* 点了「停止」之后等账单等多久。**不是**「等这么久就当停了」——
   等不到就如实说「没确认到」，见 wtStop。8 秒：够账单出来的那种情况
   （真停了通常几秒内就记账），又不至于让人对着「正在停…」干等。 */
const WT_END_WAIT = 8000;
const WT_END_STEP = 2000;             // 等的时候每 2 秒查一次
let wtStopping = false;               // 停止请求在飞（只防连点，不占 WT.busy）
/* 停止请求发出去了、账单还没出来时，设备行下面那句要说什么。
   空串 = 还是「刚才启动 · 接完自动结算」。
   为什么要单独存：那句话要在 wtStop 里写一次、wtPaintLive 里读几次，
   写两处就会有一处忘了改（「正在发停止请求」和「请求已发出」是两件事）。 */
let wtLiveHint = '';

function wtLoadLive() {
  const v = store.get(WT_LIVE_KEY, null);
  if (!v || !v.did || !v.at) { WT.live = null; return; }
  if (Date.now() - v.at > WT_LIVE_TTL) {      // 过期就扔掉，别留着吓人
    store.del(WT_LIVE_KEY);
    WT.live = null;
    return;
  }
  WT.live = v;
}

/** 接水中那台设备下面那行小字。
 *  🔴 只能写**本机发生过的事**：设备真实有没有在流，没有接口能证明
 *     （/ui/app/master 只给设备列表）。所以是「刚才启动」，不是「正在出水」。
 *     这一句就是原来顶部那条 `#wtLive` 上的字，2026-11-10 搬到行里。 */
function wtLiveText() {
  if (!WT.live || !WT.live.did) return '';
  // 🔴 hint 要比 wtStopping 先看：请求已经发出去了、正在等账单的那几秒里，
  //    wtStopping 还是 true（要等 finally 才清），只按它写的话屏幕上会一直
  //    停在「正在发停止请求…」—— 用户以为卡住了，其实已经在等设备了。
  if (wtLiveHint) return wtLiveHint;
  if (wtStopping) return '正在发停止请求…';
  return '刚才启动 · 接完自动结算';
}

/** 把「这台在接水」画到**设备行**上。
 *
 *  2026-11-10 用户：「开启饮水机后不要在顶部单独显示退出，直接把接水按钮
 *  换成退出就行了」。所以现在没有顶部那条了 —— 状态和按钮都在那一行里。
 *
 *  🔴 **只改已有节点，不重画整个列表**：它在 renderWater 开头就会被调，
 *     那时候设备还没拉回来；`wtPaintDevs` 会把 `box.innerHTML` 清空，
 *     等于每进一次页面设备列表先闪空一下（而且不报错）。
 */
function wtPaintLive() {
  const box = $('wtDevs');
  if (!box) return;
  const did = (WT.live && WT.live.did) || '';
  box.querySelectorAll('.wtdev').forEach((row) => {
    const go = row.querySelector('.wtdev-go');
    if (!go) return;
    const main = row.querySelector('.wtdev-main');
    const on = !!did && go.dataset.did === did;
    go.classList.toggle('stop', on);
    go.textContent = on ? (wtStopping ? '正在停…' : '停止') : '接水';
    if (on) {
      // 无障碍：屏幕阅读器读到的是「停止接水」，不是一个没头没脑的「停止」
      go.setAttribute('aria-label', '停止接水');
      if (main) main.classList.add('has-sub');
      let sub = row.querySelector('.wtdev-sub');
      if (!sub) {
        sub = document.createElement('span');
        sub.className = 'wtdev-sub';
        if (main) main.appendChild(sub);
      }
      sub.textContent = wtLiveText();
    } else {
      go.removeAttribute('aria-label');
      if (main) main.classList.remove('has-sub');
      const sub = row.querySelector('.wtdev-sub');
      if (sub) sub.remove();
    }
  });
}

/** 停掉轮询。离开这一页 / 停水 / 过期都要调 —— 不调就是每 10 秒打一次服务器。 */
function wtLiveStopPoll() {
  if (wtPollTimer) { clearTimeout(wtPollTimer); wtPollTimer = null; }
}

/** 结算这次接水：刷余额 + 读账单 + 填「刚才那次」。
 *  🔴 账单可能还没出 ⇒ money 为 null，写「账单还没出」，绝不写 ¥0.00。
 *  wtStop（本机点的）和 wtLivePoll（机器上按的）共用这一份，别各写一遍。 */

/** 等「这次接水」的账单出来（最多等 ms 毫秒）。
 *  返回 true = 读到了启动之后的新账单（= 这次真的结束了）；
 *  false = 没等到 —— **不等于没停**：平台记账会晚，见 wtStop 的文案。
 *  🔴 只看账单，不改任何状态、不结算：收条子统一走 wtLiveEnd，
 *     两处各收一次会把同一次接水结算两遍（余额和「刚才那次」都会重复刷）。 */
async function wtWaitEnd(lv, ms) {
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    // 人换了账号 / 又启动了一台：这一趟作废
    if (!WT.live || WT.live.at !== lv.at) return false;
    try {
      const r = await api('/api/water/bills?page=0');
      if (r && r.ok) {
        const bills = Array.isArray(r.items) ? r.items : [];
        if (wtSumSince(bills, lv).money !== null) return true;
      }
    } catch (e) { /* 读不到就当还没出，接着等 */ }
    await wtSleep(WT_END_STEP);
  }
  return false;
}

async function wtSettle(lv) {
  await wtLoad();
  await wtLoadBills(false);
  const sm = wtSumSince(WT.bills, lv);
  WT.last = { did: lv.did, name: lv.name, at: lv.at,
              money: sm.money, partial: sm.partial };
  wtPaintLast();
}

/** 结束这次接水（不论是谁结束的）：收条子、清本机记录、结算。 */
async function wtLiveEnd(msg, lv) {
  wtLiveStopPoll();
  WT.live = null;
  wtLiveHint = '';
  store.del(WT_LIVE_KEY);
  wtPaintLive();
  if (msg) toast(msg, 3000);
  try { await wtSettle(lv); } catch (e) { /* 结算失败不影响「已经结束」这个事实 */ }
}

/** 查一次账单，看这次接水是不是已经结束了。
 *  🔴 查不到 ≠ 结束：网络错误、还没记账都当「继续等」，
 *     只有**真读到**启动时刻之后的账单才收条子。 */
function wtLivePoll() {
  wtLiveStopPoll();
  const lv = WT.live;
  if (!lv || !lv.did) return;
  // 超时兜底：等满 10 分钟还没账单，就当它早停了（WaterWidget 的 expireIfNeeded）
  if (Date.now() - lv.at > WT_LIVE_TTL) {
    wtLiveEnd('这次接水提醒已经结束，账单可以往下看消费记录', lv);
    return;
  }
  if (document.hidden || !visible()) return;      // 页面看不见就不查，回到前台再起（见 visibilitychange）
  const at = lv.at;
  api('/api/water/bills?page=0').then((r) => {
    // 期间被停掉 / 换了另一台：这一趟作废，别拿旧数据去收新会话
    if (!WT.live || WT.live.at !== at) return;
    if (!r || !r.ok) { wtPollTimer = setTimeout(wtLivePoll, WT_POLL_EVERY); return; }
    const bills = Array.isArray(r.items) ? r.items : [];
    if (wtSumSince(bills, lv).money !== null) {
      wtLiveEnd('这次接水结束了，已按账单结算', lv);
      return;
    }
    wtPollTimer = setTimeout(wtLivePoll, WT_POLL_EVERY);
  }).catch(() => {
    if (WT.live && WT.live.at === at) wtPollTimer = setTimeout(wtLivePoll, WT_POLL_EVERY);
  });
}

/** 起轮询。启动成功后调一次；回到「功能」页 / 回到前台也调（幂等，先清旧定时器）。 */
function wtLiveStartPoll() {
  wtLiveStopPoll();
  if (!WT.live || !WT.live.did) return;
  const left = WT_LIVE_TTL - (Date.now() - WT.live.at);
  if (left <= 0) { wtLiveEnd('这次接水提醒已经结束，账单可以往下看消费记录', WT.live); return; }
  wtPollTimer = setTimeout(wtLivePoll, Math.min(WT_POLL_FIRST, left));
}

/* ---- 「刚才那次」结算 ----------------------------------------------
   原版接水结束会通知「本次消费 + 估算水量」。水量要一个金额↔升数的兑换
   比例（原版可配置，我们不知道真值），**不编** —— 只报金额。

   🔴 账单不是立刻出的：停止后立刻读一次，读不到就写「账单还没出」，
      绝不当成 ¥0.00。这是「没读到 ≠ 0」在同一页的第三次应用。 */
function wtPaintLast() {
  const box = $('wtLast'), v = $('wtLastV'), tip = $('wtLastTip');
  if (!WT.last || !WT.last.at) { box.hidden = true; return; }
  box.hidden = false;
  $('wtLastWhen').textContent = ntStamp(WT.last.at / 1000) + ' 起';
  if (typeof WT.last.money === 'number' && isFinite(WT.last.money)) {
    v.textContent = (WT.last.partial ? '≥ ' : '') + '¥' + WT.last.money.toFixed(2);
    v.classList.remove('unknown');
    v.classList.toggle('lower', !!WT.last.partial);
    tip.hidden = !WT.last.partial;
    tip.textContent = WT.last.partial ? '有几笔的金额还没读到，所以这是下限。' : '';
  } else {
    v.textContent = '账单还没出';
    v.classList.add('unknown');
    tip.hidden = false;
    tip.textContent = '平台几分钟后才记账，过一会儿刷新看看。';
  }
}

/** 从已读到的账单里，把「这次接水」那几笔挑出来加总。
 *  时间窗从启动前一分钟算起（服务端记账时间可能比我们点「开始」早几秒）。
 *  返回 {money, partial}：一条都找不到 ⇒ money = null（= 还没出账），**不是 0**；
 *  有几条金额没读到 ⇒ partial = true（那个数是下限）。 */
function wtSumSince(bills, live) {
  let sum = 0, priced = 0, partial = false;
  (Array.isArray(bills) ? bills : []).forEach((b) => {
    if (!b || b.did !== live.did || !b.at || b.at < live.at - 60000) return;
    if (typeof b.money === 'number' && isFinite(b.money)) {
      sum += b.money;
      priced += 1;
    } else partial = true;
  });
  return { money: priced ? sum : null, partial: partial };
}

/** 停止接水。**第二个有副作用**的调用（结束计费）。
 *  🔴 不自动重试：同一台设备可能不止一个人在用，重试可能停掉别人的水。
 *  🔴 **不弹二次确认**（2026-10-31 用户拍板：「结束」按一颗就走）。
 *     停水是**往安全方向**的动作 —— 每多一次点击，水就多流一会儿；
 *     而误点「结束」最多是这次少接一点，再点一次「接水」就行。
 *     防误触靠的是按钮位置（在「正在出水」条里，红色）和它只在这一条里出现。 */
async function wtStop() {
  const lv = WT.live;
  // 🔴 三种「什么都不发生」都是 bug（2026-11-08 用户：「为什么我这没反应」）：
  //    ① 连点两下，第二下被 WT.busy 吞掉 —— 这里改成自己的 `wtStopping`，
  //       不再借 busy：接水时 busy 是共享的，别的请求挂着就点不动停止，
  //       而水多流一秒都是钱。
  //    ② 本机没记着这次接水（在机器上按的 / 清过数据）—— 不能静默返回，
  //       要说清「这台不是从这个 App 开的，去机器上停」。
  //    ③ 平台回了 code 0 —— 那只是「请求收到了」，不是「水停了」。
  //       以前立刻写「已停止」并把条子收掉，等于替设备保证了一件我们
  //       证明不了的事。现在去核账单：真出账单才算结束。
  if (!lv || !lv.did) {
    toast('这台不是从这个 App 启动的，停水请在饮水机上按', 4000);
    return;
  }
  if (wtStopping || !window.confirm('确认你在设备旁并要结束本次用水。')) return;

  wtStopping = true;
  wtLiveHint = '';
  // 按钮自己变成「正在停…」、下面那行小字变成「正在发停止请求…」——
  // 都在 wtPaintLive 里，别在这里再写一遍文案（写两处必然有一处忘改）。
  wtPaintLive();
  try {
    const r = await api('/api/water/end', { did: lv.did });
    if (!r || !r.ok) {
      if (r && r.kind === 'auth') { wtExpire('device'); return; }
      toast(wtErrText(r && r.kind, r && r.error), 4000);
      return;                        // 没停成，按钮留在「停止」—— 别让用户以为停了
    }
    // 平台收下了。等账单：它是「这次接水真的结束」唯一能从服务端读到的证据。
    wtLiveHint = '停止请求已发出，等设备结束';
    wtPaintLive();
    const ended = await wtWaitEnd(lv, WT_END_WAIT);
    if (WT.live && WT.live.at === lv.at) {
      if (ended) {
        await wtLiveEnd('这次接水结束了，已按账单结算', lv);
      } else {
        // 没等到账单 ≠ 没停（记账会晚）。但也不能装作停了 ——
        // 说清「请求发出去了」，把「水还在流」的退路指出来，并且**留着那颗按钮**：
        // 账单真出来那一刻它会自己变回「接水」、顺手结算（见 wtLivePoll）。
        toast('停止请求已发出。水要是还在流，在饮水机上按一下停止', 6000);
        wtLiveStartPoll();
      }
    }
  } catch (e) {
    toast('停止失败：' + e.message, 4000);
  } finally {
    wtStopping = false;
    wtPaintLive();
  }
}

/* ---- 免责声明：**积分任务**那一条路弹一次 ----------------------------
   文案在 index.html 里（照 WaterWidget 的 README / TaskRiskDialog 抄的）。
   🔴 每次进都弹等于逼人盲点「我知道了」，那这个提示就白写了 ⇒ 记一笔。
   🔴 也**不能**一进「功能」页就弹：那一页还有一卡通和办事入口，多数人不是
      为积分来的；而这一层是 `position:fixed; inset:0` 的全屏遮罩，会把底部
      导航一起盖住 —— 用户看到的是「点了没反应」，以为 App 卡死了。
      ⇒ 只挂在「一键完成」这个**真会动账号**的动作前面。
   🔴 0.38.0：**接水那条路已经不弹它了**（用户 2026-11-01：「点接水不要出
      弹窗提示了，太麻烦了」）。接水的风险改成卡里常驻一行 `#wtRisk`。
      这里保留是因为积分任务会被平台风控（扣分/冻结/限流），
      那是用户明确要求过的一次性告知，跟「接水会出水」不是一回事。 */
const WT_TERMS_KEY = 'wt.terms.ok';
/* 点了「知道了」要接着做的那件事（只在首次弹层时存在） */
let wtPending = null;

/** true = 已经读过，可以继续；false = 刚弹出来，等用户点「知道了」。 */
function wtNeedTerms(next) {
  if (store.get(WT_TERMS_KEY, false)) return true;
  wtPending = (typeof next === 'function') ? next : null;
  $('wtTerms').hidden = false;
  return false;
}

function wtTermsOk() {
  $('wtTerms').hidden = true;
  store.set(WT_TERMS_KEY, true);
  const f = wtPending;
  wtPending = null;
  if (f) f();
}

/** 进这一页。**先画缓存再探网** —— 每次进来都从空白开始等，是白等。 */
async function renderWater() {
  wtLoadLive();           // 「刚才你启动了 X」是本机记的，不用等网络
  wtPaintLive();
  wtPaintLast();          // 「刚才那次」只在本进程里有，切回来还在就还显示
  // 有会话就接着盯账单（切走时 switchTab 会停掉，回来这里再起）
  if (WT.live) wtLiveStartPoll();

  let st;
  try {
    st = await api('/api/water/state');
  } catch (e) {
    wtShowOff('unknown');
    wtTip('读不到登录状态：' + e.message, true);
    return;
  }
  const acc = (st && st.accounts) || {};
  WT.accounts = { device: acc.device || null, score: acc.score || null };
  if (!st || st.state === 'none' || st.state === 'broken') {
    wtShowOff();
    // 「存着但解不开」（换过手机 / 清过数据 / Keystore 换密钥）和「从没登录」
    // 长得一样，但该说的话不一样：前者重登一次就好，后者是第一次用。
    if (st && st.state === 'broken') {
      wtTip('存的登录失效了（换手机或清过数据），重登一次就好', true);
    }
    return;
  }

  // partial = 只登了其中一个账号。**照常显示能看的部分**，缺的那半在账号卡上说。
  if (Array.isArray(st.devices)) WT.devs = st.devices;
  wtShowOn();
  wtPaintDevs();          // 本机缓存，不用等网络
  wtPaintBal();           // 余额没有缓存，先画「没读到」，等下面那次结果
  wtPaintScore();         // 同上：先画「没读到」，别让格子空着像坏了
  wtPaintMissions();
  wtPaintBills();
  // 设备账号才有余额/设备/账单；只登了积分账号时别去请求（会白报一个 auth 错）
  if (WT.accounts.device) {
    await wtLoad();
  } else {
    WT.balErr = '要用「设备登录」那个账号才能查余额和接水';
    WT.devErr = '';
    wtPaintBal();
    wtPaintDevs();
  }
  await wtLoadExtras();
}

/** 余额设备之外的三块（积分 / 任务 / 消费记录）并行拉。
 *  并行不是图快：串行的话任务接口慢一点，账单就跟着晚三秒才出来。
 *  每块自己 catch，一块挂了不影响另外两块 —— 用户至少要看到能看的那部分。 */
async function wtLoadExtras() {
  const jobs = [
    wtLoadScore().catch(() => {}),
    wtLoadMissions().catch(() => {}),
    // 兑换要的钱包端点。和积分同一个账号，所以一起拉；失败不影响别的块。
    wtLoadWallets().catch(() => {}),
  ];
  // 🔴 消费记录只认**设备账号**（1,1）。只登了积分账号时别去请求：
  //    打过去会被路由的守卫挡回来，`kind` 是 auth，而 `wtLoadBills` 见到
  //    auth 就弹「登录状态过期」—— 明明没过期，只是没登另一个账号。
  //    「没登这个账号」和「票过期了」在界面上必须是两句话。
  if (WT.accounts.device) {
    jobs.push(wtLoadBills(false).catch(() => {}));
  } else {
    WT.billErr = '要用「设备登录」那个账号才能看消费记录';
    WT.bills = [];
    WT.billsLoaded = false;
    wtPaintBills();
  }
  await Promise.all(jobs);
}

/** 点右上角刷新：这一页所有东西都重读一遍。 */
async function wtRefreshAll() {
  // 同上：没有设备账号时 `/home` 会回 auth，被当成「登录过期」弹卡。
  if (WT.accounts.device) {
    await wtLoad();
  } else {
    WT.bal = null;
    WT.balErr = '要用「设备登录」那个账号才能查余额和接水';
    wtPaintBal();
    wtPaintDevs();
  }
  await wtLoadExtras();
}

/** 发短信验证码。🔴 失败不自动重试，换一张图让用户重新读。 */
async function wtSendSms() {
  if (WT.busy) return;
  const phone = $('wtPhone').value.trim();
  const graph = $('wtGraph').value.trim();
  if (!/^1\d{10}$/.test(phone)) { wtTip('手机号要 11 位数字', true); return; }
  if (!graph) { wtTip('先把图上的字填进去', true); return; }
  if (!WT.key) { wtTip('图形验证码没加载出来，点「换一张」', true); return; }

  WT.busy = true;
  $('wtSend').disabled = true;
  wtTip('正在发短信…', false);
  try {
    const r = await api('/api/water/sms', { phone, key: WT.key, graph });
    if (!r || !r.ok) {
      // 发短信这一步失败（图形码不对 / 手机号被限 / 平台改版）。

      wtTip(wtErrText(r && r.kind, r && r.error), true);
      wtNewCaptcha();               // 图形验证码一次性，失败必须换
      return;
    }
    wtTip('短信发出去了，看一下手机', false);
    wtCountdown(60);
    $('wtSms').focus();
  } catch (e) {
    wtTip('发短信失败：' + e.message, true);
  } finally {
    WT.busy = false;
    if (!WT.timer) $('wtSend').disabled = false;
  }
}

/** 用短信验证码换 token。🔴 失败**绝不自动重试**（红线）：错一次就换图。 */
/** 点了某一行的按钮：已登录就退出，没登录就展开表单登这个。 */
function wtOpenLogin(kind) {
  if (WT.busy || WT.running || wtStopping || WT.ex.busy || loading) return;
  if (!Water.configured()) { toast('当前构建缺少航院通 0.52.0 参考配置'); return; }
  const selected = kind === 'score' ? 'score' : 'device';
  if (WT.loginKind === selected && !$('waterOff').hidden) return;
  WT.loginKind = selected;
  $('wtPhone').value = Water.state().accounts[selected]?.phone || '';
  $('wtSms').value = '';
  WT.key = '';                 // 换账号就换一张图，别用上一张的 key
  // 过期卡收起来：表单已经出来了，再摆一张「过期了」只会挤占屏幕
  $('wtExpired').hidden = true;
  if (typeof wtPaintAccounts === 'function') wtPaintAccounts();
  // 🔴 表单在「账号管理」页上，人却在「功能」页（过期卡就在那儿）。
  //    不切过去的话，点了「重登设备账号」屏幕上什么都不变 —— 2026-11-08
  //    用户原话：「点击前往设备登录应该直接跳转过去」。记住从哪来，
  //    登完送回去（见 wtLogin），别让人自己再找一遍。
  const box = $('waterOff');
  box.hidden = false;
  $('wtLoginTitle').textContent = WT.loginKind === 'device' ? '登录设备账号' : '登录积分账号';
  // 一行说清「这个账号是干什么的」。原来这里还解释了一遍「用短信验证码、
  // 密码不用填」—— 表单上就三行、没有密码框，看得见，不用再说。
  $('wtLoginWhy').textContent = WT.loginKind === 'device'
    ? '管接水、余额和设备。短信验证码登录。'
    : '积分是另一个账号，也得单独登一次。';
  // 表单在页面上方，滚上去让人看见它出来了
  if (box && box.scrollIntoView) box.scrollIntoView({ block: 'start', behavior: 'smooth' });
  wtNewCaptcha();
}

function wtCancelLogin() {
  WT.loginKind = '';
  WT.key = '';
  WT.loginBack = '';       // 取消了就别再「登完送回去」
  $('waterOff').hidden = true;
  $('wtPhone').value = '';
  $('wtSms').value = '';
  $('wtGraph').value = '';
  wtTip('', false);
  wtPaintAccounts();
  // 一个账号都没有的话，账号卡本来就空着 —— 把它顶上来当「首次使用」的说明
  if (!WT.accounts.device && !WT.accounts.score) wtShowOff();
}

async function wtLogin() {
  if (WT.busy) return;
  const kind = WT.loginKind || 'device';
  const phone = $('wtPhone').value.trim();
  const sms = $('wtSms').value.trim();
  if (!/^1\d{10}$/.test(phone)) { wtTip('手机号要 11 位数字', true); return; }
  if (!/^\d{4,8}$/.test(sms)) { wtTip('短信验证码是手机收到的那串数字', true); return; }

  WT.busy = true;
  $('wtLogin').disabled = true;
  wtTip('正在登录…', false);
  try {
    const r = await api('/api/water/login', { phone, sms, kind });
    if (!r || !r.ok) {
      // 慧生活登录失败。它最近改得勤（2026-11-06 那次「请升级最新版」），
      // 有上报才能看出是「版本墙」还是「码不对」还是「校验变了」。
      // ⚠️ 手机号和验证码都不报 —— 只报分类和平台自己说的话。

      wtTip(wtErrText(r && r.kind, r && r.error), true);
      wtNewCaptcha();
      $('wtSms').value = '';
      return;
    }
    WT.phone = r.phone || phone;
    // 记住号码，下次（包括退出登录以后）直接带出来
    // The existing Keystore keeps the last authenticated phone.
    WT.key = '';                  // 这张图用完了，下次登录要新的
    WT.loginKind = '';            // 表单收起来
    $('wtSms').value = '';
    $('wtGraph').value = '';
    wtTip('', false);
    clearInterval(WT.timer);
    WT.timer = 0; WT.cd = 0;
    $('wtSend').disabled = false;
    $('wtSend').textContent = '发送';
    // 🔴 登完**整页重画**，不是只画账号卡：补登积分账号后，任务列表会多出
    //    另一个平台的那一半，签到卡也可能才第一次能显示。只画账号卡的话，
    //    用户看到「已登录」却还是那几条任务，会以为没生效。
    //
    // 🔴 2026-11-08：人是从「功能」页点「重登」进来的，登完**直接送回去**，
    //    并且回去时重读这一页 —— 用户原话：「登录完成后应该直接刷新状态，
    //    不然还需要退出APP清后台再进来才能刷新状态」。
    //    送回去用 switchTab（它自己会调 renderWater），不自己改 hidden：
    //    改 hidden 不同步 CUR_PAGE / 底部高亮，返回键就指错地方了。
    expiredAccounts.delete(kind);
    verifiedAccounts.add(kind);
    wtCancelLogin();
  } catch (e) {
    wtTip('登录失败：' + e.message, true);
  } finally {
    WT.busy = false;
    $('wtLogin').disabled = false;
    window.renderServiceAccounts?.();
  }
}

/** 启动一台饮水机。
 *  🔴 **唯一有副作用**的调用：真的会出水、真的会按用量扣钱。
 *  🔴 **什么都不弹**（2026-10-31 拍板不弹二次确认；2026-11-01 又把免责弹层也撤了：
 *     「点接水不要出弹窗提示了，太麻烦了」）。
 *     走过的两版理由都记在这儿，免得以后有人又「出于安全」加回去：
 *       · 二次确认问的是「会出水、会扣钱」—— 这是接水这件事的定义，
 *         问第二遍只是挡路；真正防误触的是**位置**（按钮只长在某一台设备那一行）
 *         和**即时反馈**（点完这一行立刻变成「正在出水 + 停止」）。
 *       · 免责声明原来是一次性全屏遮罩，但它挡住的恰恰是「第一次用水」那一下，
 *         而且「知道了」点完还是要接水 —— 它的作用是**告知**，不是**关卡**。
 *         ⇒ 改成卡里常驻的一行小字（`#wtRisk`），风险照旧写在用户眼前，
 *           只是不再拦着他。
 *     ⚠️ 积分任务的免责弹层**没撤**（wtRunAll 那条路）：那是会动账号的风控动作，
 *        用户明确要求过那一次告知，两者不是一回事。
 *  ⚠️ 参数 `name` 只用于提示文案，不参与请求。 */
async function wtStart(did, name) {
  if (WT.busy || WT.live || wtStopping || !WT.accounts.device) return;
  if (!did) { toast('这台设备的编号没读到，刷新一下'); return; }
  const label = name || ('设备 ' + did);
  if (!window.confirm('确认你在「' + label + '」旁，启动后将按平台规则计费。')) return;

  WT.busy = true;
  try {
    const r = await api('/api/water/start', { did });
    if (!r || !r.ok) {
      if (r && r.kind === 'auth') { wtExpire('device'); return; }
      // 业务错误逐条说清楚（欠费 / 没签约 / 没绑卡 / 没权限…），
      // 这些**不是**重试能救的，所以要停 4 秒让人读完。
      toast(wtErrText(r && r.kind, r && r.error), 4000);
      return;
    }
    toast(r.msg || '已经启动了，接完自动结算', 3000);
    // 记下「你在本机点了启动」，提醒条要用它。
    // 🔴 这只是**本机记录**，不是服务端状态 —— /ui/app/master 没有
    //    「这台正在出水」这个字段，别把猜的说成读到的。
    WT.live = { did: did, name: label, at: Date.now() };
    store.set(WT_LIVE_KEY, WT.live);
    wtLiveHint = '';      // 新一轮开始，上一轮的「等设备结束」不许跟过来
    // 新一轮开始，「刚才那次」就该让位 —— 留着会让人以为这次已经结算过了
    WT.last = null;
    wtPaintLive();
    wtPaintLast();
    // 开始盯账单：人可能在机器上按结束，APP 得自己发现（见 wtLivePoll）
    wtLiveStartPoll();
  } catch (e) {
    toast('启动失败：' + e.message, 4000);
  } finally {
    WT.busy = false;
  }
}

/** 退出登录。只清本机的 token，**不动**慧生活798 那边的登录态 ——
 *  我们没资格替用户在别人的平台上登出。 */
async function wtLogout(kind) {
  const one = (kind === 'device' || kind === 'score') ? kind : '';
  const name = one === 'device' ? '设备账号' : (one === 'score' ? '积分账号' : '登录');
  const ok = await askConfirm('退出' + name,
    one
      ? '只清这个账号，另一个不受影响。'
      : '只清这台手机上的登录，另一个账号不受影响。',
    '退出');
  if (!ok) return;
  WT.busy = true;
  try {
    const result = await api('/api/water/logout', one ? { kind: one } : {});
    if (!result.ok) { toast(result.error || '退出失败'); return; }
    expiredAccounts.delete(one);
    verifiedAccounts.delete(one);
    wtCancelLogin();
    window.renderServiceAccounts?.();
  } finally {
    WT.busy = false;
  }
  WT.key = '';
  WT.loginKind = '';
  if (one) {
    // 🔴 只退一格：另一个账号的数据原样留着。整套清掉的话，退积分账号会
    //    把余额和设备也变成「没读到」，而用户只是不想跑任务了。
    WT.accounts[one] = null;
    if (one === 'score') {
      WT.score = null; WT.scoreErr = '';
      WT.missions = []; WT.missionErr = ''; WT.missionSkipped = 0;
      WT.daily = null; WT.lanes = null; WT.laneErr = {};
      WT.run = {}; WT.running = false; WT.cur = '';
    } else {
      WT.bal = null; WT.balErr = ''; WT.devs = []; WT.devErr = '';
      WT.loadedAt = 0;
      WT.bills = []; WT.billsLoaded = false; WT.billsMore = false;
      WT.live = null; store.del(WT_LIVE_KEY);
      WT.last = null;
      wtPaintLive(); wtPaintLast();
    }
    clearInterval(WT.timer);
    WT.timer = 0; WT.cd = 0;
    $('wtSend').disabled = false;
    $('wtSend').textContent = '发送';
    // 号码留着（退出登录不清），下次点「登录」直接带出来
    $('wtPhone').value = WT.phone || '';
    $('wtSms').value = '';
    $('wtGraph').value = '';
    window.renderServiceAccounts?.();
    return;
  }
  WT.bal = null; WT.balErr = ''; WT.devs = []; WT.devErr = '';
  WT.loadedAt = 0; WT.expired = false;
  // 0.24.0 的三块也要清：不清的话换个人登录，屏幕上还挂着上一个人的积分和账单
  WT.score = null; WT.scoreErr = '';
  WT.missions = []; WT.missionErr = ''; WT.missionSkipped = 0;
  WT.daily = null; WT.lanes = null; WT.laneErr = {};
  WT.run = {}; WT.running = false; WT.cur = '';
  WT.bills = []; WT.billErr = ''; WT.billsPage = 0; WT.billsMore = false;
  WT.billsLoaded = false;
  WT.accounts = { device: null, score: null };
  WT.live = null; store.del(WT_LIVE_KEY);      // 换账号了，上一个人接的水不关我事
  wtLiveStopPoll();                            // 轮询也得停，否则拿新账号去查旧会话
  WT.last = null;                              // 「刚才那次」也是上一个人的
  wtPaintLive();
  wtPaintLast();
  clearInterval(WT.timer);
  WT.timer = 0; WT.cd = 0;
  $('wtSend').disabled = false;
  $('wtSend').textContent = '发送';
  $('wtPhone').value = WT.phone || '';
  $('wtSms').value = '';
  $('wtGraph').value = '';
  wtShowOff();
}


// 没登慧生活时那颗按钮：账号在「我的 → 账号管理」，直接把人送过去并展开设备登录。
$('wtGoLogin').addEventListener('click', () => {
  // 「重试」= 这一页没读到登录状态，重读一次就行，别把人拖去登录页
  if ($('wtGoLogin').dataset.act === 'retry') { renderWater(); return; }
  // 记住从哪来：登完要送回这一页（见 wtLogin）。这里必须**先记再切** ——
  // 切过去之后 CUR_PAGE 就是 'accounts' 了，那时再问「从哪来」只会得到
  // 「账号管理」，人就永远回不去功能页。
  window.openServiceAccounts?.();
});
$('wtCapNew').addEventListener('click', () => { wtNewCaptcha(); });
// 点图也能换一张。图和「看不清？换一张」是同一个动作 —— 用户看图第一反应
// 是点图，不是找链接。
$('wtCapImg').addEventListener('click', () => { wtNewCaptcha(); });
// 图挂了也要给个交代：静默失败的话用户看到的是一个空框，不知道是网慢还是坏了。
// 🔴 这里**不能**自动重新拉 —— 会和 wtNewCaptcha 打成一个循环（每张图都挂就
//    无限请求）。只提示，让用户自己点。
$('wtCapImg').addEventListener('error', () => {
  $('wtCapImg').classList.add('bad');
  wtTip('图形验证码没加载出来，点一下换一张', true);
});
$('wtSend').addEventListener('click', () => { wtSendSms(); });
$('wtLogin').addEventListener('click', () => { wtLogin(); });
// 两行账号：点「登录」展开表单，点「退出」只退那一格。
$('wtLoginCancel').addEventListener('click', () => { wtCancelLogin(); });
// 刷新 = 刷新**这一页**（余额设备 + 积分 + 任务 + 账单），不是只刷余额。
// 只刷一半的话，用户看到「余额变了、积分还是刚才那个数」，会以为积分不更新。
// 0.27.0 起页头只有一颗刷新（直饮水并进功能页了），它两样都刷。
$('wtOpenApp').addEventListener('click', () => { openWater(); });
// 0.39.1：「退出登录」整行删了，改由「账号管理」里设备/积分各自的「退出」承担
// （`wtAccTap` → `wtLogout(kind)`）。这一页只留常用动作。
// 「重新登录」不跳别处，就在本页把表单换出来 —— 手机号还在，只要再收条短信。
$('wtRelogin').addEventListener('click', () => { window.openServiceAccounts?.(); });
// 0.24.0：一键完成任务 / 加载更多账单 / 停止接水（2026-11-10 起「停止」
// 不再是一颗固定按钮 —— 它就是设备行上那颗「接水」变成的，见 wtPaintDevs）
$('wtRunAll').addEventListener('click', () => { wtRunAll(); });
// 0.50.0 v5：后台自动的入口（和学习通那一头是同一个弹层，见 openAutoSheet）
// 0.33.0：任务明细默认收起（一屏的预算），点标题行展开。
// 🔴 只折叠**明细**，不折「一键完成」—— 收起不是让操作多一步。
$('wtTaskOpen').addEventListener('click', () => {
  const box = $('wtTaskBox'), hd = $('wtTaskOpen');
  const open = box.hidden;
  box.hidden = !open;
  hd.setAttribute('aria-expanded', open ? 'true' : 'false');
});
// 「停下」只置标记，真正退出发生在下一个检查点 —— 不打断正在飞的那一个请求
// （打断了服务端可能已经收下，我们却当成没发，下次还会再发一次）。
$('wtRunStop').addEventListener('click', () => {
  WT.runStop = true;
  toast('正在停…（正在提交的那一个会走完）');
});
$('wtBillMore').addEventListener('click', () => { wtLoadBills(true); });
// ---- 积分兑换余额（0.27.1）----
// 默认收起：这一页已经很长，不兑换的人不该先看一堆控件。
$('wtExOpen').addEventListener('click', () => {
  WT.ex.open = !WT.ex.open;
  WT.ex.qty = 1;                 // 每次打开从 1 份开始，别记住上一次的份数
  $('wtExMsg').hidden = true;
  wtExPaint();
});
$('wtExUnits').addEventListener('click', (e) => {
  const b = e.target.closest('.wtchip');
  if (!b) return;
  WT.ex.unit = Number(b.dataset.unit);
  WT.ex.qty = 1;                 // 换档位时份数归 1 —— 留着旧份数会突然变成「积分不够」
  wtExPaint();
});
// 份数的上下限：下限 1，上限 = 可用积分买得起的份数（和 wtExTotalOf 同一个判据）
$('wtExMinus').addEventListener('click', () => {
  WT.ex.qty = Math.max(1, WT.ex.qty - 1);
  wtExPaint();
});
$('wtExPlus').addEventListener('click', () => {
  const avail = (WT.score && typeof WT.score.valid === 'number') ? WT.score.valid : null;
  const max = avail == null ? 1 : Math.floor(avail / WT.ex.unit);
  WT.ex.qty = Math.min(Math.max(1, max), WT.ex.qty + 1);
  wtExPaint();
});
// 多个钱包时点「兑换到」换一个（只有一个钱包时这颗按钮是 disabled 的）
$('wtExTo').addEventListener('click', async () => {
  const ws = Array.isArray(WT.ex.wallets) ? WT.ex.wallets : [];
  if (ws.length < 2) return;
  const cur = wtExCurWallet();
  const id = await openPick('兑换到哪个钱包', '', [{
    items: ws.map((w) => ({ id: w.endpointId, name: w.name })),
  }], cur ? cur.endpointId : '');
  if (id == null) return;        // 取消 = 不换
  WT.ex.eid = id;
  wtExPaint();
});
$('wtExGo').addEventListener('click', () => { wtExGo(); });
$('wtExchangeHistory').addEventListener('click', async () => {
  if (WT.ex.busy) return;
  const records = Water.exchangeRecords();
  if (!records.length) { toast('本机还没有兑换记录'); return; }
  const id = await openPick('兑换记录', '选择一条核对平台状态', [{
    items: records.map(record => ({
      id: record.id,
      name: ntStamp(record.at / 1000) + ' · ' + record.score + ' 分 · ' + (record.done ? '已到账' : '待确认')
    }))
  }], '');
  if (!id) return;
  const record = records.find(item => item.id === id);
  const result = await api('/api/water/exchange-bill?id=' + encodeURIComponent(id));
  if (result.ok && result.done) Water.rememberExchange({ ...record, done: true });
  toast(result.ok ? (result.done ? '兑换已到账' : '兑换还未完成') : result.error);
});
// 「全部兑换」：份数顶到上限，然后走**同一条**提交路径。
// 🔴 必须复用 wtExGo，不能另写一份「一次提交到底」：那等于把「只提交一次、
//    失败不重试、拿到账单号还要核 status」这一整套再抄一遍，抄漏一句就是
//    重复扣分。这里只负责把份数按到最大。
$('wtExMax').addEventListener('click', () => {
  const avail = (WT.score && typeof WT.score.valid === 'number') ? WT.score.valid : null;
  const max = wtExMaxQty(WT.ex.unit, avail);
  if (max < 1) return;
  WT.ex.qty = max;
  wtExPaint();
  wtExGo();
});
// 「做完自动换成余额」的开关（0.44.0，默认开）。
$('wtDevAdd').addEventListener('click', () => { wtAddDevStart(); });
// 0.37.0：手动输入编号（不碰相机）。两颗图标各管一条路，
// 有相机也不影响这一颗 —— 用户点了「手动输入」就是不想扫。
$('wtDevType').addEventListener('click', () => { wtAddDev(); });
// 0.52.0 v7：碰一碰。机器上贴了我们写的贴纸时，贴一下就能到这台机器，
// 不用扫码、不用输编号。
// 「已隐藏 N 台 · 恢复」：一次全恢复，不做二级页面（一共最多几十台）
$('wtDevShow').addEventListener('click', async () => {
  const n = wtHiddenCount();
  if (!n) return;
  const ok = await askConfirm('恢复 ' + n + ' 台？',
    '它们会重新出现在列表里。', '恢复', false);
  if (!ok) return;
  wtUnhideAll();
  wtPaintDevs();
});
// 消费记录默认收起：这一页先回答「还有多少钱」，明细是偶尔翻的。
$('wtBillOpen').addEventListener('click', () => {
  const open = $('wtBillBox').hidden;
  $('wtBillBox').hidden = !open;
  $('wtBillOpen').setAttribute('aria-expanded', open ? 'true' : 'false');
});
$('wtScanClose').addEventListener('click', () => { wtScanStop(); });
// 相机用不了时的退路：先关相机（不然灯一直亮），再走粘贴那条老路。
$('wtScanPaste').addEventListener('click', () => { wtScanStop(); wtAddDev(); });
// 2026-11-10：原来这里给 `#wtStop`（顶部那条上的按钮）挂监听。
// 那条已经删了 —— 「停止」现在就是设备行上那颗「接水」变的，
// 监听在 wtPaintDevs 里跟着重画一起重新绑（见那里的注释）。
$('wtTermsOk').addEventListener('click', () => { wtTermsOk(); });

let shown = false;
let loading;
function update() {
  const now = visible();
  if (!now) {
    if (shown) {
      wtLiveStopPoll();
      wtPopClose();
      if (!$('wtScan').hidden) wtScanStop();
      if (WT.running) WT.runStop = true;
    }
    shown = false;
    return;
  }
  if (!shown && !loading) {
    loading = renderWater().finally(() => { loading = null; });
  }
  shown = true;
}
$('jctWaterRefresh').addEventListener('click', async event => {
  if (loading || WT.busy || WT.running) return;
  const button = event.currentTarget;
  button.disabled = true;
  try { await (loading = renderWater()); }
  finally { loading = null; button.disabled = false; }
});
function close() {
  if (activeDialog) { activeDialog(); return true; }
  if (!$('wtScan').hidden) { wtScanStop(); return true; }
  if (!$('wtTerms').hidden) { $('wtTerms').hidden = true; wtPending = null; return true; }
  if (wtPop) { wtPopClose(); return true; }
  return false;
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    wtLiveStopPoll();
    if (WT.running) WT.runStop = true;
  } else if (visible() && WT.live) {
    wtLiveStartPoll();
  }
});
window.WaterPage = Object.freeze({
  update, close, expired: kind => expiredAccounts.has(kind),
  verified: kind => verifiedAccounts.has(kind),
  busy: () => WT.busy || WT.running || wtStopping || WT.ex.busy || !!loading,
  login: wtOpenLogin, cancelLogin: wtCancelLogin,
  logout(kind) {
    if (this.busy()) return;
    if (kind === 'device' && WT.live) { toast('请先在饮水页确认本次用水已结束'); return; }
    return wtLogout(kind);
  }
});
})();
