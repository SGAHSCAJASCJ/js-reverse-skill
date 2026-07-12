/**
 * final.js 入口模板（Node.js 版）
 *
 * 硬性要求（来自 references/quality/delivery-templates.md）：
 *   1. 必须使用 createRequestSession + try-finally close
 *   2. 不得使用普通 fetch / axios 发送最终业务请求
 *   3. 动态资源必须运行时刷新，不硬编码动态参数
 *   4. signer 与 request 分离
 *   5. Session 模式：同一 session 复用 Cookie / TLS 上下文
 *   6. 仅用于授权范围内的少量最终验证请求
 *   7. 【默认强制】默认向真实 API 发请求验证（≥5 次交叉验证），仅当用户明确说"只输出参数"时
 *      才用 --sign-only 跳过 HTTP 请求。不得以"签名生成了"作为交付完成的判定标准。
 *
 * 并发注意：本模板为单次签名设计。signer 通常持有 vm context / WASM 实例 / Cookie 状态，
 * 非无状态。高并发场景需调用方自行池化 signer 实例（多个独立 vm context），
 * 不要跨线程/进程共享同一 signer。详见 references/workflow/common-pitfalls.md 反模式 7。
 *
 * 使用方式：
 *   node result/final.js                          # 默认：发真实 API 请求，验证 1 次
 *   node result/final.js --verify 5               # 发真实 API 请求，交叉验证 5 次
 *   node result/final.js --sign-only              # 仅输出签名，不发真实请求（需用户明确指定）
 *   node result/final.js --cookie "name=value"    # 注入用户 cookie
 */

'use strict';

const path = require('path');

// ============================================================
// 模块引用（最终项目结构 result/src/...，从 templates/ 复制或自行实现）
// ============================================================
// 补环境模块:从 templates/vm-sandbox/install-env.js 复制到 result/src/env/install-env.js
const { installEnv } = require('./src/env/install-env');
// 请求客户端:从 templates/node-request/client.js 复制到 result/src/request/client.js
const { createRequestSession, CookieJar } = require('./src/request/client');
// 签名生成:用户自行实现(每个站点签名逻辑不同),参考 cases/ 中同类案例
/**
 * 生成签名参数
 * @param {Object} params - 请求参数（buildParams() 的返回值）
 * @param {Object} env - installEnv() 的返回值，结构: { global, nativeProtect, source, navigator, document, location, storage, performance, crypto }
 * @returns {string} 签名值（用于 URL query 或 header）
 * @example generateSign({timestamp:'123', nonce:'abc'}, env) → "a1b2c3..."
 */
const { generateSign } = require('./src/signer');
// 动态资源刷新:用户自行实现(刷新 home/init 等预热请求拿 cookie/seed),参考 references/network/dynamic-resource.md
// 未实现时使用空实现（不阻塞主流程），用户在 case 中替换为真实刷新逻辑
/**
 * 刷新运行时动态资源（home 页/init 接口拿 cookie/seed/challenge）
 * @param {Object} session - createRequestSession() 的返回值，有 .request(method, url, opts) 方法
 * @param {Object} jar - CookieJar 实例，有 .cookies(Map) / .toString() / .merge(setCookieHeader) 方法
 * @param {Object} urls - { homeUrl: string, initUrl: string }
 * @returns {Promise<Object>} runtimeCtx - 运行时上下文（当前实现未使用返回值，可返回空对象）
 */
let fetchRuntimeResources;
try {
  // 从 templates/final-entry/ 复制后路径为 result/src/resources/fetch-runtime-resources.js
  // 用户未实现该模块时使用空实现
  fetchRuntimeResources = require('./src/resources/fetch-runtime-resources').fetchRuntimeResources;
} catch (e) {
  fetchRuntimeResources = async (session, jar, urls) => {
    console.warn('[warn] fetch-runtime-resources.js 未实现，使用空实现（动态资源未刷新）');
    console.warn(`       预期路径: result/src/resources/fetch-runtime-resources.js`);
    console.warn(`       参考: references/network/dynamic-resource.md`);
    return {};
  };
}
// 指纹 fixture:用户从浏览器采集真实值写入,参考 references/fingerprint/fingerprint-baseline-consistency.md
const FIXTURES = require('./src/env/fixtures/index.js');

// ============================================================
// 常量配置（硬编码，不依赖 req.txt 等已有请求文件）
// ============================================================
const CONFIG = {
  // 目标 API（通过硬编码常量和函数构建基础 URL）
  TARGET_URL: 'https://example.com/api/search',
  HOME_URL: 'https://example.com/',
  INIT_URL: 'https://example.com/api/init',

  // UA（固定为 Chrome 135，与签名用 UA 一致）
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',

  // TLS 客户端配置
  IMPERSONATE: 'chrome135',

  // 指纹 fixture（已在上方声明为 FIXTURES const）

  // 设备 Cookie（内置，用户 cookie 优先）
  DEVICE_COOKIE: process.env.DEVICE_COOKIE || '',
};

// ============================================================
// 命令行参数解析
// ============================================================
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    verify: 1,
    noRealRequest: false,
    userCookie: '',
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--verify' && args[i + 1]) {
      opts.verify = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--sign-only' || args[i] === '--no-real-request') {
      opts.noRealRequest = true;
    } else if (args[i] === '--cookie' && args[i + 1]) {
      opts.userCookie = args[i + 1];
      i++;
    }
  }
  return opts;
}

