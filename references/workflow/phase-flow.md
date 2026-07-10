# Phase 0-5 详细流程

> **触发条件**：执行某个 Phase 不确定具体怎么做时读
>
> 本文档是 SKILL.md Phase 0-5 顶层骨架的展开，按 L1/L2/L3 分级。

## Phase 0：任务确认 + 环境搭建

### 0.1 任务理解（双模式输入）
- **完整模式**：用户提供标准请求/响应包 → 直接从包中提取 URL/Method/Headers/Params/Body，跳过 Phase 0.5 抓包
- **极简模式**：用户只提供 URL+参数名 → Phase 0.5 camoufox 自动抓包获取上述信息
- 两种模式都需下载目标 JS 文件用于识别反爬类型
- 识别并标记签名/动态参数

### 0.2 信息完整性门禁（极简版）
- **必填**：目标 URL（两种模式都需）、目标参数名（可为空，自动识别）
- **完整模式提供**：目标 API、请求方法、参数位置、成功请求样本、响应特征
- **极简模式自动获取**（Phase 0.5 抓包填充）：上述字段
- **可选确认**：取证模式（L1/L2/L3，可由 Phase 0.5 自动判断）、TLS 客户端、登录态

强制阻断项：
- 未确认授权 / 登录状态：不得尝试绕过登录、验证码、MFA
- 未确认目标参数：skill 列出可疑参数后用户未确认，不得只盯单一参数进入补环境
- 极简模式遇到登录/交互/验证码：暂停要求用户补充请求包（退化为完整模式）

### 0.3 环境检测（nextRequiredInput 计划-确认模式）
```
node scripts/check_external_tools.js --markdown
 输出工具状态 + nextRequiredInput（安装计划）
 AI 向用户提问"是否安装 X？"
 用户确认 → 运行对应安装脚本:
   - ruyipage: node scripts/install_ruyipage_runtime.js --python python --install-dir <dir> --install
   - ruyitrace: node scripts/download_ruyi_tool.js --tool ruyitrace --dest <dir> --markdown
 node scripts/precheck_runtime.js（六项纯计算预检）
```

### 0.4 项目目录创建
```
project_name/
├── config/           # 密钥、Headers、JS 代码等配置
├── utils/            # 加密函数、请求封装
├── case/             # 取证材料（L2/L3）
│   ├── js/
│   ├── requests/
│   ├── fixtures/
│   ├── notes/
│   └── tmp/
├── final.js / final.py # 主脚本（入口）
└── README.md
```

### 0.5 自动识别分流（用户未指定 L 级别时执行）
- 完整模式：从包中提取参数值特征/响应码/JS URL → 下载 JS → 综合判断反爬类型
- 极简模式：启动 camoufox 轻量抓包（无 hook），navigate(URL) → 提取上述信息 → 下载 JS → 综合判断
- **抓包结果复用到 Phase 1**，不重复抓包
- 分流到 L1/L2/L3，回填 CHECK-3 意图声明
- 详见 SKILL.md "自动识别分流"段

## Phase 1：网络侦察（L1/L2/L3）

### 1.1 抓包分析
- L1: 复用 Phase 0.5 抓包结果（极简模式）或用户提供的包（完整模式），**不重抓**；`get_request_initiator` 定位签名函数（黄金路径）
- L2: `network_capture(action='start')` → 触发请求 → `list_network_requests` → `get_network_request`
- L3: ruyipage `page.capture.start(targets="<api-keyword>", collect_bodies=True)` → `page.get(url)` → `page.capture.wait()`

### 1.2 加密参数识别
对比多次请求，区分：
| 参数类型 | 特征 | 处理方式 |
|---|---|---|
| 固定值 | 每次请求相同 | 直接硬编码或从页面提取 |
| 动态值 | 有规律变化 | 判断变化因子（时间戳、页码、随机数、自增） |
| 加密值 | 看似随机 | 根据长度、字符集、格式判断算法类型 |

### 1.3 四层链路定位（source→entry→builder→writer）
| 层级 | 含义 | 常见证据 |
|---|---|---|
| source 数据源 | 参与签名的输入材料 | URL、Query、Body、Cookie、localStorage、时间、随机数、指纹 |
| entry 加密入口 | 直接返回 sign/token 的函数 | 调用栈、搜索参数名、断点命中、sourcemap |
| builder 请求构造 | 把入口结果拼到请求对象 | axios/fetch 封装、SDK request 方法、拦截器 |
| writer 请求写入 | 最终写入网络请求的位置 | fetch、XHR.send、setRequestHeader、URLSearchParams、cookie |

**只有记录到 `writer`，才能确认"找到的函数"确实影响目标请求。**

### 1.4 黄金路径
```
L1/L2: network_capture → get_request_initiator → 直达签名函数
L3: RuyiTrace NDJSON → 按 stack.file/line 定位
```

## Phase 2：源码分析

### 2.1 关键词搜索
```
L1/L2: search_code(keyword="参数名") + search_code(keyword="encrypt|sign|md5|aes")
L3: 在 RuyiTrace 抓的 JS 文件中 Grep
L1 降级模式(无 camoufox): 在用户提供的 JS 文件中 Grep
```

常用搜索词：
```
sign / token / x-s / a_bogus / h5st
setRequestHeader / fetch( / XMLHttpRequest
JSON.stringify / localStorage.getItem / document.cookie
crypto / encrypt / decrypt
```

