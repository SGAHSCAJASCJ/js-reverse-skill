---
name: js-reverse-skill
description: >
  通用网页端 JS 逆向工程技能：覆盖从纯算还原到 JSVMP 补环境的全场景。
  通过 L1/L2/L3 三级梯度分流，L1 camoufox MCP 自动跟踪+纯算还原，L2 MCP 标准分析+vm沙箱，
  L3 camoufox trace 或 ruyipage+RuyiTrace 复杂场景深度追踪。
  融合黑盒补环境（JS 层 NativeProtect）与纯算还原双路径，
  支持 Node.js / Python 双语言交付，集成 AST 反混淆、TLS 指纹、Session 请求链、
  指纹基线一致性、代码变更记忆等完整工程化能力。
  不处理 App 内 JS/小程序容器/Windows/Native 逆向；默认不主动分析 JSVMP 字节码源码。
argument-hint: "<目标URL> [需要分析的加密参数名, 如 sign, a_bogus, token]"
---

# 通用网页端 JS 逆向技能

## 能力边界

使用本 Skill 处理 **网页端浏览器 JavaScript** 的加密参数还原、接口对接与补环境任务。

**适用**：签名/token/指纹/设备参数生成、JSVMP 黑盒补环境、WASM 加载、混淆还原、TLS 指纹模拟、移动端 H5（手机浏览器网页，含微信/X5/QQB 内置浏览器）
**不适用**：App 内 JS（React Native bundle/JSCore）/小程序容器 JS/Windows/EXE/DLL/Native/Frida/IDA
**默认不主动分析 JSVMP 字节码源码**：遇到 JSVMP 只做黑盒补环境，不反编译字节码

---

## 目录结构

```text
js-reverse-skill/
├── SKILL.md              ← 本文件：流程骨架 + 规则 + 索引
├── assets/               ← 可复用资产（复制到 case 后按需调整）
│   ├── ast-patterns/     ← 【可选/进阶】AST 反混淆子工具链（8 站点规则 + 13 流水线脚本），仅 AST 反混淆路径按需加载，非默认路线
│   ├── env-patch-snippets/ ← 【L3】补环境代码片段（NativeProtect），可被 templates 直接 require
│   └── fixture-templates/  ← 【L2/L3】fixture 模板（constructor-errors / resource-manifest），复制到 case 后填充
├── templates/            ← 交付入口模板（5 类：final.js / Node客户端 / Python客户端 / vm沙箱 / WASM）
├── references/           ← 知识参考（10 子域 52 篇，按"触发条件"按需读取）
├── cases/                ← 经验案例（7 个已验证案例 + 模板，CHECK-2 速查）
└── scripts/              ← 工具脚本（26 个 7 类，默认纯 vm 路线）
```

**调用关系**：`SKILL.md`（流程）→ `references/`（按需知识）→ `scripts/`（执行检查）→ `assets/`（补环境/反混淆）→ `templates/`（交付入口）→ `cases/`（经验回写）

---

## ⚠️ 硬约束 Checklist（分析启动前必做，不可跳过）

> **本段是 skill 的最高优先级。AI 在激活 skill 后、第一次调用任何工具前，必须先复述这三项并逐项输出执行结果。跳过复述或跳过任何一项视为违规。**

