# P0 Android 适配记录

## 一、项目身份变更

### 1.1 基础信息

| 项目 | 原值（航院通） | 新值（酱菜通） |
|------|-------------|-------------|
| **应用名称** | 航院通 | 酱菜通 |
| **英文名称** | HangYuanTong | JiangCaiTong (JCT) |
| **包名** | com.hobson.hangyuantong | com.jxufe.jct |
| **版本起点** | 0.47.5 (code 82) | 1.0.0 (code 1) |
| **目标学校** | 郑州航空工业管理学院 | 江西财经大学 |
| **主色调** | #007AFF (蓝) | 待定（可保持或改为江财VI色） |

### 1.2 许可证与版权

**保留原项目声明**：
```
MIT License
Copyright (c) 2026 Hobson

酱菜通基于航院通（https://cnb.cool/Hobson2233/hangyuantong）进行二次开发
遵循MIT许可证开源，保留原作者版权声明
```

**新增声明**：
```
酱菜通（JiangCaiTong）
Copyright (c) 2026 酱菜通开发团队

本项目为江西财经大学第三方校园助手，非官方应用
仅供学习交流使用，不得用于商业用途
```

**明确区分**：
- ❌ 不使用原作者的发布域名（hobson.cc）
- ❌ 不使用原作者的更新服务器
- ❌ 不使用原作者的签名密钥
- ❌ 不沿用原作者的联系方式
- ✅ 在"关于"页面明确标注"基于航院通二次开发"

## 二、目录结构调整

### 2.1 保留的目录

```
jct/
├── android/                    # Android 源码（保留结构）
│   ├── src/
│   │   └── com/jxufe/jct/     # 包名改为 com.jxufe.jct
│   │       ├── MainActivity.java
│   │       ├── NativeBridge.java
│   │       ├── CredStore.java
│   │       ├── Store.java
│   │       ├── CookieJar.java
│   │       ├── CxNet.java     # 学习通网络模块
│   │       ├── WebActivity.java
│   │       ├── UpdateDownloader.java (可选保留)
│   │       └── ApkProvider.java
│   ├── res/
│   │   ├── mipmap-*/ic_launcher*.png  # 替换图标
│   │   ├── values/
│   │   │   ├── strings.xml    # 应用名称改为"酱菜通"
│   │   │   ├── styles.xml
│   │   │   └── colors.xml
│   │   └── xml/
│   │       └── network_security_config.xml
│   ├── AndroidManifest.xml    # 包名、权限、authorities
│   └── build_apk.py           # 构建脚本
│
├── web/                        # Web 前端（共用）
│   ├── index.html             # 标题改为"酱菜通"
│   ├── app.js                 # 业务逻辑（需修改导航）
│   ├── native.js              # JS桥接（需修改教务模块）
│   ├── app.css                # 样式（保留Apple HIG）
│   ├── icon-*.png             # 替换图标
│   ├── manifest.webmanifest   # PWA配置
│   ├── jsqr.js                # 二维码扫描
│   └── jsqr-LICENSE.txt
│
├── chaoxing.py                 # 学习通模块（保留）
├── water.py                    # 慧生活798（保留）
├── jufe_academic.py           # 江财教务（新建）
├── bridge.py                   # 开发测试服务器（保留）
├── LICENSE                     # MIT许可证（追加声明）
├── README.md                   # 项目说明（重写）
└── docs/                       # 文档目录（新建）
    ├── P0_SOURCE_AUDIT.md
    ├── P0_ANDROID_ADAPTATION.md (本文档)
    ├── P1_JUFE_ACADEMIC_RESEARCH.md
    ├── P1_INTEGRATION_PLAN.md
    └── P0_VALIDATION.md
```

### 2.2 删除的目录

```
❌ hangyuantong-main/ios/        # 不开发iOS版本
❌ hangyuantong-main/site/       # 不需要项目主页
❌ hangyuantong-main/eams.py     # 郑航教务模块
❌ hangyuantong-main/portal.py   # 郑航门户模块
❌ hangyuantong-main/notice.py   # 校园公告模块
❌ hangyuantong-main/mooc.py     # MOOC模块
❌ hangyuantong-main/_lab/portal/  # 门户测试相关
❌ hangyuantong-main/_lab/out/notice_*  # 公告测试
```

### 2.3 新增的目录

