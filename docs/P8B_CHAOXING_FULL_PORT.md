# P8B 学习通业务迁移

来源是本机 `D:\项目\jct\base(1).apk`。航院通包名 `com.hobson.hangyuantong`，版本 `0.52.1`，构建号 `157`，SHA-256 为 `a409580b72670db3c332a7f067120e0abc4599619706efc6ac3f1a7103874213`。使用包内 `assets/web/native.js`、`app.js`，并对照 `index.html`、`app.css` 与 `classes.dex` 中的 `NativeBridge`、`CxNet`、凭据保存调用。

| 原功能与函数 | 迁移结果和宿主差异 | 验证 |
| --- | --- | --- |
| `cxLogin`、`cxRelink` | 保留登录页 GET、AES 表单 POST 和响应分支。酱菜通在账号中心由用户主动提交，用临时 Cookie 容器先核验课程再替换会话。密码仅在勾选时由 Keystore 保存，可手动重连，验证码通过原官方隔离页面完成。 | MuMu 打开登录表单和官方入口，取消返回。真实密码提交与已保存密码重连未执行。 |
| `cxRestore`、`cxPersist`、`cxDisconnect` | 对接现有 Android 应用启动恢复与按账号保存的 Cookie。学习通断开同时清除本机记住的学习通密码，统一账号中心其他账号走既有实现。 | 真实旧会话跨覆盖安装与冷启动恢复，账号中心仍显示学习通状态。第二账号切换和真实退出未执行。 |
| `cxHttp`、`cxCourses`、`cxCourseMeta`、`cxStatusOk`、`cxJsonLoggedOut` | 使用参考 URL、字段顺序和节流，复用现有 Android 回调和按账号 Cookie。保留登录 JSON、HTTP 401、202 和 429 分类。重定向限制在学习通受支持域。 | MuMu 读取 63 门真实教学班。登录失效与普通失败的区分通过定向测试。 |
| `cxWorkList/ParseWork`、`cxExamList/ParseExam`、`cxActiveList/ParseActive`、`cxActiveUrl` | 迁入作业、考试、签到、练习、讨论、通知及活动解析，保留实际链接。酱菜通继续识别未读全的分页与明确空列表，提取可靠的任务 ID 和明确标注的发布时间。仅有倒计时的任务不显示推算出的绝对截止。任务链接由用户点击后在隔离 WebView 打开。 | 全量扫描读回真实分项，缺失分项保留已有数据。未执行写操作。 |
| `cxScanAll`、`cxRestNext`、`cxScanState`、`cxAutoScan`、`cxScanStart` | 移植深查、活动探测、课间间隔、失败汇总、冷却期与自动触发。单课与全量共用核心，扫描进度用本地回调交给页面。12 小时到期的隐藏或活跃度未知教学班在同一轮获得完整检查。 | 手动全量及进入学习页触发的自动扫描均完成。自动扫描处理 63 门，55 门完整读取、8 门有分项未读全，解析到作业 167 条、考试 38 条、活动 822 条。 |
| `cxDiffNew`、`cxSortItems`、`cxGroupByCourse`、`cxItemHtml`、`cxPaintTodo` | 复用原版比较、排序和分组算法。新任务按教学班及稳定 ID 比较。任务行和筛选使用酱菜通 P5 组件，待批阅保留为已完成，结束和已截止保留在历史筛选中。 | MuMu 验证教学班分组和已完成筛选。新增条目比较、旧响应隔离通过定向测试。没有制造真实新增任务。 |

旧 `Learning.readCourse`、P8 六门课批次循环、其定时器与重复课程查询入口均由 `cxScanAll` 路径替换。沿用账号级 `jct.study.v3` 缓存，保存扫描记录及每教学班各类任务，保留历史、30 天自动隐藏、恢复、手动隐藏及始终显示。P4 读取原版扫描产生的作业和通知结果。系统未接入航院通的后台自动作业，也不会自动登录、签到、答题或交卷。

JavaScript 语法检查、11 项学习通定向测试及 Android Debug 构建通过。MuMu 以覆盖方式安装，保留既有数据并冷启动到主界面，继续使用近期扫描缓存。APK 为 `D:\项目\jct\android\dist\JiangCaiTong-0.9.1-debug.apk`，构建号 36，SHA-256 为 `0d8b1d955c7d392b0a8b639da077ceff98aa487692cbbf706e82020e26ce27a9`。
