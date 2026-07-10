# L3 trace 模式

> **触发条件**：题型判断为 L3（JS 需完整浏览器环境才能执行）时读

## 适用条件

- JSVMP 虚拟机保护（200KB+ / while-switch / 字节码数组）
- 强风控（瑞数 / Akamai / Cloudflare）
- 指纹深度绑定（算法依赖大量浏览器环境属性）

> WASM 加密已归 L2（WASM 可 vm 加载，不需要补环境），本文件不涉及。

## L3 默认路径：camoufox MCP trace 模式

### 前置条件
- camoufox-reverse 定制版浏览器（支持 C++ 层 trace）
- camoufox-reverse-mcp 已安装

### trace 流程
```
1. launch_browser(enable_trace=True)
2. navigate(url="目标URL")
3. trace_property_access(mode="summary", collect_values=True)
   → 获得 JSVMP 实际读取的属性列表 + 真实值
   → C++ 层追踪，JSVMP 不可检测
4. 按 hot_keys 只补必要属性（狙击式补环境）
5. verify_signer_offline(signer_code, samples=[...]) 离线验证
```

### trace 模式说明
- `mode="summary"`：按 API 频率汇总
- `mode="timeline"`：按时间线展开
- `mode="sequence"`：按调用序列展开
- `mode="search"`：按关键词搜索

### instrumentation 源码级插桩
```
instrumentation(action='install', url_pattern="**/<VMP文件>", mode="ast", tag="vmp1")
instrumentation(action='reload')  → 让插针先于 VMP 生效
instrumentation(action='log', tag='vmp1', type_filter='tap_get', limit=200)
→ hot_keys 指纹学习法 30 秒告诉你 VMP 读了哪些环境属性
```

## L3 降级路径：ruyipage + RuyiTrace

### 降级条件
- camoufox trace 功能不足（如需更详细 stack info）
- camoufox-reverse 定制版不可用
- 需要 RuyiTrace 内部版能力（10 倍功能）

### ruyipage 取证硬约束

| 约束 | 要求 |
|---|---|
| 定制内核 | 必须显式使用已验证的 ruyiPage 定制 Firefox runtime；不得使用系统 Firefox fallback |
| 有头模式 | 必须 `headless(False)` |
| 独立 Profile | 使用本 case 专用临时 `user_dir` / profile |
| 智能指纹 | 默认调用 `opts.smart_fingerprint()`；地理探测失败时安装 `requests` 或提供 `manual_geo` |
| 仿真注入 | `smart_fingerprint()` 返回 `ctx` 后必须执行 `ctx.apply_emulation(page)` |
| 指纹一致性 | 第一次成功取证后写入 `case/notes/fingerprint-baseline.json`；后续复用同一 `base_dir` / `userdir` |
| 拟人动作 | 设置 `set_human_algorithm("windmouse")` 或 `"bezier"` |
| 取证时机 | `page.capture.start(...)` 必须在 `page.get(...)` 之前执行 |
| 自检 | 导航后检查 `navigator.webdriver`，期望为 `false` |
| isTrusted | 点击、拖拽、键盘输入优先使用原生 BiDi / human actions；确需 JS 构造事件时必须带 `ruyi: true` |

### RuyiTrace 自动抓日志（不需用户手动操作）

```
1. node scripts/capture_ruyitrace_log.js --url <url> --case-dir case --ruyitrace-home <dir> --dry-run --markdown
   → 输出捕获计划

2. node scripts/capture_ruyitrace_log.js --url <url> --case-dir case --ruyitrace-home <dir> --duration 90 --import-after --markdown
   → 自动启动 RuyiTrace 随包 trace Firefox
   → 设置 MOZ_DOM_TRACE=1 + MOZ_DOM_TRACE_FILE=<path>
   → 等待 90 秒后自动 kill
   → 自动调用 import_ruyitrace_log.js 生成摘要

3. 只有以下情况才需要用户手动操作：
   - 自动捕获启动失败
   - 需要登录/验证/MFA/设备确认
   - 用户明确要求使用 RuyiTrace GUI
   - 自动采集的日志未覆盖目标参数生成路径
```

