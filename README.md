# js-reverse-skill

通用网页端 JS 逆向工程技能：统一通过 ruyipage + RuyiTrace 采集运行时日志，基于日志证据逆向还原加密参数。融合黑盒补环境（JS 层 NativeProtect）与纯算还原双路径，支持 Node.js / Python 双语言交付。

## 来源

本 Skill 综合融合并重构了以下来源的流程骨架、工具链与案例经验：

| 来源 | 贡献 |
|------|------|
| [hello_js_reverse_skill](https://github.com/hello-js-reverse/hello_js_reverse_skill) | 流程骨架 + 案例库 |
| [xbsReverseSkill](https://github.com/xbs-js-reverse/xbsReverseSkill) | 补环境流程 + 工具链 |
| ruyipage | Firefox WebDriver BiDi 取证 |
| RuyiTrace | NDJSON trace 内核 |

## 能力边界

**适用**：签名/token/指纹/设备参数生成、JSVMP 黑盒补环境、WASM 加载、混淆还原、TLS 指纹模拟
**不适用**：App/Android/iOS/小程序/Windows/EXE/DLL/Native/Frida/IDA
**默认不主动分析 JSVMP 字节码源码**：遇到 JSVMP 只做黑盒补环境

## 目录结构

```
js-reverse-skill/
├── SKILL.md              流程骨架 + 规则 + 索引（AI 加载的主文档）
├── README.md             本文件
├── assets/               可复用资产（AST 反混淆 + 补环境片段 + fixture 模板，按需加载）
├── templates/            交付入口模板（5 类：final.js / Node客户端 / Python客户端 / vm沙箱 / WASM）
├── references/           知识参考（10 子域 48 篇，按"触发条件"按需读取）
├── cases/                经验案例（11 个已验证案例 + 模板，CHECK-2 速查）
└── scripts/              工具脚本（27 个 7 类）
```

**调用关系**：`SKILL.md`（流程）→ `references/`（按需知识）→ `scripts/`（执行检查）→ `assets/`（补环境/反混淆）→ `templates/`（交付入口）→ `cases/`（经验回写）

## 如何使用

把下面的提示词喂给 AI 编程助手（如 TRAE / Cursor / Copilot），让它加载本 Skill 后按流程执行。

> 技术细节（算法可提取性判定/补环境方案/工具选择/反爬类型识别等）由 skill 自动判断。提示词只提供任务目标，不重复技术细节。额外要求（项目规范/业务扩展/工具偏好等）可追加，覆盖 skill 默认（仅 skill 四条红线不可被覆盖）。

### 核心模板（纯逆向）

```
# 目标
- 目标URL：<网页浏览入口>
- 目标接口：<req.txt 文件路径 / 接口URL字符串 / "无，自动抓包">
- 目标参数：<参数名>（可选，留空自动识别所有动态参数）
```

skill 默认交付：`final.js`（Node.js 脱离浏览器生成参数并请求接口）+ 中文总结。

### 扩展模板（含业务要求）

```
# 目标
- 目标URL：<网页浏览入口>
- 目标接口：<req.txt 文件路径 / 接口URL字符串 / "无，自动抓包">
- 目标参数：<参数名>

# 输出（可选）
- 抽取为 HTTP API：<路径>
- 报告归档到：<路径>

# 备注（可选）
- 项目规范引用（如"项目结构见仓库 README"）
- 取证模式指定（如"手动取证，提供 cURL"）
- 一次性偏好（如"本次用原生 https，不模拟 TLS 指纹"）
```

### 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| 目标URL | 是 | 网页浏览入口，skill 用于 navigate 抓 SDK 加载链、识别反爬类型 |
| 目标接口 | 是 | **文件路径**（如 `req.txt`）或**接口URL字符串**（如 `https://api.example.com/data`）或 `"无，自动抓包"` |
| 目标参数 | 否 | 留空则 skill 自动识别所有动态参数（签名/指纹/token/时间戳等） |
| 输出 | 否 | 纯逆向不填；需 API 封装或报告归档时填写 |
| 备注 | 否 | 任意额外要求，覆盖 skill 默认 |

### 目标接口的三种填法

| 填法 | 示例 | 适用场景 |
|------|------|---------|
| 文件路径 | `req.txt` / `项目根目录 req.txt / res.txt` | 已有完整请求/响应样本 |
| 接口URL字符串 | `https://api.example.com/data` | 只知道接口地址，让 skill 自动抓包分析 |
| 无 | `"无，自动抓包"` | 只提供目标 URL，skill 从目标 URL 出发全流程抓包 |

### 两个 URL 的区别

- **目标URL**：浏览器里打开的网页地址（如 `https://www.xiaohongshu.com/explore`），加载 SDK/JS
- **目标接口**：XHR 请求地址，带签名参数。可以是文件路径或接口 URL 字符串（让 skill 自动抓包）

skill 需要两者：网页 URL 用于抓 SDK 加载链、采集环境指纹；接口样本用于定位签名参数挂载点。

### 覆盖关系

用户额外要求 > skill 默认（仅四条红线不可被覆盖）：

| 用户要求 | 覆盖 skill 哪个默认 |
|---------|-------------------|
| "手动取证，提供 cURL" | 跳过 skill 默认的 ruyipage+RuyiTrace 自动取证 |
| "原生 https 不模拟 TLS" | 跳过 skill 的 TLS 指纹梯度降级 |
| "报告归档到 xxx/" | 覆盖 skill 默认的 cases/ 沉淀路径 |
| "抽取为 HTTP API" | 在 final.js 基础上追加 API 封装（skill 默认不交付 API） |

**不可覆盖的四条红线**（见 SKILL.md）：
1. CHECK-1 到 CHECK-3 完整复述
2. 跳过 cases/ 经验库速查
3. 最终方案使用浏览器自动化
4. 关键业务 cookie 从浏览器抓包硬编码

### 示例

纯逆向（文件路径模式）：
```
# 目标
- 目标URL：http://xhslink.com/o/5vQorNvnSIb
- 目标接口：项目根目录 req.txt / res.txt
- 目标参数：x-s-common、x-s（header中）
```

纯逆向（接口URL模式）：
```
# 目标
- 目标URL：https://www.xiaohongshu.com/explore
- 目标接口：https://edith.xiaohongshu.com/api/sns/web/v1/feed
- 目标参数：x-s-common、x-s（header中）
```

含业务要求：
```
# 目标
- 目标URL：http://xhslink.com/o/5vQorNvnSIb
- 目标接口：项目根目录 req.txt / res.txt
- 目标参数：x-s-common、x-s（header中）

# 输出
- 抽取为 HTTP API：api/server
- 报告归档到：platforms/xhs/notes/

# 备注
- 项目结构见仓库 README
- 原生请求不用 TLS 指纹
```

## 验证标准

服务端返回业务数据而非风控页 / 验证码。签名通过但服务端不认时，按故障排查梯度（见 SKILL.md）逐级排查。

## 演进里程碑

> 完整版本历史通过 git log 查阅。

| 节点 | 要点 |
|---|---|
| v1.0.0 | 首次公开发布。三层级判据（L1 纯算 / L2 vm 沙箱 / L3 补环境）+ 路径 A/B/C/D + 10 核心场景 + 6 案例库 + 52 篇 references + 26 脚本 + 5 模板 + AST 反混淆 + replay trace 对拍 + 字段归属分类法 |
| v2.0.0 | 架构重构：移除 L1/L2/L3 分级与 camoufox 体系，统一为 ruyipage + RuyiTrace 日志驱动逆向。所有 case 一律走 trace 取证 → 日志分析 → 算法还原/补环境路径，简单题不再走捷径。11 案例库 + 48 篇 references + 26 脚本 + 5 模板 |

**工具栈策略**：
- 取证统一走 ruyipage + RuyiTrace（ruyipage 抓网络包/JS/Cookie，RuyiTrace 采集 NDJSON 环境日志）
- Phase 4 还原方法由日志证据决定：纯算还原 / vm 沙箱 / WASM 加载 / 补环境（默认纯 vm，遇 document.all 等原生行为检测升级 sdenv）
- ast-deobfuscation 内嵌为 assets/ast-patterns/

## License

MIT