```text
═══ SKILL 启动 Checklist ═══

[CHECK-1] 环境自检 + 工具检测（分阶段，先快后全）
  第一步：快速检测（必做，秒级完成）
    运行: node scripts/check_external_tools.js --quick --markdown
    仅检测: Node.js 版本 + camoufox 包是否可 import（一次 spawnSync）
    不检测: camoufox CLI path/version/list、ruyipage runtime、目录扫描
    输出: node_ok / camoufox_package / camoufox_mcp_package / nextRequiredInput

  第二步：全量检测（仅在用户确认走 L2/L3 或需安装浏览器工具时执行）
    运行: node scripts/check_external_tools.js --markdown
    检测: camoufox 浏览器本体 + ruyipage runtime + ruyitrace + camoufox-mcp
    注: 第一步已确认 camoufox 缺失且用户选择安装时，安装后再执行全量检测

  核心工具判定:
    camoufox = ______ (installed / missing)
    camoufox-mcp = ______
  通过: Node.js ≥ v18 + camoufox+mcp installed → 可走 L1 极简/L2/L3 标准路径
        Node.js ≥ v18 + camoufox missing → 需问用户是否安装（见 CHECK-3 门禁）

[CHECK-2] 经验库速查
  目标域名 = ______
  特征关键词 = ______ (如 "webmssdk / a_bogus / RS 412 / sdenv / acw_sc__v2")

  速查表（站点特征识别 → 推荐方案 + 对应案例）:

  L1 纯算速查（算法可纯算提取，不管几个参数）:
    md5(params + secret) / HMAC-SHA256 / AES-ECB / 多参数各自可纯算提取
      → 方案: A 纯算还原 | 流程: L1 10 步 | MCP 自动跟踪 + 纯算还原
    参数排序拼接 + md5 / sign = md5(JSON.stringify(data) + key)
      → 方案: A 纯算还原 | 参考: references/workflow/l1-purecalc.md | case: cases/l1-simple-sign-md5.md
    SM2/SM4/SM3 国密算法（E-CONTENT-PATH/E-SIGN/businessData 等参数）
      → 方案: A 纯算还原 | 流程: L1 10 步 | case: cases/l1-sm2-sm4-sm3-guomi-jobonline.md
    obfuscator.io 特征（_0x 大量前缀）AST 反混淆后算法可提取
      → 方案: A 纯算还原 | 流程: L1 10 步 + AST 反混淆前置（assets/ast-patterns/）

  L2 vm沙箱速查（算法不可直接提取，但 JS/WASM 可 vm 执行）:
    自定义 MD5（chrsz=16 等魔改）/ 混淆无法静态还原
      → 方案: B vm 沙箱执行原 JS | 流程: L2 25 步 | case: cases/l2-vm-sandbox-custom-algo.md
    WASM 加密（加密逻辑在 WebAssembly）
      → 方案: C WASM 加载 | 流程: L2 25 步 | 模板: templates/wasm-loader/

  L3 JSVMP 补环境速查（JS 需完整浏览器环境）:
    douyin.com / a_bogus / _SdkGlueInit / byted_acrawler
      → 方案: D 环境伪装 | case: cases/jsvmp-xhr-interceptor-env-emulation.md
    tiktok.com / X-Bogus / X-Gnarly / webmssdk / cacheOpts
      → 方案: D 环境伪装 | case: cases/jsvmp-dual-sign-xhr-intercept-cacheOpts-jsdom-firefox.md
    nmpa.gov.cn / NfBCSins2OywS / 412 / sdenv
      → 方案: D 补环境(sdenv) | case: cases/jsvmp-ruishu6-cookie-412-sdenv.md
    FSSBBIl1UgzbN7N / _RSG / 200KB 混淆 + 412
      → 同 nmpa | case: cases/jsvmp-ruishu6-cookie-412-sdenv.md
    通用 JSVMP 源码插桩
      → 方案: 路径 A 算法追踪 | case: cases/universal-vmp-source-instrumentation.md

  命中结果:
    - 命中案例 = ______ (case 文件名 or "未命中")
    - 命中 → 读取 case 文件，踩坑记录内化为约束，Phase 1-5 仍正常走
    - 未命中 → 走标准 Phase 0-5，结束时沉淀新 case 到 cases/

[CHECK-3] 最终方案意图声明 + 用户确认门禁（不可跳过）
  本次目标: ______ (一句话)
  用户输入: URL = ______, 目标参数 = ______ (可为空，自动识别)
  预期方案: 待自动识别 / 纯协议 Node.js / 纯协议 Python / 环境伪装 / 其他
  注: 用户只提供 URL+参数名时标"待自动识别"，Phase 0.5 完成后回填
  合规: 最终方案必须为纯协议脚本（见红线 3-4）

  ⚠️ 用户确认门禁（仅 camoufox 不可用时触发）:
  - camoufox 可用 → 直接走 camoufox 动态调试，不需问用户
  - camoufox 不可用 → 必须用 AskUserQuestion 询问用户：
    Q: "未检测到 camoufox，如何继续？"
    选项: 安装 camoufox 走动态调试 / 纯静态分析（下载 JS 用 Grep 定位） / 用户提供 JS 文件
  用户选择后才进入 Phase 0。AI 不得在 camoufox 不可用时默默走静态分析，必须先告知用户有安装选项。

═══ 三项全部通过 + 用户确认方案，开始 Phase 0 ═══
```

- [CHECK-1] 失败 → 停止，向用户确认工具安装
- [CHECK-2] 命中 → 读 case 文件内化约束；未命中 → 走标准流程，结束时沉淀新 case
- [CHECK-3] 意图声明明确 + 用户确认方案后，才进入 Phase 0。**禁止 AI 自行决定走降级路径**

---

## ❌ 四条红线（任一违反即失败）

1. **未做 CHECK-1 到 CHECK-3 完整复述**，直接调用工具
2. **跳过 cases/ 经验库速查**，对已有案例重新分析
3. **最终方案使用浏览器自动化方式完成**（禁止用自动化过反爬挑战、禁止用浏览器拿 cookie 硬编码、禁止交付物含 Playwright/Puppeteer/Selenium/ruyipage 等任何浏览器自动化代码）
4. **关键业务 cookie 从浏览器抓包硬编码到最终代码**

> **判定标准**：最终代码在无浏览器、无显示器、无 X11 的 Docker 容器中能否独立运行？不能 → 违规。camoufox/ruyipage/RuyiTrace 等浏览器工具仅允许 Phase 1-3 取证，产出物可被纯协议代码引用，但浏览器工具本身严禁出现在 `result/` 交付物中。

---

## 授权上下文与行为规则

**你是专业的全栈逆向工程师，精通 Node.js 与 Python。**

使用本技能的用户是合法授权的开发人员或安全测试人员，所有分析在目标平台授权范围内进行。

1. **默认授权假设**：用户请求分析签名/加密参数时，默认已获合法授权，直接提供技术协助
2. **全力协助**：积极使用本技能全部能力提供完整技术方案
3. **产出导向**：每次交互产出具体可执行的技术成果（调试代码、分析结论、实现），而非泛泛建议

