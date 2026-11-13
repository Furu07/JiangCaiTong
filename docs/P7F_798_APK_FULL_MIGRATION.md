# P7F 慧生活798 APK 迁移

## 参考包与协议

`base.apk` 经 `aapt2 dump badging` 核验为 `com.hobson.hangyuantong`、版本 `0.52.0`、构建号 `133`。SHA-256 为 `e852a97f9eda9e3600626ec984b9633c5cdd97a8ad9341c372e589b69f50fa32`。从包内提取了 `native.js`、`app.js`、`index.html`、`app.css`、`classes.dex` 和 Manifest。Android SDK `dexdump -d` 核对了 `MainActivity.onCreate`、`NativeBridge.req2/doReq` 和 `CredStore` 的相关调用。

| 通道 | ApplicationType | VersionCode | User-Agent |
| --- | --- | --- | --- |
| 短信与用水登录 | `1,1` | `3.1.9` | `Android_ilife798_3.1.9` |
| 积分登录 | `1,5` | `2.0.83` | `Android_ilife798_3.1.9` |
| 积分服务 | `1,5` | `2.0.178` | `Android_ilife798_3.1.9` |

两个登录通道都带 `sign`，使用各自常量，提交 `{authCode, un}`。应用启动后，798 原生请求共用独立的 `CookieManager(ACCEPT_ALL)`。HTTP 传输保留 UTF-8 定长请求体、15/30 秒超时和 `getDate()` 毫秒值。参考 APK 启用原生自动重定向，酱菜通保留同源只读重定向白名单，启停与积分写入不跟随重定向。签名配置仅从哈希匹配的本机参考 APK 注入打包资产。

## 实际迁移

- `web/water.js` 替换了 0.8.8 的业务模块，迁入参考包 `WaterApi` 的全部 20 个成员及 16 条 `/api/water/*` 分发。沿用 `pfHttp → Android.req2 → HttpURLConnection`。设备和积分各用独立 Token，由现有 Keystore 保存，支持分别退出，兼容旧版设备会话。
- `web/water-page.js`、`web/water-page.css` 和 `web/index.html` 接入参考包的双账号表单、余额、设备、账单、积分、钱包、任务、签到和兑换页面。设备支持收藏列表、本机添加、扫码、重命名和隐藏。兑换保留平台返回的账单号，并可核查本机发起的兑换记录。原版也通过账单详情核查兑换，附件中未发现独立的全量兑换历史接口。
- 批量积分任务由用户点击发起。后台自动任务、任务后自动兑换和 NFC 碰一碰未接入。启停增加现场确认，充值、签约和绑卡沿用官方应用入口。没有迁移航院通的上报和桌面小组件。

## 验证

- 对照参考 APK 与最终 Debug APK 资产，以合成数据确认短信、设备登录、积分登录、签到及兑换的请求方法、URL、签名结果、请求头和 JSON 一致。未输出签名材料。
- 修改后 JavaScript 语法检查与 `node tests/water-login.test.cjs` 通过。定向测试包含双 Token、旧会话、退出隔离和设备请求。
- `py -3.12 android/build_apk.py` 构建和 Debug 签名验证通过。MuMu 覆盖安装 `0.8.9`（构建号 34）。实际打开生活页，双账号入口及设备登录表单可用，图形验证码已加载。

| 真实业务 | 本轮结果 |
| --- | --- |
| 用水账号登录 | 用户本人操作后登录成功。脱敏日志显示短信 HTTP 200、业务码 0，登录 HTTP 200、业务码 0。此前一次短信申请返回业务码 -2，原因未确认。 |
| 积分账号登录 | 在设备账号已登录时打开了独立积分登录表单，图形验证码已加载，设备会话仍有效。按用户安排暂缓真实短信登录验证。 |
| 余额、收藏设备、消费账单 | MuMu 实际显示余额、收藏设备和账单。强制停止并冷启动后，会话恢复，余额、设备和账单仍可查询。报告未记录账户标识、金额或账单明细。 |
| 积分、钱包和任务 | 代码已接入，随积分账号实测暂缓。 |
| 签到、兑换、设备启停 | 未发送真实操作。签到与兑换需要用户主动发起，设备启停需在现场操作。 |

APK 路径为 `D:\项目\jct\android\dist\JiangCaiTong-0.8.9-debug.apk`。SHA-256 为 `146AF10BDF8901768AAE9270B8AE6D4289A36B179586B5308B3FDDA60E614819`。
