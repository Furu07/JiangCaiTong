# P1 学习通与慧生活798集成计划

## 一、集成可行性评估

### 1.1 超星学习通

**结论**：✅ **可直接复用，无需修改**

**理由**：
1. 学习通是全国统一平台，协议与学校无关
2. 登录方式：手机号/学号 + 密码（AES加密）
3. 上游代码已实现完整功能：
   - 登录认证
   - 课程列表
   - 作业待办（6种状态识别）
   - 考试列表
   - 签到状态
   - 活动列表

4. 安全规则已内置（四条硬规矩）：
   - ✅ 只读，不签到/刷课/答题
   - ✅ 失败不重试
   - ✅ 未读到≠没有作业
   - ✅ 未知状态单独列出

**技术栈**：
- `chaoxing.py` (1816行Python)
- `native.js` 中的学习通方法
- `CxNet.java` (Android HTTP客户端)

**Cookie隔离**：
- 学习通域名：`.chaoxing.com` / `passport2.chaoxing.com`
- 教务域名：`jwxt.jxufe.edu.cn`
- Android CookieManager 自动按域隔离

### 1.2 慧生活798

**结论**：✅ **代码可复用，需验证江财部署**

**理由**：
1. 798平台由长沙云多啦（cloudora）运营，全国高校通用
2. 接口网关统一：`https://i.ilife798.com/api/v1`
3. 上游代码完整实现：
   - 双账号登录（设备路1,1 + 积分路1,5）
   - 余额查询
   - 设备列表
   - 启动/停止接水
   - 消费记录
   - 积分任务（带签名）

**需要验证的点**：
- ⚠️ 江财宿舍是否使用慧生活798平台
- ⚠️ 设备类型是否兼容（可能有地区差异）
- ⚠️ 账号注册流程（手机号短信验证）

**安全规则**：
- ✅ 不后台自动签到
- ✅ 不充值/下单
- ✅ 任务提交间隔≥30秒
- ✅ 失败提示风险

**签名盐值**：
- 已从官方APK 3.1.10提取
- `SALT_APP` 和 `SALT_MINI` 已记录在 `water.py`
- ⚠️ 官方更新时需同步更新

## 二、UI设计方案

### 2.1 底部导航（4格）

```
┌────────┬────────┬────────┬────────┐
│  课表   │  学习   │  生活   │  我的   │
│  📅    │  📚    │  🏠    │  👤    │
└────────┴────────┴────────┴────────┘
```

| Tab | 页面ID | 内容 | 数据来源 |
|-----|--------|------|---------|
| 课表 | `#page-schedule` | 周视图/日视图课表 | 江财教务 |
| 学习 | `#page-study` | 作业待办、考试、签到 | 超星学习通 |
| 生活 | `#page-life` | 饮水余额、设备、消费记录 | 慧生活798 |
| 我的 | `#page-me` | 账号绑定、设置、关于 | 本地存储 |

### 2.2 学习通页面布局

**顶部统计卡片**：
```
┌──────────────────────────────────┐
│ 学习通待办                        │
│                                  │
│  📝 作业  2个  ⏰ 考试  1场      │
│  ✅ 签到  0个  📢 通知  3条      │
│                                  │
│  最后更新：今天 14:32             │
│  [刷新]                          │
└──────────────────────────────────┘
```

**待办列表**（按紧急度排序）：
```
┌──────────────────────────────────┐
│ 📝 高等数学作业3                  │
│ 还剩 2天8小时                     │
│ 高等数学A(1) · 张教授             │
└──────────────────────────────────┘
┌──────────────────────────────────┐
│ ⏰ 大学英语期中考试                │
│ 2025-11-20 14:00                │
│ 教学楼A301 · 座位32号             │
└──────────────────────────────────┘
```

**空状态**：
```
┌──────────────────────────────────┐
│         📚                       │
│     还没绑定学习通账号            │
│                                  │
│  绑定后可以查看作业、考试、签到    │
│                                  │
│      [去绑定]                    │
└──────────────────────────────────┘
```

**加载中/刷新中**：
```
┌──────────────────────────────────┐
│         ⏳                       │
│     正在同步学习通数据...         │
│                                  │
│  这可能需要1-2分钟                │
└──────────────────────────────────┘
```

### 2.3 慧生活798页面布局