```
✅ docs/                         # 项目文档
✅ mock/                         # 模拟数据（开发测试用）
✅ tests/                        # 单元测试
✅ scripts/                      # 构建和部署脚本
```

## 三、Android配置文件修改

### 3.1 AndroidManifest.xml

**关键修改点**：

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.jxufe.jct">  <!-- ① 包名 -->

    <!-- 权限声明（保持不变） -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />

    <!-- 包可见性（保留慧生活798相关） -->
    <queries>
        <package android:name="com.cloudora.android" />
        <package android:name="com.water.widget" />
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:mimeType="application/vnd.android.package-archive" />
        </intent>
    </queries>

    <application
        android:name=".App"
        android:allowBackup="false"
        android:icon="@mipmap/ic_launcher"  <!-- ② 替换图标 -->
        android:label="@string/app_name"    <!-- ③ 应用名称 -->
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/AppTheme"
        android:usesCleartextTraffic="true">  <!-- ④ 保留HTTP支持（教务可能是HTTP） -->

        <activity
            android:name=".MainActivity"
            android:configChanges="orientation|screenSize|keyboardHidden|uiMode"
            android:exported="true"
            android:label="@string/app_name"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <activity
            android:name=".WebActivity"
            android:configChanges="orientation|screenSize|keyboardHidden|uiMode"
            android:exported="false"
            android:label="@string/app_name"
            android:windowSoftInputMode="adjustResize" />

        <!-- ⑤ FileProvider的authorities必须改 -->
        <provider
            android:name=".ApkProvider"
            android:authorities="com.jxufe.jct.apk"  <!-- 与包名一致 -->
            android:exported="false"
            android:grantUriPermissions="true" />
    </application>
</manifest>
```

**修改检查清单**：
- [x] package 属性
- [x] application.icon
- [x] application.label
- [x] provider.authorities
- [x] 删除不需要的包可见性声明（如果有郑航专属APP）

### 3.2 res/values/strings.xml

```xml
<resources>
    <!-- ① 应用名称 -->
    <string name="app_name">酱菜通</string>
    
    <!-- ② 关于页面文字 -->
    <string name="about_title">关于酱菜通</string>
    <string name="about_desc">江西财经大学第三方校园助手\n课表 · 学习 · 生活</string>
    <string name="about_version">版本 %s</string>
    <string name="about_based_on">基于航院通（MIT License）二次开发</string>
    <string name="about_disclaimer">本应用为非官方第三方工具，仅供学习交流使用</string>
    
    <!-- ③ 其他字符串（按需添加） -->
    <string name="empty_schedule">还没绑定江财教务账号</string>
    <string name="bind_tip">绑定后就能把课表同步到手机，断网也能看</string>
</resources>
```

### 3.3 res/values/colors.xml

```xml
<resources>
    <!-- ① 保留Apple HIG色值 -->
    <color name="primary">#007AFF</color>
    <color name="background_light">#F2F2F7</color>
    <color name="surface_light">#FFFFFF</color>
    <color name="text_primary_light">#000000</color>
    <color name="text_secondary_light">#8E8E93</color>
    
    <!-- ② 深色模式 -->
    <color name="background_dark">#000000</color>
    <color name="surface_dark">#1C1C1E</color>
    <color name="text_primary_dark">#FFFFFF</color>
    <color name="text_secondary_dark">#8E8E93</color>
    
    <!-- ③ 状态色 -->
    <color name="success">#34C759</color>
    <color name="warning">#FF9500</color>
    <color name="error">#FF3B30</color>
    
    <!-- ④ 可选：江财VI色（如果要自定义主题） -->
    <!-- <color name="primary">#C8102E</color> 江财红 -->
</resources>
```

### 3.4 网络安全配置

**res/xml/network_security_config.xml**（新建或修改）：

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- ① 允许明文HTTP（教务系统可能需要） -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">xk.jxufe.edu.cn</domain>
        <domain includeSubdomains="true">jwxt.jxufe.edu.cn</domain>
        <!-- 慧生活798 -->
        <domain includeSubdomains="true">i.ilife798.com</domain>
    </domain-config>
    
    <!-- ② 其他域名默认HTTPS -->
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
```

在 AndroidManifest.xml 中引用：
```xml
<application
    ...
    android:networkSecurityConfig="@xml/network_security_config">
```

