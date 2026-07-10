# 逆向经验库（Cases）

本目录存放已验证的逆向分析经验案例,供 CHECK-2 速查阶段自动检索。

## 案例索引

| 案例文件 | 技术特征 | 难度 | 核心方案 | 反爬类型 |
|---------|---------|------|---------|---------|
| [jsvmp-xhr-interceptor-env-emulation.md](jsvmp-xhr-interceptor-env-emulation.md) | JSVMP + XHR 拦截器 + 多层 SDK + jsdom | ★★★★★ | jsdom 沙箱 + 58 项环境补丁 | 行为型 |
| [jsvmp-dual-sign-xhr-intercept-cacheOpts-jsdom-firefox.md](jsvmp-dual-sign-xhr-intercept-cacheOpts-jsdom-firefox.md) | JSVMP 双签名 + XHR/fetch 双通道 + cacheOpts | ★★★★★ | jsdom + Firefox native code 伪装 + got-scraping TLS | 行为型 |
| [jsvmp-ruishu6-cookie-412-sdenv.md](jsvmp-ruishu6-cookie-412-sdenv.md) | RS6 + Cookie 生成 + 412 挑战 + sdenv | ★★★★★ | sdenv(魔改 jsdom + C++ Addon) | 签名型 |
| [universal-vmp-source-instrumentation.md](universal-vmp-source-instrumentation.md) | 通用 VMP 骨架(RS/Akamai/webmssdk) | ★★★★ | 源码级插桩 + hot_keys 学习 | 混合 |
| [l1-simple-sign-md5.md](l1-simple-sign-md5.md) | 标准 md5 排序参数签名 + 盐 + 时间戳；缺/错 sign → 403 | ★ | 纯 Node 复现(md5)，零浏览器路径 | 无(标准签名) |
| [l2-vm-sandbox-custom-algo.md](l2-vm-sandbox-custom-algo.md) | 自定义 MD5/混淆算法，vm 沙箱执行（骨架模板） | ★★★ | vm.createContext + 最小 sandbox | 无/轻检测 |

## 使用方式

```
CHECK-2 速查:
1. 目标 URL 域名 / 搜索到的 JS 变量名 / 请求参数名 → 查上表
2. 命中 → 读取对应案例文件,踩坑记录内化为约束
3. 未命中 → 走标准 Phase 0-5,结束时沉淀新案例
```

## 指纹匹配快速参考

| 技术特征关键词 | 匹配案例 | 置信度 |
|--------------|---------|--------|
| `webmssdk` / `byted_acrawler` / `_SdkGlueInit` | jsvmp-xhr-interceptor-env-emulation | 高 |
| `cacheOpts` + `X-Gnarly` | jsvmp-dual-sign-xhr-intercept-cacheOpts-jsdom-firefox | 高(国际版双签名) |
| `a_bogus` + 180-192 字符 + 无 cacheOpts | jsvmp-xhr-interceptor-env-emulation | 高(国内版单签名) |
| `sdenv` / `FSSBBIl1UgzbN7N` / 412 挑战 | jsvmp-ruishu6-cookie-412-sdenv | 高(RS) |
| `while-switch` + 200KB+ 文件 | universal-vmp-source-instrumentation | 中(通用骨架) |
| `sign` 32 位 hex + 伴随 `t` 时间戳 + 缺/错返回 403 `invalid sign` | l1-simple-sign-md5 | 高(标准签名 L1) |
| 自定义 MD5(非标准输出) / 混淆算法不可静态还原 / eval 包裹算法 | l2-vm-sandbox-custom-algo | 中(自定义算法 L2) |

## 新增案例

1. 复制 `_template.md` 为新文件,以技术特征命名
2. 按模板格式填写各段(技术指纹/加密方案/踩坑记录/可验证事实清单)
3. 更新本文件的案例索引表和指纹匹配表
4. 在"可验证事实清单"段列 5-15 条最小可验证事实
