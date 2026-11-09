# P0C Android 运行验证

验证日期为 2026-11-09。先检查了 P0B 的 0.1.0 APK，再复核本轮 0.2.0 Debug 包。

| 项目 | 0.2.0 结果 |
| --- | --- |
| APK | `D:\项目\jct\android\dist\JiangCaiTong-0.2.0-debug.apk`，62,511 字节 |
| SHA-256 | `811fd1956a6ea502078179e6601fe5251b474c285ab696a86455568d2258f681` |
| 构建 | `py -3.12 android/build_apk.py` 成功，使用既有 JDK 24.0.1、Platform 33、Build Tools 35.0.0 |
| 标识与 Manifest | 酱菜通、`com.jxufe.jct`、versionCode 2、minSdk 26、targetSdk 33、debuggable、`INTERNET` 权限。禁用备份及明文流量。启动入口为 `MainActivity`，学习通 `WebActivity` 未导出。 |
| 签名及资源 | `zipalign -c 4` 和 `apksigner verify` 均通过，v2/v3，证书 `CN=JiangCaiTong Debug`。ZIP CRC、DEX 和许可证检查通过，APK 中的全部 Web 资产与工作区逐字节一致。 |

## 设备与验证边界

- **Android 运行阻塞。** 现有 MuMu 6.6.4.0 的 Android 15 实例未启动，管理器返回 `-503 mainnx connect failed`，ADB 连接返回 `-201 vm not running`。用安装快捷方式对应参数启动控制器后进程退出，实例仍未启动。SDK 中无可用 AVD，`adb devices -l` 为空。
- **浏览器实际运行。** 使用 Edge Headless 360px 视口及模拟 Android 接口，8 项界面断言通过，涵盖四栏导航、学期切换、调课和冲突、日视图详情、离线恢复、官方教务按钮及清缓存按钮的桥接调用。设备上的 APK 安装、首次加载、桥接、Keystore、退出和缓存清理仍待验证。
- **桥接隔离为静态审查结果。** 仅本地资产的 `MainActivity` 注册 JavaScript Bridge，拦截远程导航并限制页面资源。学习通登录使用独立且无桥接的 WebView。江财入口交给系统浏览器。

## 会话检查与修正

审查发现旧登录 WebView 会复用浏览器 Cookie，而旧的 Java CookieHandler 为进程级。现改为打开学习通登录窗口先清理应用内浏览器 Cookie，再进入官方登录。导入要求已离开登录站、课程 API 主机存在身份 Cookie，同名身份 Cookie 不得在允许的主机间冲突。新会话保存成功后替换学习通原生 Cookie 容器。请求及跳转限制在明确的学习通主机，798 不使用此容器。退出时清除持久会话并替换容器，在途请求持有旧容器。

上述会话边界已编译，真实官方页面的登录跳转、Cookie 路径与登录态交接仍需授权设备验证。本轮未提交真实登录或短信请求，也未执行接水和支付操作。
