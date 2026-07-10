# 最终规范项目交付

本文件只在 fixtures 多样本通过，并准备最终交付时读取。这里的"一体化"不是指整个项目只能有一个文件，而是指：**最终项目只有一个可直接执行的入口文件；执行该入口后，自动完成生成加密参数、发送 Node.js / Python 模拟请求，并输出请求成功/失败结果**。

> 适用范围：所有级别的 case 交付前必读。

## 硬性要求

1. **最终项目必须干净**
   最终交付目录不得包含临时文件、测试文件、trace、HAR、hook、指纹采样 Hook、截图、缓存、浏览器 Profile、失败响应、调试日志或空目录。可以保留必要源码模块、配置模板和依赖清单。

2. **最终项目必须是规范目录结构**
   允许把补环境、目标入口、请求客户端、配置、工具函数拆成模块，避免把所有代码硬塞进一个超大文件。

3. **最终项目只能有一个执行入口**
   默认入口为 `case/result/final.js`。如果用户明确选择 Python 请求客户端，可以使用 `case/result/final.py`。

   入口执行后必须完成：安装/加载补环境 → 调用目标 JS 入口生成加密参数 → 组装请求 → 用 Node.js / Python TLS 指纹兼容 Session 客户端发送模拟请求 → 输出验证结果 → 销毁 session。

   其他文件只能作为被入口调用的模块，不得再提供 `server.js`、`bridge.py`、`runner.js`、`sign.js`、`test.js` 等第二入口或测试入口。

4. **最终项目不能有自动化操作代码**
   最终项目内任何源码文件不得出现：ruyiPage / RuyiTrace 启动或控制代码、Playwright / Puppeteer / Selenium / browser-use、CDP / WebDriver / Marionette 控制代码、`page.goto`、`browser.launch`、`chromium.launch`、`FirefoxPage`、`page.capture` 等自动化取证调用。

   ruyiPage / RuyiTrace / Playwright / Puppeteer 只能用于前置取证、环境日志采集和指纹采样；不能进入最终项目代码。Canvas / WebGL / WebGPU / Audio / 字体 / DOM 几何指纹应由 Node.js 终端 API 值回放实现，不得通过自动化浏览器实时生成。

5. **最终加密参数必须由补环境生成，禁止复用样本值**
   cURL / HAR / fixture 中已有的 sign、token、a_bogus、h5st、x-s、x-t、mtgsig、w_rid 等值只能作为浏览器真实样本和 expected fixture。最终项目不得把这些值硬编码到 `final.js`、请求模块、配置文件或 signer 模块中。入口必须调用补环境后的目标 JS 入口 / signer 重新生成加密参数，再组装请求。

6. **最终请求必须由前置阶段已确认的 Node.js 或 Python Session 客户端完成**
   最终验证流程必须是：创建 session → 生成加密参数 → 用已确认的 TLS 指纹兼容客户端在同一 session 中组装请求 → 发起少量授权验证请求 → 销毁 session。

   可选客户端为 Node.js CycleTLS / impers / curl-cffi-node，或 Python curl_cffi / cffi_curl / cyCronet；如果用户选择"不发真实请求"，入口只输出本地 sign / 参数和组装后的脱敏请求信息。即使只有一个目标 API，也必须使用 Session 模式，动态资源刷新、Cookie / challenge 生成链路和目标 API 复用同一 Cookie jar / Header / UA / Client Hints / TLS 指纹 / fingerprint baseline。

7. **项目完成后默认生成最终总结**
   最终交付前必须生成 `case/result/最终项目总结.md`。总结必须读取 `final-summary.md` 的模板要求，使用 `scripts/write_markdown_utf8.js` 以 UTF-8 写入。

8. **最终代码必须简洁可读并带中文注释**
   最终补环境代码必须按职责拆分模块，禁止压缩、堆叠、过长函数、过深嵌套和无意义命名。所有手写源码必须有文件头中文职责注释，关键 WebAPI、getter / setter、NativeProtect 保护、fallback、指纹回放和加密入口必须有中文说明。中文注释必须 UTF-8 正常显示，不得包含问号、连续问号或乱码。

