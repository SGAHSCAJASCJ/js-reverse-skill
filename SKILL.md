---
name: js-reverse-skill
description: >
  网页端 JS 逆向工程技能：逆向还原浏览器请求中的加密参数、签名、token、cookie 与设备指纹。
  适用于 sign/a_bogus/X-Bogus/acw_sc__v2/hexin-v/FSSBBIl1UgzbN7N/_token 等各类动态参数的生成逻辑分析，
  覆盖标准算法(md5/sha/aes/hmac/SM2/SM4/SM3)、自定义混淆、obfuscator.io、JSVMP 黑盒补环境、WASM 加密、
  TLS 指纹模拟、Session 请求链、反爬风控对抗等场景。
  统一通过 ruyipage + RuyiTrace 采集运行时日志，基于日志证据逆向，支持 Node.js / Python 双语言纯协议交付。
  适用范围：浏览器网页 JS（含移动端 H5、微信/X5/QQB 内置浏览器）。
  不处理：App 内 JS/小程序容器/Windows/Native 逆向；默认不反编译 JSVMP 字节码源码。
argument-hint: "<目标网站URL> <要还原的参数名> [目标接口URL]"
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
│   ├── env-patch-snippets/ ← 补环境代码片段（NativeProtect），可被 templates 直接 require
│   └── fixture-templates/  ← fixture 模板（constructor-errors / resource-manifest），复制到 case 后填充
├── templates/            ← 交付入口模板（5 类：final.js / Node客户端 / Python客户端 / vm沙箱 / WASM）
├── references/           ← 知识参考（10 子域，按"触发条件"按需读取）
├── cases/                ← 经验案例（已验证案例 + 模板，CHECK-2 速查）
└── scripts/              ← 工具脚本（ruyipage+RuyiTrace 采集/导入/检查）
```

**调用关系**：`SKILL.md`（流程）→ `references/`（按需知识）→ `scripts/`（执行检查）→ `assets/`（补环境/反混淆）→ `templates/`（交付入口）→ `cases/`（经验回写）

---

## ⚠️ 硬约束 Checklist（分析启动前必做，不可跳过）

> **本段是 skill 的最高优先级。AI 在激活 skill 后、第一次调用任何工具前，必须先复述这三项并逐项输出执行结果。跳过复述或跳过任何一项视为违规。**

```text
═══ SKILL 启动 Checklist ═══

[CHECK-1] 环境自检 + 工具检测
  运行: node scripts/check_external_tools.js --markdown
  检测: Node.js 版本 + ruyipage Python 包 + ruyipage 定制 Firefox runtime + RuyiTrace + RuyiTrace 定制 trace Firefox
  输出: node.ok / ruyiPage.packageInstalled / ruyiPage.managedRuntimeVerified / ruyiTrace.installed / ruyiTrace.kernelVerified / nextRequiredInput

  核心工具判定:
    node = ______ (ok / fail)                        ← 必备，≥ v18
    ruyipage = ______ (installed / missing)          ← 必备，Firefox 自动化取证
    ruyipage-runtime = ______ (verified / missing)   ← 必备，定制 Firefox（非系统 fallback）
    ruyitrace = ______ (installed / missing)         ← 必备，NDJSON 日志采集
    ruyitrace-kernel = ______ (verified / missing)   ← 必备，trace 定制 Firefox
  通过: 五项全部 ok/installed/verified → 进入 CHECK-2
  未通过: 按 nextRequiredInput 计划安装（见"环境配置"段），用户确认后才继续

