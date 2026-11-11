# P6 定向验证

| 检查 | 实际结果 |
| --- | --- |
| MuMu Android 15 | 在原 0.7.0 上覆盖安装 0.8.0，保留应用数据。冷启动进入 `MainActivity`。五项底栏在 360 CSS px 下可见，系统深浅色切换后仍保留洗浴子页。 |
| 生活服务 | 校园饮水默认打开，切换洗浴后可返回饮水。慧生活798的配置提示仍显示。住理生活子页识别已安装的 App，点击后真实启动 `com.whxinna.userplatform`。 |
| 江财项目 | 官方 App 首页显示麦庐园校区洗浴、直饮水项目。打开官方钱包可见余额界面，观察了订单入口。酱菜通内的余额、设备和消费记录查询均待授权接口。 |
| 合成与语法检查 | `node --check` 检查 `web/zhuli.js`、`web/app.js`。运行 `node --test tests/zhuli.test.cjs tests/water-login.test.cjs`，3 个测试条目通过。覆盖 App 有无、桥接不可用、仅点击触发跳转及 798 登录链路回归。应用宝详情页返回 HTTP 200，MuMu 可解析浏览器处理程序。未卸载官方 App 实测回退分支。 |
| 设备与账号 | 未触发短信、充值、支付、预约或设备命令。未验证麦庐园真实设备和第三方会话交接。此次设备检查限于 Android 蓝牙能力声明与管理器状态。 |

## APK

- 执行 `py -3.12 android/build_apk.py`，完成编译、对齐和 Debug 签名验证，最终产物通过 MuMu 覆盖安装与入口验证。
- 包名 `com.jxufe.jct`，版本 `0.8.0`，构建号 25，最低 Android 8.0。
- 输出 `D:\项目\jct\android\dist\JiangCaiTong-0.8.0-debug.apk`。
- SHA-256 `2806049DD6CF30493924D448403A1CA33407115819727CEE2056A8EE461F3293`。
