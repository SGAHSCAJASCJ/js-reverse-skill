# js-reverse-skill 实现深度审查报告

> 审查范围：`scripts/`（28 个 JS）、`templates/`（5 类交付模板）、`assets/`（env-patch-snippets / fixture-templates / ast-patterns）、`SKILL.md` 规范一致性。
> 方法：6 路并行逐文件代码审查 + 关键高危项由主代理逐一对照源码复核（标注「已验证」）。`tools/` 为第三方运行时（已 gitignore，0 跟踪文件，不纳入实现审查）。
> 严重度：P0=严重（可导致越权删除/宿主泄露/产物损坏）；P1=重要（安全/正确性缺陷）；P2=一般（功能遗漏/性能/健壮性）；P3=建议（可维护性/一致性）。

---

## 一、总体结论

代码整体质量较高：命令执行几乎全部使用 `spawnSync(cmd, [args], {shell:false})` 数组传参，**除 `download_ruyi_tool.js` 的 PowerShell 解压外不存在 shell 注入**；异常处理普遍用 `try/catch` 兜底；BOM/编码处理在多数脚本到位。

但存在 **2 个 P0（删除脚本越权/误删）** 与一批 **P1（安全 + 模板/补环境核心功能失效）**，其中最重要的是：

1. **`clean_case.js` 可删除 case 目录之外的文件**（符号链接逃逸 + 危险目录判定过弱）——这是当前最危险的实现。
2. **vm 补环境的「Node 泄露阻断」只是文档声明，未真正实现**：`templates/vm-sandbox/install-env.js` 第 10 步是注释，引用的 `vm-sandbox.js` 在仓库中不存在；`assets/env-patch-snippets/native-protect.js` 反而污染**宿主**全局。这与 SKILL.md 反复强调的「环境检测验证原则 / 红线」直接冲突，会使补环境产物在真实风控下被识别为 Node 脚本。
3. **`download_ruyi_tool.js` 安装环节存在命令注入 + 关闭 TLS 校验 + 路径穿越**，属于远程代码执行/本地文件破坏入口。

建议：**上线前必须修复全部 P0 与 P1（尤其是 1/2/3）**，再做生产交付。

---

## 二、安全性（最高优先级）

### P0

