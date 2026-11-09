# P2C life-798 登录协议对照

参考仓库为 [nocookies111/life-798](https://github.com/nocookies111/life-798)，独立克隆到 `D:\项目\jct-reference-life-798`。分支 `main`，Commit `86566185aac1138e80c49ff0267d42a18f3452ec`，对应 `v5.5.0-1-g8656618`。仓库使用 MIT 许可证，版权为 2026 nocookies111。酱菜通按自身 WebView 与 Java 桥接结构重新实现所需行为。

## 核对的源码

- `IlifeApi.java` 与 `Signer.java` 定义图形码、两类短信与登录请求、App 签名及 HTTP 处理。
- `LoginActivity.kt` 与 `ui/LoginUiState.kt` 定义图形码状态、换号或换平台后的短信状态及成功响应校验。
- `Account.java` 与 `AccountsActivity.kt` 分别保存并验证 `appToken` 和积分 `token`。
- `DeviceControlProtocolTest.kt` 的短信及登录测试验证两路请求头、JSON 字段和 App 登录签名。本轮只阅读相关测试。

## 协议与实现差异

| 环节 | life-798 | 酱菜通 |
| --- | --- | --- |
| 图形码和短信 | 独立随机标识传入图形码查询的 `s`，发送短信沿用同一个 `s`。短信请求字段为 `un`、图形验证码 `authCode`、`s`。业务码 `0` 才进入已发短信状态。 | 请求字段一致。新版使用系统随机数生成标识，并在换号、刷新图形码或取消时作废旧短信状态。 |
| 用水登录 APP | `ApplicationType: 1,1`。短信与提交同路，提交包含 `un` 和短信验证码 `authCode`，签名放在查询参数。参考版用 `3.1.9` 和对应 UA。 | 两阶段均为 `1,1`，保持已有 `3.1.10` 和对应 UA。沿用已核实的签名输入顺序，由 Java 使用经授权的本地构建配置生成。 |
| 积分登录 ALIPAY | `ApplicationType: 1,5`、`VersionCode: 2.0.83`、`WaterWidget/<版本> (Android)`。提交还带 `openCode` 和 `cid`，登录结果进入独立积分会话。 | 当前只实现 APP，用水请求无积分字段，也无积分会话导入或复用。 |
| 登录响应 | 读取 HTTP 响应，包括错误流，再看业务码和 `msg`。成功必须有 `data.al.token`，按通道归档。 | 新版对 400/401/403 的错误体尝试分类，仍拒绝其成功标志。仅接受 `data.al.token` 中可用于请求头的有效字符串，继续用 Android Keystore 保存。 |
| 签名配置 | `app/build.gradle.kts` 从本地 `secrets.properties` 注入 `APP_SIGN_SALT`，示例文件无有效生产值。App 登录签名是验证码、手机号与盐的 MD5，无时间桶。 | 旧实现硬编码的签名盐来源未核实。新版移除该值，未提供经授权的配置时在发短信前停住。 |

## 上游反馈

- [Issue #23](https://github.com/nocookies111/life-798/issues/23) 报告的是已登录后设备启动被版本校验拒绝，已关闭。
- [PR #24](https://github.com/nocookies111/life-798/pull/24) 提议对齐当时的 3.1.9 请求头并调整设备启动参数，该 PR 已关闭。这份提案和当前 `main` 的登录测试都无法证明酱菜通现在应回退到 3.1.9。
- [Issue #30](https://github.com/nocookies111/life-798/issues/30) 是积分通道在短信送达后收到升级提示，报告尚开放。
- [Issue #31](https://github.com/nocookies111/life-798/issues/31) 同样报告升级提示，但未注明通道及请求条件，报告尚开放。

酱菜通现有真实记录为 APP 短信业务码 `0`、登录业务码 `-1`。没有证据将该拒绝归因于上述升级问题。修复与验证情况见 [798 登录修复](P2C_798_LOGIN_FIX.md)。