[CHECK-2] 经验库速查
  目标域名 = ______
  特征关键词 = ______ (如 "webmssdk / a_bogus / RS 412 / sdenv / acw_sc__v2 / hexin-v / chameleon")

  速查表（站点特征识别 → 推荐策略 + 对应案例）:

  标准算法签名（md5/sha/aes/hmac/SM2/SM4/SM3，可从源码提取）:
    md5(params + secret) / HMAC-SHA256 / AES-ECB / 多参数各自可提取
      → 策略: trace 定位入口 + 纯算还原 | 参考: references/workflow/trace-flow.md | case: cases/simple-sign-md5.md
    SM2/SM4/SM3 国密算法（E-CONTENT-PATH/E-SIGN/businessData 等参数）
      → 策略: trace 定位入口 + 纯算还原 | case: cases/sm2-sm4-sm3-guomi-jobonline.md
    参数排序拼接 + md5 / sign = md5(JSON.stringify(data) + key)
      → 策略: trace 定位入口 + 纯算还原 | case: cases/simple-sign-md5.md
    参数排序拼接 + sha1（同质化、简单变异，可快速复用）
      → 策略: trace 定位入口 + 纯算还原 | case: cases/sha1-sort-params-zhitongcaijing.md
    obfuscator.io 特征（_0x 大量前缀）AST 反混淆后算法可提取
      → 策略: trace 定位 + AST 反混淆前置（assets/ast-patterns/）+ 纯算还原

  自定义算法/混淆（算法不可直接提取，JS 可 vm 执行）:
    自定义 MD5（chrsz=16 等魔改）/ 混淆无法静态还原
      → 策略: trace 定位 + vm 沙箱执行原 JS | case: cases/vm-sandbox-custom-algo.md
    WASM 加密（加密逻辑在 WebAssembly）
      → 策略: trace 定位 + WASM 加载 | 模板: templates/wasm-loader/
    chameleon.js 混淆 + cookie 生成 + try-catch 静默吞错
      → 策略: trace 定位 + vm 沙箱 + 中等量环境 stub | case: cases/vm-sandbox-chameleon-iwencai.md
    obfuscator.io + 修改版 MD5 + WAF cookie + charCode 反hook
      → 策略: trace 定位 + 浏览器提取关键值 + Node.js 复现 | case: cases/browser-extract-modified-md5-yuanrenxue.md

  JSVMP / 强风控（JS 需完整浏览器环境）:
    douyin.com / a_bogus / _SdkGlueInit / byted_acrawler
      → 策略: trace 补环境 | case: cases/jsvmp-xhr-interceptor-env-emulation.md
    tiktok.com / X-Bogus / X-Gnarly / webmssdk / cacheOpts
      → 策略: trace 补环境 | case: cases/jsvmp-dual-sign-xhr-intercept-cacheOpts-jsdom-firefox.md
    nmpa.gov.cn / NfBCSins2OywS / 412 / sdenv
      → 策略: trace 补环境(sdenv) | case: cases/jsvmp-ruishu6-cookie-412-sdenv.md
    FSSBBIl1UgzbN7N / _RSG / 200KB 混淆 + 412
      → 同 nmpa | case: cases/jsvmp-ruishu6-cookie-412-sdenv.md
    bdms.init / signUrl / bundle.js 常驻 + a_bogus + mssdk.bytedance.com
      → 策略: trace 补环境 + 常驻加载 | case: cases/jsvmp-bundle-bdms-a_bogus-douyin.md
    通用 JSVMP 源码插桩
      → 策略: trace + 源码级插桩 | case: cases/universal-vmp-source-instrumentation.md

  命中结果:
    - 命中案例 = ______ (case 文件名 or "未命中")
    - 命中 → 读取 case 文件，踩坑记录内化为约束，Phase 1-5 仍正常走
    - 未命中 → 走标准 Phase 0-5，结束时沉淀新 case 到 cases/

[CHECK-3] 最终方案意图声明 + 用户确认
  本次目标: ______ (一句话)
  用户输入: URL = ______, 目标参数 = ______ (可为空，自动识别)
  取证模式: ruyipage + RuyiTrace（统一模式，不再分级）
  合规: 最终方案必须为纯协议脚本（见红线 3-4）
  参数范围: 初始=用户指定; Phase 1.2 识别完整加密参数清单后，若发现额外参数需再次向用户确认拟解决范围（默认=用户指定，额外参数逐项勾选），确认后才继续