**余额卡片**（顶部，醒目）：
```
┌──────────────────────────────────┐
│ 💧 饮水余额                       │
│                                  │
│      ¥ 12.50                    │
│                                  │
│  最后消费：今天 08:32  0.30元     │
│  [充值] [消费记录]                │
└──────────────────────────────────┘
```

**设备列表**：
```
┌──────────────────────────────────┐
│ 🚰 我的设备                       │
│                                  │
│  西区9栋601-1号机                 │
│  设备ID: WM2023****89             │
│  [启动接水] [停止] [移除]         │
└──────────────────────────────────┘
┌──────────────────────────────────┐
│  [+ 添加设备]                     │
│  扫描设备二维码或输入设备号        │
└──────────────────────────────────┘
```

**积分任务**（可选，折叠）：
```
┌──────────────────────────────────┐
│ ⭐ 积分任务 (当前积分: 320)       │
│                                  │
│  📅 每日签到          +5 积分     │
│  🎉 完成任务          +10 积分    │
│  📢 分享活动          +3 积分     │
│                                  │
│  [一键完成]  (风险提示)           │
└──────────────────────────────────┘
```

**空状态**：
```
┌──────────────────────────────────┐
│         💧                       │
│     还没绑定慧生活798账号         │
│                                  │
│  绑定后可以查看饮水余额和消费      │
│                                  │
│      [去绑定]                    │
└──────────────────────────────────┘
```

### 2.4 "我的"页面调整

**三张绑定卡片**：

```
┌──────────────────────────────────┐
│ 🏫 江财教务账号                   │
│                                  │
│  已绑定: 2024010****              │
│  姓名: 张三                       │
│  班级: 会计2401班                 │
│                                  │
│  [刷新] [解绑]                    │
└──────────────────────────────────┘

┌──────────────────────────────────┐
│ 📚 学习通账号                     │
│                                  │
│  已绑定: 138****5678              │
│                                  │
│  [刷新] [解绑]                    │
└──────────────────────────────────┘

┌──────────────────────────────────┐
│ 💧 慧生活798                      │
│                                  │
│  已绑定: 138****5678              │
│  余额: ¥12.50                     │
│                                  │
│  [刷新] [解绑]                    │
└──────────────────────────────────┘
```

**设置区域**：
```
┌──────────────────────────────────┐
│ 🔧 设置                           │
│                                  │
│  > 学期设置                       │
│  > 上课时间                       │
│  > 已隐藏的课程                   │
│  > 主题外观                       │
└──────────────────────────────────┘
```

**关于区域**：
```
┌──────────────────────────────────┐
│ ℹ️ 关于酱菜通                     │
│                                  │
│  版本 1.0.0                       │
│  基于航院通(MIT License)二次开发  │
│  非官方应用，仅供学习交流          │
│                                  │
│  [检查更新] [用户协议] [隐私政策]  │
└──────────────────────────────────┘
```

## 三、数据模型

### 3.1 学习通数据模型

**课程（Course）**：
```javascript
{
  id: '12345',
  name: '高等数学A(1)',
  teacher: '张教授',
  school: '江西财经大学',
  term: '2024-2025-1',
  cover: 'https://...',  // 封面图
}
```

**作业（Homework）**：
```javascript
{
  id: '67890',
  courseId: '12345',
  courseName: '高等数学A(1)',
  title: '第三章作业',
  deadline: '2025-11-18 23:59',
  status: 'pending',  // pending | completed | overdue
  type: 'homework',   // homework | exam | quiz
}
```

**待办汇总（TodoSummary）**：
```javascript
{
  homeworkCount: 2,      // 未交作业数
  examCount: 1,          // 未考试数
  signInCount: 0,        // 未签到数
  noticeCount: 3,        // 未读通知数
  lastUpdate: 1700123456,  // 时间戳
}
```

### 3.2 慧生活798数据模型

**余额（Balance）**：
```javascript
{
  balance: 12.50,           // 当前余额
  lastAmount: 0.30,         // 最后消费金额
  lastTime: '2025-11-15 08:32',
  currency: 'CNY',
}
```

**设备（Device）**：
```javascript
{
  id: 'WM2023****89',
  name: '西区9栋601-1号机',
  location: '西区9栋601宿舍',
  status: 'idle',  // idle | running | offline
  lastUse: '2025-11-15 08:32',
}
```