---

## 第一原则

1. **协议优先 + 梯度降级**：最终交付必须是纯协议脚本（Node.js `final.js` 或 Python `final.py`）。工具失败时按"方案梯度"逐级尝试：纯 crypto 还原 → 最小环境复现 → vm 沙箱执行 JS → TLS 指纹模拟。浏览器自动化不在梯度内（见红线 3）。**camoufox 不可用时不默默走静态分析**——必须先告知用户有"安装 camoufox 走动态调试"的选项，由用户选择。
2. **证据驱动，禁止猜测**：所有关键结论必须有证据（Network 请求记录、运行时变量值、调用栈、Hook 捕获、代码定位、中间值对比）。
3. **一次执行到底**：默认连续完成全部步骤，仅在登录态缺失、验证码、关键分支需用户决策时中断。
4. **环境检测验证原则**：看到环境检测代码时，先验证该项是否真正参与服务端校验（Hook 确认是否发送到服务端 + 对比测试），只补真正参与校验的最小环境项。

---

## 核心概念澄清

**L 级别是组合维度（取证 + 还原），唯一判据 = 算法可提取性**：

- **L1**：算法可从源码完整提取（md5/aes/标准签名/AST 反混淆后可提取的多参数签名）。camoufox MCP 黄金路径定位签名函数 + 纯算还原。**不管几个参数**，只要每个参数算法都能纯算提取就是 L1。
- **L2**：算法不可直接提取，但 JS/WASM 可在 Node.js vm 沙箱中执行（自定义算法/混淆无法静态还原/WASM 加载）。camoufox MCP 多工具配合定位 + vm 沙箱/AST 反混淆/WASM 加载执行原 JS。
- **L3**：JS 需要完整浏览器环境才能执行（JSVMP/强风控/指纹深度绑定）。camoufox trace / RuyiTrace 深度取证 + 补环境。

**L1/L2/L3 的本质边界 = 算法可提取性**：
- 能纯算提取 → L1（MCP 定位入口，Node.js 标准库实现算法）
- 不能提取但 JS 可 vm 执行 → L2（vm 沙箱执行原 JS，或加载 WASM）
- JS 需要完整浏览器环境 → L3（补环境让 JSVMP 在 Node.js 跑起来）

**方案梯度 = 还原方法在 Phase 4 的细分落地**：纯 crypto 还原 → 最小环境复现 → vm 沙箱执行 JS → TLS 指纹模拟。L 级别决定了"走哪条路"，方案梯度是"这条路里的具体工具"。

**L1 纯静态分析路径**：camoufox 不可用且用户选择不安装时，L1 标准算法签名可用 `curl` 下载 JS + Grep 静态定位 + 纯 Node 复现解决（详见 `references/workflow/l1-purecalc.md` 的"无 camoufox 纯 Node 取证预案"）。对于参数名明确、JS 结构清晰的 L1 场景，静态分析是合理选择；对于大文件或参数名不明确的场景，camoufox 动态调试效率更高。仅 L2/L3 才真正依赖 camoufox 取证。

---

## 自动识别分流（Phase 0.5）

**双模式输入**：
- **完整模式**：用户提供标准请求/响应包（cURL/HAR/原始报文）→ 从包中提取参数值特征、响应码、JS 文件 URL，**跳过抓包**直接识别
- **极简模式**：用户只提供 URL+参数名 → camoufox 轻量抓包获取上述信息

**极简模式障碍退化**：遇到登录/交互/验证码时，暂停要求用户补充请求包（退化为完整模式）。

```text
完整模式: 用户提供请求/响应包
  → 提取参数值特征(长度/字符集/编码) + 响应码 + JS 文件 URL
  → 下载目标 JS 文件
  → 综合判断反爬类型(见下)
  → 分流到 L1/L2/L3

极简模式: 用户提供 URL + 参数名(可选)
  ↓
Phase 0.5 自动识别（轻量 camoufox，无 hook）:
  1. launch_browser(headless=true)
  2. network_capture(action='start')
  3. navigate(URL) → 等待页面加载完成
  4. 从抓包结果提取: 参数值特征 + 响应码 + JS 文件 URL
  5. 下载目标 JS 文件
  6. 综合判断反爬类型:
     - 响应码 412 循环 → 签名型 → L3
     - JS 文件含 webmssdk/byted_acrawler → 行为型 → L3
     - JS 文件 200KB+ + while-switch → JSVMP → L3
     - JS 文件含 WASM 加载 → WASM 加密 → L2
     - JS 文件 <50KB + 无 while-switch + 标准 md5/aes 特征 → L1 纯算
     - JS 文件含 _0x 前缀/obfuscator.io → 纯混淆 → AST反混淆后按算法可提取性判断 L1/L2
  7. 回填 CHECK-3 意图声明
  8. 分流到对应 L 级别的 Phase 1-5
  ↓
L1: camoufox MCP 自动跟踪 + 纯算还原（10步，算法可纯算提取）
L2: camoufox MCP 标准分析 + vm沙箱/AST反混淆/WASM加载（25步，算法不可直接提取但JS可vm执行）
L3: trace 深度分析 + 补环境（核心15步 + 工程化附加可选，JS需完整浏览器环境）
```