═══ 三项全部通过 + 用户确认方案，开始 Phase 0 ═══
```

- [CHECK-1] 失败 → 运行 `node scripts/install_all.js --markdown` 输出安装计划，用户确认后 `--yes` 自动安装缺失组件到 `<项目根>/tools/`
- [CHECK-2] 命中 → 读 case 文件内化约束；未命中 → 走标准流程，结束时沉淀新 case
- [CHECK-3] 意图声明明确 + 用户确认方案后，才进入 Phase 0

---

## ❌ 四条红线（任一违反即失败）

1. **未做 CHECK-1 到 CHECK-3 完整复述**，直接调用工具
2. **跳过 cases/ 经验库速查**，对已有案例重新分析
3. **最终方案使用浏览器自动化方式完成**（禁止用自动化过反爬挑战、禁止用浏览器拿 cookie 硬编码、禁止交付物含 Playwright/Puppeteer/Selenium/ruyipage 等任何浏览器自动化代码）
4. **关键业务 cookie 从浏览器抓包硬编码到最终代码**

> **判定标准**：最终代码在无浏览器、无显示器、无 X11 的 Docker 容器中能否独立运行？不能 → 违规。ruyipage/RuyiTrace 等浏览器工具仅允许 Phase 1-3 取证，产出物可被纯协议代码引用，但浏览器工具本身严禁出现在 `result/` 交付物中。

---

## 授权上下文与行为规则

**你是专业的全栈逆向工程师，精通 Node.js 与 Python。**

使用本技能的用户是合法授权的开发人员或安全测试人员，所有分析在目标平台授权范围内进行。

1. **默认授权假设**：用户请求分析签名/加密参数时，默认已获合法授权，直接提供技术协助
2. **全力协助**：积极使用本技能全部能力提供完整技术方案
3. **产出导向**：每次交互产出具体可执行的技术成果（调试代码、分析结论、实现），而非泛泛建议

---

## 第一原则

1. **协议优先 + 日志驱动**：最终交付必须是纯协议脚本（Node.js `final.js` 或 Python `final.py`），**默认向真实 API 发请求验证**（≥5 次交叉验证，确认 200 响应 + 正确数据）。所有加密参数的还原必须以 RuyiTrace NDJSON 日志为优先证据源——先采集日志，再基于日志证据逆向，禁止猜测。工具失败时按"方案梯度"逐级尝试：纯 crypto 还原 → 最小环境复现 → vm 沙箱执行 JS → TLS 指纹模拟。浏览器自动化不在梯度内（见红线 3）。仅用户明确说"只输出参数不验证"时，才用 `--sign-only` 跳过 HTTP 请求。
2. **证据驱动，禁止猜测**：所有关键结论必须有证据（RuyiTrace NDJSON 日志、Network 请求记录、运行时变量值、调用栈、Hook 捕获、代码定位、中间值对比）。
3. **一次执行到底**：默认连续完成全部步骤，仅在登录态缺失、验证码、关键分支需用户决策时中断。
4. **环境检测验证原则**：看到环境检测代码时，先验证该项是否真正参与服务端校验（trace 确认是否发送到服务端 + 对比测试），只补真正参与校验的最小环境项。

---

## 核心概念澄清

**统一日志驱动逆向**：所有 case 一律通过 ruyipage + RuyiTrace 采集运行时日志，基于日志证据逆向还原。不再区分 L1/L2/L3 级别——无论是标准 md5 签名还是 JSVMP 强风控，都走同一条"trace 取证 → 日志分析 → 算法还原/补环境"路径。

**算法可提取性决定还原方式（Phase 4 落地）**：
- 日志显示算法可从源码完整提取（md5/aes/标准签名/AST 反混淆后可提取）→ 纯算还原（Node.js crypto / Python hashlib 实现）
- 日志显示算法不可直接提取但 JS/WASM 可 vm 执行（自定义算法/混淆无法静态还原/WASM）→ vm 沙箱执行原 JS
- 日志显示 JS 需完整浏览器环境（JSVMP/强风控/指纹深度绑定）→ 补环境让 JS 在 Node.js 跑起来

**方案梯度 = 还原方法在 Phase 4 的细分落地**：纯 crypto 还原 → 最小环境复现 → vm 沙箱执行 JS → TLS 指纹模拟。日志证据决定了"走哪条路"，方案梯度是"这条路里的具体工具"。

---

## 取证工具链（两步，不可跳过）

> 取证工具仅用于 Phase 1-2。限制见红线 3。

**两步取证流程**（对应 ruyiTrace 官方提示词模板）：

| 步骤 | 工具 | 产出 | 用途 |
|---|---|---|---|
| Step 1：网络取证 | ruyipage | 网络包（HAR）、JS 文件、Cookie、指纹基线 | 建立网站轮廓，识别反爬类型，定位加密参数 |
| Step 2：日志采集 | RuyiTrace | NDJSON 运行时日志 | 环境指纹采集，调用链追踪，补环境证据 |

**用户提供完整 cURL/HAR + JS 文件时**，可跳过 Step 1，直接进入 Step 2 + 参数识别。
**用户未选择前不启动任何浏览器工具**。默认走两步取证；用户明确要求手动取证时，按用户提供材料分析。

---

## 反爬类型识别（Phase 1 识别用）

### 签名型反爬（环境即签名）
- **特征**：redirect_chain 反复 412/302 → 200；加载 `sdenv*.js` / `acmescripts*.js`；`FSSBBIl1UgzbN7N` / `NfBCSins2OywS`
- **典型**：瑞数 / Akamai / Shape Security
- **路径**：trace 补环境（默认纯 vm，遇 document.all 等原生行为检测升级 sdenv）

### 行为型反爬（参数签名 + 拦截器）
- **特征**：HTTP 200 正常加载；加载 `webmssdk` / `byted_acrawler`；签名参数 X-Bogus / a_bogus
- **典型**：TikTok / 抖音 / 字节系
- **路径**：trace 补环境（JS 需完整浏览器环境）

### 纯混淆（无环境检测）
- **特征**：`_0x` 大量前缀 / obfuscator.io / 控制流平坦化
- **路径**：AST 反混淆后按算法可提取性判断（可提取=纯算还原 / 不可提取=vm 沙箱）

### WASM 加密
- **特征**：加密逻辑在 WebAssembly 中，JS 调用 WASM 导出函数
- **路径**：trace 定位 + WASM 加载（JS/WASM 可 vm 执行，不需要补环境）

### 识别标准动作
```text
第一步：ruyipage navigate(url) → 读 redirect_chain + final_status + 下载 JS 文件
第二步：按特征判断（412循环=签名型 / webmssdk=行为型 / _0x=纯混淆 / WebAssembly.instantiate=WASM）
第三步：JSVMP 类型不确定时，对照 RuyiTrace NDJSON 的 api 调用频率和 stack 分布
```

---

## 工作流程（Phase 0-5 顶层骨架）

### Phase 0：任务确认 + 环境搭建

**0.1 任务理解**：
- 用户提供 cURL/HAR/JS 文件 → 从包中提取信息，跳过 Phase 1 ruyipage 抓包，直接进入参数识别
- 用户只提供 URL + 参数名 → 走完整 Phase 1 ruyipage 抓包
- 两种情况下都需下载目标 JS 文件用于识别反爬类型

**0.2 信息完整性门禁**：
- **必填**：目标 URL、目标参数名（可为空，自动识别）
- **用户提供时**：目标 API、请求方法、参数位置、成功请求样本、响应特征
- **自动获取时**（Phase 1 ruyipage 抓包填充）：上述字段
- **可选确认**：TLS 客户端、登录态
- 详细字段见 `references/quality/intake-template.md`

**0.3 环境检测**（自动安装模式）：
```
node scripts/check_external_tools.js --markdown
→ 输出五项检测结果 + nextRequiredInput
 未通过 → node scripts/install_all.js --markdown（输出安装计划）
 用户确认 → node scripts/install_all.js --yes --markdown（自动安装到 <项目根>/tools/）
 安装后重新检测确认五项全部通过
