# P3D 定向验证

- MuMu 复用现有教务授权，校方「入学以来」成绩检索返回空报表。校方考试页仍锁定 261 学期并列出四个已查批次。本轮缺少真实非空成绩和考试样本，未重复查询此前已查的学期或批次。
- `node --check web/jufe-record-reader.js` 通过。运行 `node --test tests/jufe-record-reader.test.cjs tests/jufe-sync.test.cjs tests/p3-modules.test.cjs`，8 项通过。成绩范围切换、考试时间原文回退和待办持久化使用合成数据验证。
- MuMu 冷启动显示原课表缓存并停留在主界面。触发课表刷新后，后台在 `17:02:12` 返回成功，未打开登录窗口。刷新后待办页可打开。学习通与798未参与本轮操作。
- `py -3.12 android/build_apk.py` 构建、Debug 签名验证通过。产物为 `D:\项目\jct\android\dist\JiangCaiTong-0.6.2-debug.apk`。MuMu 覆盖安装成功，系统确认版本号 0.6.2、versionCode 19。本机结构诊断使用独立临时包，交付包使用正式源码构建。
- 下一次只需在已授权的校方页面打开有已发布成绩或本人考试记录的学期或批次，由本机读取脱敏结构。