**消费记录（Transaction）**：
```javascript
{
  id: 'T20251115001',
  type: 'water',          // water | recharge
  amount: 0.30,
  balance: 12.50,         // 交易后余额
  device: 'WM2023****89',
  time: '2025-11-15 08:32',
  volume: 300,            // 毫升
}
```

**积分任务（Task）**：
```javascript
{
  adId: 'AD123456',
  name: '每日签到',
  score: 5,               // 奖励积分
  type: 'daily',          // daily | share | custom
  status: 'available',    // available | completed | expired
  platform: 'app',        // app | mini（对应两套sign盐值）
}
```

## 四、接口集成

### 4.1 native.js 路由扩展

**新增路由**：

```javascript
window.NativeApi = {
  handle: function (path, body) {
    // 教务路由（江财）
    if (path === '/api/academic/login') return jufeLogin(body);
    if (path === '/api/academic/timetable') return jufeTimetable(body);
    if (path === '/api/academic/exams') return jufeExams(body);
    
    // 学习通路由（复用）
    if (path === '/api/chaoxing/login') return chaoxingLogin(body);
    if (path === '/api/chaoxing/courses') return chaoxingCourses();
    if (path === '/api/chaoxing/homework') return chaoxingHomework(body);
    if (path === '/api/chaoxing/exams') return chaoxingExams(body);
    if (path === '/api/chaoxing/activities') return chaoxingActivities(body);
    
    // 慧生活798路由（复用）
    if (path === '/api/water/login') return waterLogin(body);
    if (path === '/api/water/balance') return waterBalance();
    if (path === '/api/water/devices') return waterDevices();
    if (path === '/api/water/start') return waterStart(body);
    if (path === '/api/water/stop') return waterStop(body);
    if (path === '/api/water/transactions') return waterTransactions(body);
    if (path === '/api/water/tasks') return waterTasks();
    if (path === '/api/water/do_task') return waterDoTask(body);
    
    return { error: '未知接口：' + path };
  }
};
```

### 4.2 app.js 数据层封装

**学习通模块**：
```javascript
const ChaoxingAPI = {
  // 登录
  async login(username, password) {
    return api('/api/chaoxing/login', { username, password });
  },
  
  // 获取待办汇总
  async getTodoSummary() {
    const [homework, exams, activities] = await Promise.all([
      api('/api/chaoxing/homework'),
      api('/api/chaoxing/exams'),
      api('/api/chaoxing/activities'),
    ]);
    
    return {
      homeworkCount: homework.filter(h => h.status === 'pending').length,
      examCount: exams.filter(e => e.status === 'pending').length,
      signInCount: activities.filter(a => a.type === 'signin' && !a.done).length,
      noticeCount: activities.filter(a => a.type === 'notice' && !a.read).length,
      lastUpdate: Date.now(),
    };
  },
  
  // 缓存策略
  async getCachedOrFetch(key, fetcher, maxAge = 10 * 60 * 1000) {
    const cached = store.get(key);
    if (cached && Date.now() - cached.time < maxAge) {
      return cached.data;
    }
    
    const data = await fetcher();
    store.set(key, { data, time: Date.now() });
    return data;
  },
};
```

**慧生活798模块**：
```javascript
const WaterAPI = {
  // 登录（短信验证码）
  async sendCode(phone) {
    return api('/api/water/send_code', { phone });
  },
  
  async login(phone, code) {
    return api('/api/water/login', { phone, code });
  },
  
  // 获取余额
  async getBalance() {
    return api('/api/water/balance');
  },
  
  // 设备管理
  async getDevices() {
    return api('/api/water/devices');
  },
  
  async addDevice(qrCode) {
    return api('/api/water/add_device', { qrCode });
  },
  
  async removeDevice(deviceId) {
    return api('/api/water/remove_device', { deviceId });
  },
  
  // 接水控制
  async startWater(deviceId, volume = 300) {
    return api('/api/water/start', { deviceId, volume });
  },
  
  async stopWater(deviceId) {
    return api('/api/water/stop', { deviceId });
  },
  
  // 消费记录
  async getTransactions(page = 1, limit = 20) {
    return api('/api/water/transactions', { page, limit });
  },
};
```

## 五、实现优先级

### 5.1 P0 - 第一阶段（基础功能）

**目标**：显示占位页面，账号绑定框架