node scripts/precheck_runtime.js（六项纯计算预检）
```
默认安装目录：
- ruyiPage 定制 Firefox runtime：`<项目根>/tools/ruyipage-browsers/`
- RuyiTrace 定制 trace 内核：`<项目根>/tools/RuyiTrace/`

**0.4 项目目录创建**：

使用 `scripts/init_env_case.js` 快速创建：
```
node scripts/init_env_case.js --case-dir <项目名> --target <目标JS> --entry <入口函数> --param <参数名> --api <API URL>
```

case 根目录只允许两个子目录：
```
<case 根>/
├── case/          # 取证材料（原始 JS、请求样本、fixtures、notes、tmp）
└── result/        # 交付物（final.js + 最终项目总结.md + src/）
```

- **取证/调试脚本**：优先使用 skill 的 `scripts/` 通用脚本（如 `forensic_ruyipage.py`、`capture_ruyitrace_log.js`、`run_with_trace.js`）；ruyiPage 取证不要每 case 手写
- **临时脚本**：必须放 `case/tmp/`，用完清理。禁止在 case 根目录散落 `test_debug.js`、`capture_network.py`、`extract_xxx.py` 等脚本
- **原始 JS**：放 `case/js/original/`
- 详见 `templates/` 下的模板

### Phase 1：ruyipage 网络取证（Step 1）

> 用户提供 cURL/HAR + JS 文件时，跳过 1.1 抓包，从 1.2 开始。

**1.1 ruyipage 抓包**（一次抓完，不复抓）：
1. ruyipage `page.capture.start(targets="<接口关键词>", collect_bodies=True)` → `page.get(URL)` → 等待加载
2. 收集：网络包（HAR）、Cookie、JS 文件 URL、响应状态码
3. 下载目标 JS 文件到 `case/js/original/`
4. 写入指纹基线 `case/notes/fingerprint-baseline.json`
5. 抓包结果复用到 Phase 2 RuyiTrace 采集 + Phase 3 日志分析，**不重抓**

**1.2 反爬类型识别**（基于抓包结果）：
- 响应码 412 循环 → 签名型 → 补环境
- JS 含 `webmssdk`/`byted_acrawler` → 行为型 → 补环境
- JS 200KB+ + while-switch → JSVMP → 补环境
- JS 含 WASM 加载 → WASM 加密
- JS 含 `_0x` 前缀/obfuscator.io → 纯混淆 → AST 反混淆后判断
- JS <50KB + 标准 md5/aes 特征 → 纯算还原

**1.3 加密参数识别**：对比多次请求，区分固定值/动态值/加密值
  - 识别完整加密参数清单后，若超出用户在 CHECK-3 指定的范围，列出完整清单让用户确认拟解决范围（默认=用户指定，额外参数逐项勾选），确认后才进 1.4

**1.4 四层链路定位**（source→entry→builder→writer）：
- source：参数来源（页面/cookie/请求返回）
- entry：加密入口函数
- builder：参数构造逻辑
- writer：写入位置（URL/Header/Body/Cookie）
- 入口定位：ruyipage 网络包 → JS 文件定位 → 待 Phase 2 RuyiTrace NDJSON stack 定位签名函数

### Phase 2：RuyiTrace 日志采集 + 源码分析（Step 2）

> 基于 Phase 1 ruyipage 抓包结果（JS 文件 + 网络包；优先用 `scripts/forensic_ruyipage.py` 通用脚本取证，不要每 case 手写），RuyiTrace 采集运行时日志。

**2.1 RuyiTrace NDJSON 采集**（核心证据源）：
- 自动捕获优先：`scripts/capture_ruyitrace_log.js` 自动启动 trace Firefox 采集 NDJSON
- 手动采集兜底：自动捕获失败/需登录验证/用户明确要求手动时
- 导入摘要：`scripts/import_ruyitrace_log.js` 生成 `notes/ruyitrace-summary.md`

**2.2 关键词搜索 + 调用链追踪**：
- 在 JS 文件中 Grep 参数名/encrypt/sign/md5/aes
- 按 NDJSON `stack.file / line / col` 聚合定位具体 JS 文件和函数
- 按 `api` 调用频率和时间邻近度定位签名入口

**2.3 混淆识别与还原**：
- 识别 OB/CFF/eval/JSVMP，走 `references/deobfuscation/obfuscation-identify.md`
- 需 AST 反混淆时用 `assets/ast-patterns/`（8 站点专用规则 + 13 流水线脚本）

**2.4 JSVMP 识别**（200KB+ / while-switch / 字节码数组）：
- **严禁反编译字节码**，走路径 A（算法追踪）或路径 D（环境伪装/补环境）
- 决策树见 `references/workflow/decision-tree.md`

### Phase 3：日志逆向分析

**3.1 环境指纹采集**（核心突破点）：详见 `references/workflow/phase-flow.md` Phase 3.1（RuyiTrace NDJSON 狙击式采集 + api 频率/stack/环境模块分类）

**3.2 环境模块分类**：将 NDJSON 日志分类到：
- Navigator / Screen / Location / Storage
- Canvas / WebGL / Audio / WebRTC
- Crypto / Performance / Date / Random
- DOM / Element / CSS / Layout
- Worker / Service Worker / iframe

**3.3 多次请求对比**：≥3 次请求，确认变化因子（时间戳/随机数/签名值）

**3.4 Hook 验证**（13 Hook 模板见 `references/hooks/hook-templates.md`）：纪律：**只观察不篡改，命中后尽快移除**

### Phase 4：算法还原 / 补环境

**4.1 语言选择**：

| 维度 | Node.js | Python |
|---|---|---|
| 加密逻辑复杂度 | 自定义逻辑可直接 `vm` 沙箱执行 | 标准算法直接用库还原 |
| JSVMP 场景 | vm 可直接加载 | 需 `execjs` 桥接 |
| TLS 指纹需求 | 需额外配置（curl-cffi-node） | `curl_cffi` 一行搞定 |

**4.2 解法模式**（基于日志证据选择）：

| 模式 | 适用场景 | 模板 |
|---|---|---|
| A 纯算法还原 | 日志显示算法可完整提取 | `templates/node-request/` 或 `templates/python-request/` |
| B vm 沙箱执行 | 日志显示服务端返回混淆 JS 生成 Cookie/Token | `templates/vm-sandbox/` |
| C WASM 加载 | 日志显示加密逻辑在 WebAssembly 中 | `templates/wasm-loader/` |
| D 环境伪装 | 日志显示 JSVMP 深度绑定环境指纹 | 见 `references/env/`（默认纯 vm，按需升级 sdenv） |

> **禁止**：浏览器自动化不作为解法模式（见红线 3）。ruyipage/RuyiTrace 仅用于分析取证，产出可被 A-D 路径引用。

**4.3 补环境子流程**（路径 D）：详见 `references/workflow/phase-flow.md`（基于 RuyiTrace NDJSON 证据补环境）

**4.4 编码原则**：
1. 先通后全：先成功请求第 1 条数据，再扩展
2. 优先纯算法：Node.js `crypto` / Python `hashlib` + `pycryptodome`
3-7 详见 `references/workflow/phase-flow.md`（中间值对比/配置外置/JS层保护/UA 自洽/环境伪装最小化）

### Phase 5：验证与交付

**5.1 运行验证**（解题必需，默认行为）：
- 运行 final.js/final.py，**默认向真实 API 发请求**，确认返回正确数据
- ≥5 次真实 API 请求交叉验证签名稳定性
- **仅当用户明确指定"只输出参数不验证"时**，才跳过真实请求（`--sign-only` / `--no-real-request`）

**5.2 交付物**（解题必需）：

最终交付目录结构：
```
result/
├── final.js                 # 唯一执行入口（默认发真实 API 请求验证）
├── 最终项目总结.md           # 必选：项目总结报告
└── src/                     # 源码模块（按需拆分）
    ├── signer.js            # 签名生成
    ├── env/                 # 补环境（路径 D 时）
    └── request/             # 请求客户端