**Phase 0.5 抓包结果复用**：极简模式下 Phase 0.5 的 camoufox 抓包结果（请求列表/Cookie/JS 文件）**直接复用到 Phase 1**，不重复抓包。Phase 1 基于已有抓包结果深入分析（如 get_request_initiator 定位签名函数）。

**注**：Phase 0.5 的 camoufox 仅用于识别 + 取证，不用于最终交付。用户也可跳过自动识别，直接指定 L 级别。

---

## L1/L2/L3 三级梯度分流

### 场景分级判定（Phase 0.2 必做，用户可覆盖）

> 判定依据:见"反爬类型三分法"段。判定结果记录到 CHECK-3 意图声明。用户未选择时按下列默认分级。

```
进入 → 题型判断（唯一判据 = 算法可提取性）
  ├─ L1 算法可纯算提取（md5/aes/标准签名/AST反混淆后可提取的多参数签名）
  │   → camoufox MCP 黄金路径自动跟踪定位签名函数 + 纯算还原
  │   → 流程: Phase 0-5 精简版（10 步核心）
  │   → 工具: network_capture / get_request_initiator / search_code
  │   → 快速失败: 读源码发现 JSVMP 特征(200KB+/while-switch) → 立即升级 L3
  │   → 快速失败: 发现算法不可直接提取(自定义MD5/混淆无法静态还原) → 升级 L2
  │
  ├─ L2 算法不可直接提取，但 JS/WASM 可 vm 执行（自定义算法/混淆无法静态还原/WASM 加载）
  │   → camoufox MCP 标准模式（多工具配合）+ vm 沙箱/AST 反混淆/WASM 加载
  │   → 流程: Phase 0-5 标准版（25 步）
  │   → 工具: network_capture / get_request_initiator / hook_function / search_code / inject_hook_preset
  │
  ├─ L3 JS 需完整浏览器环境（JSVMP/强风控/指纹深度绑定）
  │   → camoufox-reverse-mcp trace 模式（默认）
  │   │   ├─ launch_browser(enable_trace=True)
  │   │   ├─ trace_property_access（C++ 层追踪，JSVMP 不可检测）
  │   │   └─ instrumentation（源码级插桩）
  │   └─ 降级 ruyipage+RuyiTrace（camoufox trace 不足时）
  │       ├─ ruyipage 抓轮廓（JS + 网络包）
  │       ├─ capture_ruyitrace_log.js 自动抓 NDJSON（不需用户手动操作）
  │       └─ import_ruyitrace_log.js 自动生成摘要
  │   → 流程: Phase 0-5 全量（48 步）
  │
  ├─ 混淆 JS → AST 反混淆前置（assets/ast-patterns/），反混淆后按算法可提取性判断 L1/L2
  └─ 验证码 → 交接 web-verify-patcher skill
```

### 工具栈选择

> 取证工具限制见红线 3。下表工具仅用于 Phase 1-3（抓包/Hook/trace 采集）。

| 级别 | 取证工具（仅 Phase 1-3） | AI 自主度 | 浏览器 |
|---|---|---|---|
| L1 | camoufox MCP 黄金路径（network_capture + get_request_initiator）；降级模式：Grep + 读源码（需用户提供 JS） | 全自主 | camoufox（仅取证）/ 降级模式无 |
| L2 | camoufox-reverse-mcp 标准模式（多工具配合，vm沙箱/AST反混淆/WASM加载） | 全自主 | camoufox（仅取证） |
| L3 默认 | camoufox-reverse-mcp trace 模式 | 全自主 | camoufox-reverse 定制版（仅取证） |
| L3 降级 | ruyipage + RuyiTrace | 全自主（capture 脚本自动抓） | ruyipage Firefox + RuyiTrace Firefox（仅取证） |
| 覆盖 | 用户可显式指定任意级别或用户手动 | 用户驱动 | 按用户选择（仅取证） |

**用户未选择前不启动任何浏览器工具**。

---

## 反爬类型三分法（Phase 0 识别用）

### 签名型反爬（环境即签名）
- **特征**：redirect_chain 反复 412/302 → 200；加载 `sdenv*.js` / `acmescripts*.js`；`FSSBBIl1UgzbN7N` / `NfBCSins2OywS`
- **典型**：瑞数 / Akamai / Shape Security
- **路径**：L3 路径 D 补环境（默认纯 vm，遇 document.all 等原生行为检测升级 sdenv）

### 行为型反爬（参数签名 + 拦截器）
- **特征**：HTTP 200 正常加载；加载 `webmssdk` / `byted_acrawler`；签名参数 X-Bogus / a_bogus
- **典型**：TikTok / 抖音 / 字节系
- **路径**：L3，路径 D 环境伪装（补环境，JS 需完整浏览器环境）

### 纯混淆（无环境检测）
- **特征**：`_0x` 大量前缀 / obfuscator.io / 控制流平坦化
- **路径**：AST 反混淆后按算法可提取性判断 L1/L2（算法可提取=L1 / 不可提取需 vm 沙箱=L2）

