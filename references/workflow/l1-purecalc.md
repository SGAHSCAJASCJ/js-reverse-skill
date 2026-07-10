# L1 纯算模式

> **触发条件**：题型判断为 L1 纯算（md5/aes/标准签名/无明显环境检测）时读

## 适用条件

- 加密算法可用标准库实现（MD5/SHA/AES/DES/RSA/HMAC）
- 无浏览器环境检测
- 无 TLS 指纹校验
- 加密逻辑可从源码完整提取（算法不可直接提取时升级 L2）
- 默认用 camoufox MCP 黄金路径定位签名函数；camoufox 不可用且用户选择不安装时走纯静态分析（Grep 定位）。**camoufox 不可用时不默默走静态分析，必须先告知用户有安装选项**

## 流程（核心 10 步）

```
0. (前置) 提取参数值特征(长度/字符集/编码) + 定位 JS 文件 URL + 下载
   - 完整模式: 从用户提供的请求包提取
   - 极简模式: 复用 Phase 0.5 抓包结果(不重抓)
1. camoufox MCP 黄金路径定位签名函数:
   - network_capture(action='start') → 触发请求 → list_network_requests
   - get_request_initiator(request_id=N) → 直达签名函数
   - 降级模式(无 camoufox): Grep 搜索参数名 → 定位赋值点
2. search_code(keyword="参数名") + search_code(keyword="encrypt|sign|md5|aes") → 提取加密函数
3. 识别算法类型(参考 references/crypto/crypto-patterns.md)
   - 快速失败: 发现 JSVMP 特征(200KB+/while-switch) → 立即升级 L3
   - 快速失败: 发现需要 vm 沙箱(自定义 MD5/算法不可提取) → 升级 L2
4. 确认参数拼接顺序、密钥来源、时间戳精度
5. 用 Node.js crypto / Python hashlib 实现算法
6. 打印中间值，与请求/响应样本逐一比对(用户提供或 Phase 0.5 抓包获取)
7. 修正偏差(拼接顺序 / 编码 / 填充 / 密钥)
8. 运行 final.js/final.py 发送请求
9. ≥5 次请求交叉验证签名稳定性
10. 整理 config/ + README.md 交付
```

## 无 camoufox 纯 Node 静态分析路径

> **何时用**：camoufox 不可用且用户选择不安装时，或用户主动选择纯静态分析路径。L1 标准算法签名（md5/aes/hmac/标准签名/SM2/SM4/SM3 国密）可用此路径解决。对于参数名明确、JS 结构清晰的 L1 场景，静态分析是合理选择；对于大文件或参数名不明确的场景，camoufox 动态调试效率更高。camoufox 不可用时不默默走此路径，必须先告知用户有安装选项。

**核心步骤**：

1. 拿到目标 JS 文件 URL：从页面 HTML / 用户提供的请求包 / 已知静态路径获取
2. `curl -s <JS_URL> -o site.js` 下载（SPA 首屏 HTML 里通常能 `grep` 到 `<script src>`；必要时先 `curl` 抓首屏再提取路径）
3. `js-beautify site.js -o site.pretty.js`（可选）后 `grep -nE "参数名|sign|md5|aes|hmac|token" site.js` 定位签名函数
4. 读源码提取：算法类型、参数拼接顺序、密钥/盐来源、时间戳精度、最终编码
5. 用 Node.js `crypto` / Python `hashlib` 实现，`console.log` 中间值与样本逐一比对
6. 跑 `final.js` 发真实请求，≥5 次交叉验证签名稳定性
7. **仅当**返回 403/超时且算法全对 → 才怀疑 TLS 指纹（见 scenario 6 / `tls-validation.md`），此时才需 TLS 客户端

**关键边界**：本预案只覆盖 L1（标准算法可纯算提取）。一旦发现 JSVMP 特征（200KB+/while-switch/字节码数组）或算法不可提取需 vm 执行 → 升级 L2/L3，而这些**确实依赖 camoufox 取证**，无 MCP 环境无法继续，需让用户安装（见 Phase 0.3 环境配置）。

**TLS 客户端依赖说明**：`templates/node-request/client.js` 强制要求 TLS 指纹兼容客户端（curl-cffi-node 等），但该依赖**仅在怀疑 TLS 指纹检测时才需要**。纯算法签名、服务端无非标 TLS 校验时，直接用 Node 内置 `http`/`https` 或 `fetch` 即可，不要为简单 L1 强装 TLS 库——否则会把最快的题拖进最重的依赖。

## 技术栈

**Node.js**：
- `crypto`（内置）— MD5/SHA/AES/DES/HMAC
- `crypto-js` — CryptoJS 兼容实现
- `node-rsa` / `node-forge` — RSA 加解密
- `axios` / `node-fetch` — HTTP 请求

**Python**：
- `hashlib` / `hmac` — 哈希
- `pycryptodome` — AES/DES/RSA
- `curl_cffi` — TLS 指纹模拟（备用）
- `requests` — HTTP 请求

## 常见签名拼接模式

```javascript
// 模式1：固定格式
sign = md5(`page=${page}&t=${timestamp}&key=${secret}`)

// 模式2：所有参数排序拼接
const params = { page: 1, size: 10, t: Date.now() };
const str = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
sign = md5(str + secret)

// 模式3：JSON 字符串
sign = md5(JSON.stringify(data) + secret)

// 模式4：管道分隔
sign = md5(`${page}|${timestamp}|${secret}`)
```

## 签名不一致排查链路

签名排查 7 步（原始输入参数 → 参数排序/拼接字符串 → 时间戳精度 → 随机串 → 密钥/盐值 → 中间摘要 → 最终密文编码）详见 `experience-rules.md` 的"10. 签名不一致时逐环节对比"段。本文件只列 L1 纯算特有的步骤与重点：

- L1 纯算场景下签名输入通常无环境指纹参与，排查重点落在第 1、2、5、7 步（参数拼接顺序、密钥来源、最终编码方式）。
- 第 3 步时间戳精度（秒 vs 毫秒）和第 4 步随机串（长度、字符集）是 L1 最常见的偏差点，优先核对。
- 若 7 步全部一致仍签名不通过，转而考虑自定义 MD5/SHA 实现（见下文"自定义 MD5 处理"段）或 TLS 指纹问题。

## 配置文件策略

配置产物存放位置详见 `references/workflow/phase-flow.md` Phase 4.3 配置文件策略表。

**核心原则**：分析过程中产生的任何长文本都应该立即持久化到 `config/` 文件中。后续代码只需「读取文件」而非「内联长字符串」。

## 自定义 MD5 处理

某些网站修改了 MD5 的内部参数（如 chrsz=16），导致输出与标准 MD5 不同。

**识别方法**：用相同输入对比标准 MD5 输出，如果不一致则为自定义实现。

**还原策略**：必须提取原始 JS 实现，在 Node.js 中直接执行（降级到模式 B vm 沙箱）。