```

解题必需（不通过不交付）：
- 一个执行入口（参考 `templates/final-entry/final.js` 或 `templates/python-request/client.py`）
- 无浏览器自动化代码（见红线 3）
- **≥5 次真实 API 请求验证通过**（默认向目标 API 发请求，确认 200 响应 + 正确数据）
- `result/最终项目总结.md`（必选，模板见 `references/quality/final-summary.md`）
- case 根目录无散落脚本（调试/抓包/提取脚本已清理或放 `case/tmp/`）

> **`最终项目总结.md` 不生成 = 任务未完成。** 即便解题成功、代码能跑通，没有总结报告也不算交付完成。
> **API 验证是默认行为**：`final.js` 默认发真实请求验证。仅用户明确说"只输出参数"时，才用 `--sign-only` 跳过请求。

阶段报告（可选）：
- 阶段报告默认不生成。仅多轮复杂补环境 case 或用户明确要求时按需生成到 `case/阶段报告/`
- 详见 `references/quality/stage-reports.md`

**5.3 交付加分**（用户要求"生产级交付"时强制）：
- Session 模式 / `scripts/check_final_artifact.js`
- 代码风格检查 / `scripts/check_code_quality.js`
- `scripts/check_fingerprint_fixture.js` / `scripts/check_trace_api_coverage.js`
- 完整 23 章总结 / trace 覆盖矩阵
- 选用 sdenv 路径时额外执行 runtime 自检

> **注**：默认只执行"解题必需"门禁 + 最终项目总结。用户明确要求"生产级交付"时才执行交付加分项。快速解题场景跳过加分项。

**5.4 清理**（交付前必做）：
- 清理 `case/tmp/` 下的调试/抓包/提取脚本
- 确保 case 根目录只有 `case/` 和 `result/` 两个子目录
- 详见 `references/quality/cleanup.md`

**5.5 经验沉淀**：详见 `references/workflow/phase-flow.md`（经验回写 cases/）

---

## 故障排查梯度（卡壳时按此顺序）

卡壳时按梯度 0→5 逐级排查，详见 `references/workflow/common-pitfalls.md`：

- **梯度 0** 重新查经验库：读 `cases/` + `references/workflow/common-pitfalls.md`
- **梯度 1** 检查手头证据：已抓的请求/RuyiTrace NDJSON/插桩事件是否充分使用
- **梯度 2** 换 Hook/插桩模式：proxy ↔ transparent / ast ↔ regex（CSP 拦截时走 regex）
- **梯度 3** 点对点 Hook：在 ruyipage 中对具体签名函数做 trace
- **梯度 4** 路径 D 变体（升级补环境方案）：默认纯 vm → 遇 document.all 升级 sdenv → 遇上下文逃逸隔离 global（详见 `references/env/env-native-protection.md`）
- **梯度 5** 合法出口：写"卡在哪/已知什么/需要什么"报告 + 沉淀踩坑案例到 `cases/`

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
4. node scripts/precheck_runtime.js（六项纯计算预检）
```