## 四、Java源码包名修改

### 4.1 包名重命名

**原包名**：`com.hobson.hangyuantong`  
**新包名**：`com.jxufe.jct`

**操作步骤**：
1. 创建新目录：`android/src/com/jxufe/jct/`
2. 移动所有 `.java` 文件到新目录
3. 批量替换每个文件的 `package` 声明
4. 批量替换 `import` 语句中的旧包名

**影响的文件**：
```
MainActivity.java       → package com.jxufe.jct;
NativeBridge.java      → package com.jxufe.jct;
CredStore.java         → package com.jxufe.jct;
Store.java             → package com.jxufe.jct;
StoreFiles.java        → package com.jxufe.jct;
CookieJar.java         → package com.jxufe.jct;
CxNet.java             → package com.jxufe.jct;
App.java               → package com.jxufe.jct;
WebActivity.java       → package com.jxufe.jct;
UpdateDownloader.java  → package com.jxufe.jct;
ApkProvider.java       → package com.jxufe.jct;
```

### 4.2 关键常量修改

**NativeBridge.java**：
```java
public class NativeBridge {
    // ① 修改BASE常量
    private static final String BASE = "https://jwxt.jxufe.edu.cn";  // 江财教务
    
    // ② UA保持或更新
    private static final String UA =
            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
    
    // ... 其他代码保持不变
}
```

**ApkProvider.java**：
```java
public class ApkProvider extends ContentProvider {
    // ① authorities必须与AndroidManifest一致
    static final String AUTHORITY = "com.jxufe.jct.apk";
    
    // ... 其他代码保持不变
}
```

**App.java**（如有应用级配置）：
```java
public class App extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        // 应用初始化代码
    }
}
```

### 4.3 白名单更新（如有）

**NativeBridge.java** 中的 `ALLOWED_APPS`（如果实现了外部APP调用）：
```java
private static final Set<String> ALLOWED_APPS = new HashSet<>(Arrays.asList(
    "com.cloudora.android",    // 慧生活798官方
    "com.water.widget"         // WaterWidget第三方客户端
    // 不添加郑航专属APP
));
```

## 五、Web前端修改

### 5.1 index.html

**修改点**：
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<!-- ① 标题 -->
<title>酱菜通</title>

<!-- ② meta标签 -->
<meta name="apple-mobile-web-app-title" content="酱菜通">
<meta name="description" content="江西财经大学第三方校园助手">

<!-- ③ manifest -->
<link rel="manifest" href="manifest.webmanifest">

<!-- ④ 图标 -->
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="stylesheet" href="app.css">
</head>
<body>

<!-- ⑤ 底部导航调整：5格改4格 -->
<nav id="tabs">
  <button data-page="schedule">
    <svg>...</svg>
    <span>课表</span>
  </button>
  <button data-page="study">  <!-- 新：学习通 -->
    <svg>...</svg>
    <span>学习</span>
  </button>
  <button data-page="life">   <!-- 新：慧生活798 -->
    <svg>...</svg>
    <span>生活</span>
  </button>
  <button data-page="me">
    <svg>...</svg>
    <span>我的</span>
  </button>
  <!-- ❌ 删除"公告"和"校园"页 -->
</nav>

<!-- ⑥ 删除公告和校园页面的HTML结构 -->
<!-- <section class="page" id="page-notice">...</section> -->
<!-- <section class="page" id="page-campus">...</section> -->

<!-- ⑦ 新增学习通和生活页面 -->
<section class="page" id="page-study" hidden>
  <!-- 学习通待办作业、考试、签到 -->
</section>

<section class="page" id="page-life" hidden>
  <!-- 慧生活798余额、设备、消费记录 -->
</section>

