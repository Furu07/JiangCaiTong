# P3 定向验证

## Android 运行

- 基线 0.5.11 在 MuMu Android 15 冷启动后停在主界面。0.6.0 以 `adb install -r` 覆盖安装，保留应用数据。
- 0.6.0 可进入五项底部导航及三个教务子页。冷重启、后台切回和手动关闭校方窗口均回到或停在主界面。成绩、考试子页切换未打开认证窗口。
- 原有江财课表可读。冷重启记录到 `14:20:16 background start` 和 `14:20:17 background result success`，同步后前台仍为 `MainActivity`。
- 实际新增、编辑、勾选、取消勾选和筛选了测试待办。重启及清理网页缓存后均找回该项，删除确认后只移除了该测试项。
- 手动打开校方窗口复用了已有会话，看到「学业成绩」和「课程考试」导航，成绩页可见学期筛选。未完成真实成绩或考试记录读取，也未在日志或报告中保留个人成绩明细。

## 定向检查与范围

- 修改的 JavaScript 通过 `node --check`。`node --test tests/p3-modules.test.cjs tests/jufe-sync.test.cjs` 报告 4 项通过。成绩、考试的记录转换、空状态、错误和账号隔离使用合成响应验证。断网、过期会话及双账号隔离沿用课表定向测试。
- 平台退出与待办的隔离通过源码检查。本轮保留现有教务、学习通及798会话。要接入真实成绩和考试，需确认已授权页面的学期筛选、本人记录字段和未公布响应。
- `py -3.12 android/build_apk.py` 构建和 Debug 签名验证通过。产物为 `D:\项目\jct\android\dist\JiangCaiTong-0.6.0-debug.apk`。MuMu 安装版本为 `com.jxufe.jct` 0.6.0，versionCode 17。
