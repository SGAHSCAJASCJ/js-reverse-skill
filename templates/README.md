# 交付入口模板索引

本目录提供 5 类交付入口模板，复制到 `case/result/` 后按站点签名逻辑填充。

## 模板清单

| 模板 | 入口文件 | 解法模式 | 用途 |
|------|---------|---------|------|
| `final-entry/` | `final.js` | 所有模式 | **Node.js 最终入口**：默认发真实 API 请求验证（≥5 次），Session 模式 + 签名/请求分离 + 动态资源刷新 |
| `node-request/` | `client.js` | A/B/C/D | **Node.js TLS 客户端**：curl-cffi-node → impers 优先级检测（已移除 CycleTLS） |
| `python-request/` | `client.py` | A/B/C/D | **Python TLS 客户端**：curl_cffi → cffi_curl → cyCronet 优先级检测（cyCronet 不传 impersonate） |
| `vm-sandbox/` | `install-env.js` | B/D | **补环境安装**：JS 层 NativeProtect 保护（快速验证版） |
| `wasm-loader/` | `loader.js` | C | **WASM 加载器**：buffer 实例化 + importObject 注入 |

## 模板间引用关系

```
final.js（最终入口）
  ├── 引用 vm-sandbox/install-env.js → 复制为 result/src/env/install-env.js
  ├── 引用 node-request/client.js   → 复制为 result/src/request/client.js
  └── 签名逻辑由用户参考 cases/ 自行实现 → result/src/signer.js
```

Python 交付同理：Python 版 `final.py` 入口骨架示例见 `references/quality/delivery-templates.md`，引用 `python-request/client.py`（含 CookieJar）；若需补环境，通过 `execjs` 桥接 `vm-sandbox/install-env.js`。

## 使用方式

1. Phase 4 编码时，根据解法模式选择对应模板
2. 复制模板文件到 `case/result/`
3. 按站点签名逻辑填充 `signer.js`（参考 `cases/` 中的还原代码模板）
4. `vm-sandbox/install-env.js` 是"快速验证用"简化版，正式交付时需完善原型链和构造函数（参考 `references/env/env-native-protection.md` 保护策略）