**学习通**：
- [x] 底部导航"学习"Tab
- [x] 空状态页面
- [x] 登录表单（账号密码）
- [ ] 简单的课程列表展示

**慧生活798**：
- [x] 底部导航"生活"Tab
- [x] 空状态页面
- [x] 登录表单（手机号+验证码）
- [ ] 余额卡片展示

**"我的"页面**：
- [x] 三张账号绑定卡片
- [x] 显示绑定状态
- [ ] 绑定/解绑操作

### 5.2 P1 - 第二阶段（完整功能）

**学习通**：
- [ ] 待办列表（作业、考试、签到）
- [ ] 倒计时显示
- [ ] 按紧急度排序
- [ ] 后台定时刷新（可选）
- [ ] 提醒通知（可选）

**慧生活798**：
- [ ] 设备列表
- [ ] 扫码添加设备
- [ ] 启动/停止接水
- [ ] 消费记录列表
- [ ] 积分任务（谨慎实现，需用户确认）

### 5.3 P2 - 第三阶段（增强功能）

**学习通**：
- [ ] 课程详情页
- [ ] 筛选和搜索
- [ ] 成绩查询
- [ ] 学分统计

**慧生活798**：
- [ ] 充值功能（跳转官方APP或网页）
- [ ] 账单分析
- [ ] 用量统计图表
- [ ] 设备共享（多人绑定）

## 六、账号隔离方案

### 6.1 独立存储

**CredStore（Android Keystore）**：
```
KEY_ACADEMIC = "jufe_academic"   // 江财教务
KEY_CHAOXING = "chaoxing"       // 学习通
KEY_WATER = "water_798"         // 慧生活798
```

**localStorage（Web）**：
```javascript
const CRED_KEYS = {
  academic: 'jct.cred.academic',
  chaoxing: 'jct.cred.chaoxing',
  water: 'jct.cred.water',
};
```

### 6.2 Cookie隔离

**CookieManager（Android）**：
```java
// 自动按域隔离，无需手动处理
// jwxt.jxufe.edu.cn        → 教务cookie
// .chaoxing.com            → 学习通cookie
// i.ilife798.com           → 798cookie
```

### 6.3 登出清理

**单个账号登出**：
```javascript
async function logoutAcademic() {
  // 清除凭据
  await api('/api/academic/logout');
  CredStore.delete('jufe_academic');
  
  // 清除缓存
  store.del('jct.data.academic');
  store.del('jct.cache.timetable');
  
  // 清除Cookie
  CookieManager.removeAll('jwxt.jxufe.edu.cn');
}
```

**全局登出**：
```javascript
async function logoutAll() {
  await Promise.all([
    logoutAcademic(),
    logoutChaoxing(),
    logoutWater(),
  ]);
  
  toast('所有账号已退出');
  navigateTo('me');
}
```

## 七、安全策略

### 7.1 凭据存储

**不存储明文密码**：
- ✅ 教务：只存储加密后的凭据（如有Token）
- ✅ 学习通：存储加密后的Cookie
- ✅ 慧生活798：存储Token（短信登录后获取）

**加密方式**：
- Android：Keystore + AES/GCM
- Web：localStorage（浏览器沙盒保护）

### 7.2 网络请求

**HTTPS优先**：
- 学习通：`https://mooc1.chaoxing.com`
- 慧生活798：`https://i.ilife798.com`
- 江财教务：`https://jwxt.jxufe.edu.cn`（需验证）

**HTTP兜底**：
- 如果教务系统是HTTP，在 `network_security_config.xml` 中明确声明

**超时设置**：
- 连接超时：15秒
- 读取超时：30秒
- 学习通查询（慢）：延长到60秒

### 7.3 频率限制

**教务系统**：
- 两次请求间隔≥1.2秒
- 登录失败后等待5秒

**学习通**：
- 不重试（防止触发验证码）
- 查询间隔≥2秒

**慧生活798**：
- 任务提交间隔≥30秒
- 短信验证码60秒内只能发一次

## 八、错误处理

### 8.1 网络错误

**分级处理**：
```javascript
function handleError(error) {
  if (error.code === 'NETWORK_ERROR') {
    toast('网络连接失败，请检查网络设置');
  } else if (error.code === 'TIMEOUT') {
    toast('请求超时，请稍后重试');
  } else if (error.code === 'AUTH_FAILED') {
    toast('登录已过期，请重新登录');
    navigateTo('me');
  } else {
    toast('操作失败：' + (error.message || '未知错误'));
  }
}
```