### 2.2 混淆识别与还原
| 混淆类型 | 特征 | 还原策略 |
|---|---|---|
| OB 混淆 | `_0x` 前缀变量、十六进制字符串数组 | 字符串解密 + 变量重命名 |
| 控制流平坦化 | `switch-case` 状态机、`while(true)` 循环 | 追踪状态转移还原执行顺序 |
| eval/Function 打包 | `eval(...)` 或 `new Function(...)` 包裹 | Hook eval/Function 拦截源码 |
| JSVMP | 200KB+ 文件、自定义解释器 | 不反编译，走路径 A 或路径 D |

需要 AST 反混淆时用 `assets/ast-patterns/`（8 站点专用规则 + 13 流水线脚本）。

### 2.3 JSVMP 识别
**严禁反编译字节码**，走路径 A（算法追踪）或路径 D（环境伪装/补环境）。

识别标志：
- 超大 JS 文件（200KB+），函数/变量名完全无意义
- 包含自定义解释器循环：`while(true) { switch(opcode) { ... } }`
- 改写或劫持浏览器原生 API（XHR / fetch / Cookie）
- 超大数组（字节码）+ 指针变量 + 栈操作 + 跳转指令

### 2.4 静态分析关键判断清单
- [ ] 参数是单独加密还是整条请求链被接管
- [ ] 页码、时间戳、随机数、Cookie、UA、环境变量是否参与运算
- [ ] 是否存在响应解密（接口返回加密字符串而非明文 JSON）
- [ ] 是否存在运行时代码生成（`eval` / `new Function`）
- [ ] 是否有前置请求（预热接口、Token 获取接口）
- [ ] 是否有请求链改写（拦截 XHR/fetch 添加签名头）

## Phase 3：动态验证

### 3.1 环境指纹采集（核心突破点）
```
L3 camoufox trace（默认）:
  launch_browser(enable_trace=True) → navigate(url)
  → trace_property_access(mode="summary", collect_values=True)
  → 获得 JSVMP 实际读取的属性列表 + 真实值
  → 只补这些属性（狙击式补环境）

L3 RuyiTrace 降级:
  capture_ruyitrace_log.js 自动抓 NDJSON
  → import_ruyitrace_log.js 生成摘要
  → 按 api/stack.file/line/col 定位环境依赖

L2 无 trace:
  compare_env + 分批 evaluate_js 采集
  → 与 Node 环境全量 diff
  → 按影响分级修复（撒网式补环境）
```

### 3.2 Hook 验证（13 Hook 模板见 `references/hooks/hook-templates.md`）
- `inject_hook_preset(preset="xhr"/"fetch"/"crypto"/"cookie")`
- `hook_function(function_path="签名函数", mode='trace', log_args=true, log_return=true, log_stack=true)`
- 纪律：**只观察不篡改，命中后尽快移除**

### 3.3 多次请求对比
≥3 次请求，确认变化因子（时间戳/随机数/签名值）

## Phase 4：算法还原 / 补环境

### 4.1 编码原则
1. 先通后全：先成功请求第 1 条数据，再扩展
2. 优先纯算法：Node.js `crypto` / Python `hashlib` + `pycryptodome`
3. 中间值对比：打印关键中间值，与浏览器逐一比对
4. 配置外置：密钥/Headers/JS 代码写入 `config/`
5. NativeProtect 保护：补环境初始化阶段默认启用
6. UA 自洽：环境补丁每项与 `navigator.userAgent` 声明一致
7. 环境伪装最小化：只补经 trace/hook 证明 JSVMP 真的读了的 API

### 4.2 补环境子流程（路径 D，按 L2/L3 分级）
- L1 纯算还原通常不需要补环境（算法可完整提取）；若发现需要 vm 沙箱（自定义 MD5/算法不可提取）→ 升级 L2
- L2 标准 25 步：+ native 保护 → 指纹基线 → Session 链 → TLS 验证
- L3 全量 48 步：+ trace 覆盖矩阵 → 代码变更记忆 → 23 章总结

详见 `references/env/` 目录下文档。

### 4.3 配置文件策略
| 产物类型 | 存放位置 |
|---|---|
| Cookie 字符串 | `config/cookies.txt` 或 `config/cookies.json` |
| 长参数样本 | `config/params_sample.json` |
| 提取的 JS 代码 | `config/sign_logic.js` / `config/encrypt.js` |
| Headers 模板 | `config/headers.json` |
| 响应样本 | `config/response_sample.json` |

## Phase 5：验证与交付

### 5.1 运行验证
- 运行 final.js/final.py，确认输出正确数据
- ≥5 次请求交叉验证签名稳定性
- L2: `verify_signer_offline(signer_code, samples=[...])` 离线验证

### 5.2 交付门禁（分级：解题必需 vs 交付加分）

**解题必需**（所有级别，不通过不交付）：
- 一个执行入口 / 禁止任何浏览器自动化代码 / ≥5 次请求签名稳定性验证 / 中文最终总结

**交付加分**（L2+，用户要求"生产级交付"时强制）：
- Session 模式 / `check_final_artifact.js` / 代码风格检查

**工程化附加**（L3，用户要求"生产级交付"时强制）：
- `check_code_quality.js` / `check_fingerprint_fixture.js` / `check_trace_api_coverage.js`
- 23 章总结 / trace 覆盖矩阵
- 选用 sdenv 路径时额外执行 runtime 自检，默认纯 vm 路线跳过

> 默认只执行"解题必需"。用户明确要求"生产级交付"时才执行附加门禁。

### 5.3 阶段报告（按级别分级）
- L1：不要求，只生成精简总结（5-8 章）
- L2：关键阶段报告（12-15 章）
- L3：全量阶段报告（8 阶段 + 13 章节动态报告）
- 所有级别"中文"始终硬性

### 5.4 经验沉淀
主动询问用户是否沉淀到 `cases/`（按 `_template.md` 格式）

### 5.5 清理
临时 hook/trace/日志/缓存立即清理，不等项目结束
