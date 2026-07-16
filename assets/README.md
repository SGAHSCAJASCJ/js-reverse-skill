# assets — 可复用资产

复制到 case 后按需调整的可执行资源。与 references（知识文档）、templates（交付骨架）、cases（经验库）的关系：

| 目录 | 性质 | 使用方式 |
|---|---|---|
| `ast-patterns/` | AST 反混淆工具链 | 按需加载，检测命中后运行流水线脚本 |
| `env-patch-snippets/` | 补环境代码片段 | 可被 templates 直接 require |
| `fixture-templates/` | fixture 模板 | 复制到 case 对应目录后按采样填充 |

## 目录结构

```
assets/
├── README.md                              ← 本文件
├── ast-patterns/                          ← AST 反混淆（8 站点规则 + 13 流水线脚本，以 STEP_LIBRARY 为准）
│   ├── README.md
│   ├── patterns.md
│   ├── scripts/
│   └── ...
├── env-patch-snippets/                    ← 补环境代码片段
│   └── native-protect.js                  ← NativeProtect 类（补环境基础设施）
└── fixture-templates/                     ← fixture 模板
    ├── constructor-errors.fixture.json    ← 构造函数行为采样模板
    └── resource-manifest.json             ← 动态资源清单模板
```

## 使用

### native-protect.js

补环境基础设施，覆盖多通道 toString + DataCloneError 保护。详见 `references/env/env-native-protection.md`（外部依赖，不在 assets/ 内）。

> **已内联进交付模板**：`templates/vm-sandbox/native-protect.js` 是同一份文件的副本。复制 `vm-sandbox/` 到 `result/src/env/` 后，`vm-context.js` 优先 `require('./native-protect.js')`，**交付物不再依赖 skill 仓库的 `assets/`**，可整体搬走到任意位置。

```javascript
// 在交付物中（result/src/env/ 内）
const NativeProtect = require('./native-protect.js');
const np = NativeProtect.getInstance();
np.setNativeFunc(myFunc, 'myFunc');
```

技能开发期也可直接引用仓库内副本：

```javascript
const NativeProtect = require('./assets/env-patch-snippets/native-protect.js');
const np = NativeProtect.getInstance();
np.setNativeFunc(myFunc, 'myFunc');
```

### constructor-errors.fixture.json

构造函数行为采样模板。复制到 `case/fixtures/constructor-errors.fixture.json` 后按真实浏览器采样填充。详见 `references/env/env-object-model.md`（外部依赖，不在 assets/ 内）的"构造函数行为采样"段。

### resource-manifest.json

动态资源清单模板。复制到 `case/notes/resource-manifest.json` 后按实际填充。`scripts/check_dynamic_resources.js`（外部依赖，不在 assets/ 内）依赖本文件结构。详见 `references/network/dynamic-resource.md`（外部依赖，不在 assets/ 内）。

### ast-patterns/

AST 反混淆子工具链，独立 README 见目录内。触发条件：OB/CFF/eval 混淆且需要 AST 反混淆后才能提取算法。