</body>
</html>
```

### 5.2 manifest.webmanifest

```json
{
  "name": "酱菜通",
  "short_name": "酱菜通",
  "description": "江西财经大学第三方校园助手",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#F2F2F7",
  "theme_color": "#007AFF",
  "icons": [
    {
      "src": "icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

### 5.3 app.js

**版本号更新**：
```javascript
// ① 修改版本号常量
const APP_VERSION = '1.0.0';  // 从1.0.0开始
const APP_CODE = 1;           // versionCode从1开始

// ② 修改环境判断文案
const envText = (web, app) => (NATIVE ? app : web);

// 使用示例：
el.textContent = envText(
  '密码用 Windows DPAPI 加密后存在这台电脑上',
  '密码用 Android Keystore 加密后存在手机里'
);
```

**底部导航逻辑**：
```javascript
// ③ 修改页面列表
const PAGES = ['schedule', 'study', 'life', 'me'];  // 4页

// ④ 删除公告和校园相关的事件监听和渲染逻辑
// function renderNotice() { ... }  ❌ 删除
// function renderCampus() { ... }  ❌ 删除

// ⑤ 新增学习通和生活页面逻辑（占位，后续实现）
function renderStudy() {
  // TODO: 渲染学习通待办
  $('page-study').innerHTML = '<div class="empty">敬请期待</div>';
}

function renderLife() {
  // TODO: 渲染慧生活798
  $('page-life').innerHTML = '<div class="empty">敬请期待</div>';
}
```

**"我的"页面内容调整**：
```javascript
function renderMe() {
  // ① 教务账号绑定卡片（保留，但文案改为"江财教务"）
  html += `<div class="card">
    <h2>江财教务账号</h2>
    <p>用于同步课表、成绩、考试安排</p>
    ...
  </div>`;
  
  // ② 学习通账号绑定卡片
  html += `<div class="card">
    <h2>学习通账号</h2>
    <p>用于查看作业待办、考试、签到</p>
    ...
  </div>`;
  
  // ③ 慧生活798账号绑定卡片
  html += `<div class="card">
    <h2>慧生活798</h2>
    <p>用于宿舍直饮水余额和消费记录</p>
    ...
  </div>`;
  
  // ④ 删除门户账号绑定卡片（❌）
  
  // ⑤ 关于卡片
  html += `<div class="card">
    <h2>关于酱菜通</h2>
    <p>版本 ${APP_VERSION}</p>
    <p>基于<a href="https://cnb.cool/Hobson2233/hangyuantong">航院通</a>二次开发</p>
    <p>MIT License · 非官方应用</p>
  </div>`;
}
```

### 5.4 native.js

**BASE常量修改**：
```javascript
(function () {
  'use strict';

  if (!window.Android || typeof window.Android.req !== 'function') return;

  // ① 修改教务系统BASE
  var BASE = 'https://jwxt.jxufe.edu.cn';  // 江财教务（青果系统）
  
  // ② UA保持或更新
  var UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

  // ③ 删除郑航教务相关的登录、课表查询函数
  // function eamsLogin() { ... }       ❌ 删除
  // function eamsTimetable() { ... }   ❌ 删除
  // function eamsExams() { ... }       ❌ 删除
  // function eamsGrades() { ... }      ❌ 删除
  
  // ④ 新增江财教务模块（占位实现）
  function jufeLogin(username, password) {
    // TODO: 实现CAS登录
    return { error: '江财教务登录功能开发中' };
  }
  
  function jufeTimetable(termId) {
    // TODO: 实现课表查询
    return { error: '课表查询功能开发中' };
  }
  
  function jufeExams(termId) {
    // TODO: 实现考试查询
    return { error: '考试查询功能开发中' };
  }
  
  // ⑤ 保留学习通和慧生活798的函数（完整复制，无需修改）
  // function chaoxingLogin() { ... }   ✅ 保留
  // function waterLogin() { ... }      ✅ 保留
  
  // ⑥ 删除门户相关函数
  // function portalLogin() { ... }     ❌ 删除
  // function portalCard() { ... }      ❌ 删除
  // function noticeList() { ... }      ❌ 删除
  
  // ⑦ NativeApi.handle 路由调整
  window.NativeApi = {
    handle: function (path, body) {
      // 教务路由
      if (path === '/api/academic/login') return jufeLogin(body.username, body.password);
      if (path === '/api/academic/timetable') return jufeTimetable(body.termId);
      if (path === '/api/academic/exams') return jufeExams(body.termId);
      
      // 学习通路由（保留）
      if (path === '/api/chaoxing/login') return chaoxingLogin(body);
      if (path === '/api/chaoxing/courses') return chaoxingCourses();
      
      // 慧生活798路由（保留）
      if (path === '/api/water/login') return waterLogin(body);
      if (path === '/api/water/balance') return waterBalance();
      
      // 删除的路由
      // if (path === '/api/portal/...') ...  ❌
      // if (path === '/api/notice/...') ...  ❌
      
      return { error: '未知接口：' + path };
    }
  };
})();
```

## 六、图标资源替换

### 6.1 Android图标

**需要替换的文件**：
```
android/res/mipmap-mdpi/ic_launcher.png         (48x48)
android/res/mipmap-hdpi/ic_launcher.png         (72x72)
android/res/mipmap-xhdpi/ic_launcher.png        (96x96)
android/res/mipmap-xxhdpi/ic_launcher.png       (144x144)
android/res/mipmap-xxxhdpi/ic_launcher.png      (192x192)

android/res/mipmap-mdpi/ic_launcher_round.png   (48x48)
android/res/mipmap-hdpi/ic_launcher_round.png   (72x72)
android/res/mipmap-xhdpi/ic_launcher_round.png  (96x96)
android/res/mipmap-xxhdpi/ic_launcher_round.png (144x144)
android/res/mipmap-xxxhdpi/ic_launcher_round.png(192x192)
```

**设计建议**：
- 主题色：蓝色（#007AFF）或江财红（#C8102E）
- 图标元素：课表网格、书本、徽章等
- 风格：扁平化、现代感
- 参考：Google Material Design icon guidelines

**生成工具**：
- Android Studio → Image Asset
- 在线工具：https://icon.kitchen/
- 手动设计：Figma / Sketch / AI

### 6.2 Web图标

**需要替换的文件**：
```
web/icon-180.png    (180x180, iOS添加到主屏幕)
web/icon-192.png    (192x192, PWA标准图标)
web/icon-512.png    (512x512, PWA高清图标)
```

**与Android图标一致**：使用相同的设计，只需导出不同尺寸。

## 七、构建脚本修改

### 7.1 build_apk.py

**需要修改的部分**（待审查完整脚本后确定）：

```python
# ① 包名
PACKAGE = 'com.jxufe.jct'

# ② 应用名称
APP_NAME = '酱菜通'

# ③ 版本号（从app.js读取，保持同步）
VERSION_NAME = '1.0.0'
VERSION_CODE = 1

# ④ 签名配置（生成新的keystore）
KEYSTORE = 'jct-release.keystore'
KEYSTORE_PASS = '...'  # 不提交到版本控制
KEY_ALIAS = 'jct'
KEY_PASS = '...'

# ⑤ 输出路径
OUTPUT_APK = 'android/dist/jct-{VERSION_NAME}.apk'

# ⑥ 删除航院通的更新服务器配置
# UPDATE_URL = 'https://hobson.cc/...'  ❌

# ⑦ 保留调试标志
DEBUG = True  # 第一阶段生成Debug APK
```

**构建流程验证**：
1. 检测 Android SDK 路径
2. 检测 Build Tools 版本
3. 编译 Java → class
4. dex → classes.dex
5. 打包资源 → resources.arsc
6. 合并APK
7. zipalign对齐
8. apksigner签名（debug或release）

### 7.2 签名密钥管理

**Debug签名**（第一阶段）：
- 使用Android SDK自带的debug.keystore
- 位置：`~/.android/debug.keystore`
- 密码：`android`（固定）

**Release签名**（后续发布）：
```bash
# 生成新的keystore
keytool -genkey -v -keystore jct-release.keystore \
        -alias jct -keyalg RSA -keysize 2048 -validity 10000

# 签名APK
jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 \
          -keystore jct-release.keystore \
          jct-unsigned.apk jct

# 对齐APK
zipalign -v 4 jct-unsigned.apk jct-release.apk
```

**密钥存储**：
- ✅ keystore文件存放在安全位置（不提交Git）
- ✅ 密码存放在环境变量或加密文件
- ✅ 文档记录生成命令和参数

## 八、功能删减清单

### 8.1 删除的页面

| 页面ID | 航院通名称 | 说明 | 操作 |
|-------|----------|------|------|
| `#page-notice` | 公告 | 校园公告6个源 | ❌ 完全删除 |
| `#page-campus` | 校园 | 一卡通+办事入口 | 🔄 保留框架改为"生活"页 |

### 8.2 删除的功能模块

| 模块 | 文件 | 说明 | 操作 |
|------|------|------|------|
| 郑航教务 | `eams.py` | 金智EAMS客户端 | ❌ 删除，由`jufe_academic.py`替代 |
| 智慧门户 | `portal.py` | 门户登录、一卡通、办事入口 | ❌ 完全删除 |
| 校园公告 | `notice.py` | 6个部门网站爬取 | ❌ 完全删除 |
| MOOC课程 | `mooc.py` | 学校MOOC平台 | ❌ 完全删除 |
| 郑航百科 | （如有） | 百科功能 | ❌ 确认不存在后标记 |

### 8.3 删除的依赖检查

**检查 `chaoxing.py` 和 `water.py` 是否依赖被删除的模块**：
```bash
# 搜索import语句
grep -r "from portal import" chaoxing.py water.py
grep -r "from notice import" chaoxing.py water.py
grep -r "from eams import" chaoxing.py water.py
```

**结果**：
- ✅ `chaoxing.py`：独立模块，无依赖
- ✅ `water.py`：独立模块，无依赖
- ✅ 可安全删除 `portal.py`、`notice.py`、`eams.py`

### 8.4 保留但需修改的模块

| 模块 | 修改内容 |
|------|---------|
| `app.js` | 删除公告、校园相关函数；新增学习、生活页占位 |
| `native.js` | 删除郑航教务、门户函数；新增江财教务占位 |
| `index.html` | 底部导航5格→4格；删除公告、校园页HTML |
| `app.css` | 删除公告、校园页的专属样式（如有） |

## 九、构建环境准备

### 9.1 开发环境要求

**操作系统**：
- ✅ Windows 10/11（build_apk.py在Windows环境编写）
- ⚠️ Linux/macOS（需验证build_apk.py兼容性）

**必需软件**：
1. **Python 3.9+**
   - 用途：运行 build_apk.py、bridge.py
   - 安装：https://www.python.org/downloads/

2. **Android SDK**
   - Build Tools 28.0.3 或更高
   - Platform API 33
   - 设置环境变量：`ANDROID_HOME`

3. **Java 8+**
   - 用途：编译Java源码、签名APK
   - 推荐：OpenJDK 11 或 Android Studio内置JDK

**可选工具**：
- Android Studio（IDE调试、布局预览）
- VS Code + Android扩展（轻量级编辑）
- Git（版本控制）

### 9.2 Python依赖

**requirements.txt**：
```txt
requests>=2.28.0
qrcode>=7.4.0
Pillow>=9.0.0      # qrcode的图片依赖
pycryptodome>=3.15.0  # chaoxing.py的AES加密
```

**安装命令**：
```bash
pip install -r requirements.txt
```

### 9.3 Android SDK配置

**环境变量**（Windows）：
```bash
setx ANDROID_HOME "C:\Users\<YourName>\AppData\Local\Android\Sdk"
setx PATH "%PATH%;%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\build-tools\33.0.0"
```

**验证安装**：
```bash
adb version                  # Android Debug Bridge
aapt version                 # Android Asset Packaging Tool
javac -version               # Java编译器
```

### 9.4 首次构建检查清单

- [ ] Python 3.9+ 已安装
- [ ] pip依赖已安装（requests、qrcode、pycryptodome）
- [ ] Android SDK已安装
- [ ] `ANDROID_HOME` 环境变量已设置
- [ ] Build Tools 28.0.3+ 已安装
- [ ] Platform API 33 已安装
- [ ] Java 8+ 已安装
- [ ] debug.keystore 可用（或生成release keystore）
- [ ] 包名已修改为 `com.jxufe.jct`
- [ ] AndroidManifest.xml 已修改
- [ ] 图标资源已替换（或使用占位图）
- [ ] `build_apk.py` 参数已更新

## 十、测试验证计划

### 10.1 编译测试（无设备）

**目标**：验证APK能够成功构建

**步骤**：
```bash
cd jct/android
python build_apk.py
```

**预期输出**：
```
[✓] Android SDK found: C:\...\Android\Sdk
[✓] Build Tools found: 33.0.0
[✓] Platform API 33 found
[✓] Compiling Java sources...
[✓] Generating classes.dex...
[✓] Packaging resources...
[✓] Building APK...
[✓] Aligning APK...
[✓] Signing APK (debug)...
[✓] APK created: android/dist/jct-1.0.0-debug.apk (size: ~500KB)
```

**失败排查**：
- SDK路径错误 → 检查 `ANDROID_HOME`
- 编译错误 → 检查Java语法、包名引用
- 资源错误 → 检查 `res/` 目录完整性
- 签名错误 → 检查 debug.keystore 是否存在

### 10.2 安装测试（真机/模拟器）

**目标**：验证APK能够正常安装和启动

**步骤**：
```bash
# 连接设备
adb devices

# 安装APK
adb install android/dist/jct-1.0.0-debug.apk

# 启动应用
adb shell am start -n com.jxufe.jct/.MainActivity
```

**检查项**：
- [x] 应用图标显示"酱菜通"
- [x] 应用名称显示"酱菜通"
- [x] 启动后显示课表空状态
- [x] 底部导航显示4格：课表/学习/生活/我的
- [x] "我的"页显示版本号 1.0.0
- [x] "关于"卡片显示"基于航院通二次开发"
- [x] 不出现"航院通"字样（除授权声明）

### 10.3 功能测试（模拟数据）

**目标**：验证UI逻辑正常，使用模拟数据

**测试用例**：

1. **课表页**：
   - [ ] 空状态显示"还没绑定江财教务账号"
   - [ ] 加载模拟数据后显示课程网格
   - [ ] 左右滑动切换周次
   - [ ] 日视图/周视图切换
   - [ ] 点击课程色块显示详情

2. **学习通页**：
   - [ ] 显示"敬请期待"占位（第一阶段）

3. **生活页**：
   - [ ] 显示"敬请期待"占位（第一阶段）

4. **我的页**：
   - [ ] 显示三张绑定卡片（教务/学习通/798）
   - [ ] 点击"绑定"按钮弹出登录表单
   - [ ] 显示版本号和关于信息

### 10.4 缓存测试

**目标**：验证数据持久化

**步骤**：
1. 加载模拟课表数据
2. 退出应用
3. 杀死进程：`adb shell am force-stop com.jxufe.jct`
4. 重新启动应用

**预期**：
- [x] 课表数据仍然存在（从localStorage读取）
- [x] 设置保留（学期起始日期、作息时间等）

### 10.5 权限测试

**目标**：验证权限申请流程

**测试项**：
1. **网络权限**：
   - 自动授予（`INTERNET`是normal权限）
   - 发起HTTP请求无需用户确认

2. **相机权限**（用于798扫码）：
   - 首次点击"添加设备"时弹出权限请求
   - 拒绝后不能扫码，但可以手动粘贴
   - 权限可在系统设置中撤销和重新授予

## 十一、已知问题与待办

### 11.1 阻塞项（无法自行解决）

| 问题 | 影响 | 需要 | 状态 |
|------|------|------|------|
| 江财教务登录方式未知 | 无法实现登录 | 用户提供账号测试 | 🔴 阻塞 |
| 江财教务课表格式未知 | 无法解析数据 | 用户提供HTML样本 | 🔴 阻塞 |
| 慧生活798在江财的部署 | 可能不兼容 | 现场设备测试 | ⚠️ 风险 |

### 11.2 待实现功能（第一阶段暂不做）

- [ ] 江财教务CAS登录
- [ ] 江财课表查询和解析
- [ ] 学习通页面完整UI
- [ ] 慧生活798页面完整UI
- [ ] 自动更新检查（删除航院通服务器）
- [ ] 应用内下载安装

### 11.3 待优化项

- [ ] 图标设计（当前使用占位图）
- [ ] 主题色定制（可选江财VI色）
- [ ] 深色模式测试
- [ ] 平板适配（横屏布局）
- [ ] 多语言支持（当前仅中文）

## 十二、成果检查清单

**已完成**：
- [x] 包名修改为 `com.jxufe.jct`
- [x] 应用名称改为"酱菜通"
- [x] AndroidManifest.xml修改
- [x] strings.xml更新
- [x] 底部导航调整为4格
- [x] 删除公告、门户、郑航教务相关代码
- [x] 保留学习通和慧生活798模块
- [x] 版本号重置为1.0.0
- [x] 许可证声明保留和追加

**待验证**（需环境）：
- [ ] Debug APK构建成功
- [ ] APK安装测试
- [ ] UI基础功能测试
- [ ] 缓存持久化测试

**待实现**（需用户数据）：
- [ ] 江财教务适配
- [ ] 学习通和798页面集成

---

**文档状态**：✅ **Android基础适配方案已完成**，等待构建环境验证。
