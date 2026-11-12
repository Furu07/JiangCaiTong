# P7A 慧生活798实际恢复结果

**真实登录仍未成功。** MuMu 上的酱菜通没有已保存的 798 会话。0.8.3 默认构建在发短信前因缺少 `JCT_WATER_APP_SIGN_SALT` 停住，本轮没有发出 `POST /acc/login/code` 或 `POST /acc/login`。上次实测是短信接口业务码 `0`、登录接口业务码 `-1`。现有记录无法区分后者来自验证码、签名或其他服务端校验。

## 登录对照与本轮修正

| 环节 | 实际核对 |
| --- | --- |
| 图形验证码 | 航院通和酱菜通均使用 `GET /captcha/?s=…&r=…`，life-798 使用相同路由并在 Java 侧取图。本轮一次真实请求返回 HTTP 200、`image/jpeg`，未见 `Set-Cookie`。仅核实取图路由。 |
| 发短信 | 三套用水实现均向 `POST /acc/login/code` 提交手机号 `un`、图形码 `authCode` 和对应图片标识 `s`。酱菜通在 `web/app.js` 消耗已提交的图形码，失败或重发须手动取新图，仍可使用本次成功收到的短信码。统一了发送按钮的状态和倒计时更新。 |
| 短信登录 | 用水通道为 `1,1`。`POST /acc/login?sign=…` 的请求体为 `un` 和短信码 `authCode`。现有 Java 使用 `authCode=<短信码>&un=<手机号>` 与配置值计算 MD5。航院通与酱菜通使用 `3.1.10` 及对应 UA，本地 life-798 用水分支使用 `3.1.9` 及对应 UA。旧故障证据不足以支持改版本。 |
| Cookie 和会话 | 酱菜通按短信尝试保存接口 Cookie，登录提交沿用同一容器。航院通 Android 有原生全局 Cookie 容器，本地 life-798 的普通请求未显式维护短信 Cookie 容器。两阶段业务成功及 `data.al.token` 校验后才保存酱菜通用水会话，沿用 Android Keystore 恢复。 |
| 签名配置 | 提交 `24fb563` 移除了旧硬编码值，其来源无法证明获得服务方授权。life-798 的公开仓库只有示例配置。已检查本机进程、用户和机器三处环境变量，均无该值。当前可复测的明确前置条件是获得云多啦允许酱菜通使用的 APP 用水登录签名配置。取得后在本机以 `JCT_WATER_APP_SIGN_SALT` 构建，再由用户在 MuMu 手动收取并提交一次短信验证码。 |

[航院通源码](https://cnb.cool/Hobson2233/hangyuantong) · [life-798 配置说明](https://github.com/nocookies111/life-798#配置参数) · [云多啦技术支持与客服电话 400-868-8798](https://www.ilife798.com/)

## 实际验收与 APK

| 功能 | 结果 |
| --- | --- |
| 账号及重启恢复 | 缺少有效会话，未验证。P7 曾确认无会话的 `GET /acc/view-info` 返回业务码 `-99`。 |
| 余额、收藏设备与账单 | 本轮无真实数据。保留 `GET /acc/wallet/owner`、`GET /ui/app/master`、`GET /bill/lst-owner` 和 `GET /bill/view-full` 的现有实现，待登录后验证。 |
| 开始和结束用水 | 航院通和 life-798 参考实现使用 `GET /dev/start`、`GET /dev/end`。结束响应和结算结果需要分别确认。本轮未接入控制，未发送设备指令或扣费。 |

`node --check web/app.js`、现有 798 定向测试与图形码单次消费的本地检查通过。`py -3.12 android/build_apk.py` 构建并验证 Debug 签名，已在 MuMu 通过 `adb install -r` 覆盖安装 `0.8.3`（构建号 28）。冷启动可见原江财课表缓存，798 如实显示签名配置缺失。本次未修改其他业务。

APK 路径为 `D:\项目\jct\android\dist\JiangCaiTong-0.8.3-debug.apk`。SHA-256 为 `9C5D2DA8A42E7652C50B5109D7BD9C588CDD511DFF9507EF08E15AAE9D726C0E`。
