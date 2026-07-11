# 智通财经 H5 token 逆向

- 目标：`https://m.zhitongcaijing.com/` → `https://mapi.zhitongcaijing.com/news/list.html`
- 目标参数：URL query 中的 `token`（40 位 hex，非固定值，是签名）
- 类型：L1 纯算（标准 SHA1 签名，无环境/无混淆）

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
- camoufox 动态调试路线因 ① addons.mozilla.org 拉 UBO 插件返回 451（代理拦截）② playwright 1.61 与 camoufox 135 浏览器 CDP `setDefaultViewport` 协议不匹配（isMobile 字段）而不可行，故改用 L1 纯静态分析（下载 JS + Grep）完成，结果等价。

## 复盘（技能层面的教训，已回写 js-reverse-skill）
1. **L1 纯静态分析应是一等公民，而非降级**：本例 token 是标准 SHA1，纯 curl+Grep 比装 camoufox 更快更稳。技能原描述把"L1 camoufox MCP 自动跟踪"当默认，实际 MCP 不在 pip 源、需另 clone，且本例根本不需要。已改为：L1 纯算/静态分析可独立推进，MCP 只是可选增强。
2. **camoufox-reverse-mcp 不会自动安装**：用户选"安装 camoufox 走动态调试"时，默认装的只是 `python -m camoufox fetch` 的普通浏览器，MCP 需额外 `git clone + pip install -e`，且仓库路径需用户确认。已补明确安装门禁 + 镜像说明。
3. **默认 camoufox ≠ trace 内核（这是"trace 还用不了"的根因）**：`python -m camoufox fetch` 下载的是默认反检测浏览器，不带 C++ 层 trace 能力；L3 要的 `camoufox-reverse 定制版` 是另一回事，技能此前只写"camoufox-reverse 定制版"却没给获取方式与选型检测。已新增 `check_external_tools.js --require-camoufox-trace` 检测/提议门禁：L3 trace 选型时若内核缺失，必须让用户提供路径或降级 ruyiPage+RuyiTrace，禁止用默认 camoufox 静默替代。
4. **GitHub 网络不通 → 镜像站代理**：本次代理自签 CA 把 GitHub 下载全拦了。已补"SSL 自签 CA 兜底 + ghproxy/kgithub 镜像前缀 + git insteadOf + raw 镜像 + playwright 版本固定"的降级链。注：用户参考的 BrowserSkill AGENT_INSTALL.md 本身并无镜像说明，镜像策略基于本次实战踩坑实现。
