# Case 初始化模板

每个新 case 开始时复制本模板到 `case/` 目录，按实际任务填写。

## 目录结构

```text
case/
├── 阶段报告/
│   └── 01-需求信息确认.md
├── js/
│   ├── original/          # 原始 JS 文件
│   ├── pretty/            # 格式化后的 JS
│   └── extracted/         # 提取的关键代码片段
├── requests/
│   └── request.curl       # Copy as cURL 样本
├── fixtures/
│   ├── sample.fixture.json    # 浏览器真实输出 fixture
│   └── fingerprint.fixture.json # 指纹采样 fixture（如涉及）
├── notes/
│   ├── 代码变更记忆.md
│   ├── entry-chain.md     # source/entry/builder/writer 链路
│   ├── silent-failure-checklist.md
│   └── trust-matrix.md
├── ruyi-trace/            # Trace 日志（如使用）
│   └── logs/
├── hooks/                 # 临时 Hook 脚本（用完即删）
├── env/                   # 补环境代码（开发阶段）
├── tmp/                   # 临时文件（用完即删）
└── result/                # 最终交付
    ├── final.js
    ├── 最终项目总结.md
    └── src/
```

## Case 信息

```markdown
# Case 信息

## 目标
- 目标网站 URL：
- 目标页面 URL：
- 目标 API：
- 请求方法：
- 目标加密参数：
- 参数位置：Query / Header / Body / Cookie

## 取证
- 取证模式：ruyiPage + RuyiTrace / 仅 ruyiPage / Camoufox + camoufox-reverse-mcp / 仅 Camoufox / 用户手动取证 / AI 自行决定
- 最终请求 TLS 客户端：Node.js CycleTLS / impers / curl-cffi / Python curl_cffi / cffi_curl / cyCronet / 不发真实请求

## 难度分级
- 级别：L1 纯算 / L2 vm 沙箱 / L3 补环境
- 分级依据：

## 指纹基线
- baselineId：
- baseline 文件：case/notes/fingerprint-baseline.json

## 补环境框架
- 选择：不使用（默认） / vm / jsdom
```

## 技术指纹（供 CHECK-2 自动匹配）

> 列出可用于自动检测的稳定特征,每条写成可搜索的模式。CHECK-2 速查表靠这些特征命中。

- JS 特征:（如 "_0x 前缀变量大量出现"、"单文件 200KB+"、"存在 while-switch 解释器循环"）
- 参数特征:（如 "sign 参数,32 位 hex,疑似 MD5"、"token 参数,Base64 格式"）
- 请求特征:（如 "存在 /api/init 预热请求"、"Cookie 中有动态字段 __ac_xxx"）
- 反调试特征:（如 "debugger 定时器"、"Function.toString 检测"）

## 加密方案

> 一句话说明最终采用的方案路径(L1 纯算 / L2 vm 沙箱 / L3 补环境)+ 核心方法。

- 分级:L1 / L2 / L3
- 路径:A 纯算还原 / B vm 沙箱执行 / C WASM 加载 / D 环境伪装
- 框架:不使用 / vm / jsdom
- TLS 客户端:CycleTLS / curl-cffi-node / impers / curl-cffi / curl_cffi / cyCronet / 不发真实请求
- 核心思路:（一句话）

## 踩坑记录

> 每条写成"坑:___ → 正确做法:___"格式。这些是 Phase 4 编码时必须回查的约束。

1. **坑 1**:（描述）→ 正确做法:（描述）
2. **坑 2**:（描述）→ 正确做法:（描述）
3. ...

## 可验证事实清单（经验资产）

> 5-15 条最小可验证事实。同站升级时逐条核对找出"哪些变了"。每条写成可断言的形式。

1. （如 "X-Bogus 长度 28"）
2. （如 "navigator.webdriver === false"）
3. （如 "签名输入包含完整 query string,不含 #hash"）
4. ...

## 阶段报告清单

- [ ] 01-需求信息确认.md
- [ ] 02-取证方案确认.md
- [ ] 03-请求样本与可疑参数确认.md
- [ ] 04-JS文件与入口定位.md
- [ ] 05-补环境前置分析.md
- [ ] 06-补环境实现记录.md
- [ ] 07-验证与清理记录.md
- [ ] 最终项目总结.md

## 交付前检查清单

- [ ] 信息完整性检查通过
- [ ] 取证模式已确认
- [ ] TLS 客户端已确认
- [ ] 可疑加密参数已确认
- [ ] source/entry/builder/writer 链路已确认
- [ ] 补环境框架已选择
- [ ] fixtures 多样本通过
- [ ] 代码质量检查通过
- [ ] 补环境真实性检查通过
- [ ] 最终产物检查通过
- [ ] 清理 dry-run 通过
- [ ] 最终总结已生成

---

## 相关参考

> 填写与本案例相关的参考文档，建立 cases→references 双向链接。

| 参考文档 | 关联点 |
|---------|--------|
| `references/workflow/decision-tree.md` | 题型判定 + 路径决策 |
| `references/workflow/experience-rules.md` | 相关经验法则编号 |
