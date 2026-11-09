# 酱菜通 · JiangCaiTong

面向江西财经大学的非官方 Android 校园助手。项目基于航院通，使用内置 WebView、JavaScript 和 Java 原生桥接，支持 Android 8.0+（API 26+）。应用 ID 为 `com.jxufe.jct`。

## 当前状态

当前构建为 0.5.9 Debug。Android 9 及以上可在独立窗口完成江财授权，自动读取本人课表。已在 MuMu 验证 261、252 学期同步、重开刷新和离线缓存回退。此前已验证 798 会话隔离及学习通真实只读查询。

| 入口 | 已实现 | 验证范围 |
| --- | --- | --- |
| 课表 | 江财 261 和 252 学期自动同步、周视图和日视图、单双周、离线缓存、脱敏课表导入 | MuMu 单账号实测。双账号隔离用合成数据验证 |
| 学习 | 学习通官方登录窗口、课程列表、按课程查询作业、考试和活动、本机结果缓存 | 现有授权实测课程列表和一门课的作业、考试及活动 |
| 生活 | 慧生活798手动验证码登录、余额、设备与消费记录分页 | 新登录需要经授权的用水签名配置。旧版真实登录返回业务码 `-1`，根因待验证 |
| 我的 | 服务账号状态、退出、网页缓存清理和应用信息 | Android 运行检查 |

## 构建

需要 Python 3.10+、JDK（本轮用 24.0.1）、Android SDK Platform 33 和 Build Tools 35.0.0。构建脚本只依赖 Python 标准库。

```powershell
py -3.12 android/build_apk.py
```

脚本从 `ANDROID_HOME`、`ANDROID_SDK_ROOT` 或系统默认位置查找 Android SDK，从 `JAVA_HOME` 或 `PATH` 查找 JDK。首次构建会生成独立的本地 Debug 签名密钥。输出为 `android/dist/JiangCaiTong-0.5.9-debug.apk`。安装到已连接且已授权的测试设备可执行以下命令。

```powershell
adb install -r android/dist/JiangCaiTong-0.5.9-debug.apk
```

## 源码

- `android/` 包含 Manifest、应用资源、Java 桥接和构建脚本。
- `web/` 包含打包进 APK 的页面、主题、课表模型及服务查询逻辑。
- `docs/` 包含交接参考与本轮的 [教务自动同步](docs/P1D_AUTO_SYNC_REPORT.md)、[798 登录诊断](docs/P2C_798_LOGIN_FIX.md) 和 [学习通真实查询](docs/P2A_REAL_DATA_VALIDATION.md)。

课表离线测试及合成样本位于 `tests/`。本地导入格式见 [教务样本说明](docs/P1C_ACADEMIC_INTEGRATION.md)。

酱菜通与江西财经大学官方无关。航院通原作者为 Hobson，原版权声明及 MIT 许可证见 [LICENSE](LICENSE)。[上游源码](https://cnb.cool/Hobson2233/hangyuantong)