### RuyiTrace NDJSON 分析流程

```
1. import_ruyitrace_log.js 生成 notes/ruyitrace-summary.md
2. 统计 api 调用频率，优先处理高频或和目标参数生成邻近的 API
3. 按 stack.file / line / col 聚合，定位具体 JS 文件和函数
4. 分类到环境模块：
   - Navigator / Screen / Location / Storage
   - Canvas / WebGL / Audio / WebRTC
   - Crypto / Performance / Date / Random
   - DOM / Element / CSS / Layout
   - Worker / Service Worker / iframe
5. 将结论写入：
   - notes/ruyitrace-summary.md
   - notes/missing-env-priority.md（标记 "RuyiTrace 证据 / Node trace 补充 / 推断"）
   - notes/entry-chain.md
6. 进入 Node.js 缺失环境追踪和 fixtures 验证
```

### RuyiTrace 长字段截断保护

RuyiTrace NDJSON 长字符串字段可能被截断到约 4000 字符。

**硬性规则**：
- 导入时必须运行带截断检测的脚本：`--truncation-threshold 3900`
- 任何字符串字段长度达到或接近阈值时，标记 `truncationSuspected: true`
- 不得把 RuyiTrace 中的长字段可见值直接作为 fixture 期望值
- 影响签名/指纹回放时，必须从以下来源补采完整值：
  1. HAR / cURL / Network 完整请求
  2. ruyiPage `collect_bodies=True` 网络抓包
  3. 专用 Hook 对 writer 或加密入口做分片落盘
  4. 最终 Node.js signer 输出

## L3 全量流程（核心 15 步 + 工程化附加 33 步）

> **分级原则**：核心 15 步完成即可交付可用代码；工程化附加仅在用户要求"生产级交付"时强制执行。

### 核心解题 15 步（必须，快速交付）

#### Phase 0：任务确认（3 步）
```
1. 信息确认（URL + 参数名，或自动抓包结果）
2. check_external_tools.js + precheck_runtime.js
3. 项目目录创建
```

#### Phase 1：网络侦察（3 步）
```
4. launch_browser(enable_trace=True) / ruyipage
5. navigate(url) → 读 redirect_chain + final_status → 判断反爬类型
6. network_capture → 收集网络包 + JS 文件
```

#### Phase 2：源码分析（3 步）
```
7. 四层链路定位 source→entry→builder→writer
8. 关键词搜索 → JSVMP 识别 → 路径选择（A/B 基于反爬类型）
9. 保存关键脚本到 config/
```

#### Phase 3：动态验证（3 步）
```
10. 环境指纹采集（camoufox trace / RuyiTrace NDJSON）
11. 按 api/stack 定位环境依赖 → 逐项 diff
12. hook_function 验证签名入口 + ≥3 次请求对比
```

#### Phase 4：算法还原 / 补环境（2 步）
```
13. 编写 patchEnvironment() + NativeProtect 保护
14. 端到端验证：生成签名 → 请求接口 → 返回有效数据
```

#### Phase 5：验证（1 步）
```
15. ≥5 次请求交叉验证签名稳定性
```

> **核心 15 步完成 = 可用代码交付**。以下工程化附加步骤仅在用户要求"生产级交付"时执行。

---

### 工程化附加 33 步（可选，生产级交付时强制）

#### Phase 4 附加（5 步）
```
16. 框架选择（none/vm/jsEnv）
17. 指纹基线一致性验证
18. Session 请求链处理
19. TLS 指纹验证
20. 动态资源保鲜检查 + Node 泄露阻断
```

#### Phase 5 附加（28 步）
```
21. check_code_quality.js
22. check_fingerprint_fixture.js
23. check_final_artifact.js
24. check_trace_api_coverage.js
25. check_dynamic_resources.js
26. check_change_memory.js
27-33. 阶段报告（7 阶段）
34-46. 13 章节动态报告
47. 23 章最终总结
48. 经验沉淀到 cases/
```