| # | 位置 | 问题 | 证据 |
|---|------|------|------|
| S1 | `scripts/clean_case.js:47-49, 66-69, 132-143, 188-195` | **符号链接逃逸导致越权删除**。删除边界仅由字符串级 `isInside`（`path.relative` 比较）判定，而 `listTree` 用 `fs.statSync`（跟随软链接）递归，字符串层面仍“在 caseDir 内”，`fs.rmSync(...,{recursive:true,force:true})` 跟随链接真实删除外部文件。 | `stat()` 用 `statSync`（L47-49）；`isInside` 纯字符串（L66-69）；`removePath` 用 `rm -rf` 式（L192）「已验证」 |
| S2 | `scripts/clean_case.js:51-55, 327-331, 338` | **`isDangerousDir` 过弱，灾难性误删**。仅拦截盘符根（`C:\`/`/`）及根下 ≤2 字符路径。`/home`、`C:\Users`、`cwd=/home` 时 `--case-dir .` 均不拦截，会递归 `rm -rf` 遍所有用户临时/缓存目录。 | `normalized.length <= root.length + 2`（L54）；`/home`→len5 > 3 不拦截「已验证」 |

### P1

| # | 位置 | 问题 | 证据 |
|---|------|------|------|
| S3 | `scripts/download_ruyi_tool.js:41-46` | **PowerShell 命令注入**。`Expand-Archive -Path '${zipFile}'` 单引号拼接，`zipFile` 来自 GitHub API 返回的 `asset.name`；含 `'` 的镜像/资产名可注入命令；Windows 用户含撇号路径也会失败。 | L45 单引号拼接「已验证」 |
| S4 | `scripts/download_ruyi_tool.js:73-78, 92-109` | **`curl -sk -L` 关闭 TLS 校验 + 跟随重定向 + 无 URL 白名单**。`downloadUrl` 来自外部 JSON，`mirrorUrl` 仅判断 `startsWith('https://github.com/')`；恶意镜像/中间人可返回 `file:///etc/passwd` 或 `http://169.254.169.254/...` → 读取本机文件/云元数据（SSRF）。 | L75、L106 含 `-sk -L`「已验证」 |
| S5 | `scripts/download_ruyi_tool.js:119-121, 41-71` | **路径穿越 / Zip Slip 未校验**。`path.join(destDir, asset.name)` 中 `asset.name` 含 `../` 或绝对路径（如 `/etc/passwd`）可逃出 `destDir` 写任意位置；`Expand-Archive -Force` 不校验包内条目越界。 | L120 `asset.name` 未白名单化「已验证」 |
| S6 | `assets/env-patch-snippets/native-protect.js:37-86, 54-79, 106-166` | **宿主全局污染，与自身注释自相矛盾**。文件头 L24 明确“只在目标上下文内 patch，不要污染宿主”，但 `getInstance()` 直接 `Object.defineProperty(Function.prototype,"toString",...)`、`Object.prototype.toString`、`globalThis.structuredClone`——改的是**宿主** Node 全局；而 vm 沙箱内 `Function.prototype` 是另一套对象，对目标**无效**且污染分析进程。 | L54/L74/L132 改写宿主原型「已验证」 |
| S7 | `templates/vm-sandbox/install-env.js:6, 345-348` | **Node 泄露阻断未实现**。文件头声明“process/Buffer/require/module/global 必须为 undefined”，但第 10 步（L345-348）是纯注释，引用的 `vm-sandbox.js` 在全仓**不存在**（已 `find` 确认）。作为正式交付骨架直接运行目标 JS 会泄露 Node 能力，违反 `references/network/node-leakage.md` 阻断清单。 | L345-348 仅注释；`vm-sandbox.js` 不存在「已验证」 |
| S8 | `scripts/capture_ruyitrace_log.js:169-202` | **Firefox 子进程孤儿化**。`child.kill()` 仅杀主进程，content/GPU 子进程在 Windows 上不随 TerminateProcess 结束，导致资源常驻、profile 锁未释放、下次采集失败、违反清理纪律。 | spawn 后仅 `child.kill()` |
| S9 | `scripts/capture_ruyitrace_log.js:251-284` | **无 SIGINT 清理钩子**。60s `await wait` 期间 Ctrl+C 直接孤儿化浏览器（叠加 S8）。 | `main` 全程 await 无 signal 监听 |
| S10 | `scripts/write_stage_report.js:86-98, 319-329` | **阶段名未净化 → 路径穿越写 case 目录外**。`stage.title` 直接拼进 `path.join(caseDir,'阶段报告',file)`，可构造 `测试/../../../../etc/测试` 落盘到 `/etc`。中文名校验只查 basename，不限制目录。 | `defaultOut`（L95-98）直接拼 `stage.title`「已验证（agent）」 |
| S11 | `scripts/write_markdown_utf8.js:129-137` | **`--out` 可写任意位置/覆盖重要文件**。仅当显式 `--require-chinese-name` 才校验文件名含中文，默认无目录边界约束。 | `ensureParent`+`writeFileSync`（L133-137） |
| S12 | `assets/ast-patterns/scripts/patterns/yidun-dispatcher-pass.js:124` | **`path.toString()` 误用**。`path` 是 Babel `NodePath`，无 `toString` 方法，落到 `Object.prototype.toString` 返回 `"[object Object]"`；`evaluateExpression` 抛错被吞 → 解码器调用**永不被内联**，且上游已 `slice(2)` 删掉解码器定义 → 产物留**悬空引用**。 | L124「已验证」 |
| S13 | `assets/ast-patterns/scripts/patterns/ob-variant-pass.js:259` | 同上 `path.toString()`（解码器内联失效 + 已 `slice(3)` 删定义）。 | L259「已验证」 |
| S14 | `assets/ast-patterns/scripts/patterns/xiaohongshu-wrapper-pass.js:179, 190-200` | 同上；且会 `path.remove()` 删除别名声明，内联失效后产物**运行时 ReferenceError**。 | L179 用 `path.get("arguments.0").toString()`「已验证」 |
| S15 | `assets/ast-patterns/scripts/if-chain-to-switch.js:13, 133` | **`==` 被降级为 `===`**。`getCaseInfo` 允许 `==`/`===`，但生成 `t.switchStatement`（严格 `===`）。原 `if(x=="5")` 转换后 `switch(x){case 5:}` 不命中，静默改变语义。 | L13 允许 `==`；L133 生成 switch「已验证」 |
| S16 | `assets/ast-patterns/scripts/patterns/ob-variant-pass.js:186-241` | **解码器调用绕过 vm 超时 + px 暴力穷举**。513 次沙箱启动（每次 5s+3s，最坏 25–68 分钟纯阻塞），且 `sandbox[decoderName](...)` 直接调用**无 vm timeout**，恶意样本可永久挂死进程。 | `for px 256..512 / 0..256`（L207-241） |
| S17 | `templates/final-entry/final.js:97-100` | **默认验证次数=1，与 SKILL「≥5 次交叉验证」矛盾**（红线判定标准）。 | `verify: 1`「已验证（agent）」 |
| S18 | `templates/node-request/client.js:37-40, 104-125` | **CycleTLS 被声明为可用客户端但无 `.request` 包装** → `final.js` 调用 `session.request` 抛 `is not a function`。虚假支持。 | `detectAvailableClient` 返回 cycletls 但包装仅对 `session.request` 生效 |
| S19 | `templates/wasm-loader/loader.js:78` | **默认 `malloc` 返回 0（空指针）**。Emscripten `IMPORTED_MALLOC` 场景分配永远失败/写空指针崩溃。 | `malloc: (size) => 0` |