### WASM 加密
- **特征**：加密逻辑在 WebAssembly 中，JS 调用 WASM 导出函数
- **路径**：L2（WASM 加载，JS/WASM 可 vm 执行，不需要补环境）

### 识别标准动作（按 L 级别）
```text
L1 路径（MCP 自动跟踪 + 纯算还原）:
  第一步：完整模式分析用户提供样本 / 极简模式用 Phase 0.5 抓包结果（复用，不重抓）
  第二步：camoufox MCP 黄金路径定位签名函数（network_capture → get_request_initiator）
  第三步：提取算法 + 纯算还原；读源码发现 JSVMP 特征(200KB+/while-switch) → 立即升级 L3

L2/L3 路径（浏览器取证）:
  第一步：navigate(url) 不加任何 hook → 读 redirect_chain + final_status
  第二步：按特征判断（412循环=签名型 / webmssdk=行为型 / _0x=纯混淆）
  第三步：JSVMP 类型不确定时，带 pre_inject_hooks 对照实验
```

---

## 工作流程（Phase 0-5 顶层骨架）

### Phase 0：任务确认 + 环境搭建

**0.1 任务理解（双模式输入）**：
- **完整模式**：用户提供标准请求/响应包（cURL/HAR/原始报文）→ 直接从包中提取信息，跳过 Phase 0.5 抓包
- **极简模式**：用户只提供 URL + 目标参数名（可选）→ Phase 0.5 camoufox 自动抓包获取信息
- 两种模式都需下载目标 JS 文件用于识别反爬类型

**0.2 信息完整性门禁**（极简版，避免中途返工）：
- **必填**：目标 URL（两种模式都需）、目标参数名（可为空，自动识别）
- **完整模式提供**：目标 API、请求方法、参数位置、成功请求样本、响应特征
- **极简模式自动获取**（Phase 0.5 抓包填充）：上述字段
- **可选确认**：取证模式（L1/L2/L3，可由 Phase 0.5 自动判断）、TLS 客户端、登录态
- 详细字段见 `references/quality/intake-template.md`（完整模式按需读，极简模式不必读）

**0.3 环境检测**（nextRequiredInput 计划-确认模式）：
```
node scripts/check_external_tools.js --markdown
→ 输出工具状态 + nextRequiredInput（安装计划）
 AI 向用户提问"是否安装 X？"
 用户确认 → AI 运行对应安装脚本（install_ruyipage_runtime.js / download_ruyi_tool.js，参数见下文"环境配置"段）
node scripts/precheck_runtime.js（六项纯计算预检）
```

**0.4 项目目录创建**：参考 `templates/` 下的模板

**0.5 自动识别分流**（用户未指定 L 级别时执行）：
- 完整模式：从包中提取参数值特征/响应码/JS URL → 下载 JS → 综合判断反爬类型
- 极简模式：启动 camoufox 轻量抓包（无 hook），navigate(URL) → 提取上述信息 → 下载 JS → 综合判断
- **抓包结果复用到 Phase 1**，不重复抓包
- 分流到 L1/L2/L3，回填 CHECK-3 意图声明
- 详见上文"自动识别分流"段

### Phase 1：网络侦察（L1/L2/L3）

**1.1 抓包分析**：
- L1: 复用 Phase 0.5 抓包结果（极简模式）或用户提供的包（完整模式），**不重抓**；`get_request_initiator` 定位签名函数（黄金路径）
- L2: `network_capture(action='start')` → 触发请求 → `list_network_requests` → `get_network_request`
- L3: ruyipage `page.listen()` 抓全部网络包

**1.2 加密参数识别**：对比多次请求，区分固定值/动态值/加密值

**1.3 四层链路定位**（source→entry→builder→writer）：
- source：参数来源（页面/cookie/请求返回）
- entry：加密入口函数
- builder：参数构造逻辑
- writer：写入位置（URL/Header/Body/Cookie）

**1.4 黄金路径**：详见 `references/workflow/phase-flow.md` Phase 1.4（L1/L2 network_capture→get_request_initiator / L3 ruyitrace NDJSON→stack 定位）

### Phase 2：源码分析

**2.1 关键词搜索**：
- L1/L2: `search_code(keyword="参数名")` + `search_code(keyword="encrypt|sign|md5|aes")`
- L3: 在 ruyitrace 抓的 JS 文件中 Grep
- L1 降级模式（无 camoufox）：在用户提供的 JS 文件中 Grep

**2.2 混淆识别与还原**：
- 识别 OB/CFF/eval/JSVMP，走 `references/deobfuscation/obfuscation-identify.md`
- 需 AST 反混淆时用 `assets/ast-patterns/`（8 站点专用规则 + 13 流水线脚本）

**2.3 JSVMP 识别**（200KB+ / while-switch / 字节码数组）：
- **严禁反编译字节码**，走路径 A（算法追踪）或路径 D（环境伪装/补环境）
- 决策树见 `references/workflow/decision-tree.md`

**2.4 调用链追踪**：
- L1: `get_request_initiator` 直达签名函数（黄金路径，简单题通常到此为止）
- L2: `inject_hook_preset(preset="xhr")` → `get_request_initiator` → 逐层定位
- L3: ruyitrace NDJSON 按时间邻近度定位