9. **动态 HTML / JS 必须运行时刷新**
   如果 `case/notes/resource-manifest.json` 中存在 `dynamic: true` 且 `requiredForFinal: true` 的资源，最终项目必须包含运行时刷新模块。`final.js` / `final.py` 执行顺序必须是：创建请求 session → 刷新当前 HTML / JS / challenge / seed → 更新同一 session 的 Cookie / Storage / runtime context → 加载当前资源运行 signer → 使用已确认 TLS 指纹兼容客户端在同一 session 发送最终请求 → 销毁 session。

10. **验证码接口的轨迹入口必须可替换**
    如果目标是验证码 / 风控验证接口，并且加密参数依赖点击、鼠标移动、拖动或触摸事件，最终项目允许保留旧轨迹 fixture 作为参数生成输入，但必须暴露可替换入口，例如 `motionTrack`、`eventFixture`、`verifyContext`、`clickPoints` 或 `dragPath`，并使用 UTF-8 中文注释说明"当前旧轨迹只用于补环境生成加密参数，不保证最终验证通过"。

11. **必须交付前检查**
    交付前运行：

    ```bash
    node scripts/write_markdown_utf8.js --input case/tmp/最终项目总结草稿.md --out case/result/最终项目总结.md --require-chinese-name --markdown
    node scripts/check_final_artifact.js --case-dir case --markdown
    node scripts/clean_case.js --case-dir case --dry-run --json
    ```

    若检查失败，先修复和清理，再交付。

## 推荐 Node.js 最终目录

目录结构详见 `references/quality/code-style.md` 的"按职责拆模块"段。补充要求：

- `final.js` 是唯一可以直接运行的入口。
- `package.json` 的 `scripts.start` 只能指向 `node final.js`。
- `src/` 中模块不能直接启动浏览器、启动服务或发起额外批量请求。
- 不交付 `test/`、`tests/`、`__tests__/`、`tmp/`、`logs/`、`hooks/`、`screenshots/`、`ruyi-trace/`、`browser-profile/`。

## 推荐 Python 最终目录

仅当用户明确选择 Python 请求客户端时使用：

```text
case/result/
├── final.py                 # 唯一执行入口：python final.py
├── 最终项目总结.md           # 项目完成后默认生成的 UTF-8 中文命名最终总结
├── requirements.txt         # 可选，仅列运行依赖
├── config.example.json      # 可选，脱敏配置模板
└── src/
    ├── request_client.py    # curl_cffi / cffi_curl / cyCronet，或用户确认不发真实请求
    ├── signer.py            # 参数生成入口；仅在逻辑已可靠迁移时使用
    └── normalize.py
```

如果目标 JS 必须在 Node.js 补环境里执行，优先交付 Node.js 项目，不要用 Python 调浏览器自动化来完成签名。

## `final.js` 入口职责

`final.js` 不需要包含全部源码，但必须串联完整流程：

```javascript
// 唯一入口：生成加密参数并使用已确认的请求客户端验证结果
'use strict';

let fetchRuntimeResources = null;
try {
  ({ fetchRuntimeResources } = require('./src/resources/fetch-runtime-resources'));
} catch (_) {
  // 无动态资源时可以不提供刷新模块；存在动态资源时必须提供并通过检查。
}

const { makeEncryptedParams } = require('./src/target/entry');
const { createRequestSession } = require('./src/request/client');

// 请求配置来自脱敏后的浏览器成功样本，敏感值由用户本地补充
const CONFIG = {
  api: 'https://example.com/api',
  method: 'GET',
  headers: {
    'user-agent': '<从样本脱敏迁移>',
  },
  query: {},
  body: null,
};

async function main() {
  const session = await createRequestSession(CONFIG);
  try {
    // 如果存在动态 HTML / JS / challenge，必须在同一 session 中刷新当前有效资源
    const runtimeResources = typeof fetchRuntimeResources === 'function'
      ? await fetchRuntimeResources(CONFIG, session)
      : null;

    // 加密参数必须由补环境后的目标入口动态生成，不复用 cURL 样本值
    const params = await makeEncryptedParams({ request: CONFIG, runtimeResources, session });

    const response = await session.request({ config: CONFIG, params });

    const ok = response.status >= 200 && response.status < 300;
    console.log(JSON.stringify({ ok, params, response }, null, 2));

    if (!ok) process.exitCode = 2;
  } finally {
    // 中文说明：无论请求成功还是失败，都销毁 session，清理 Cookie jar 和敏感运行态
    await session.close();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
```

