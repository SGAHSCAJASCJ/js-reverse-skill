# L2 camoufox MCP 抓包模式

> **触发条件**：题型判断为 L2（算法不可直接提取，但 JS/WASM 可 vm 执行）时读

## 适用条件

- 算法不可直接提取（自定义 MD5 / 混淆无法静态还原）
- WASM 加密（加密逻辑在 WebAssembly，需加载 WASM 调用导出函数）
- 需要 MCP 多工具配合定位签名入口（hook_function / inject_hook_preset）
- JS 可在 Node.js vm 沙箱中执行（不需要完整浏览器环境）
- 不需要 C++ 层 trace

## camoufox-reverse-mcp 工具清单（35 工具）

### 基础浏览器（9 工具）
| 工具 | 用途 |
|---|---|
| `launch_browser` | 启动 camoufox 浏览器 |
| `navigate` | 导航到 URL |
| `click` | 点击元素 |
| `type_text` | 输入文本 |
| `screenshot` | 截图 |
| `snapshot` | 页面快照 |
| `wait_for` | 等待条件 |
| `page_info` | 页面信息 |
| `close` | 关闭浏览器 |

### JS 执行（1 工具）
| 工具 | 用途 |
|---|---|
| `evaluate_js` | 执行 JS 表达式（必须用 IIFE 包装 + 显式 return） |

### Cookie/Storage（4 工具）
| 工具 | 用途 |
|---|---|
| `cookies` | Cookie 读写 |
| `get_storage` | 读取 localStorage/sessionStorage |
| `export_state` | 导出浏览器状态 |
| `import_state` | 导入浏览器状态 |

### 网络分析（3 工具）
| 工具 | 用途 |
|---|---|
| `network_capture` | 启动/停止网络捕获 |
| `list_network_requests` | 列出捕获的请求 |
| `get_network_request` | 获取请求详情 |

### 请求拦截（2 工具）
| 工具 | 用途 |
|---|---|
| `intercept_request` | 拦截请求 |
| `stop_intercept` | 停止拦截 |

### 脚本分析（2 工具）
| 工具 | 用途 |
|---|---|
| `scripts` | 脚本列表/获取/保存 |
| `search_code` | 在已加载 JS 中搜索关键词 |

### Hook（4 工具）
| 工具 | 用途 |
|---|---|
| `hook_function` | Hook 指定函数 |
| `inject_hook_preset` | 注入预设 Hook（xhr/fetch/crypto/cookie/debugger_bypass） |
| `remove_hooks` | 移除 Hook |
| `get_console_logs` | 获取 console 日志 |

### JSVMP 插桩（3 工具）
| 工具 | 用途 |
|---|---|
| `hook_jsvmp_interpreter` | Hook JSVMP 解释器 |
| `instrumentation` | 源码级插桩（ast/regex） |
| `compare_env` | 环境对比 |

### 验证（1 工具）
| 工具 | 用途 |
|---|---|
| `verify_signer_offline` | 离线验证签名代码 |

### 环境管理（2 工具）
| 工具 | 用途 |
|---|---|
| `check_environment` | 检测 MCP/Camoufox 状态 |
| `reset_browser_state` | 重置浏览器状态 |

### Trace（3 工具，L3 用）
| 工具 | 用途 |
|---|---|
| `trace_property_access` | C++ 层属性访问追踪（需 camoufox-reverse 定制版） |
| `list_trace_files` | 列出 trace 文件 |
| `query_trace_file` | 查询 trace 文件 |

### 其他（1 工具）
| 工具 | 用途 |
|---|---|
| `get_request_initiator` | 获取请求发起栈（黄金路径核心工具） |

## L2 标准流程（25 步）

### Phase 0：环境搭建
```
1. check_environment → 确认 MCP/Camoufox 可用
2. launch_browser(headless=false, humanize=true)
3. navigate(url="目标URL")
4. 如需登录 → 用户手动登录 → cookies(action='set')
```

### Phase 1：网络侦察
```
5. network_capture(action='start')
6. 触发目标操作（click/type_text/evaluate_js）
7. list_network_requests → 找到目标接口
8. get_network_request(request_id=N) → 获取请求详情
9. get_request_initiator(request_id=N) → 定位签名函数（黄金路径）
```

### Phase 2：源码分析
```
10. search_code(keyword="参数名") → 搜索赋值点
11. search_code(keyword="encrypt|sign|md5|aes") → 搜索加密函数
12. scripts(action='save', url=..., save_path='./config/target.js') → 保存关键脚本
13. 识别混淆类型 → 需要时走 assets/ast-patterns/ AST 反混淆
```

### Phase 3：动态验证
```
14. inject_hook_preset(preset="xhr", persistent=true)
15. inject_hook_preset(preset="crypto", persistent=true)
16. reload() → 触发 Hook
17. 触发目标操作 → get_console_logs() 读取 Hook 输出
18. hook_function(function_path="签名函数", mode='trace', log_args=true, log_return=true, log_stack=true)
19. ≥3 次请求对比，确认变化因子
```

### Phase 4：算法还原
```
20. 提取加密函数到 config/encrypt.js
21. 用 Node.js crypto / Python hashlib 实现
22. 打印中间值，与浏览器样本逐一比对
23. verify_signer_offline(signer_code, samples=[...]) 离线验证
```

### Phase 5：交付
```
24. 运行 final.js/final.py，≥5 次请求验证
25. 整理 config/ + README.md
```

## 4 条最佳实践路径

### 黄金路径（最快定位签名函数）
```
network_capture(action='start') → 触发请求 → list_network_requests
→ get_request_initiator(request_id=N) → 直达签名函数
```

### 环境伪装路径（路径 D 入口，L2 发现需补环境时升级到 L3）
```
compare_env → 分批 evaluate_js 采集 → 与 Node 环境全量 diff
→ 按影响分级修复 → verify_signer_offline
```

### JSVMP 插桩路径
```
instrumentation(action='install', url_pattern=..., mode='ast')
→ instrumentation(action='reload')
→ instrumentation(action='log', type_filter='tap_get') → hot_keys
```

### Cookie 归因路径
```
network_capture(action='start', capture_body=true)
→ inject_hook_preset(preset="cookie", persistent=true)
→ 触发场景 → analyze_cookie_sources(name_filter="目标cookie名")
```

## camoufox 启动硬约束

- 默认有头：`headless=False`
- 默认拟人：`humanize=True`
- 代理场景按授权启用 `geoip=True`
- 不固定窗口、字体、WebGL、locale 等指纹（除非已有真实样本或用户明确要求）
- 点击、输入、滚动使用 Camoufox/Playwright 原生输入路径，不用 `dispatchEvent`
