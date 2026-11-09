# P0B 验证报告

验证日期为 2026-11-09，运行环境为 Windows。

## 工具链与构建

| 项目 | 实测 |
| --- | --- |
| Python | PATH 上的 `python` 为 2.7.3。复用 Python Launcher 下的 Python 3.12.4。 |
| Java | 复用本机 JDK 24.0.1，以 Java 8 字节码级别编译。 |
| Android SDK | Google 官方包 Platform 33 与 Build Tools 35.0.0，下载归档按仓库元数据的 SHA-1 校验。 |
| adb | 复用 `C:\adb\adb.exe`，版本 1.0.41（Platform Tools 33.0.0），设备列表为空。 |
| 第一次构建 | Build Tools 34.0.0 的 D8 在读取编译后的类时抛出空指针异常。切换为 35.0.0 后完成转 Dex、对齐和签名。 |
| 最终构建 | 成功。JDK 打印 API 弃用提示和签名器 native access 提示，构建及签名检查正常结束。 |

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-24'
py -3.12 android/build_apk.py
```

[Android SDK 官方工具文档](https://developer.android.com/tools/sdkmanager)

## 定向运行检查

- `node --check` 检查了 5 个 JavaScript 文件，`py -3.12 -m py_compile android/build_apk.py` 检查了构建脚本。Java 语法和类型由本次 `javac` 构建检查。
- 在本机 Edge Headless 的 360px 移动视口加载实际前端，注入模拟 `Android` 接口与本地响应。16 项断言全部通过，覆盖教学周解析和越界拒绝、首次同步、周/日视图、单双周、详情打开与关闭、离线缓存和重载恢复、底部导航、学习通查询、798余额与设备、消费记录分页、退出与手动验证码会话，以及请求列表中无控制或交易路径。
- 此运行检查使用模拟响应，未访问真实业务端点，也未发送短信。网页脚本与原生接口之间的 Android 运行时行为仍需设备验证。

## APK 检查

| 检查项 | 结果 |
| --- | --- |
| 文件 | `D:\项目\jct\android\dist\JiangCaiTong-0.1.0-debug.apk` |
| 大小 | 54,246 字节 |
| SHA-256 | `d5376817601e0edd65445242ee9618e5f958761d2f472614ccd0998449df4d6c` |
| `aapt2 dump badging` | 酱菜通、`com.jxufe.jct`、`0.1.0`（code 1）、minSdk 26、targetSdk 33、debuggable、入口 `com.jxufe.jct.MainActivity`、自有图标、`INTERNET` 权限。 |
| `zipalign -c 4` | 通过。 |
| `apksigner verify --verbose --print-certs` | v2 与 v3 验证通过，签名证书为 `CN=JiangCaiTong Debug`。 |
| ZIP 与资源 | ZIP 完整性检查通过，`classes.dex` 存在，所有 Web 资产及 LICENSE 与本地源码逐字节一致。 |

本轮验证止于模拟前端、构建与 APK 基本检查。真机或模拟器安装、设备端登录和原生存储、江财真实课表，以及两项服务的真实查询均待验证。