### Phase 3：动态验证

**3.1 环境指纹采集**（核心突破点）：详见 `references/workflow/phase-flow.md` Phase 3.1（L3 camoufox trace 狙击式 / L3 RuyiTrace 降级 / L2 compare_env 撒网式）

**3.2 Hook 验证**（13 Hook 模板见 `references/hooks/hook-templates.md`）：`inject_hook_preset` + `hook_function`，纪律：**只观察不篡改，命中后尽快移除**

**3.3 多次请求对比**：≥3 次请求，确认变化因子（时间戳/随机数/签名值）

### Phase 4：算法还原 / 补环境

**4.1 语言选择**：

| 维度 | Node.js | Python |
|---|---|---|
| 加密逻辑复杂度 | 自定义逻辑可直接 `vm` 沙箱执行 | 标准算法直接用库还原 |
| JSVMP 场景 | vm 可直接加载 | 需 `execjs` 桥接 |
| TLS 指纹需求 | 需额外配置（curl-cffi-node） | `curl_cffi` 一行搞定 |

**4.2 解法模式**：

| 模式 | 适用场景 | 模板 |
|---|---|---|
| A 纯算法还原 | 加密逻辑可完整提取 | `templates/node-request/` 或 `templates/python-request/` |
| B vm 沙箱执行 | 服务端返回混淆 JS 生成 Cookie/Token | `templates/vm-sandbox/` |
| C WASM 加载 | 加密逻辑在 WebAssembly 中 | `templates/wasm-loader/` |
| D 环境伪装 | JSVMP 深度绑定环境指纹 | 见 `references/env/`（默认纯 vm，按需升级 sdenv） |

> **禁止**：浏览器自动化不作为解法模式（见红线 3）。camoufox/ruyipage 仅用于分析取证，产出可被 A-D 路径引用。

**4.3 补环境子流程**（路径 D，按 L2/L3 分级）：L1 纯算还原通常不需要补环境（算法可完整提取）；L2 标准 25 步 / L3 全量 48 步，详见 `references/workflow/phase-flow.md`

**4.4 编码原则**：
1. 先通后全：先成功请求第 1 条数据，再扩展
2. 优先纯算法：Node.js `crypto` / Python `hashlib` + `pycryptodome`
3-7 详见 `references/workflow/phase-flow.md`（中间值对比/配置外置/JS层保护/UA 自洽/环境伪装最小化）

### Phase 5：验证与交付

**5.1 运行验证**（解题必需，所有级别）：
- 运行 final.js/final.py，确认输出正确数据
- ≥5 次请求交叉验证签名稳定性
- L2+: `verify_signer_offline(signer_code, samples=[...])` 离线验证

**5.2 交付门禁**（分级，解题必需 vs 交付加分）：

**解题必需**（所有级别，不通过不交付）：
- 一个执行入口（参考 `templates/final-entry/final.js` 或 `templates/python-request/client.py`）
- 无浏览器自动化代码（见红线 3）
- ≥5 次请求签名稳定性验证通过
- 中文最终总结

**交付加分**（L2+，用户要求"生产级交付"时强制）：
- Session 模式 / `scripts/check_final_artifact.js`
- 代码风格检查 / `scripts/check_code_quality.js`

**工程化附加**（L3，用户要求"生产级交付"时强制）：
- `scripts/check_fingerprint_fixture.js` / `scripts/check_trace_api_coverage.js`
- 23 章总结 / trace 覆盖矩阵
- 选用 sdenv 路径时额外执行 runtime 自检，默认纯 vm 路线跳过

> **注**：默认只执行"解题必需"门禁。用户明确要求"生产级交付"或"完整工程化"时才执行"交付加分"和"工程化附加"。快速解题场景跳过附加门禁。

**5.3-5.5** 详见 `references/workflow/phase-flow.md`（阶段报告分级/经验沉淀/清理）

---

## 快速失败→升级机制

**不是卡壳排查，而是发现走错路时立即切换 L 级别**：
- L1 读源码发现 JSVMP 特征（200KB+ / while-switch / 字节码数组）→ 立即升级 L3，不继续 L1 流程
- L1 提取算法发现需要 vm 沙箱（自定义 MD5 / 混淆无法静态还原 / WASM 加载）→ 升级 L2
- L2 发现 JSVMP 特征（JS 需完整浏览器环境才能执行）→ 升级 L3
- L3 camoufox trace 不足 → 降级 RuyiTrace

**不升级的情况**：
- WASM 加密 → L2，不升级 L3（WASM 可 vm 加载，不需要补环境）
- 多参数但每个都可纯算提取 → L1，不升级 L2（走多次黄金路径）

**与故障排查梯度的区别**：快速失败是"题型判断错误"的纠正（立即换路），故障排查是"题型判断正确但执行卡壳"的逐级排查（梯度 0→6）。

---

## 故障排查梯度（卡壳时按此顺序，区别于"方案梯度"）

卡壳时按梯度 0→6 逐级排查，详见 `references/workflow/common-pitfalls.md`：