## trace 覆盖矩阵（8 种 API 状态）

有 Trace 时硬性要求，详见 `references/quality/trace-api-coverage.md`：

| API 状态 | 含义 | 处理 |
|---|---|---|
| 0. 未命中 | Trace 未覆盖 | Node trace 补充 |
| 1. 命中无值 | Trace 命中但未采集值 | 补采 |
| 2. 命中截断 | 值疑似截断 | 补采完整值 |
| 3. 命中完整 | 值完整可用 | 直接用 |
| 4. 命中但 Node 缺失 | Trace 有但 Node 没有 | 补环境 |
| 5. 命中但值不一致 | Trace 值与 Node 不一致 | 修正 Node 值 |
| 6. 命中但 API 缺失 | Trace 命中但 API 不存在 | 实现 API |
| 7. 命中但 API 行为不一致 | API 存在但行为不同 | 修正 API 行为 |

## Replay Trace 对比方法论

在补环境完成后，用无浏览器 JS 引擎执行补环境脚本，生成 replay trace，与浏览器基准 trace 做**逐 API 调用顺序对比**。这是比指纹 fixture 值对比更底层的验证方式——不仅对比值，还对比调用时机和顺序。

### 对比流程

```
浏览器 trace（真环境）
  │
  ├─ 采集 replay 值 + 调用顺序
  │   → traceOut/replay/trace_replay_process_.jsonl
  │
JS 引擎 trace（补环境）
  │
  ├─ Node.js vm 沙箱执行补环境脚本
  │   → 记录 replayValue.api 和调用堆栈
  │
对拍
  │
  ├─ 按 api 名对齐两个 trace 的调用序列
  ├─ 对比每个 api 的返回值
  ├─ 标记差异：值不一致 / 调用顺序不同 / 缺失调用
  │
修复
  │
  ├─ 缺什么 → 从浏览器 trace 取真实值补到补环境
  ├─ 值不一致 → 修正补环境模拟逻辑
  ├─ 调用顺序不同 → 修正初始化时序
  │
复验 → 重新对拍直到一致
```

### 对比维度

| 维度 | 检查内容 | 一致性要求 |
|---|---|---|
| 值一致性 | 同一 api 在两端的返回值 | 严格相等（字符串/数字/布尔）或结构一致（对象/数组） |
| 调用顺序 | api 被调用的先后次序 | 顺序一致（工具链差异导致的无关调用可忽略） |
| 调用次数 | 同一 api 的总调用次数 | 次数一致（多环境预读导致的差异需分析和标注） |
| 缺失项 | 浏览器有但补环境没有的 api | 补全或确认不需要后标注"非关键" |
| 多余项 | 补环境有但浏览器没有的 api | 确认是补环境自身调用后标注"休泄漏" |

### 与本 skill 工具链的映射

- **浏览器 trace**：camoufox trace（`trace_property_access`）或 RuyiTrace NDJSON
- **JS 引擎 trace**：`scripts/run_with_trace.js`（vm 探测模式，输出 env-trace.jsonl）
- **对比脚本**：`scripts/compare_fixture.js`（值对比）+ 手动对比调用顺序
- **指纹 fixture**：`scripts/check_fingerprint_fixture.js`（指纹值对比的补充层）

### 注意事项

- standalone 引擎（SpiderMonkey 等）没有 DOM，canvas/navigator/crypto/WebGL 等需要补环境层模拟，真实值来源以浏览器 trace 为准
- Node.js vm 沙箱有宿主泄漏风险（Node 21+ navigator 等），见 `references/network/node-leakage.md`
- 不要追求 100% 调用顺序对齐——浏览器自身预读、优化、事件队列可能导致少量无关差异
- 聚焦于签名计算链路上的 api 调用，非关键路径的差异可标注后跳过
