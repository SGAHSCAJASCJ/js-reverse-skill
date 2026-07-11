# Phase 0-5 详细流程

> **触发条件**：执行某个 Phase 不确定具体怎么做时读
>
> 本文档是 SKILL.md Phase 0-5 顶层骨架的展开，统一流程，不分级。

## Phase 0：任务确认 + 环境搭建

### 0.1 任务理解（双模式输入）
- **完整模式**：用户提供标准请求/响应包 → 直接从包中提取 URL/Method/Headers/Params/Body，跳过 Phase 0.5 抓包
- **极简模式**：用户只提供 URL+参数名 → Phase 0.5 ruyipage 自动抓包获取上述信息
- 两种模式都需下载目标 JS 文件用于识别反爬类型
- 识别并标记签名/动态参数

### 0.2 信息完整性门禁（极简版）
- **必填**：目标 URL（两种模式都需）、目标参数名（可为空，自动识别）
- **完整模式提供**：目标 API、请求方法、参数位置、成功请求样本、响应特征
- **极简模式自动获取**（Phase 0.5 抓包填充）：上述字段
- **可选确认**：取证模式（默认 ruyipage+RuyiTrace）、TLS 客户端、登录态

强制阻断项：
- 未确认授权 / 登录状态：不得尝试绕过登录、验证码、MFA
- 未确认目标参数：skill 列出可疑参数后用户未确认，不得只盯单一参数进入补环境
- 极简模式遇到登录/交互/验证码：暂停要求用户补充请求包（退化为完整模式）

### 0.3 环境检测（自动安装模式）
```
node scripts/check_external_tools.js --markdown
 输出五项检测结果 + nextRequiredInput
 未通过 → node scripts/install_all.js --markdown（输出安装计划）
 用户确认 → node scripts/install_all.js --yes --markdown（自动安装到 <项目根>/tools/）
 安装后重新检测确认五项全部通过
node scripts/precheck_runtime.js（六项纯计算预检）
```
默认安装目录：
- ruyiPage 定制 Firefox runtime：`<项目根>/tools/ruyipage-browsers/`
- RuyiTrace 定制 trace 内核：`<项目根>/tools/RuyiTrace/`

install_all.js 内部流程：检测缺失组件 → pip install ruyiPage requests → python -m ruyipage install → 下载 RuyiTrace.zip 并自动解压 → 重新检测验证。

### 0.4 项目目录创建
```
project_name/
├── config/           # 密钥、Headers、JS 代码等配置
├── utils/            # 加密函数、请求封装
├── case/             # 取证材料
│   ├── js/
│   ├── requests/
│   ├── fixtures/
│   ├── notes/
│   └── tmp/
├── final.js / final.py # 主脚本（入口）
└── README.md
```

### 0.5 自动识别（用户未提供请求包时执行）
- 完整模式：从包中提取参数值特征/响应码/JS URL → 下载 JS → 综合判断反爬类型
- 极简模式：启动 ruyipage 轻量抓包（无 hook），navigate(URL) → 提取上述信息 → 下载 JS → 综合判断
- **抓包结果复用到 Phase 1**，不重复抓包
- 详见 SKILL.md "自动识别"段

## Phase 1：网络侦察（ruyipage 取证）

### 1.1 抓包分析
- ruyipage `page.capture.start(targets="<api-keyword>", collect_bodies=True)` → `page.get(url)` → `page.capture.wait()`
- 极简模式复用 Phase 0.5 抓包结果，**不重抓**

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

### 1.4 入口定位（黄金路径）
```
ruyipage 网络包 → JS 文件定位 → RuyiTrace NDJSON stack 定位签名函数
  → 按 stack.file/line/col 聚合
  → 按 api 调用频率和时间邻近度定位签名入口
```

## Phase 2：源码分析 + RuyiTrace 日志采集

### 2.1 RuyiTrace NDJSON 采集（核心证据源）
- 自动捕获优先：`scripts/capture_ruyitrace_log.js` 自动启动 trace Firefox 采集 NDJSON
- 手动采集兜底：自动捕获失败/需登录验证/用户明确要求手动时
- 导入摘要：`scripts/import_ruyitrace_log.js` 生成 `notes/ruyitrace-summary.md`
- 详见 `references/workflow/trace-flow.md`

### 2.2 关键词搜索
```
在 RuyiTrace 抓的 JS 文件中 Grep:
  - 参数名 / encrypt / sign / md5 / aes
  - 按 NDJSON stack.file/line/col 聚合定位具体 JS 文件和函数
```

常用搜索词：
```
sign / token / x-s / a_bogus / h5st
setRequestHeader / fetch( / XMLHttpRequest
JSON.stringify / localStorage.getItem / document.cookie
crypto / encrypt / decrypt
```