---

## 三、功能完整性

| # | 位置 | 问题 | 严重度 |
|---|------|------|--------|
| F1 | `assets/env-patch-snippets/native-protect.js`（全文件） | NativeProtect 基础设施对在 vm 中运行的目标**完全无效**（patch 落在宿主），核心“toString 保护”形同虚设。 | P1 |
| F2 | `templates/vm-sandbox/install-env.js:345-348` | 第 10 步 Node 泄露阻断未实现（见 S7）。 | P1 |
| F3 | `scripts/check_node_leakage.js:113-124, 185-217` | 已收集宿主 `localStorage/sessionStorage` 信号（`storage`），但 `renderMarkdown` 从不渲染 → 死数据，用户拿不到这部分泄露结论。 | P2 |
| F4 | `scripts/clean_case.js:121-130` | `isDisposableFileName` 前缀白名单无 `capture-`/`extract-`，扩展名无 `.py`；`cleanup.md` 明确要清理的 `capture_network.py`/`extract_xxx.py` 等 Python 散落脚本**清不掉**。 | P2 |
| F5 | `scripts/capture_ruyitrace_log.js:198-200` | `--import-after` 只导入 mtime 最新的一个 ndjson，分片/多 trace 其余不导入摘要。 | P3 |
| F6 | `templates/python-request/client.py:197-206` | `cyCronet.Session` 传入 `impersonate` 等不兼容参数，大概率 `TypeError`，却仍被标为“检测到可用客户端”。 | P2 |
| F7 | `assets/ast-patterns/scripts/inline-dispatchers.js:51-52, 111-115` | computed 非字面量 key 以 `undefined` 存表可能误命中；移除 dispatcher 声明未校验“所有调用点已内联”。 | P2 |
| F8 | `assets/ast-patterns/scripts/reese84-heavy-pass.js:4-40` | `pruneUnusedTopLevel` 仅按 `!binding.referenced` 删除顶层声明，动态名/属性调用场景可能误删破坏产物。 | P2 |
| F9 | `templates/final-entry/final.js:190-195` | 仅校验 HTTP 200，不校验返回数据正确性（与「确认 200 + 正确数据」原则不符）。 | P2 |

---

## 四、代码质量（bug / 异常 / 边界）