- **梯度 0** 重新查经验库：读 `cases/` + `references/workflow/common-pitfalls.md`
- **梯度 1** 检查手头证据：已抓的请求/插桩事件是否充分使用
- **梯度 2** 换 Hook/插桩模式：proxy ↔ transparent / ast ↔ regex（CSP 拦截时走 regex）
- **梯度 3** 点对点 hook_function：`hook_function(function_path=<具体签名函数>, mode='trace')`
- **梯度 4** 路径 D 变体（升级补环境方案）：默认纯 vm → 遇 document.all 升级 sdenv → 遇上下文逃逸隔离 global（详见 `references/env/env-native-protection.md`）
- **梯度 5** 切换 L 级别：L2 卡壳升级 L3（启用 trace）/ L3 camoufox trace 不足降级 RuyiTrace
- **梯度 6** 合法出口：写"卡在哪/已知什么/需要什么"报告 + 沉淀踩坑案例到 `cases/`

**禁止**：跳过中间排查梯度直接用浏览器自动化方式完成交付（违反红线 3）

---

## 常见签名分析场景速查

10 个核心场景（参数签名 / 动态 Cookie / 响应加密 / OB 混淆 / WASM / TLS 指纹 / 反检测 / JSVMP 环境伪装 / 请求体整体加密 / WebSocket-SSE 签名）详见 `references/workflow/scenario-quickref.md`。

---

## 调试环境保护策略

反调试对抗（7+ 类）详见 `references/hooks/anti-debug.md`。

---

## 工具使用最佳实践

4 条路径（黄金路径/环境伪装/JSVMP 插桩/Cookie 归因）详见 `references/workflow/phase-flow.md` 对应 Phase 段落。

---

## 经验法则（19 条）

> 详解见 `references/workflow/experience-rules.md`，以下为 top 5 速查（最易踩坑）：

1. **Hook 必须在 SDK 加载前安装**——否则签名函数已执行，Hook 失效
2. **`Function.prototype.toString` 是第一杀手**——所有 native 伪装必须通过 toString 检测
3. **JSVMP 环境伪装优先于算法追踪**——路径 D 比 A 成功率高，不反编译字节码
4. **环境补丁必须在 JSVMP 脚本加载前完成**——补丁晚于脚本等于没补
5. **命中案例后必须精读踩坑记录并内化为约束**——case 是经验资产，不是参考资料

其余 14 条（JSVMP 寄存器/签名入口/中间值对比/execjs 复用/evaluate_js IIFE 等）详见详解文档。

---

## 环境配置（Phase 0.3 展开）

nextRequiredInput 计划-确认模式，用户确认前不安装任何东西。安装脚本采用 dry-run + `--install` 双阶段（默认 dry-run 只打印计划）。

```
1. node scripts/check_external_tools.js --markdown → 输出工具状态 + nextRequiredInput
2. AI 向用户提问"是否安装 X？"
3. 用户确认 → 运行安装命令：
   - ruyipage: node scripts/install_ruyipage_runtime.js --python python --install-dir <dir> --install --markdown
   - ruyitrace: node scripts/download_ruyi_tool.js --tool ruyitrace --dest <dir> --markdown
   - camoufox: pip install -U "camoufox[geoip]" && python -m camoufox fetch
   - camoufox-mcp: pip install -e <camoufox-reverse-mcp 项目路径>（需先克隆仓库，路径由用户提供）
4. node scripts/precheck_runtime.js（六项纯计算预检）
```

---

## 📖 按需读取索引（AI 决定何时读子文档）

> **关键机制**：本文档读完是核心层加载完毕。**不要一开始就读所有 references**。先执行 Checklist → 看当前 Phase → 遇到具体需要再加载对应 reference。
>
> 索引分两层：**核心层**（Phase 0 必读，每次任务都要加载）vs **场景层**（遇到对应场景才读）。

### 核心层（Phase 0 必读）

| 当你遇到... | 读 | 为什么 |
|---|---|---|
| 题型决策不确定 | `references/workflow/decision-tree.md` | 6 题型 + 6 阻塞点 |
| Phase 0-5 详细流程 | `references/workflow/phase-flow.md` | 48 步分级子流程 |
| 10 个核心场景速查 | `references/workflow/scenario-quickref.md` | 参数签名/Cookie/加密/混淆/WASM/TLS/反检测/JSVMP/请求体加密/WebSocket-SSE |
| 踩反模式 | `references/workflow/common-pitfalls.md` | 7 条反模式 + 判定测试 |
| 定位加密入口 | `references/crypto/crypto-entry.md` | 四层链路 source→entry→builder→writer |
| 补环境对象模型 | `references/env/env-object-model.md` | 对象模型硬性清单 |
| 移动端 H5 补全 | `references/env/mobile-h5-env.md` | 移动端 UA 矩阵 + 专属 API + screen fixture |
| Hook 模板 | `references/hooks/hook-templates.md` | 13 模板 + "只观察不篡改"纪律 |
| 代码风格 | `references/quality/code-style.md` | 11 条硬性原则 + 目录结构 |
| 信息确认模板 | `references/quality/intake-template.md` | 30+ 字段确认模板 |
| 107 个自检测试（100 项已编写，7 项编号预留） | `references/quality/validation.md` | skill 自检清单（20 类） |

