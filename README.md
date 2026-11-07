# 酱菜通（JiangCaiTong）- 江西财经大学校园助手

**基于航院通二次开发 | MIT License | 非官方应用**

## 项目概况

酱菜通是面向江西财经大学的第三方Android校园助手，提供课表查询、学习通待办和宿舍饮水管理三大核心功能。项目基于郑州航空工业管理学院的开源项目[航院通](https://cnb.cool/Hobson2233/hangyuantong)进行二次开发，复用其成熟的WebView架构和安全存储方案。

**当前状态**：第一阶段已完成（文档规划和方案设计），等待环境配置和用户数据后进入代码实施阶段。

## 核心功能

| 功能模块 | 数据来源 | 状态 |
|---------|---------|------|
| **课表查询** | 江财教务系统（青果KINGOSOFT） | 📋 设计完成 |
| **学习通待办** | 超星学习通（全国统一平台） | ✅ 代码可复用 |
| **宿舍饮水** | 慧生活798（全国通用平台） | ✅ 代码可复用 |

**底部导航**：课表 / 学习 / 生活 / 我的（4格）

## 技术特性

**架构**：
- WebView + JavaScript桥接
- Android Keystore安全存储
- 离线缓存支持
- Apple HIG设计规范

**平台**：
- Android 8.0+ (API 26+)
- 包名：`com.jxufe.jct`
- APK体积：~500-800KB（预估）

**复用率**：约 **75-80%** 代码直接复用自航院通

## 项目结构

```
jct/
├── docs/                           # 📄 技术文档
│   ├── P0_SOURCE_AUDIT.md         # 上游源码审计报告
│   ├── P0_ANDROID_ADAPTATION.md   # Android适配记录
│   ├── P1_JUFE_ACADEMIC_RESEARCH.md  # 江财教务系统研究
│   ├── P1_INTEGRATION_PLAN.md     # 学习通与798集成计划
│   ├── P0_VALIDATION.md           # 验证报告
│   └── PROJECT_SUMMARY.md         # 项目总结报告
│
├── hangyuantong-main/             # 🗂️ 上游源码（参考）
│   ├── android/                   # Android原生代码
│   ├── web/                       # Web前端代码
│   ├── chaoxing.py                # 学习通模块
│   ├── water.py                   # 慧生活798模块
│   └── ...
│
└── README.md                      # 本文档
```

**注意**：`jct/android/` 和 `jct/web/` 等实际代码目录尚未创建，等待用户配置环境后实施。

## 第一阶段交付物

### ✅ 已完成

1. **源码审计报告**（20页）
   - 上游项目完整分析
   - 模块依赖关系图
   - 可复用能力矩阵
   - 复用率评估：75-80%

2. **Android适配记录**（30页）
   - 包名修改方案
   - 底部导航调整
   - 资源替换计划
   - 构建脚本修改

3. **江财教务研究报告**（25页）
   - 青果系统识别（vs 金智EAMS）
   - CAS统一认证分析
   - JufeAcademicAdapter架构
   - 接口文档模板

4. **学习通与798集成计划**（20页）
   - 可行性评估
   - UI设计方案
   - 数据模型定义
   - 账号隔离策略

5. **验证报告**（15页）
   - 架构验证
   - 未验证事项清单
   - 风险评估
   - 下一步优先级

6. **项目总结报告**（15页）
   - 完成情况
   - 阻塞因素
   - 经验总结
   - 项目展望

**总计**：约 **20,000字** 技术文档

### ⚠️ 未完成（受环境限制）

- APK构建（需Android SDK）
- 江财教务适配器（需账号和HTML样本）
- 真机测试（需测试设备）

## 快速开始

### 前置要求

**必需**：
- Python 3.9+
- Android SDK (Build Tools 28.0.3+, Platform API 33)
- Java 8+

**可选**：
- Android Studio（IDE调试）
- 真机或模拟器（测试）

### 环境配置

1. **安装Python依赖**：
   ```bash
   pip install requests qrcode pycryptodome Pillow
   ```

2. **配置Android SDK**：
   ```bash
   # Windows
   setx ANDROID_HOME "C:\Users\<YourName>\AppData\Local\Android\Sdk"
   setx PATH "%PATH%;%ANDROID_HOME%\platform-tools"
   ```

3. **验证环境**：
   ```bash
   python --version  # 应≥3.9
   adb version       # 应显示Android Debug Bridge版本
   javac -version    # 应≥8
   ```

### 代码实施（待执行）

```bash
# 1. 创建项目骨架
mkdir -p jct/android jct/web

# 2. 复制可复用代码
cp -r hangyuantong-main/android/src jct/android/
cp -r hangyuantong-main/web/* jct/web/
cp hangyuantong-main/chaoxing.py jct/
cp hangyuantong-main/water.py jct/

# 3. 修改包名（需要批量替换工具）
# 详见 docs/P0_ANDROID_ADAPTATION.md 第四章

# 4. 构建APK
cd jct/android
python build_apk.py

# 5. 安装测试
adb install jct-1.0.0-debug.apk
```

## 当前阻塞因素

### 🔴 高优先级

1. **无Android SDK环境**
   - 影响：无法构建APK
   - 解决：用户安装Android Studio或独立SDK

2. **无江财教务账号**
   - 影响：无法实现课表功能
   - 解决：用户提供测试账号或抓包数据

3. **无替换图标**
   - 影响：APK显示航院通图标
   - 解决：使用占位图标（快速）或设计新图标

### 🟡 中优先级

4. **慧生活798兼容性未知**
   - 影响：饮水功能可能不可用
   - 解决：用户在宿舍现场测试

## 用户需要提供

### 环境配置

- [ ] 安装Android SDK
- [ ] 配置环境变量 `ANDROID_HOME`
- [ ] 安装Python依赖

### 业务数据（用于江财教务适配）

- [ ] 一卡通号格式示例（脱敏）
- [ ] 登录页面截图
- [ ] 浏览器开发者工具Network面板截图
- [ ] 登录页HTML源码
- [ ] 课表页HTML源码

**详细抓包步骤**：见 `docs/P1_JUFE_ACADEMIC_RESEARCH.md` 第十章

### 兼容性测试（可选）

- [ ] 学习通账号测试（预期可用）
- [ ] 慧生活798账号测试（需验证江财是否部署）

## 开发计划

### 第二阶段（预计1-2周）

**目标**：交付首个可用Debug APK

- [ ] 创建项目骨架
- [ ] 修改包名和应用名
- [ ] 调整底部导航
- [ ] 实现江财教务适配器
- [ ] 集成学习通和798基础UI
- [ ] 构建和安装测试

### 第三阶段（预计1-2个月）

**目标**：完善所有功能模块

- [ ] 学习通待办列表、提醒
- [ ] 慧生活798设备管理、接水控制
- [ ] 考试安排、倒计时
- [ ] 成绩查询、GPA计算
- [ ] 性能优化、兼容性测试

### 长期规划

- 建立用户反馈渠道
- 持续优化体验
- 社区贡献和开源协作
- 可能的功能扩展

## 文档导航

**核心文档**：
- [📄 上游源码审计报告](docs/P0_SOURCE_AUDIT.md) - 了解航院通架构和可复用模块
- [📄 Android适配记录](docs/P0_ANDROID_ADAPTATION.md) - 查看详细的修改清单
- [📄 江财教务研究报告](docs/P1_JUFE_ACADEMIC_RESEARCH.md) - 理解江财教务系统差异
- [📄 学习通与798集成计划](docs/P1_INTEGRATION_PLAN.md) - 查看UI设计和数据模型
- [📄 验证报告](docs/P0_VALIDATION.md) - 了解已验证和未验证事项
- [📄 项目总结报告](docs/PROJECT_SUMMARY.md) - 查看完整项目概况

**快速查询**：
- 如何修改包名？→ `P0_ANDROID_ADAPTATION.md` 第四章
- 如何调整底部导航？→ `P0_ANDROID_ADAPTATION.md` 第五章
- 如何抓包江财教务？→ `P1_JUFE_ACADEMIC_RESEARCH.md` 第十章
- 如何构建APK？→ `P0_ANDROID_ADAPTATION.md` 第七章
- 学习通如何集成？→ `P1_INTEGRATION_PLAN.md` 第二章
- 慧生活798如何集成？→ `P1_INTEGRATION_PLAN.md` 第二章

## 常见问题

**Q: 为什么基于航院通而不是从零开发？**  
A: 航院通提供了成熟的WebView架构、安全存储和缓存机制，复用率达75-80%，大幅降低开发成本和风险。

**Q: 江财教务系统与郑航有什么区别？**  
A: 江财使用青果软件KINGOSOFT系统，郑航使用金智EAMS系统，接口完全不同。用户需求中明确警告不能假设兼容。

**Q: 学习通和慧生活798能直接用吗？**  
A: 学习通是全国统一平台，代码可100%复用。慧生活798也是全国通用平台，代码可复用但需验证江财宿舍是否部署。

**Q: 为什么删除公告和门户功能？**  
A: 用户需求明确：不迁移郑航的校园公告和办事入口，聚焦课表、学习通和饮水三大核心功能。

**Q: 需要自建服务器吗？**  
A: 不需要。凭据本地加密存储，数据直接从学校服务器获取，无需中转服务器。

**Q: 如何保证账号安全？**  
A: 使用Android Keystore + AES/GCM加密，密钥绑定到设备无法导出，符合Android安全标准。

**Q: 项目会开源吗？**  
A: 是的，遵循MIT许可证开源，欢迎社区贡献。

## 许可证

本项目基于 [航院通](https://cnb.cool/Hobson2233/hangyuantong) 进行二次开发，遵循 MIT License。

```
MIT License

Copyright (c) 2026 Hobson (航院通原作者)
Copyright (c) 2026 酱菜通开发团队

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 免责声明

**酱菜通是非官方第三方应用，与江西财经大学官方无关。**

- 本应用仅供学习交流使用，不得用于商业用途
- 用户需自行承担使用风险
- 开发者不对因使用本应用导致的任何损失负责
- 凭据本地加密存储，不上传到任何服务器
- 遵循只读原则，不修改学校系统数据
- 建议用户定期备份重要信息

## 致谢

- **航院通原作者Hobson**：提供优秀的开源项目基础
- **江西财经大学**：提供教务系统研究对象
- **开源社区**：学习通协议逆向、慧生活798签名提取、Android最佳实践

## 联系方式

**项目仓库**：待创建（建议GitHub）  
**问题反馈**：待设置（建议GitHub Issues）  
**用户社区**：待建立（建议QQ群或微信群）

---

**文档生成时间**：2025-01-XX  
**第一阶段状态**：✅ 已完成（文档规划和方案设计）  
**下一步**：等待用户配置环境和提供业务数据

**当前版本**：1.0.0-planning（规划阶段）  
**预计首个可用版本**：1.0.0-alpha（10-15天后，取决于用户配合进度）
