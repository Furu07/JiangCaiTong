# 酱菜通 · JiangCaiTong

面向江西财经大学的非官方 Android 校园助手。项目基于航院通，使用内置 WebView、JavaScript 和 Java 原生桥接，支持 Android 8.0+（API 26+）。应用 ID 为 `com.jxufe.jct`。

## 当前状态

P1B 已生成 0.3.0 Debug APK，并在 MuMu Android 15 实例上完成安装、启动和核心运行验证。

| 入口 | 已实现 | 验证范围 |
| --- | --- | --- |
| 课表 | 示例课表、学期切换、周视图和日视图、课程详情、单双周、调课与冲突标记、离线缓存、脱敏课表导入 | Android 上验证了课表交互、选文件及粘贴导入。江财个人课表查询等待授权样本 |
| 学习 | 学习通官方登录窗口、课程列表、按课程查询作业、考试和活动、本机结果缓存 | Android 上验证了桥接隔离及合成会话导入、退出和隔离。真实账号登录与查询待验证 |
| 生活 | 慧生活798手动验证码登录、余额、设备与消费记录分页 | Android 上验证了合成会话的加密存储及退出。真实服务与江财宿舍兼容性待验证 |
| 我的 | 服务账号状态、退出、网页缓存清理和应用信息 | Android 运行检查 |

## 构建

需要 Python 3.10+、JDK（本轮用 24.0.1）、Android SDK Platform 33 和 Build Tools 35.0.0。构建脚本只依赖 Python 标准库。

```powershell
py -3.12 android/build_apk.py
```

脚本从 `ANDROID_HOME`、`ANDROID_SDK_ROOT` 或系统默认位置查找 Android SDK，从 `JAVA_HOME` 或 `PATH` 查找 JDK。首次构建会生成独立的本地 Debug 签名密钥。输出为 `android/dist/JiangCaiTong-0.3.0-debug.apk`。安装到已连接且已授权的测试设备可执行以下命令。

```powershell
adb install -r android/dist/JiangCaiTong-0.3.0-debug.apk
```

## 源码

- `android/` 包含 Manifest、应用资源、Java 桥接和构建脚本。
- `web/` 包含打包进 APK 的页面、主题、课表模型及服务查询逻辑。
- `docs/` 包含交接参考与本轮的 [Android 运行验证](docs/P1B_RUNTIME_VALIDATION.md) 和 [教务接入与样本说明](docs/P1B_ACADEMIC_INTEGRATION.md)。

课表离线测试及合成样本位于 `tests/`。本地导入格式见教务接入与样本说明。

酱菜通与江西财经大学官方无关。航院通原作者为 Hobson，原版权声明及 MIT 许可证见 [LICENSE](LICENSE)。[上游源码](https://cnb.cool/Hobson2233/hangyuantong)
