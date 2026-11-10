# 酱菜通 · JiangCaiTong

面向江西财经大学的非官方 Android 校园助手。项目基于航院通，使用内置 WebView、JavaScript 和 Java 原生桥接，支持 Android 8.0+（API 26+）。应用 ID 为 `com.jxufe.jct`。

## 当前状态

当前构建为 0.6.3 Debug。Android 9 及以上支持独立教务授权和后台查询。会话失效时保留已有课表，由用户主动重新绑定。生活页提供官方慧生活798的外部入口。

| 入口 | 已实现 | 验证范围 |
| --- | --- | --- |
| 教务 | 江财 261 和 252 学期课表自动同步、周／日视图、离线缓存、脱敏导入。成绩与考试复用本人授权并在进入子页时查询 | MuMu 已验证课表、252 学期非空有效成绩报表及 261 学期考试空报表。非空考试安排仍待验证 |
| 学习 | 学习通官方登录窗口、课程列表、按课程查询作业、考试和活动、本机结果缓存 | 现有授权实测课程列表和一门课的作业、考试及活动 |
| 待办 | 离线新增、编辑、删除、完成状态、筛选、备注和截止日期 | 仅保存在本机，无须绑定服务账号 |
| 生活 | 官方慧生活798外部入口，已有有效会话的余额、设备与消费记录查询 | 原生短信登录需要服务方授权配置。旧版登录业务码 `-1` 的根因未确认 |
| 我的 | 服务账号状态、退出、网页缓存清理和应用信息 | Android 运行检查 |

## 构建

需要 Python 3.10+、JDK（本轮用 24.0.1）、Android SDK Platform 33 和 Build Tools 35.0.0。构建脚本只依赖 Python 标准库。

```powershell
py -3.12 android/build_apk.py
```

脚本从 `ANDROID_HOME`、`ANDROID_SDK_ROOT` 或系统默认位置查找 Android SDK，从 `JAVA_HOME` 或 `PATH` 查找 JDK。首次构建会生成独立的本地 Debug 签名密钥。输出为 `android/dist/JiangCaiTong-0.6.3-debug.apk`。安装到已连接且已授权的测试设备可执行以下命令。

```powershell
adb install -r android/dist/JiangCaiTong-0.6.3-debug.apk
```

## 源码

- `android/` 包含 Manifest、应用资源、Java 桥接和构建脚本。
- `web/` 包含打包进 APK 的页面、主题、课表模型及服务查询逻辑。
- `docs/` 包含交接参考与本轮的 [教务自动同步](docs/P1D_AUTO_SYNC_REPORT.md)、[798 登录诊断](docs/P2C_798_LOGIN_FIX.md) 和 [学习通真实查询](docs/P2A_REAL_DATA_VALIDATION.md)。

课表离线测试及合成样本位于 `tests/`。本地导入格式见 [教务样本说明](docs/P1C_ACADEMIC_INTEGRATION.md)。

酱菜通与江西财经大学官方无关。航院通原作者为 Hobson，原版权声明及 MIT 许可证见 [LICENSE](LICENSE)。[上游源码](https://cnb.cool/Hobson2233/hangyuantong)