## `final.py` 入口职责

```python
# 唯一入口：生成加密参数并使用已确认的请求客户端验证结果
from src.signer import make_encrypted_params
from src.request_client import create_request_session, close_request_session

# 请求配置来自脱敏后的浏览器成功样本，敏感值由用户本地补充
CONFIG = {
    "api": "https://example.com/api",
    "method": "GET",
    "headers": {
        "user-agent": "<从样本脱敏迁移>",
    },
    "query": {},
    "body": None,
}

def main():
    session = create_request_session(CONFIG)
    try:
        # 加密参数必须由补环境后的目标入口动态生成，不复用 cURL 样本值
        params = make_encrypted_params({"request": CONFIG, "session": session})

        response = session.request(CONFIG, params)

        ok = 200 <= response["status"] < 300
        print({"ok": ok, "params": params, "response": response})

        if not ok:
            raise SystemExit(2)
    finally:
        # 中文说明：请求结束后销毁 Session，清理 Cookie jar 和敏感运行态
        close_request_session(session)

if __name__ == "__main__":
    main()
```

不得在 `final.py` 或 `src/` 中引入 Selenium、Playwright、pyppeteer、ruyiPage 或其他浏览器自动化。

## 交付前检查清单

- [ ] `case/result/` 是规范项目目录，而不是临时文件堆。
- [ ] 只有一个执行入口：`final.js` 或 `final.py`。
- [ ] 执行入口可直接运行，并会生成加密参数、使用 Session 发送模拟请求、输出请求结果并销毁 session。
- [ ] 模块拆分合理，必要源码位于 `src/`。
- [ ] 补环境代码已运行 `check_code_quality.js`，中文注释 UTF-8 正常、无问号、无连续问号、无乱码。
- [ ] 项目内任何源码都不包含 ruyiPage / RuyiTrace / Playwright / Puppeteer / Selenium / CDP / WebDriver 自动化代码。
- [ ] 如涉及 Canvas / WebGL / WebGPU / Audio / 字体 / DOM 几何指纹，最终项目使用真实浏览器采样 fixture + 终端 API 值回放，不依赖 node-canvas / headless-gl / 自动化浏览器。
- [ ] 最终请求由前置阶段已确认的 Node.js / Python TLS 指纹兼容 Session 客户端发起，或用户明确选择不发真实请求；同一请求链复用 session，结束后销毁。
- [ ] fixtures 已通过；动态参数建议三组以上。
- [ ] 如存在动态 HTML / JS / challenge，已生成 `case/notes/resource-manifest.json`，并运行 `check_dynamic_resources.js --require-runtime-refresh` 通过。
- [ ] 动态快照未复制进 `result/`；最终入口会运行时刷新当前资源。
- [ ] Cookie、token、Authorization、localStorage 等敏感值已脱敏或仅由用户本地配置，不明文写入报告。
- [ ] 临时 trace、hook、日志、HAR、截图、Profile、缓存和测试文件已清理。
- [ ] 已运行 `check_code_quality.js`、`check_fingerprint_fixture.js`，已生成 UTF-8 `result/最终项目总结.md`，并运行 `check_final_artifact.js` 和 `clean_case.js --dry-run`，且已手动复核 NativeProtect 保护证据。

## 补环境真实性交付检查

交付前执行：

```bash
node scripts/check_fingerprint_fixture.js --case-dir case --require canvas,webgl,audio,dom --markdown
node scripts/check_final_artifact.js --case-dir case --markdown
```

要求最终环境代码体现：属性描述符、访问器、原型链、构造函数、函数 toString 保护、访问器 toString 保护、实例对象 toString 保护；创建函数、构造函数、getter、setter、`document.all`、原型链时从补环境初始化阶段就必须启用 `NativeProtect` 保护，用户明确豁免才允许降级并记录原因；涉及浏览器指纹时必须保留真实采样 fixture 并做终端 API 值回放；使用 Trace 时必须保留 `notes/trace-summary.md` 与 `notes/missing-env-priority.md` 证据摘要。
