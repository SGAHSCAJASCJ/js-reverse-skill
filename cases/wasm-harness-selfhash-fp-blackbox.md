# Case：设备指纹 black_box 自同构校验（wasm 自哈希绑定）——透明边界捕获 + 直接 wasm harness 纯协议生成

> 难度：★★★★★
> 还原方案：C WASM 加载（直接 harness：Node 实例化 wasm，按捕获契约装配导入后调导出产出载荷）+ 配对设备画像
> 实现语言：Node.js
> 最后验证日期：2026-09-13
> 平台类型：9air.com（同盾 TrustDecision fm.js 设备指纹）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：单文件混淆 SDK（字符串数组 `oQOQ0O[1234]` + while-switch 控制流扁平化）；内嵌 base64 wasm 字面量（~138KB）；`_fmOpt` 全局配置（partner/appName/interfaceProtection/success）
- 参数特征：Header `anti-headers` 内 `black_box`，`tddf` 前缀 + base64url(JSON 信封 `{v,os,p,e,l}`) + `.` + base64url 载荷；载荷为 Protobuf（field1=4 / field2 主密文 / field3 48B / field4 16B 随机盐）；同会话复用（deviceId 快路径为 26 字符）
- 请求特征：加载期 `POST cn-fp.apitd.net/web/v2?partner=<x>&appKey=<x>`（`data=` 表单编码）注册上报；业务请求头 `anti-headers` JSON（`black_box`/`channel` 等）
- 反爬特征：**自同构校验**——SDK 把 `document.currentScript.src`（脚本来源复合槽）、**fm.js 源码全文**（wasm 导入 `o`）与 **wasm 自身字节**（导入 `m`）全部喂进指纹计算；非官方构建/非成对资产 → 载荷结构完全正常但服务端恒 `检验失败`（HTTP 500）

## 加密方案

- 路径：C WASM 加载（直接 harness），**无浏览器、无 jsdom、无 SDK 运行态、无凭据注入**
- 框架：不使用（Node 原生 `WebAssembly.instantiate` + 自实现 21 导入）
- TLS 客户端：Node 原生 https（H1 + keep-alive Agent 即可）
- 核心思路：不反编译 wasm（62K 行 WAT/270 函数），用**透明边界捕获**（hook 包裹 `WebAssembly` 构造器，在官方包真实页上记录全部导入返回值 verbatim 字节 + 返回指针 + 导出调用序）拿到「真机当次 E 调用的完整输入」，把「132 项指纹数组 + fm.js 源 + wasm 自身字节 + 常量串」固化为**成对校验的设备画像**；交付侧每次 fresh 实例化 wasm、按契约装配画像 + 当下时间/随机，调用导出 `E` 产出载荷 → 拼 tddf → 直发业务接口。

### wasm 导入契约（E 调用期消费，实测语义）

```text
d = 132 项指纹数组（[u32 n][u32 total][item\0…] 序列化）     ← 设备画像（采集自真实页）
o = [hdr][len][fm.js 源码全文]                              ← 自同构校验：脚本完整性
m = [len][wasm 自身字节]                                    ← 自同构校验：载荷与 wasm 构建绑定
n = 3×u32 常量 / f = 2 项异或对（QQQoQQ[i]^ts）/ s = 88 字符 version（动态 nonce 型，每次运行不同）
u = 34 字符 osc（6 随机 + 13 位时间戳 + 11 随机）/ e×2 = partner / p = appKey / r,t = 空串
g = 「fm.js 下载至今毫秒」（真机 1455~2503）/ c = 13 位时间戳 / a,l = 时钟 / b,i,q = Math.random
导入调用序每次运行漂移（24~27 条，i/k 按分支出现）——回放按捕获序逐条弹出，不得按静态表硬编码
E 返回 [u32 status][u32 len][载荷字节]，status=0 为有效载荷
```

### 交付资产（成对 sha256 固化）

| 资产 | 内容 | 绑定关系 |
|---|---|---|
| device-profile.json | 132 槽指纹 + osc + version + f 异或对 + n 常量 | 与下述 wasm 构建来自**同一次真实会话** |
| fm-input-src.bin | fm.js 源码全文（577583B） | 来自同会话 `o` 导入捕获 |
| fm.wasm | 当前线上构建（138510B） | 来自同会话 `m` 导入捕获；与旧 fm.js 内嵌 wasm **长度相同字节不同** |

## 踩坑记录