### 2.3 混淆识别与还原
| 混淆类型 | 特征 | 还原策略 |
|---|---|---|
| OB 混淆 | `_0x` 前缀变量、十六进制字符串数组 | 字符串解密 + 变量重命名 |
| 控制流平坦化 | `switch-case` 状态机、`while(true)` 循环 | 追踪状态转移还原执行顺序 |
| eval/Function 打包 | `eval(...)` 或 `new Function(...)` 包裹 | Hook eval/Function 拦截源码 |
| JSVMP | 200KB+ 文件、自定义解释器 | 不反编译，走路径 A 或路径 D |

需要 AST 反混淆时用 `assets/ast-patterns/`（8 站点专用规则 + 13 流水线脚本）。

### 2.4 JSVMP 识别
**严禁反编译字节码**，走路径 A（算法追踪）或路径 D（环境伪装/补环境）。

识别标志：
- 超大 JS 文件（200KB+），函数/变量名完全无意义
- 包含自定义解释器循环：`while(true) { switch(opcode) { ... } }`
- 改写或劫持浏览器原生 API（XHR / fetch / Cookie）
- 超大数组（字节码）+ 指针变量 + 栈操作 + 跳转指令

### 2.5 调用链追踪
- RuyiTrace NDJSON 按时间邻近度定位签名函数
- 按 `api` 调用频率和 `stack` 指向的 JS 文件/函数逐层定位

### 2.6 静态分析关键判断清单
- [ ] 参数是单独加密还是整条请求链被接管
- [ ] 页码、时间戳、随机数、Cookie、UA、环境变量是否参与运算
- [ ] 是否存在响应解密（接口返回加密字符串而非明文 JSON）
- [ ] 是否存在运行时代码生成（`eval` / `new Function`）
- [ ] 是否有前置请求（预热接口、Token 获取接口）
- [ ] 是否有请求链改写（拦截 XHR/fetch 添加签名头）

## Phase 3：日志逆向分析

### 3.1 环境指纹采集（核心突破点）
```
RuyiTrace NDJSON 狙击式采集:
  capture_ruyitrace_log.js 自动抓 NDJSON
  → import_ruyitrace_log.js 生成摘要
  → 按 api/stack.file/line/col 定位环境依赖
  → 只补 trace 证明 JSVMP 真的读了的 API（狙击式补环境）
```

### 3.2 环境模块分类
将 NDJSON 日志分类到：
- Navigator / Screen / Location / Storage
- Canvas / WebGL / Audio / WebRTC
- Crypto / Performance / Date / Random
- DOM / Element / CSS / Layout
- Worker / Service Worker / iframe

### 3.3 Hook 验证（13 Hook 模板见 `references/hooks/hook-templates.md`）
- 纪律：**只观察不篡改，命中后尽快移除**

### 3.4 多次请求对比
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

### 4.2 解法模式（基于日志证据选择）

| 模式 | 适用场景 | 模板 |
|---|---|---|
| A 纯算法还原 | 日志显示算法可完整提取 | `templates/node-request/` 或 `templates/python-request/` |
| B vm 沙箱执行 | 日志显示服务端返回混淆 JS 生成 Cookie/Token | `templates/vm-sandbox/` |
| C WASM 加载 | 日志显示加密逻辑在 WebAssembly 中 | `templates/wasm-loader/` |
| D 环境伪装 | 日志显示 JSVMP 深度绑定环境指纹 | 见 `references/env/`（默认纯 vm，按需升级 sdenv） |

### 4.3 补环境子流程（路径 D）
基于 RuyiTrace NDJSON 证据补环境，详见 `references/env/` 目录下文档。

补环境工作量取决于日志显示的环境依赖复杂度：
- 算法可纯算提取 → 通常不需要补环境
- JS 可 vm 执行但需少量环境 stub → 最小 sandbox
- JSVMP 需完整浏览器环境 → 全量补环境 + NativeProtect

### 4.4 配置文件策略
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

### 5.2 交付门禁（分级：解题必需 vs 交付加分）

**解题必需**（不通过不交付）：
- 一个执行入口 / 禁止任何浏览器自动化代码 / ≥5 次请求签名稳定性验证 / 中文最终总结

**交付加分**（用户要求"生产级交付"时强制）：
- Session 模式 / `check_final_artifact.js` / 代码风格检查

**工程化附加**（用户要求"生产级交付"时强制）：
- `check_code_quality.js` / `check_fingerprint_fixture.js` / `check_trace_api_coverage.js`
- 23 章总结 / trace 覆盖矩阵
- 选用 sdenv 路径时额外执行 runtime 自检，默认纯 vm 路线跳过

> 默认只执行"解题必需"。用户明确要求"生产级交付"时才执行附加门禁。

### 5.3 阶段报告
- 默认：精简总结（5-8 章）
- 用户要求"生产级交付"：关键阶段报告（12-15 章）
- 用户要求"完整工程化"：全量阶段报告（8 阶段 + 13 章节动态报告）
- 所有报告"中文"始终硬性

### 5.4 经验沉淀
主动询问用户是否沉淀到 `cases/`（按 `_template.md` 格式）

### 5.5 清理
临时 hook/trace/日志/缓存立即清理，不等项目结束
