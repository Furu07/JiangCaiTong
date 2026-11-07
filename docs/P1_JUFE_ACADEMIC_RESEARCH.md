# P1 江财教务系统适配研究

## 一、系统识别

### 1.1 基本信息

- **学校**：江西财经大学
- **公开入口**：`http://xk.jxufe.edu.cn/`（选课门户）
- **实际系统**：`https://jwxt.jxufe.edu.cn/`
- **厂商**：青果软件集团有限公司（KINGOSOFT）
- **产品**：高校智慧校园教学综合服务平台
- **协议**：HTTPS（与郑航的HTTP不同）

### 1.2 与上游差异

| 维度 | 郑航（金智EAMS） | 江财（青果KINGOSOFT） |
|------|----------------|---------------------|
| **厂商** | 金智教育 | 青果软件 |
| **协议** | HTTP | HTTPS |
| **登录方式** | SHA1加密 | 待验证 |
| **验证码** | 无 | "正常情况免验证码" |
| **统一认证** | 教务系统独立 | CAS统一身份认证 |
| **域名** | jwglxt.zua.edu.cn | jwxt.jxufe.edu.cn |

**结论**：✅ **证实用户需求中的警告**——江财教务接口与郑航完全不同，不能假设兼容。

### 1.3 统一身份认证

**CAS 登录流程**：
1. 访问 `https://jwxt.jxufe.edu.cn/` 
2. 重定向到 `/cas/login.action`
3. POST 用户名、密码、验证码（条件触发）
4. 获取 TGT（Ticket Granting Ticket）
5. 重定向回教务系统，携带 ST（Service Ticket）
6. 验证 ST，建立会话

**账号规则**（来自选课页公告）：
- 账号：一卡通号
- 密码：信息门户"智慧江财"统一身份认证密码
- 初始密码：绑定手机号激活设置

**扫码登录**：
- 二维码由"喜鹊儿"（xiqueer.com）提供
- 移动端APP扫码后授权登录
- 酱菜通可选择支持（需要研究喜鹊儿协议）

## 二、关键接口推测

### 2.1 登录接口

**URL**：`POST /cas/login.action`

**推测参数**：
```
username: <一卡通号>
password: <加密后的密码>（需要抓包确认加密方式）
captcha: <验证码>（"正常情况免验证码"，可能用频率限制触发）
service: <回调URL，如 https://jwxt.jxufe.edu.cn/...>
```

**需要确认**：
1. 密码加密方式（RSA、AES、明文？）
2. 验证码触发条件
3. 验证码格式（图片、滑块、算术？）
4. Cookie/Token 存储机制

### 2.2 课表查询

**推测入口**（基于青果系统通用结构）：
- 学生应用 → 网上选课 → 我的课表
- 或：学生应用 → 教学安排 → 个人课表

**URL 推测**：
```
GET /student/course/schedule
GET /student/course/timetable
POST /student/course/query
```

**需要参数**：
- 学期ID / 学年学期
- 学生ID（可能在会话中）
- 查询类型（周视图、日视图）

**返回格式**（需实测）：
- HTML 表格
- JSON 数据
- XML 格式

### 2.3 学期管理

**学期标识**：
- 郑航格式：`2024-2025-1`（学年-学期）
- 江财格式：待确认（可能是 `261` 这种简码，从公告中"261学期"推测）

**学期列表接口**：
```
GET /student/term/list
GET /common/term/current
```

**校历接口**：
- 选课页有"校历"链接
- 需要用于计算当前教学周

### 2.4 成绩查询

**推测入口**：
- 学生应用 → 成绩查询 → 全部成绩
- 学生应用 → 成绩查询 → 学期成绩

**需要参数**：
- 学期筛选
- 成绩类型（考试成绩、平时成绩）

### 2.5 考试安排

**推测入口**：
- 学生应用 → 考试安排 → 考试查询

**返回字段**（推测）：
- 课程名称
- 考试时间
- 考试地点
- 座位号
- 考试类型（期末、期中、补考）

## 三、技术实现方案

### 3.1 JufeAcademicAdapter 架构

**模块结构**：
```
JufeAcademicAdapter/
├── auth.js          # CAS登录、会话管理
├── parser.js        # HTML/JSON解析器
├── course.js        # 课表查询
├── term.js          # 学期管理
├── exam.js          # 考试查询
├── grade.js         # 成绩查询
└── util.js          # 加密、日期、网络工具
```

