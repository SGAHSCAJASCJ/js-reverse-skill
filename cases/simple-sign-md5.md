# Case：标准 md5 排序参数签名（零浏览器路径模板）

> 难度：★
> 还原方案：A 纯算还原（md5 排序拼接 + 盐 + 时间戳）
> 实现语言：Node.js（内置 crypto / http）
> 最后验证日期：2026-07-11
> 平台类型：通用骨架（任意 `sort(params)+salt+ts → md5` 签名接口）
>
> **模式案例**：覆盖「参数排序拼接 + 盐 + 时间戳 → md5 签名」这一类最常见题型。已端到端实测验证（curl 取 JS → Grep 定位 → 纯 Node 复现 → 真请求 5/5 通过 200）。碰到同类简单题直接套用，**不要上来就开 trace 取证**，先走零浏览器路径。

---

## 技术指纹（供 CHECK-2 自动匹配）

- JS 特征：`var SALT = '...'` 常量内联；`md5(...)` 自定义实现或引用 crypto
- 参数特征：`sign` 参数 32 位 hex（MD5）；伴随 `t`/`timestamp` 毫秒时间戳
- 请求特征：缺 `sign` 或 `sign` 错误 → 服务端返回 403 / `invalid sign`（这是强信号：服务端校验签名）
- 反调试特征：无

## 加密方案

- 路径：A 纯算还原
- 框架：不使用
- TLS 客户端：Node 内置 http（无 TLS 指纹检测时不必装 curl-cffi-node）
- 核心思路：`raw = 'GET/api/data' + sortedParams(k=v&) + SALT + ts`；`sign = md5(raw)`；请求带 `sign` 与 `t`

## 踩坑记录

1. **坑：一上来就开 trace 取证** → 正确做法：标准算法签名先用零浏览器路径（curl+Grep），trace 取证缺失也不阻塞；仅复杂场景才真需要它。
2. **坑：为简单题型强装 TLS 客户端库** → 正确做法：先普通 http/https 发一次，403/超时且算法全对才怀疑 TLS 指纹（见 scenario 6）。
3. **坑：排序拼接时把 `sign`/`t` 也算进 raw** → 正确做法：`Object.keys(params).filter(k => k!=='sign' && k!=='t').sort()`，时间戳只在尾部拼一次。
4. **坑：时间戳精度用秒** → 正确做法：用毫秒（`Date.now()`），与服务端 `t` 一致；精度不对签名必失败。
5. **坑：自定义 md5 误当标准 md5** → 正确做法：同一输入先比标准 MD5，不一致才降级 vm 执行原实现（见纯算还原文档「自定义 MD5 处理」）。

## 可验证事实清单（经验资产）

1. `sign` 为 32 位 hex（MD5 输出）
2. `raw` 拼接顺序：`'GET' + path + sortedParams + SALT + ts`，参数排序排除 `sign`/`t`
3. 时间戳为毫秒，与请求中的 `t` 同源
4. 缺/错 `sign` → 服务端 403 `invalid sign`
5. 算法无环境指纹参与（纯参数 + 盐 + 时间）
6. ≥5 次请求签名稳定通过

## 零浏览器复现要点（实测步骤）

```
1. curl -s <JS_URL> -o site.js            # 拿客户端签名 JS
2. grep -nE "makeSign|md5|SALT|GET/api" site.js   # 定位入口 + 盐 + raw 格式
3. 读源码提取: 算法(md5) / 拼接顺序 / SALT / ts 精度
4. Node crypto 实现 makeSign, console.log 中间值比对
5. node final.js → 5 次请求全 200 即过关
```

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/workflow/trace-flow.md` | 统一日志驱动逆向流程 |
| `references/crypto/crypto-patterns.md` | MD5/排序拼接模式识别 |
| `references/workflow/decision-tree.md` | 题型判定 |
| `references/network/tls-validation.md` | 仅当怀疑 TLS 指纹时才看 |