| # | 位置 | 问题 | 严重度 |
|---|------|------|--------|
| Q1 | `scripts/check_code_quality.js:151-162` | 函数长度检测把 `while/switch/catch (...) {` 误判为函数起点 → 假性触发“函数过长”门禁失败。 | P2 |
| Q2 | `scripts/check_code_quality.js:112-117, 124-139, 163-173` | 大括号计数不剥离字符串/模板字面量，`"{}{}"` 或单 `"{"` 会误报“嵌套过深/函数过长”，甚至把整文件当一个超长函数。 | P2 |
| Q3 | `scripts/check_external_tools.js:22-26`、各带值选项脚本 | **带值选项吞掉紧随的 flag**：`--python --json` 会把 `--json` 当 python 值，静默误用无报错。 | P2 |
| Q4 | `scripts/check_dynamic_resources.js:248-253` | `refreshEntry` 解析出空 basename → `new RegExp('')` 恒匹配 → 漏报“未调用运行时刷新”。 | P2 |
| Q5 | `scripts/check_trace_api_coverage.js:175, 187` | API 缺 `priority` 时 `normalizePriority(undefined)` 返回 `'UNKNOWN'`，不触发任何要求，缺优先级不报错。 | P3 |
| Q6 | `scripts/analyze_trace.js:32-39` | `readTrace` 未去 BOM，首行带 BOM 的 NDJSON 整行被记为 `parse-error`，首条事件丢失、统计失真。 | P2 |
| Q7 | `scripts/analyze_trace_complexity.js:168` | stack 信号正则裸匹配 `file`/`url`，`configfile`/`profile` 等误命中虚增复杂度分数。 | P2 |
| Q8 | `scripts/import_ruyitrace_log.js:98-112, 140-163` | `walkStrings`/`sanitizeLongStrings` 纯递归，超深 JSON 可能爆栈致摘要失败。 | P2 |
| Q9 | `scripts/run_with_trace.js:45-46, 76` | 通用 proxy `set` 把敏感值**明文**写入 `--trace`（仅 `document.cookie` 做了防护）。 | P2 |
| Q10 | `templates/final-entry/final.js:184-185` | `res.body === undefined` 时 `JSON.stringify(undefined)` 为 `undefined`，`body.slice` 抛 `TypeError` 掩盖真实失败。 | P2 |
| Q11 | `templates/final-entry/final.js:257, 262-263`、client.js:160-162 | Cookie 值含 `=` 被 `pair.split('=')` 截断（`token=a=b`→`token=a`）。Python 版 `split("=",1)` 正确，Node 版应对齐。 | P2 |
| Q12 | `templates/final-entry/final.js:278-285` | `uncaughtException`/`unhandledRejection` 仅 `console.error` 不 `process.exit`，进程处于不一致态继续运行。 | P2 |
| Q13 | `templates/node-request/client.js:114` | `timeout: opts.timeout || 30000`，curl_cffi 单位为**秒** → 约 8.3 小时无超时，网络挂起阻塞。 | P2 |
| Q14 | `templates/vm-sandbox/install-env.js:234-246` | `getRandomValues` 用 `Math.random`、`subtle.digest` 固定返回全 0 的 32 字节，真正依赖的算法得错误结果。 | P2 |
| Q15 | `templates/wasm-loader/loader.js:196, 257` | 两套独立分配器（`_heapPtr`/`_ptr`）互不协调，可能内存重叠。 | P2 |
| Q16 | `scripts/check_intake.js:26` | `--input` 读取未去 BOM，首行带 BOM 的 `task.md` 必填字段被误判缺失（与其余脚本行为不一致）。 | P3 |
| Q17 | `scripts/check_stage_reports.js:117-120` | 连续 3 个 `?` 即判乱码，技术文档“等待 ??? 秒”等合法用法误报。 | P3 |
| Q18 | `assets/ast-patterns/scripts/collect-residue-metrics.js:220` | 转义字符串嵌套量词正则 → **ReDoS** 风险（对抗性输入指数回溯）。 | P2 |
| Q19 | `assets/ast-patterns/scripts/patterns/xiaohongshu-wrapper-pass.js:9, 91-112` | `convertOpcodeIfChains` 同 if-chain-to-switch 的 `==`→`===` 语义降级。 | P2 |

---

## 五、性能与资源

