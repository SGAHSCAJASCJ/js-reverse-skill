# Case：L2 vm 沙箱执行自定义算法（骨架模板）

> 难度：★★★（骨架模板）
> 还原方案：B vm 沙箱执行
> 实现语言：Node.js
> 最后验证日期：2026-07-09
> 平台类型：通用骨架（自定义 MD5 / 混淆算法 / 算法不可静态提取但 JS 可 vm 执行）

> **骨架案例**。本文是**方法论模板**，适用于：自定义 MD5/SHA 实现、混淆后算法不可静态还原、算法可提取但依赖少量环境属性（非 JSVMP）等 L2 场景。
>
> 使用方式：
> 1. 在 CHECK-2 指纹匹配时，若检测到"算法不可直接提取但 JS 可 vm 执行"特征，直接走本案例的流程
> 2. 完成具体站点逆向后，复制本文件重命名为 `l2-vm-<具体技术特征>.md`，按真实数据填充占位符

---

## 技术指纹（供 CHECK-2 自动匹配）

### JS 特征
- [ ] 算法函数存在但不可直接提取（自定义 MD5 变种 / 混淆后控制流打乱 / eval 包裹）
- [ ] 无 JSVMP 字节码虚拟机（区别于 L3）
- [ ] 无 200KB+ 大文件 + while-switch 解释器（区别于 L3）
- [ ] 算法依赖少量环境属性（如 navigator.userAgent / 时间戳），但不依赖完整浏览器环境

### 参数特征
- [ ] 签名参数长度异常（非标准 MD5 的 32 位 / 非 SHA256 的 64 位）
- [ ] 或长度标准但值与标准算法不一致（自定义变种）
- [ ] 签名输入含环境属性（UA / 时间 / 随机数）

### 请求特征
- [ ] 缺/错签名 → 服务端返回 403 或业务码异常
- [ ] 不返回 412 循环（区别于瑞数签名型）
- [ ] 不返回 200 空 body（区别于 JSVMP 行为型）

### 混淆类型
- [ ] OB 混淆但可 AST 反混淆后提取
- [ ] eval/Function 包裹（可 Hook 拦截源码）
- [ ] 无混淆但算法逻辑复杂（自定义哈希表 + 异或 + 位移）

---

## 加密方案

- **算法**：[填入：自定义 MD5 变种 / 混淆后的 AES / 自定义哈希]
- **密钥来源**：[填入：硬编码 / 动态计算 / 接口下发]
- **加密流程**：
  1. [填入：参数收集]
  2. [填入：拼接/排序]
  3. [填入：算法执行]
  4. [填入：编码输出]
- **签名公式**：[填入真实公式，若可提取部分逻辑]

---

## 方案方向

L2 vm 沙箱执行：提取算法 JS 代码 → 在 Node.js `vm` 模块中执行 → 喂入参数截出签名。

与 L1 的区别：算法不可直接用 `crypto` 复现（自定义实现），但 JS 代码本身可独立执行（不需要完整浏览器环境）。

与 L3 的区别：不需要 jsdom / 补环境 / 浏览器指纹，只需 `vm.createContext` 提供最小 sandbox。

## L2 标准流程（25 步详见 references/workflow/l2-mcp-survey.md）

### Phase 1-2：定位 + 提取

```
1. camoufox MCP 黄金路径定位签名函数
   network_capture → get_request_initiator → 直达签名函数
2. search_code(keyword="参数名") → 定位赋值点
3. scripts(action='save') → 保存算法 JS
4. 识别算法类型：
   - 标准 MD5/SHA/AES → 降级 L1 纯算
   - 自定义 MD5（chrsz 变化 / 轮函数修改）→ L2 vm 执行
   - 混淆不可静态还原 → L2 vm 执行
5. 提取算法函数 + 依赖的全局变量/常量
```

### Phase 3：vm 沙箱搭建

```javascript
const vm = require('vm');

// 最小 sandbox：只提供算法依赖的属性
const sandbox = {
    // 算法依赖的环境属性（按 trace/hook 确认）
    navigator: { userAgent: '<UA>' },
    Date: { now: () => <固定时间戳> },  // 调试时用固定值
    Math: Math,
    parseInt: parseInt,
    String: String,
    Array: Array,
    JSON: JSON,
    console: { log: () => {} },  // 静默
};

// 如果算法用了 CryptoJS，需要提供
sandbox.CryptoJS = require('crypto-js');

vm.createContext(sandbox);

// 加载算法 JS
const algorithmCode = require('fs').readFileSync('./config/sign_algorithm.js', 'utf8');
vm.runInContext(algorithmCode, sandbox);

// 调用签名函数
function generateSign(params) {
    return vm.runInContext(`signFunction(${JSON.stringify(params)})`, sandbox);
}
```

### Phase 4：验证

```
1. 用浏览器样本的相同输入调用 generateSign
2. 对比输出是否一致
3. 不一致 → 检查 sandbox 缺失的依赖（hook_function trace 确认）
4. 一致 → ≥5 次请求验证稳定性
```

## 踩坑记录

| # | 坑 | 现象 | 解决方法 |
|---|---|------|---------|
| 1 | sandbox 缺失依赖 | vm 执行报 `xxx is not defined` | 用 hook_function trace 确认算法读取的全局变量，逐项补到 sandbox |
| 2 | 自定义 MD5 误当标准 MD5 | 签名长度 32 位但值不对 | 同一输入对比标准 MD5，不一致则为自定义实现 |
| 3 | 算法依赖 Date.now() | 每次签名不同，无法对比 | 调试时用固定时间戳，验证通过后改回 Date.now() |
| 4 | CryptoJS 版本差异 | vm 中 CryptoJS 输出与浏览器不一致 | 确认浏览器用的 CryptoJS 版本（3.1.2 / 4.0.0），npm 安装对应版本 |
| 5 | 算法含 setTimeout 异步 | vm 同步执行拿不到结果 | 改用 Promise + vm 微任务，或重构为同步 |

## 与 L1/L3 的边界判断

```
算法提取后能否用标准 crypto 库复现？
  ├─ 能 → L1 纯算还原（走 l1-purecalc.md）
  └─ 不能
      │
      ├─ 算法 JS 能否在最小 sandbox 中执行（不需要 document/window/navigator.* 指纹）？
      │   ├─ 能 → L2 vm 沙箱（本案例）
      │   └─ 不能（需要完整浏览器环境 / JSVMP）→ L3 补环境
      │
      └─ 是否是 JSVMP（200KB+ / while-switch / 字节码数组）？
          ├─ 是 → L3 路径 D
          └─ 否 → L2 路径 B
```

## 可验证事实清单（经验资产）

1. [签名参数名] 长度 [N] 字符
2. 算法类型：[自定义 MD5 / 混淆 AES / 自定义哈希]
3. 算法依赖的环境属性：[UA / 时间戳 / 随机数]
4. vm sandbox 需要提供的全局变量：[CryptoJS / Math / parseInt]
5. 签名输入：[参数排序规则 / 拼接格式]
6. ≥5 次请求签名稳定通过

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/workflow/l2-mcp-survey.md` | L2 camoufox MCP 标准流程（25 步） |
| `references/workflow/decision-tree.md` | L1/L2/L3 题型判定边界 |
| `references/workflow/l1-purecalc.md` | L1 降级判断（能否纯算复现） |
| `references/env/runtime-frameworks.md` | L2→L3 升级判断（何时需 jsdom/sdenv） |
| `templates/vm-sandbox/` | vm 沙箱交付模板 |
