# 智通财经 H5 token 逆向

- 目标：`https://m.zhitongcaijing.com/` → `https://mapi.zhitongcaijing.com/news/list.html`
- 目标参数：URL query 中的 `token`（40 位 hex，非固定值，是签名）
- 类型：纯算还原（标准 SHA1 签名，无环境/无混淆）

## 证据
- 页面为 Vue 构建：`https://img.zhitongcaijing.com/m/js/{app,chunk-vendors}.js?v=14`
- app.js 模块 `1ae8` 请求构造器：
  - GET：`o=s()(a); o+="&token="+u["a"].hex_sha1(o)`
  - POST：`a.token=u["a"].hex_sha1(s()(a))`
- `a = f(p({__mode__:"history",tradition_chinese,access_token,language}, r))`
  - `f(t)` = `Object.keys(t).sort()` 重排对象键为字母序
  - `s()` = chunk-vendors 模块 `cfd4` 序列化器：`for in` 遍历 + `encodeURIComponent(key)`/`encodeURIComponent(value)` + `&` 连接（对象递归为 `k[v]`）
- `u["a"].hex_sha1` = 标准 SHA1（hex）；用 Python `hashlib.sha1` 比对完全吻合。

## 算法（放之 GET/POST 皆准）
1. 合并基础参数 `{__mode__:"history", tradition_chinese:"0", access_token:"", language:"zh-cn"}` 与业务参数
2. 对象键按字母序排序
3. 序列化为 `encodeURIComponent(k)=encodeURIComponent(v)` 以 `&` 连接（纯 ASCII 时与原串一致）
4. `token = SHA1(上述串)`
5. GET 追加 `&token=...` 到 query；POST 写入 body.token

## 验证
- 目标已知 token `928079f344b3d4b20faf84ed7afc989a774ab328` 复现成功（page=1 用例）
- 对真实接口连续 5 页请求均返回 200 + 正确 JSON，签名每次合法且随参数变化

## 交付物
- `cases/zhitongcaijing/final.js`：纯 Node.js 实现（`signGet`/`signPost`/`get`/`post`），无浏览器依赖
- 实测需用 `NODE_TLS_REJECT_UNAUTHORIZED=0`（本机出网经透明代理，仅本地脚本验证用）

## 踩坑（环境侧，与算法无关）
- 本机出网有透明代理（Server: WattToolkit），自签 CA 导致 Python `requests`/Node TLS 校验失败 → 用 curl -k 下载资源、Node 设 `NODE_TLS_REJECT_UNAUTHORIZED=0`
- 动态调试路线因代理拦截（addons.mozilla.org 返回 451）不可行，故改用纯静态分析（下载 JS + Grep）完成，结果等价。本例 token 是标准 SHA1，纯 curl+Grep 足够，无需 trace 取证。

## 复盘（技能层面的教训，已回写 js-reverse-skill）
1. **标准算法无需重工具**：本例 token 是标准 SHA1，纯 curl+Grep 比启动浏览器自动化更快更稳。统一 trace 流程下，日志证据确认算法可提取后即可走纯算还原，trace 仅用于定位入口。
2. **GitHub 网络不通 → 镜像站代理**：本次代理自签 CA 把 GitHub 下载全拦了。已补"SSL 自签 CA 兜底 + ghproxy/kgithub 镜像前缀 + git insteadOf + raw 镜像"的降级链。
