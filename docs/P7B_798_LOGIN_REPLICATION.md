# P7B 慧生活798登录复刻

本地可核实的郑航参考是面向郑州航空工业管理学院的「航院通」，快照 `225ac3add`。未找到独立的「郑航通」仓库。另对照本地 life-798 `8656618` 的 `IlifeApi.java`、`Signer.java` 和 `LoginActivity.kt`。 [航院通](https://cnb.cool/Hobson2233/hangyuantong) · [life-798](https://github.com/nocookies111/life-798/tree/86566185aac1138e80c49ff0267d42a18f3452ec)

## 调用链与差异

| 环节 | 核对结果 |
| --- | --- |
| 图形验证码 | 三者使用 `GET /captcha/?s=…&r=…`。航院通和酱菜通交给 WebView 加载，life-798 用 Java 取图。图片标识 `s` 由客户端生成，并随下一步短信请求传递，取图请求无手机号。 |
| 发送短信 | 用水通道 `1,1`，`POST /acc/login/code` 发送 `un`、图形码 `authCode`、`s`。航院通和酱菜通使用 `3.1.10` 及对应 UA，life-798 本地快照用水分支使用 `3.1.9` 及对应 UA。酱菜通将响应 Cookie 关联到同一次短信尝试。 |
| 签名和登录 | 用户输入短信码后，Java 按 UTF-8 对 `authCode=<短信码>&un=<手机号>` 后接授权配置计算小写 MD5，再调用 `POST /acc/login?sign=…`，请求体是 `un` 与短信码 `authCode`。签名输入顺序与参考一致。积分通道带另外的字段，无法作为已验证的用水登录替代流程。 |
| 会话和查询 | 酱菜通与 life-798 要求业务码 `0` 且存在有效 `data.al.token`。航院通代码另有读取 `data.token` 的回退。酱菜通沿用 Android Keystore 保存和恢复用水会话，通过原有账号、余额、设备和账单端点查询。 |

`web/app.js` 解除了公开图形码和签名配置的绑定。无配置时可以从现有表单加载图片，无需先输入手机号，账号字段及短信和登录按钮保持禁用。配置可用时，填写或修正手机号保留尚未提交的图形码，同时清空旧短信码并作废对应短信尝试。沿用 P7A 图形码提交后清除的处理。构建脚本与 `MainActivity.java` 同步版本为 `0.8.4`。

## 验证和剩余条件

- MuMu 通过 `adb install -r` 安装 0.8.4，冷启动进入主界面，原课表缓存可见。在酱菜通实际加载并显示了一张 798 图形验证码。通过 Java 桥接读取签名配置状态，验证图片加载后短信和登录按钮仍禁用。收起表单通过。ADB 仅发现同一 MuMu 的两个连接标识，未发现 Android 真机。
- `node --check web/app.js` 和 `node --test tests/water-login.test.cjs` 通过。请求字段、成功和失败响应解析为定向测试结果。真实短信、登录、Keystore 会话恢复、余额、收藏设备及账单均未验证。无用水指令或扣费操作。
- 当前已证实的阻塞是缺少云多啦允许酱菜通使用的 APP 用水登录签名配置 `JCT_WATER_APP_SIGN_SALT`。本机环境和参考克隆均无可用配置，公开示例为占位值。现有默认包在短信请求前拦截，避免发出无法完成登录的短信。历史业务码 `-1` 的具体原因未确认，保留当前 `3.1.10`。取得授权配置后，可在本机重新构建，由用户在酱菜通完成一次真实验证码登录。 [云多啦技术支持](https://www.ilife798.com/)
- `py -3.12 android/build_apk.py` 构建及 Debug 签名验证通过。MuMu 确认版本 `0.8.4`、构建号 29。APK 位于 `D:\项目\jct\android\dist\JiangCaiTong-0.8.4-debug.apk`，SHA-256 为 `6D13148AF2F080CD9B9E5F1BC660F3584CDA8FEF3DEF255465DE28D3697514F1`。