// ============================================================
// 主入口
// ============================================================
async function main() {
  const opts = parseArgs();

  console.log('=== JS 逆向 final.js 启动 ===');
  console.log(`目标 API: ${CONFIG.TARGET_URL}`);
  console.log(`UA: ${CONFIG.USER_AGENT}`);
  console.log(`TLS 客户端: ${CONFIG.IMPERSONATE}`);
  console.log(`验证次数: ${opts.verify}`);
  console.log(`发送真实请求: ${opts.noRealRequest ? '否（--sign-only）' : '是（默认）'}`);

  // ----- 1. 安装补环境 -----
  const env = installEnv({
    fixtures: FIXTURES,
    userAgent: CONFIG.USER_AGENT,
    cookie: mergeCookie(CONFIG.DEVICE_COOKIE, opts.userCookie),
  });
  console.log(`补环境来源: ${env.source}`);

  // ----- 2. 仅输出签名模式（需用户明确指定 --sign-only）-----
  if (opts.noRealRequest) {
    console.log('\n--- 仅输出签名（--sign-only，不发真实请求）---');
    for (let i = 0; i < opts.verify; i++) {
      const params = buildParams();
      const sign = generateSign(params, env);
      console.log(`[第 ${i + 1} 次] sign=${sign} params=${JSON.stringify(params)}`);
    }
    return;
  }

  // ----- 3. 创建请求 Session -----
  const session = await createRequestSession({
    impersonate: CONFIG.IMPERSONATE,
    userAgent: CONFIG.USER_AGENT,
  });
  const jar = new CookieJar();

  try {
    // ----- 4. 动态资源刷新 -----
    console.log('\n--- 刷新动态资源 ---');
    const runtimeCtx = await fetchRuntimeResources(session, jar, {
      homeUrl: CONFIG.HOME_URL,
      initUrl: CONFIG.INIT_URL,
    });
    console.log(`动态资源刷新完成: cookie 数 ${jar.cookies.size}`);

    // ----- 5. 交叉验证 -----
    console.log(`\n--- 交叉验证 ${opts.verify} 次 ---`);
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < opts.verify; i++) {
      try {
        const params = buildParams();
        const sign = generateSign(params, env);
        const url = buildTargetUrl(CONFIG.TARGET_URL, { ...params, sign });

        console.log(`\n[第 ${i + 1} 次请求]`);
        console.log(`  URL: ${url}`);
        console.log(`  sign: ${sign}`);
        console.log(`  cookie: ${jar.toString().slice(0, 80)}...`);

        const res = await session.request('GET', url, {
          headers: { Cookie: jar.toString() },
        });

        console.log(`  状态码: ${res.status}`);
        const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
        console.log(`  响应: ${body.slice(0, 200)}`);

        // 合并新 Cookie
        jar.merge(res.headers['set-cookie']);

        if (res.status === 200) {
          successCount++;
        } else {
          failCount++;
          console.log(`  [WARN] 状态码非 200`);
        }
      } catch (e) {
        failCount++;
        console.log(`  [FAIL] 异常: ${e.message}`);
      }

      // 间隔
      if (i < opts.verify - 1) {
        await sleep(1000 + Math.random() * 2000);
      }
    }

    console.log(`\n=== 验证结果 ===`);
    console.log(`成功: ${successCount} / ${opts.verify}`);
    console.log(`失败: ${failCount} / ${opts.verify}`);
  } finally {
    // ----- 6. 关闭 Session（硬性要求）-----
    if (session.close) {
      session.close();
      console.log('Session 已关闭');
    }
  }
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 构建请求参数（硬编码常量 + 动态时间戳）
 */
function buildParams() {
  return {
    timestamp: String(Date.now()),
    nonce: Math.random().toString(36).slice(2, 10),
    // 其他固定参数
    app_id: 'demo_app',
    platform: 'web',
  };
}

/**
 * 构建目标 URL（query 拼接）
 */
function buildTargetUrl(base, params) {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

/**
 * 合并 Cookie（用户 cookie 优先同名项）
 */
function mergeCookie(deviceCookie, userCookie) {
  if (!userCookie) return deviceCookie;
  if (!deviceCookie) return userCookie;

  const merged = new Map();
  // 设备 Cookie 先加入
  for (const pair of deviceCookie.split(';').map(s => s.trim()).filter(Boolean)) {
    const [k, v] = pair.split('=');
    if (k) merged.set(k.trim(), v?.trim());
  }
  // 用户 Cookie 覆盖同名项
  for (const pair of userCookie.split(';').map(s => s.trim()).filter(Boolean)) {
    const [k, v] = pair.split('=');
    if (k) merged.set(k.trim(), v?.trim());
  }
  return Array.from(merged.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// 异常处理
// ============================================================
process.on('uncaughtException', (err) => {
  // 捕获 bundle.js 异步执行异常（如 JSVMP crash），不影响 signer 同步执行
  console.error(`[uncaughtException] ${err.message}`);
});

process.on('unhandledRejection', (reason) => {
  console.error(`[unhandledRejection] ${reason}`);
});

// ============================================================
// 启动
// ============================================================
main().catch(err => {
  console.error('主流程异常:', err);
  process.exit(1);
});