**集成位置**：
- Android端：`native.js` 中新增 `jufe` 命名空间
- Python端（测试用）：`jufe_academic.py`

### 3.2 登录流程

```javascript
async function login(username, password) {
  // 1. 获取登录页，读取加密参数（如有）
  const loginPage = await http('GET', '/cas/login.action');
  const { salt, publicKey } = parseLoginParams(loginPage);
  
  // 2. 加密密码
  const encryptedPwd = encryptPassword(password, salt, publicKey);
  
  // 3. 检查是否需要验证码
  const needCaptcha = checkCaptchaRequired(loginPage);
  let captcha = '';
  if (needCaptcha) {
    // 返回验证码图片URL，由用户输入
    return { status: 'need_captcha', captchaUrl: '/cas/captcha.jpg' };
  }
  
  // 4. 提交登录
  const body = `username=${encodeURIComponent(username)}&` +
               `password=${encodeURIComponent(encryptedPwd)}&` +
               `captcha=${captcha}`;
  const result = await http('POST', '/cas/login.action', body);
  
  // 5. 解析结果
  if (result.includes('登录成功') || result.includes('个人主页')) {
    // 提取学生信息
    const { studentId, studentName, className } = parseUserInfo(result);
    return { status: 'success', studentId, studentName, className };
  } else {
    // 解析错误信息
    const errorMsg = parseErrorMessage(result);
    return { status: 'error', message: errorMsg };
  }
}
```

### 3.3 课表解析

**方案1：HTML表格解析**（青果系统常见）
```javascript
function parseTimetable(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  // 定位课表容器（需要实测确认选择器）
  const table = doc.querySelector('#kbtable') ||
                doc.querySelector('.course-table') ||
                doc.querySelector('table.kb');
  
  const courses = [];
  const rows = table.querySelectorAll('tr');
  
  // 第一行是星期标题，跳过
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].querySelectorAll('td');
    const period = i; // 第i节课
    
    for (let j = 1; j < cells.length; j++) {
      const dayOfWeek = j; // 周j
      const cell = cells[j];
      const courseBlocks = cell.querySelectorAll('.course-block');
      
      courseBlocks.forEach(block => {
        const course = {
          name: block.querySelector('.course-name')?.textContent.trim(),
          teacher: block.querySelector('.teacher')?.textContent.trim(),
          room: block.querySelector('.room')?.textContent.trim(),
          weeks: parseWeeks(block.querySelector('.weeks')?.textContent),
          dayOfWeek: dayOfWeek,
          startPeriod: period,
          endPeriod: period + 1, // 或从合并单元格读取
        };
        courses.push(course);
      });
    }
  }
  
  return courses;
}
```

**方案2：JSON API**（如果青果提供）
```javascript
async function fetchTimetable(termId) {
  const response = await http('POST', '/student/course/query', 
                               `termId=${termId}`);
  const data = JSON.parse(response);
  
  return data.courses.map(c => ({
    name: c.courseName,
    teacher: c.teacherName,
    room: c.classRoom,
    weeks: c.weekList,
    dayOfWeek: c.weekday,
    startPeriod: c.startSection,
    endPeriod: c.endSection,
    campus: c.campus,
  }));
}
```

### 3.4 周次解析

青果系统的周次格式推测：
- `1-16周`：第1周到第16周，每周都上
- `1-16单周`：单周上课
- `1-16双周`：双周上课
- `1-8,10-16周`：跳过第9周

```javascript
function parseWeeks(text) {
  const weeks = new Set();
  const parts = (text || '').split(/[,，]/);
  
  for (const part of parts) {
    const match = part.match(/(\d+)-(\d+)(单周|双周)?/);
    if (!match) {
      const single = part.match(/(\d+)/);
      if (single) weeks.add(parseInt(single[1]));
      continue;
    }
    
    const [_, start, end, oddEven] = match;
    for (let w = parseInt(start); w <= parseInt(end); w++) {
      if (oddEven === '单周' && w % 2 === 0) continue;
      if (oddEven === '双周' && w % 2 === 1) continue;
      weeks.add(w);
    }
  }
  
  return Array.from(weeks).sort((a, b) => a - b);
}
```