| # | 位置 | 问题 | 严重度 |
|---|------|------|--------|
| P1 | `scripts/check_final_artifact.js:296-304` | 样本复用检测 `sampleValues × textFiles` 双层循环，**每个 text 文件按样本数反复全量 `readFileSync`**，中大型 case 显著 IO/CPU 瓶颈。 | P2 |
| P2 | `scripts/clean_case.js:162-164, 93-110` | `hasProfileInside`/`isProfilePath` 嵌套 `listTree` 导致近似 O(n²) 的 `stat` 调用，大目录极慢。 | P2 |
| P3 | `scripts/capture_ruyitrace_log.js:187-196` | spawn 失败后空等约 3.2s 才返回（200ms + 3000ms），无早退。 | P2 |
| P4 | `scripts/clean_case.js:188-195` | `removePath` 无 `maxRetries`，Windows 文件被占用（EPERM/EBUSY）抛错后整体 `exit(1)`，留下**部分清理**且无可汇总。 | P2 |
| P5 | `scripts/analyze_trace.js:34-35`、`analyze_trace_complexity.js:182-193`、`run-pipeline.js:55` | 整文件 `readFileSync` 入内存，未用 `readline` 流式（与 `import_ruyitrace_log.js` 风格不一致）；`maxLines` 计数与切片口径不一致。 | P3 |
| P6 | `assets/ast-patterns/scripts/normalize-structure.js:205-210` | `do{normalize();if(changed)ast=reparse(ast)}while(changed)` 无迭代上限，大文件慢且存在非收敛无限循环风险。 | P3 |
| P7 | `assets/ast-patterns/scripts/flatten-array-control-flow.js:166-289` | `resolveStatic` 对对象/成员递归未防环，对抗性自引用结构可能爆栈。 | P2 |
| P8 | `assets/ast-patterns/scripts/patterns/ob-variant-pass.js:207-241` | 见 S16，px 暴力穷举导致分钟级阻塞。 | P1 |
| P9 | `templates/wasm-loader/loader.js:284` | `wasmCache` 全局 `Map` 无上限/无失效。 | P3 |

---

## 六、可维护性

| # | 位置 | 问题 | 严重度 |
|---|------|------|--------|
| M1 | 全部接受路径的脚本（`--case-dir/--input/--out/--fixture/--file/--profile-dir` 等） | 用户路径普遍未做 `path.resolve` 后的目录边界/穿越校验（本地 AI 工具，风险低但属统一加固点）。 | P3 |
| M2 | `scripts/install_all.js:13-22` vs `check_external_tools.js:57-75` | `findProjectRoot` 策略不一致（cwd 优先 vs `__dirname` 优先），调用子脚本校验时可能因 cwd 不同产生路径判定差异。 | P3 |
| M3 | `scripts/init_env_case.js:7-22, 357` | 不支持 `--markdown`，与技能其它脚本约定不一致。 | P3 |
| M4 | `scripts/check_stage_reports.js:51, 130` | 默认 `caseDir:''` 成死值且与同批脚本行为不一致（不传 `--case-dir` 必抛错）。 | P3 |
| M5 | `scripts/compare_fixture.js:86` | 失败退出码用 `2` 而非同批的 `1`，CI 判断可能歧义。 | P3 |
| M6 | `assets/ast-patterns/README.md` & `assets/README.md` | “13 流水线脚本”与 `STEP_LIBRARY` 实际 14 个不符；多处引用 `references/`、`scripts/check_dynamic_resources.js` 不在 assets 内，未标注外部依赖。 | P3 |
| M7 | `templates/README.md:9, 10-11` | 与 `final.js`（verify 默认 1）、`client.js`（CycleTLS 不可用）、`client.py`（cyCronet 可能不可用）描述不一致。 | P2 |
| M8 | `SKILL.md` 5.3 vs `check_final_artifact.js` | 5.3 把 `check_final_artifact` 列为“交付加分（可选）”，但脚本默认强制《最终项目总结.md》，与 5.2“不生成=未完成”一致但与 5.3“加分可选”表述冲突。 | P3 |
| M9 | `scripts/write_markdown_utf8.js:97` | 死代码/变量遮蔽：函数内 `const hasChinese = /.../.test(...)` 声明却未使用，遮蔽外层同名函数。 | P3 |
| M10 | `templates/final-entry/final.js:87` | “设备 Cookie（内置…）”注释措辞易诱导硬编码业务 Cookie（触红线4边界），应改明确禁止。 | P3 |
| M11 | 多个模板 | 未使用的 `require('path')`（`final.js:27`、`client.js:18`）；`final.js:33-68` 顶层 require 缺失即硬崩溃，与 `fetchRuntimeResources` 降级不一致。 | P3 |
| M12 | `assets/ast-patterns/scripts/shared.js` 及各脚本 | 整文件 `readFileSync` 且不处理 UTF-8 BOM，Windows 保存的 JS 可能触发 babel 解析问题。 | P3 |

---

## 七、SKILL.md 规范自检（文档一致性）

