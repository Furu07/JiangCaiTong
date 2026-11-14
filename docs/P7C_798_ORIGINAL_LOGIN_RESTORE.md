# P7C 慧生活798原始登录兼容性恢复

- 航院通在 `hangyuantong-main/web/native.js:4499` 硬编码 `WATER.SALT_APP`，`wSignLogin()` 对手机号、短信码及该常量按既定顺序做 UTF-8 MD5。用水登录将结果放入 `POST /acc/login` 的 `sign` 查询参数。源码注释称该常量来自官方 APK。酱菜通在 `24fb563` 前也使用这个常量，之后改为构建时读取 `JCT_WATER_APP_SIGN_SALT` 并在 Java 计算相同的签名。
- `web/water.js` 已恢复两种成功响应的兼容性。HTTP 和业务码校验通过后，优先读取 `data.al.token`，同时接受航院通支持的 `data.token`。有效 Token 继续经现有 Keystore 保存，换号时的账号隔离和短信会话检查沿用原实现。请求体、`1,1` 用水通道、`3.1.10` 请求头和验证码顺序沿用现有实现。
- 本机未配置可用签名材料，现有源码和历史记录未提供酱菜通可使用旧常量的授权依据。本轮保留 `JCT_WATER_APP_SIGN_SALT` 的用水登录依赖。MuMu 中可在酱菜通加载真实图形验证码，短信和登录按钮仍禁用。本轮未提交短信和登录请求，未验证真实登录、会话、余额、设备或账单。
- `node --check web/water.js` 和 `node --test tests/water-login.test.cjs` 通过。现有定向测试验证了两种成功响应、换号时的旧响应隔离，以及错误响应不会建立会话。
- `py -3.12 android/build_apk.py` 构建及 Debug 签名验证通过。MuMu 覆盖安装 `0.8.5`（构建号 30），保留原有数据并显示原课表缓存。APK 位于 `D:\项目\jct\android\dist\JiangCaiTong-0.8.5-debug.apk`，SHA-256 为 `559A96E1A397AA73D5006E828E8CE50BFCB8046D82518393CEB29C891E862F5B`。