### 3.5 统一数据模型

```javascript
// 与航院通保持一致的课程数据结构
const CourseModel = {
  id: '',              // 课程ID
  name: '',            // 课程名称
  code: '',            // 课程代码
  teacher: '',         // 教师姓名
  room: '',            // 教室
  campus: '',          // 校区
  dayOfWeek: 1,        // 1-7（周一到周日）
  startPeriod: 1,      // 起始节次
  endPeriod: 2,        // 结束节次
  weeks: [1, 2, 3],    // 上课周次数组
  term: '',            // 学期标识
  credit: 0,           // 学分
  source: 'jufe',      // 数据来源标识
};
```

## 四、实现优先级

### 4.1 P0 - 基础登录与课表（第一阶段必需）

1. **CAS登录**：
   - ✅ 支持一卡通号 + 密码
   - ✅ 密码加密（需实测）
   - ⚠️ 验证码处理（条件触发时人工输入）
   - ✅ 会话保持

2. **当前学期课表**：
   - ✅ 查询当前学期课表
   - ✅ 解析HTML/JSON为标准格式
   - ✅ 周次计算
   - ✅ 离线缓存

3. **基础UI**：
   - ✅ 登录页（复用航院通框架）
   - ✅ 课表周视图（复用）
   - ✅ 课表日视图（复用）
   - ✅ 空状态提示

### 4.2 P1 - 完整功能（后续迭代）

1. **历史学期课表**：
   - 学期列表
   - 切换查询

2. **考试安排**：
   - 考试列表
   - 倒计时
   - 日历导出

3. **成绩查询**：
   - 全部成绩
   - 学期筛选
   - GPA计算

4. **校历管理**：
   - 自动获取学期起始日期
   - 教学周计算
   - 节假日标注

### 4.3 P2 - 增强功能（可选）

1. **扫码登录**：
   - 研究喜鹊儿协议
   - 实现二维码生成
   - 轮询登录状态

2. **课程提醒**：
   - 上课前通知
   - 考试倒计时
   - 作业截止提醒

3. **数据同步**：
   - 后台定时刷新
   - 增量更新
   - 冲突解决

## 五、风险与缓解

### 5.1 高风险项

**风险1：无法获取真实账号测试** 🔴
- **影响**：无法验证登录流程和数据格式
- **缓解策略**：
  1. 使用浏览器开发者工具抓包分析（用户提供截图）
  2. 实现模拟数据模式，先验证UI和缓存逻辑
  3. 设计接口抽象层，易于后续调整

**风险2：密码加密方式未知** 🔴
- **影响**：登录失败
- **缓解策略**：
  1. 分析登录页JavaScript代码（`login.js`、`encrypt.js`等）
  2. 常见方式：RSA公钥加密、AES对称加密、BASE64编码、明文
  3. 使用浏览器控制台逐步调试加密函数

**风险3：接口频繁变更** ⚠️
- **影响**：适配器失效
- **缓解策略**：
  1. 设计可配置的选择器和URL映射
  2. 多种解析策略fallback
  3. 失败时提供详细错误信息

### 5.2 中风险项

**风险4：验证码类型复杂** ⚠️
- **影响**：自动登录受阻
- **缓解策略**：
  1. 图片验证码：OCR识别（复用portal.py中的逻辑）
  2. 滑块验证码：人工完成，保留会话
  3. 行为验证：评估是否影响移动端使用

**风险5：课表格式多样** ⚠️
- **影响**：解析失败或数据不完整
- **缓解策略**：
  1. 多种选择器策略
  2. 字段容错处理
  3. 单元测试覆盖异常格式

### 5.3 低风险项

**风险6：HTTPS证书问题**
- Android默认信任系统CA
- 学校自签名证书需要额外处理（当前未发现）

**风险7：跨校区课程**
- 江财有多个校区（蛟桥园、麦庐园、枫林园）
- 课表需要显示校区信息

## 六、测试策略

### 6.1 无账号阶段测试