- **可达性**：对 SKILL.md / 三个 README 共 86 处本地路径引用做存在性校验，**无真实断链**（4 个“缺失”系全角括号导致的正则误捕获，已排除）。
- **核心矛盾**：SKILL.md 反复强调「环境检测验证原则」「Node 泄露必须阻断」「红线 3/4」，但 `templates/vm-sandbox/install-env.js` 与 `assets/env-patch-snippets/native-protect.js` **均未真正实现这些约束**（见 S6/S7/F1/F2），文档与交付物存在落差——这是 skill 级最需关注的完整性缺口。
- **默认参数矛盾**：SKILL.md 要求“≥5 次真实 API 交叉验证”，`templates/final-entry/final.js` 默认 `verify:1`（S17）。

---

## 八、修复优先级建议

**必须（P0，上线前）**
1. `clean_case.js`：删除目标做 `realpath` 后与 `realpath(caseDir)` 包含校验；`lstatSync` 识别并跳过符号链接；`isDangerousDir` 增加最小深度 / 标记目录（存在 `case/`、`result/`、`阶段报告/` 之一）约束，过浅目录拒绝或强制二次确认。
2. 补 `clean_case.js` 单条失败容错与汇总输出（P4）。

**高优先（P1）**
3. `download_ruyi_tool.js`：解压改参数数组式 `powershell -Command Expand-Archive -Path <arg> -DestinationPath <arg>`；`asset.name` 白名单 `[A-Za-z0-9._-]` + `basename` 去 `..`；去掉 `curl -k`、对 `browser_download_url` 与 `GITHUB_MIRROR` 强制 `https://` 且 host ∈ `github.com`/`objects.githubusercontent.com`、禁止 `file://`、限制重定向同源。
4. 实现真正的 vm 隔离：`templates/vm-sandbox/` 提供 `vm.createContext` 模块，只注入受控 `win` 与桩函数，删除宿主 `process/Buffer/require/module/global` 及 Node 21+ 宿主 `navigator/performance/localStorage/fetch`；`native-protect.js` 改为 `applyToContext(context)` 在沙箱内 patch，停止污染宿主。
5. `write_stage_report.js` / `write_markdown_utf8.js`：`--out` 与 `stage.title` 净化（`/` `\` `..` 空字节），写入前校验 `realpath` 落在 caseDir/项目根内。
6. AST passes：`path.toString()` → `generateCode(path.node)`（加单测：构造 `decoder(5)` 断言输出出现字面量）；`if-chain-to-switch` 拒绝 `==` 或保留 if 链；`ob-variant` px 穷举加预算 + 解码器调用加 vm timeout。
7. 模板：`final.js` `verify` 默认 5；`client.js` 剔除未实现的 CycleTLS 或实现适配；`wasm-loader` 实现真实 `malloc`；`client.js`/`final.js` Cookie 截断对齐 `split("=",1)`；`client.js` timeout 单位改秒并注释。

**一般（P2/P3）**：按上文 Q/F/P/M 各表逐项修复；统一参数解析（带值选项前瞻判断 flag、`--markdown` 一致性）、统一路径边界校验、统一 BOM 处理、补 `check_node_leakage` 的 storage 渲染、补 `clean_case` 的 `.py` 清理。

---

## 九、附录：经审查确认无问题的正向点

- 全部脚本命令执行几乎均为 `spawnSync` 数组传参、无 `shell`，**无命令注入**（除 S3 的 PowerShell 字符串拼接）。
- `run_with_trace.js` 的 vm 沙箱设计（空 `vm.createContext({})` + 桩覆盖）**正确阻断了 Node 宿主泄露**，对照 `check_node_leakage.js` deny list 逐项满足，`__leakageCheck` 自检自洽。
- `import_ruyitrace_log.js` 正确用 `readline` 流式 + 逐行去 BOM + 长字段仅存 sha256/preview，方向正确。
- `generate_fingerprint_hook.js` 生成器与被生成代码均**无 eval/Function 注入**，长值分片不截断，且头部/控制台明确“不得放入 result/”。
- `python-request/client.py` 的 `CookieJar.merge` 用 `split("=", 1)` 正确保留值内 `=`。
- `tools/` 已 gitignore，未污染仓库（132 跟踪文件，0 来自 tools/）。

---

*审查完成。以上结论中标注「已验证」的项由主代理对照源码逐一确认；其余为并行审查代理基于全量源码阅读给出，均附 file:line 证据。*