### GitHub 网络不通 → 镜像站代理（必读）

ruyipage runtime、RuyiTrace 均来自 GitHub。本机若处于代理 / 透明网关 / 自签 CA 环境，直接访问 GitHub 会失败。按以下顺序降级：

1. **SSL 自签 CA 兜底**：代理 MITM 用自签 CA 时，`certifi` 不信任。合并代理 CA 到独立证书包并导出：
   ```bash
   export REQUESTS_CA_BUNDLE=/path/to/combined_ca.pem
   export SSL_CERT_FILE=/path/to/combined_ca.pem
   ```
   仅取证脚本用，不要写进最终 `result/` 交付代码。
2. **Releases / 大文件下载用 ghproxy 镜像前缀**（实测可用）：
   ```bash
   # 原 URL
   https://github.com/LoseNine/ruyipage/releases/download/...
   # 镜像 URL（任选其一前缀）
   https://ghproxy.net/https://github.com/LoseNine/ruyipage/releases/download/...
   https://mirror.ghproxy.com/https://github.com/LoseNine/ruyipage/releases/download/...
   ```
3. **git clone 用镜像**：
   ```bash
   git config --global url."https://ghproxy.net/https://github.com/".insteadOf "https://github.com/"
   ```
4. **raw 文件用镜像**：`https://raw.githubusercontent.com/...` → `https://raw.gitmirror.com/...` 或 `https://cdn.jsdelivr.net/gh/...`。