**模拟数据测试**：
```javascript
const MOCK_COURSE_DATA = {
  term: '2024-2025-1',
  weekStart: '2024-09-02',
  totalWeeks: 20,
  courses: [
    {
      name: '高等数学A(1)',
      teacher: '张三',
      room: '蛟桥园-教学楼A101',
      campus: '蛟桥园',
      dayOfWeek: 1,
      startPeriod: 1,
      endPeriod: 2,
      weeks: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16],
      code: 'MATH1001',
    },
    // ... 更多课程
  ],
};
```

**UI测试项**：
- ✅ 课表网格渲染
- ✅ 周次切换
- ✅ 日视图/周视图切换
- ✅ 课程详情弹层
- ✅ 空状态显示
- ✅ 缓存加载

### 6.2 有账号阶段测试

**登录测试**：
1. 正确账号密码
2. 错误密码
3. 不存在的账号
4. 验证码触发（故意快速重试）
5. 网络异常

**数据测试**：
1. 正常课表（10-15门课）
2. 空课表（未排课的新生）
3. 课程冲突（同一时间两门课）
4. 跨校区课程
5. 单双周课程
6. 不连续周次（1-8,10-16）

**边界测试**：
1. 学期初（第1周）
2. 学期末（第20周）
3. 假期中（无当前学期）
4. 辅修/双学位课程

### 6.3 回归测试

**对照测试**：
- Python `jufe_academic.py` 与 `native.js` 逐字段对拍
- 复用航院通的 `_lab/out/check_native_js.py` 框架

**截图测试**：
- 8个页面截图（课表/考试/成绩/设置/...）
- 深色模式
- 不同屏幕尺寸

## 七、接口文档模板

### 7.1 登录接口

**待用户或开发者实测填写**：

```yaml
# CAS 登录
POST https://jwxt.jxufe.edu.cn/cas/login.action

请求头:
  Content-Type: application/x-www-form-urlencoded
  User-Agent: Mozilla/5.0 ...
  Referer: https://jwxt.jxufe.edu.cn/cas/login.action

请求体:
  username: <一卡通号>
  password: <加密后密码>
  captcha: <验证码（可选）>
  service: <回调URL>
  
响应:
  成功: 302重定向 + Set-Cookie: TGC=...
  失败: 200 + HTML（包含错误提示）
```

### 7.2 课表接口

```yaml
# 待实测
GET/POST https://jwxt.jxufe.edu.cn/student/course/schedule

请求参数:
  termId: <学期ID>
  studentId: <学生ID（可能在cookie中）>
  
响应:
  格式: HTML表格 / JSON / XML
  字段: [待实测记录]
```

### 7.3 学期列表

```yaml
# 待实测
GET https://jwxt.jxufe.edu.cn/student/term/list

响应示例:
[
  { id: "261", name: "2024-2025-1", current: true },
  { id: "252", name: "2023-2024-2", current: false },
]
```

## 八、开发计划

### 8.1 阶段1：框架搭建（无需真实账号）

**时间**：1-2天

**交付物**：
1. ✅ `JufeAcademicAdapter` 目录结构
2. ✅ 接口抽象层（auth/course/term/exam）
3. ✅ 模拟数据生成器
4. ✅ 单元测试框架
5. ✅ UI集成（使用模拟数据）

### 8.2 阶段2：协议分析（需用户协助）

**时间**：2-3天

**工作内容**：
1. 🔍 用户提供登录页截图和开发者工具Network面板截图
2. 🔍 分析登录请求的加密方式
3. 🔍 获取课表页HTML样本
4. 🔍 编写解析器并用样本测试

**交付物**：
1. ✅ 登录流程文档
2. ✅ 接口映射表
3. ✅ 解析器代码
4. ✅ 测试用例

### 8.3 阶段3：真实测试（需真实账号）

**时间**：1-2天

**工作内容**：
1. 🧪 真实账号登录测试
2. 🧪 课表数据获取
3. 🧪 边界情况验证
4. 🐛 Bug修复

**交付物**：
1. ✅ 可用的登录和课表查询功能
2. ✅ 测试报告
3. ✅ 已知问题清单

### 8.4 阶段4：功能完善（后续迭代）

**时间**：3-5天

**工作内容**：
1. 考试安排
2. 成绩查询
3. 历史学期
4. 性能优化

## 九、即刻可执行的准备工作

### 9.1 代码框架