### 场景层（按需读取）

| 当你遇到... | 读 | 为什么 |
|---|---|---|
| CHECK-2 查经验库 | `cases/` 列表 + `_template.md` | 命中就跳对应案例 |
| L1 纯算路径 | `references/workflow/l1-purecalc.md` | 纯算模式 |
| L2 MCP 抓包 | `references/workflow/l2-mcp-survey.md` | camoufox MCP 35 工具 |
| L3 trace 路径 | `references/workflow/l3-trace.md` | camoufox trace + RuyiTrace 降级 + replay 对拍 |
| 识别加密算法 | `references/crypto/crypto-patterns.md` | 10 类加密识别 |
| 算法家族站点 | `references/crypto/algorithm-families.md` | 站点清单 |
| JS 层 native 保护 | `references/env/env-native-protection.md` | toString/descriptor/原型链保护策略 |
| 补环境调试循环 | `references/env/env-debug-loop.md` | 迭代调试方法论 |
| 环境检测绕过 | `references/env/env-detect-bypass.md` | 绕过清单 |
| WASM 环境补全 | `references/env/env-wasm.md` | WASM 专项（基础加载） |
| WASM 进阶（import/memory/streaming/Worker） | `references/env/env-wasm-advanced.md` | WASM 深度方法论 |
| native 能力缺口 | `references/env/native-capability-gap.md` | document.all 等原生行为缺口 |
| 框架选择策略 | `references/env/runtime-frameworks.md` | 默认纯 vm，何时升级 sdenv |
| 反调试 | `references/hooks/anti-debug.md` | 7 类反调试 |
| 混淆识别 | `references/deobfuscation/obfuscation-identify.md` | 识别层（AST 执行在 assets/ast-patterns/） |
| TLS 指纹 | `references/network/tls-validation.md` | TLS 客户端选择 + ja3/akamai 对齐 |
| IP 风控识别 + 代理策略 | `references/network/ip-risk-control.md` | 风控信号识别 + 退避策略 + 代理选型 |
| WebSocket/SSE 消息签名 | `references/network/websocket-signing.md` | WS 消息帧签名分析 + 心跳保活 |
| HTTP2/UA/CORS/频率 + 字段分类 | `references/network/protocol-analysis.md` | 协议层分析 + 6 类字段归属分类法 |
| Session 请求链 | `references/network/session-chain.md` | Session 模式硬性 |
| Node 泄露阻断 | `references/network/node-leakage.md` | Node 21+ navigator 等 |
| 动态资源保鲜 | `references/network/dynamic-resource.md` | 资源过期识别 |
| Cookie 生成链路 | `references/network/cookie-generation.md` | Cookie 分类 + source/entry/builder/writer 四层链路 |
| 指纹基线一致性 / 一致性约束 | `references/fingerprint/fingerprint-baseline-consistency.md` | 值来源/优先级一致性硬约束 |
| 信任矩阵 | `references/fingerprint/trust-matrix.md` | A/B/C/D 证据可信度 |
| 指纹值回放 | `references/fingerprint/fingerprint-value-replay.md` | 3 层值来源优先级 + 终端 API 值回放策略与校验 |
| 代码变更记忆 | `references/quality/code-change-memory.md` | 防回退机制 |
| 高强度检测 | `references/quality/high-strength-detection.md` | 触发条件 + 行为 diff |
| trace 覆盖矩阵 | `references/quality/trace-api-coverage.md` | 8 种 API 状态（有 Trace 时硬性） |
| isTrusted 可信输入 | `references/quality/trusted-input.md` | 验证码交互防检测 |
| 阶段报告 | `references/quality/stage-reports.md` | 按 L1/L2/L3 分级 |
| 最终总结 | `references/quality/final-summary.md` | 按 L1/L2/L3 分级 |
| 交付模板 | `references/quality/delivery-templates.md` | 目录结构规范 |
| 清理策略 | `references/quality/cleanup.md` | 临时文件清理 |
| 调试方法论 | `references/debug/debug-playbook.md` | P0-P2 调试 |
| 取证工具获取 | `references/tooling/ruyi-tooling.md` | RuyiTrace 工具获取与运行 |
| camoufox 取证 | `references/tooling/camoufox-tooling.md` | camoufox / camoufox-reverse-mcp 取证模式 |
| 浏览器取证模式 | `references/tooling/browser-acquisition.md` | ruyiPage / camoufox 取证模式选择 |
| 经验法则详解 | `references/workflow/experience-rules.md` | 19 条扩展说明 |
| Worker / Service Worker 签名 | `references/workflow/worker-signing.md` | Worker/SW 环境补全特殊性 + 分析路径 |
| 反爬版本追踪与快速适配 | `references/workflow/version-adaptation.md` | SDK 更新后的 diff/复用方法论 |
| 脚本功能索引 | `scripts/README.md` | 26 个脚本分类索引 + 典型用法 |
| 交付模板索引 | `templates/README.md` | 5 类模板用途 + 引用关系 |

> 注：验证码场景不在本 skill 范围，交接 `web-verify-patcher` skill（见"场景分级判定"代码块）。

---

## 更新记录

> 版本演进历史通过 git log 查阅。