1. **坑：官方包 200 / 重建包（deobf+插桩重打包）必 500——同机同页同 cadence 下唯一变量是 JS 包，却连续多轮归因为「环境取值/痕迹/调用历史没对齐」，做了 7+ 轮逐槽对齐、全量回灌、内存快照、TLS 替换全部无效** → 正确做法：先确认自同构校验信号（`o` 导入喂脚本源、`m` 导入喂 wasm 自身）。任何改包取证方式都改变输入 → 结论应为「放弃改包，改用透明捕获 + 直接 wasm harness」，一次实验即判。
2. **坑：真机指纹基线全部采自 file:// 探针页，「来源类复合槽」（含 currentScriptSrc 的 `URL|…|md5|rgb|srgb` 槽）被本地路径污染而不自知** → 正确做法：按名对齐只能对齐具名槽的值，**来源类槽的值本身因取证页而异**；ground truth 必须取自真实页（透明 hook 不改语义、经 200 验证）。
3. **坑：wasm 边界 hook 静默半失效——`WebAssembly.instantiate(module, imports)` 的 module 重载解析结果是 **Instance 本体**（非 `{module, instance}` 记录），只处理后者导致导出包裹从未生效（exp=0）** → 正确做法：两种重载都处理：`r.instance` 存在则包裹之，否则 `r instanceof WebAssembly.Instance` 直接包裹。
4. **坑：hook 找不到内存——`exports.memory` 不存在（本 wasm 内存导出名是 `v`），所有指针捕获变 `nomem`** → 正确做法：遍历导出用 `instanceof WebAssembly.Memory` 探测，不假设导出名。
5. **坑：内存快照 verbatim 写回新实例后 E 直接 OOB/错乱** → 正确做法：`E = f(线性内存, wasm 全局, 导入值)`，**全局（堆指针等）从 JS 不可恢复**——跨实例快照恢复是结构性死路；但这不影响 fresh 生成：fresh 实例自带一致的 (初始内存, 初始全局)，只要导入值是真实画像，产出载荷自洽且服务端可验证。
6. **坑：用旧会话提取的 wasm 配新会话画像（或反之），长度相同字节不同，结构完全正常仍 500** → 正确做法：画像、fm.js 源、wasm 二进制是**成对资产**，全部取自同一次会话并各自 sha256 固化；交付启动校验，失败即报「SDK 升级需重采」。
7. **坑：按静态契约表硬编码导入语义与调用序** → 正确做法：契约从捕获中逐条校准（`u` 实测返回 osc 非空串、`s` 是动态 nonce 型常量、`i/k` 分支性出现）；回放/生成按捕获序弹出。
8. **坑：假设业务接口要求先注册（apitd 上报），默认多发一次请求** → 正确做法：实测 `--no-register` 直发业务也 200——**载荷自包含**，注册非必需；先测再定交付流程，减少请求足迹。
9. **坑：f 异或对用 32 位 `^` 语义还是 BigInt 语义拿不准，不敢动** → 正确做法：两变体（原样回放 / BigInt 重异或）都实测通过——该字段服务端不严格校验；拿不准的输入先做双变体实测再定实现。
10. **坑：交付前把 138510B 的 fm-input-src.bin 放在 src/black-box/ 下被代码质量门禁按「单行长文件」误判** → 正确做法：取证原始产物放 `src/target/original/`（质量门禁豁免路径）。

## 方法论：wasm 边界透明捕获 → 直接 harness（本案例核心，通用化见 env-wasm-advanced.md）

```text
① 前置透明 hook（prepend 进 SDK 响应体，非 add_preload_script 独立 world）：
   包裹 Instance/instantiate/instantiateStreaming（两种重载！）→ 包裹导入（记录调用序+全值+ptr）
   → 包裹导出（记录调用序+ptr 参数解码+输出字节）
② 透明性验证：官方包 + hook 走完整链路 → 业务 200，证明 hook 无害
③ 捕获产物 = 「真机当次 E 的完整输入」+ E 输出 → 固化为设备画像（成对 sha256）
④ 交付：fresh 实例 + 画像 + 当下时间/随机 → E 产出 → 业务接口实测
⑤ 判定分支：fresh 载荷 200 = 纯协议达成；500 → 检查资产配对/来源槽污染/导入语义偏差
```

## 可验证事实清单（经验资产）

1. `black_box = "tddf" + b64url(JSON{v:"4.2.7",os:3,p:"9air",e:4,l:hex(wbB64长度)}) + "." + wbB64`；`wbB64 = b64url(wasm 导出 E() 输出)`。
2. 载荷 Protobuf：field1 varint=4 / field2 主密文 / field3 48B / field4 16B（随机盐，每采样变）。
3. 导入 `m` 恒返回 wasm 自身 138510B（`head=0061736d`）——载荷与 wasm 构建自哈希绑定。
4. 导入 `o` 返回 `[hdr=103][len=577583][fm.js 源全文]`——脚本源完整性进入指纹。
5. 导入 `s` 的 88 字符 version 每次运行不同（动态 nonce 型），`u` 返回 34 字符 osc（内嵌 13 位时间戳）。
6. 导入序列每次运行漂移（24~27 条：`u l q b d o n c b l m t s r g c f a a a a e e p` 基型，`i/k` 分支出现）。
7. 132 项指纹数组中，真机自身两次采样即有 21 个易变槽（噪声，无需对齐）；槽位顺序每次运行随机打乱（服务端按自描述结构解析）。
8. 业务接口对「未注册」的 fresh 载荷同样 200——载荷自包含，apitd 注册非必需。
9. 时间/随机可用运行时真实值（osc 与 13 位时间槽按当下重建已被接受）；`g` 下载至今毫秒喂 2000 量级即可。
10. 纯协议验证：交付入口连续 14 次真实请求全 200 + prices 业务数据（验证记录 attempts=14）；另有变体 A/B 与 no-register 共 9 次通过。
11. 站点存在两个 138510B 的 wasm 构建（旧 fm.js 577667B 内嵌 vs 线上 fm.js 577721B 内嵌），字节不同——**混用即静默 500**。
12. `performance.now` 导入返回值量级不敏感（真机 2765 vs 沙箱 100~8000 均通过）。

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/env/env-wasm-advanced.md` | wasm 边界透明捕获方法论（hook 模式/重载坑/捕获 schema/fresh vs 回放） |
| `references/workflow/common-pitfalls.md` | 反模式 39（自同构校验误判）、反模式 40（跨实例快照恢复死路） |
| `references/workflow/experience-rules.md` | 规则 41~43（成对资产、捕获优先于逆向、fresh 优于字节级回放） |
| `references/workflow/decision-tree.md` | WASM 加密题型决策 |
| `references/network/ip-risk-control.md` | 双对照定位协议（本案例排错史复用） |