**创建 `native.js` 中的江财命名空间**：
```javascript
// 江财教务系统适配器
const JufeAcademic = {
  BASE: 'https://jwxt.jxufe.edu.cn',
  
  // CAS 登录
  async login(username, password) {
    // TODO: 实现登录逻辑
    return { status: 'not_implemented' };
  },
  
  // 查询课表
  async fetchTimetable(termId) {
    // TODO: 实现课表查询
    return { status: 'not_implemented' };
  },
  
  // 解析课表HTML
  parseTimetable(html) {
    // TODO: 实现解析逻辑
    return [];
  },
  
  // 获取学期列表
  async fetchTerms() {
    // TODO: 实现学期列表
    return [];
  },
};
```

### 9.2 模拟数据

**创建 `mock/jufe_courses.json`**：
```json
{
  "term": "2024-2025-1",
  "studentId": "20240101001",
  "studentName": "测试学生",
  "className": "会计2401班",
  "weekStart": "2024-09-02",
  "totalWeeks": 20,
  "courses": [
    {
      "id": "C001",
      "name": "高等数学A(1)",
      "code": "MATH1001",
      "teacher": "张教授",
      "room": "蛟桥园-教学楼A101",
      "campus": "蛟桥园",
      "dayOfWeek": 1,
      "startPeriod": 1,
      "endPeriod": 2,
      "weeks": [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16],
      "credit": 5.0
    }
  ]
}
```

### 9.3 配置更新

**修改 `NativeBridge.java` 的 BASE 常量**：
```java
// 支持多套教务系统
private static final String BASE_ZUA = "http://jwglxt.zua.edu.cn";  // 郑航（保留用于参考）
private static final String BASE_JUFE = "https://jwxt.jxufe.edu.cn"; // 江财

// 当前使用的系统
private static final String BASE = BASE_JUFE;
```

## 十、需要用户提供的信息

### 10.1 必需信息（P0）

1. **登录凭据**：
   - ✅ 一卡通号格式（如：202401010001）
   - ✅ 密码格式（长度、特殊字符要求）
   - ⚠️ 可用的测试账号（最好是无敏感数据的新生账号）

2. **登录页面分析**：
   - 📸 登录页面完整截图
   - 📸 浏览器开发者工具 → Network → 登录请求的Headers和Payload
   - 📄 登录页面HTML源码（右键"查看网页源代码"）
   - 📄 登录页面引用的JavaScript文件内容（如 `login.js`、`encrypt.js`）

3. **课表页面样本**：
   - 📸 课表页面截图（周视图）
   - 📄 课表页面HTML源码
   - 📋 实际课程数据（脱敏后的课程名、教室、周次等）

### 10.2 辅助信息（P1）

1. **学期信息**：
   - 当前学期标识（如"261"对应"2024-2025-1"）
   - 学期起始日期（如2024年9月2日）
   - 总教学周数（如20周）

2. **校区信息**：
   - 校区列表（蛟桥园、麦庐园、枫林园）
   - 教学楼编号规则

3. **考试/成绩页面**：
   - 考试安排页面截图和HTML
   - 成绩查询页面截图和HTML

### 10.3 可选信息（P2）

1. 教务系统使用手册或操作指南
2. 学校信息化部门联系方式（遇到技术问题时咨询）
3. 其他学校开发的类似APP（如有，可参考）

## 十一、替代方案

如果青果系统接口难以逆向或频繁变更，考虑以下备选方案：

### 方案A：WebView内嵌 + Cookie注入

- 用户在WebView中完成登录
- 提取Cookie后访问课表页
- 解析渲染后的DOM（而非原始HTML）

**优点**：绕过加密和反爬
**缺点**：依赖WebView环境，无法在Python测试端复现

### 方案B：导入ICS文件

- 如果教务系统支持导出课表为ICS（iCalendar）格式
- 用户手动导出后导入酱菜通
- 酱菜通解析ICS并渲染

**优点**：零逆向成本
**缺点**：需要用户手动操作，无法自动同步

### 方案C：OCR识别课表截图

- 用户截图课表
- 使用OCR提取文字
- 结构化解析

**优点**：完全不依赖接口
**缺点**：识别准确率低，用户体验差

**结论**：优先方案为直接调用接口，WebView方案作为fallback。

---

**本文档状态**：🚧 **待完善**，需用户提供真实登录和课表页面数据后更新。