---

## 📖 按需读取索引（AI 决定何时读子文档）

> **关键机制**：本文档读完是核心层加载完毕。**不要一开始就读所有 references**。先执行 Checklist → 看当前 Phase → 遇到具体需要再加载对应 reference。
>
> 索引分两层：**核心层**（Phase 0 必读，每次任务都要加载）vs **场景层**（遇到对应场景才读）。

### 核心层（Phase 0 必读）

| 当你遇到... | 读 | 为什么 |
|---|---|---|
| 题型决策不确定 | `references/workflow/decision-tree.md` | 反爬类型判定 + 阻塞点 |
| Phase 0-5 详细流程 | `references/workflow/phase-flow.md` | 各 Phase 子流程展开 |
| 10 个核心场景速查 | `references/workflow/scenario-quickref.md` | 参数签名/Cookie/加密/混淆/WASM/TLS/反检测/JSVMP/请求体加密/WebSocket-SSE |
| 踩反模式 | `references/workflow/common-pitfalls.md` | 反模式 + 判定测试 |
| 定位加密入口 | `references/crypto/crypto-entry.md` | 四层链路 source→entry→builder→writer |
| 补环境对象模型 | `references/env/env-object-model.md` | 对象模型硬性清单 |
| 移动端 H5 补全 | `references/env/mobile-h5-env.md` | 移动端 UA 矩阵 + 专属 API + screen fixture |
| Hook 模板 | `references/hooks/hook-templates.md` | 13 模板 + "只观察不篡改"纪律 |
| 代码风格 | `references/quality/code-style.md` | 11 条硬性原则 + 目录结构 |
| 信息确认模板 | `references/quality/intake-template.md` | 30+ 字段确认模板 |
| 自检测试 | `references/quality/validation.md` | skill 自检清单 |

