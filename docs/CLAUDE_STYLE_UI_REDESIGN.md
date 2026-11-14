# 酱菜通界面改造 · 0.9.3 Debug

视觉参考来自 Anthropic 公开展示的 Claude Projects 实际界面。采用其中的暖中性色、衬线标题与无衬线正文组合、轻边框分组和克制的操作强调。设置页保留浅色、深色和跟随系统三种选择。Claude 登录后的页面以官方公开截图为参考。[Claude Projects 产品界面](https://www.anthropic.com/news/projects) · [Claude 外观设置](https://support.claude.com/en/articles/8887527-customizing-your-appearance-settings)

## 视觉与代码

- 浅色以 `#faf9f5`、`#fffefa` 和 `#f5f4ed` 区分页面和表面，深色使用 `#262624`、`#302e2a` 和 `#2e2e2a`。赤陶色用于主按钮和选中项，成功、警告、危险操作各自使用独立颜色。
- 标题用 Android 可用的衬线字体回退，正文用系统无衬线。共享 8 px 控件圆角、12 px 容器圆角、44 px 常用控件高度，页面边距随宽度变化。底栏保留五个入口，用细线和颜色表示选中。弹层使用统一遮罩，待办编辑的字段可滚动，操作区独立。
- `web/index.html` 整理页面容器和待办弹层。 `web/app.css` 负责共享组件和模块布局，`web/water-page.css` 替换饮水页原有渐变、阴影和按系统主题写死的样式。`web/app.js` 只调整动态 DOM 的样式类。
- Android 的 `MainActivity.java` 和日夜间 `colors.xml` 同步系统栏及启动底色。构建脚本和 README 更新至 0.9.3。官方认证窗口仍由原有 Android Activity 打开。

## 业务入口对应

| 模块 | 原入口与处理函数 | 新界面入口 |
| --- | --- | --- |
| 教务 | `scheduleSync → syncSchedule`，学期选择 → `loadSelectedTerm`，周次和周／日切换 → `renderSchedule`，课程 → `showDetails` | 同一课表控件改为紧凑工具栏，七天列保留；选中日期用细线强调 |
| 成绩和考试 | `data-academic → selectAcademicPanel`，学期和刷新 → `renderAcademicRecords`，校方查看和重连 → `openAcademicBinding` 和 `openAccounts` | 子栏目改为下划线切换，成绩与考试使用分隔线列表，保留原字段和原查询入口 |
| 学习 | `studyRefresh → queryStudy`，类型、状态和课程分组 → `cxPaintTodo`，课程与任务 → `openStudyCourse` 和 `openStudyTask`，隐藏相关操作 → `changeStudyVisibility` | 状态区、筛选区与任务列表分开，保持任务排序、自动扫描、30 天活跃度和缓存逻辑 |
| 待办 | `todoForm`、`todoEditForm`、复选框和删除确认仍由 `todo-page.js` 绑定，使用原本地存储 | 快速输入区、完成筛选、分隔线任务列表和可滚动编辑弹层 |
| 生活 | `data-life → selectLifeService`。798 原有登录、刷新、账单、设备、启停和积分按钮使用 `water-page.js`。洗浴继续由 `zhuli-device-page.js` 和 `zhuliOpen` 处理 | 饮水保留余额面板和分组列表，洗浴按项目、设备和官方服务分组，显示当前接入状态 |
| 我的 | `accountsOpen → openAccounts`，服务连接及断开由 `renderAccounts` 绑定，外观 → `applyUiTheme`，清理缓存 → 原 Android 桥接 | 设置列表和五种账号状态使用低对比度分隔线。保留 P9 移除介绍卡片及教务重复登录卡片的结果 |

网络接口、Android 业务桥接、认证协议、数据结构和存储方式沿用原实现。所有 HTML 元素 ID、任务筛选值和导航绑定均与 0.9.2 对照过。

## MuMu 前后对比

截图来自同一独立 MuMu 测试用户，使用 360 dp 视口、应用自带示例课表及本地测试待办。学习、饮水和成绩、考试截图展示各自未连接状态。

[五个模块对比总览](claude-ui-screenshots/comparison.jpg)

| 模块 | 0.9.2 | 0.9.3 |
| --- | --- | --- |
| 教务 | [截图](claude-ui-screenshots/before-schedule.png) | [截图](claude-ui-screenshots/after-schedule.png) |
| 学习 | [截图](claude-ui-screenshots/before-study.png) | [截图](claude-ui-screenshots/after-study.png) |
| 待办 | [截图](claude-ui-screenshots/before-todo.png) | [截图](claude-ui-screenshots/after-todo.png) |
| 生活 | [截图](claude-ui-screenshots/before-life.png) | [截图](claude-ui-screenshots/after-life.png) |
| 我的 | [截图](claude-ui-screenshots/before-me.png) | [截图](claude-ui-screenshots/after-me.png) |

子页面：[成绩](claude-ui-screenshots/after-grades.png) · [考试](claude-ui-screenshots/after-exams.png) · [待办编辑](claude-ui-screenshots/after-todo-editor.png) · [编辑字段聚焦](claude-ui-screenshots/after-todo-focus.png) · [校园洗浴](claude-ui-screenshots/after-shower.png) · [账号管理](claude-ui-screenshots/after-accounts.png)

深色：[教务](claude-ui-screenshots/after-schedule-dark.png) · [饮水](claude-ui-screenshots/after-life-dark.png) · [我的](claude-ui-screenshots/after-me-dark.png) · [跟随系统](claude-ui-screenshots/after-system-dark.png)

## 验证及 APK

- MuMu 验证五项导航、示例课表手动刷新、周／日切换、成绩和考试的账号入口、学习账号入口及返回、饮水登录入口、洗浴官方服务入口、五项账号状态、深浅主题和跟随系统。
- 待办验证添加、编辑备注、保存、完成和取消完成、按状态筛选、删除确认及长标题换行。MuMu 默认输入法测试中，备注字段聚焦后仍可保存，截图未显示带实际高度的键盘。实体机有高度的键盘遮挡仍待验证。
- 在 320 CSS px 的 Edge 中，用本地合成数据验证学习任务类型筛选、任务状态筛选、按课程分组、展开隐藏课程及长标题无横向溢出。合成数据未打包。
- 原有 MuMu 用户的 0.9.3 冷启动确认留在主界面，可见已有江财课表缓存。线上成绩、考试、学习通和饮水数据未在本轮重新读取。未执行支付、充值、积分兑换或设备控制。
- JavaScript 语法、CSS 解析、DOM 绑定对照和 Git 差异检查通过。运行 `py -3.12 android/build_apk.py` 完成构建和 Debug 签名验证。MuMu 覆盖安装成功，版本 0.9.3，构建号 38，包名 `com.jxufe.jct`。
- APK 路径 `android/dist/JiangCaiTong-0.9.3-debug.apk`，SHA-256 为 `AC85AA1DDC12B09DB7ED183A9FCF136F14FAD24A0D6FC832E2F6998C84821495`。
