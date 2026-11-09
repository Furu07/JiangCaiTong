# P1B Android 运行验证

验证日期为 2026-11-09，设备为本机 MuMu 6.6.4.0 Android 15（API 35）实例，Android WebView 110.0.5481.154.1。

## 环境与构建

本轮诊断时 Windows 报告已运行 Hypervisor，MuMu 实例起初停止。管理器接受一次启动请求，启动期间 ADB 返回 `-201 vm not running`。约 20 秒后 MuMu 日志报告 `start_finished`、虚拟化可用，ADB 连接成功。本轮复用了该实例。此前的连接失败原因没有进一步证据，现有实例无需修复即可运行。

0.2.0 APK 首次安装成功，`MainActivity` 冷启动实测 533 ms。0.3.0 APK 随后覆盖安装并冷启动，最终一次实测 319 ms。

| 项目 | 0.3.0 APK |
| --- | --- |
| 构建 | `py -3.12 android/build_apk.py` 成功，复用现有工具链 |
| 路径 | `D:\项目\jct\android\dist\JiangCaiTong-0.3.0-debug.apk` |
| 大小与 SHA-256 | 66,682 字节，`ca95b6013e749b73c5997e313d02823d3a4dd2149b6b1c750ff1773c68211a5d` |
| 包信息 | `com.jxufe.jct`、versionCode 3、minSdk 26、targetSdk 33、入口 `MainActivity` |
| 签名与内容 | v2/v3 签名及对齐通过。APK 的 DEX、ZIP 完整性、许可证和全部 Web 资产通过检查。 |

## 设备实测

- 0.2.0 和 0.3.0 均在 Android 上加载本地 WebView，四栏导航、周日视图、课程详情、离线缓存重载通过。JavaScript Bridge 实际收到原生异步回调，非白名单请求被拒。
- 0.3.0 实际通过 Android 系统文件选择器选中合成 JSON 并导入，也通过粘贴导入、失败保留、重载恢复和移除测试。示例与同 ID 的导入学期独立。
- 学习通登录 WebView 到达公开登录主机 `passport2.chaoxing.com`，该窗口内无法取得 `Android` 或 `nativeRequest`。用合成身份验证了 Cookie 导入、退出和旧会话拒绝。原生请求与缓存写入绑定授权标识，旧排队请求退出后返回 401，迟到的旧课程结果没有显示或保存。授权失败或取消时保留此前已接受的会话，退出清理的是本地会话。
- 798 使用合成会话通过真实 Android Keystore 写入、读取和退出清理。检查到持久值为 `k1:` 加密记录。学习通退出保留了 798 会话。网页缓存清理按钮已调度原生命令。测试脚本代答了退出确认。
- 日志里有旧的 UiAutomation 测试进程错误及 WebView 图形层诊断；本轮成功的测试与最终前台启动未观察到应用崩溃。

JavaScript 和 Python 语法检查通过，29 项离线课表、导入及同步状态断言通过。设备上的学习通 Cookie 和 798 会话使用合成凭据。真实账号登录、课程/任务查询、798 短信及余额设备账单查询、江财授权后课表查询仍待验证。