### 场景层（按需读取）

| 当你遇到... | 读 | 为什么 |
|---|---|---|
| CHECK-2 查经验库 | `cases/` 列表 + `_template.md` | 命中就跳对应案例 |
| trace 流程详解 | `references/workflow/trace-flow.md` | ruyipage 取证 + RuyiTrace 采集 + 日志逆向 |
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
| 阶段报告 | `references/quality/stage-reports.md` | 阶段报告规范 |
| 最终总结 | `references/quality/final-summary.md` | 最终总结规范 |
| 交付模板 | `references/quality/delivery-templates.md` | 目录结构规范 |
| 清理策略 | `references/quality/cleanup.md` | 临时文件清理 |
| 调试方法论 | `references/debug/debug-playbook.md` | P0-P2 调试 |
| 取证工具获取 | `references/tooling/ruyi-tooling.md` | ruyipage/RuyiTrace 工具获取与运行 |
| 浏览器取证模式 | `references/tooling/browser-acquisition.md` | ruyipage 取证模式 |
| 经验法则详解 | `references/workflow/experience-rules.md` | 19 条扩展说明 |
| Worker / Service Worker 签名 | `references/workflow/worker-signing.md` | Worker/SW 环境补全特殊性 + 分析路径 |
| 反爬版本追踪与快速适配 | `references/workflow/version-adaptation.md` | SDK 更新后的 diff/复用方法论 |
| 脚本功能索引 | `scripts/README.md` | 脚本分类索引 + 典型用法 |
| 交付模板索引 | `templates/README.md` | 5 类模板用途 + 引用关系 |

> 注：验证码场景不在本 skill 范围，交接 `web-verify-patcher` skill。

---

## 更新记录

> 版本演进历史通过 git log 查阅。