### 8.2 数据异常

**容错解析**：
```javascript
function parseCourse(data) {
  try {
    return {
      name: data.name || '未知课程',
      teacher: data.teacher || '未知教师',
      room: data.room || '待定',
      weeks: parseWeeks(data.weeks) || [],
    };
  } catch (e) {
    console.error('解析课程失败', data, e);
    return null;
  }
}

// 过滤掉解析失败的项
const courses = rawData.map(parseCourse).filter(Boolean);
```

### 8.3 版本兼容

**接口版本标识**：
```javascript
const API_VERSION = {
  academic: 'v1',
  chaoxing: 'v1',
  water: 'v1',
};

function api(path, body) {
  const headers = {
    'X-API-Version': API_VERSION[getModule(path)],
  };
  return fetch(path, { body, headers });
}
```

## 九、测试策略

### 9.1 单元测试

**学习通解析器测试**：
```javascript
// tests/chaoxing_parser.test.js
describe('学习通数据解析', () => {
  it('应正确解析作业列表', () => {
    const html = readFixture('chaoxing_homework.html');
    const result = parseHomework(html);
    
    expect(result).toHaveLength(3);
    expect(result[0].title).toBe('第三章作业');
    expect(result[0].status).toBe('pending');
  });
  
  it('应处理空作业列表', () => {
    const html = '<div class="empty">暂无作业</div>';
    const result = parseHomework(html);
    
    expect(result).toHaveLength(0);
  });
});
```

**慧生活798签名测试**：
```javascript
// tests/water_sign.test.js
describe('慧生活798签名', () => {
  it('应生成正确的App路签名', () => {
    const sign = signScore('AD123', 'token123', 'uid456', true, 1700000000000);
    expect(sign).toBe('<预期的MD5值>');
  });
});
```

### 9.2 集成测试

**学习通登录流程**：
```javascript
// tests/integration/chaoxing_login.test.js
describe('学习通登录', () => {
  it('应成功登录并获取课程列表', async () => {
    const result = await ChaoxingAPI.login(TEST_PHONE, TEST_PASSWORD);
    expect(result.status).toBe('success');
    
    const courses = await ChaoxingAPI.getCourses();
    expect(courses.length).toBeGreaterThan(0);
  });
});
```

### 9.3 UI测试

**Playwright / Puppeteer**：
```javascript
// tests/ui/study_page.test.js
test('学习通页面显示待办列表', async ({ page }) => {
  await page.goto('http://localhost:8788');
  await page.click('[data-page="study"]');
  
  // 模拟登录
  await page.click('#bindChaoxing');
  await page.fill('#cxPhone', '13800000000');
  await page.fill('#cxPassword', 'password');
  await page.click('#cxSubmit');
  
  // 等待列表加载
  await page.waitForSelector('.homework-item');
  
  const count = await page.locator('.homework-item').count();
  expect(count).toBeGreaterThan(0);
});
```

## 十、发布检查清单

### 10.1 功能完整性

**学习通**：
- [ ] 登录成功
- [ ] 显示课程列表
- [ ] 显示作业待办
- [ ] 显示考试安排
- [ ] 倒计时计算正确
- [ ] 刷新功能正常

**慧生活798**：
- [ ] 短信验证码发送
- [ ] 登录成功
- [ ] 显示余额
- [ ] 显示设备列表
- [ ] 扫码添加设备
- [ ] 启动/停止接水

### 10.2 安全检查

- [ ] 凭据加密存储
- [ ] Cookie按域隔离
- [ ] 敏感信息不进日志
- [ ] 登出清理完整
- [ ] HTTPS证书验证

### 10.3 性能检查

- [ ] 首屏加载<2秒
- [ ] 列表滚动流畅
- [ ] 后台刷新不阻塞UI
- [ ] 内存占用<100MB
- [ ] APK体积<2MB

### 10.4 兼容性检查

- [ ] Android 8.0+
- [ ] 深色模式
- [ ] 横屏适配
- [ ] 不同屏幕尺寸
- [ ] 不同分辨率

---

**文档状态**：✅ **学习通和798集成计划已完成**，等待实际开发验证。

**下一步**：实现占位UI → 完整功能 → 测试验证。
