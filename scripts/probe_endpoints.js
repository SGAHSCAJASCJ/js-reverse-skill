#!/usr/bin/env node
'use strict';

// 多接口 × 多 token 变体对照探针：验证服务端是否真的校验某个请求头/参数。
// 解决 baidu-finance 实测痛点：用户追问「其他接口是否验证这个头」时，此前手写两版探针
// （共 6.7K 字符 + 4 次 EDIT 迭代）才得到四态对照；本脚本把「有效/垃圾/无/篡改末位」
// 对照固化为通用命令（2.3.125）。只发只读 GET（无 curl_cffi 依赖，Node 原生 https）。
//
// 用法示例：
//   node scripts/probe_endpoints.js \
//     --session "BAIDUID=..;_fdp=.." \
//     --header acs-token \
//     --tokens '{"valid":"<沙箱生成的合法token>"}' \
//     --endpoints '["https://finance.pae.baidu.com/vapi/v1/hotrank?pn=0&rn=10"]' \
//     --markdown
//
// 变体语义：valid=传入合法值；garbage=垃圾值；tamper=合法值末位翻转（可显式覆盖）；
// none=不携带该头。每接口变体顺序随机 + 请求间隔默认 900ms，降低频率风控混淆。
// 限制：TLS 指纹被拒的站点（纯 https 直连即 403）本工具不适用，改用 curl_cffi 客户端。

const fs = require('fs');
const http = require('http');
const https = require('https');

function parseArgs(argv) {
  const args = {
    endpoints: [],
    tokens: null,
    session: '',
    sessionFile: '',
    header: '',
    delayMs: 900,
    json: false,
    markdown: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const nextVal = () => {
      if (i + 1 >= argv.length) throw new Error(`参数 ${a} 缺少值`);
      return argv[++i];
    };
    if (a === '--endpoints') {
      try {
        const v = JSON.parse(nextVal());
        if (!Array.isArray(v)) throw new Error('endpoints 应为数组');
        args.endpoints.push(...v.map(String));
      } catch (err) {
        throw new Error(`--endpoints 应为 JSON 数组：${err.message}`);
      }
    }
    else if (a === '--tokens') {
      try {
        const v = JSON.parse(nextVal());
        args.tokens = (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
      } catch { /* 非法 JSON 由下方校验兜底 */ }
      if (!args.tokens) throw new Error('--tokens 应为 JSON 对象，至少含 valid');
    }
    else if (a === '--session') args.session = nextVal();
    else if (a === '--session-file') args.sessionFile = nextVal();
    else if (a === '--header') args.header = nextVal();
    else if (a === '--delay-ms') args.delayMs = Number(nextVal()) || 900;
    else if (a === '--json') args.json = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (!args.endpoints.length) throw new Error('必须提供 --endpoints <JSON 数组>');
  if (!args.tokens || !('valid' in args.tokens)) throw new Error('--tokens 必须包含 valid 值');
  if (!args.header) throw new Error('必须提供 --header <头名>（如 acs-token）');
  if (!args.session && !args.sessionFile) throw new Error('必须提供 --session <cookies> 或 --session-file <路径>');
  if (!args.json && !args.markdown) args.markdown = true;
  return args;
}

function usage() {
  return `用法：
  node scripts/probe_endpoints.js --session "<cookies>" --header <头名> --tokens '{"valid":"..."}' --endpoints '["<url>", ...]' [--markdown|--json]

选项：
      --endpoints <JSON>  目标接口完整 URL 数组
      --tokens <JSON>     变体值对象：valid（必填合法值）/ garbage / tamper（默认取 valid 末位翻转）
      --session <cookies> Cookie 字符串（如 BAIDUID=x;_fdp=y）
      --session-file <p>  从文件读取 cookies
      --header <头名>     被探测的请求头名（如 acs-token）
      --delay-ms <ms>     请求间隔（默认 900，防频率风控）
      --json / --markdown 输出格式（默认 markdown）

变体：valid=合法值；garbage=垃圾值；tamper=篡改末位；none=不携带该头。
每接口变体顺序随机 + 请求间隔，降低频率风控与顺序效应混淆。
输出仅给状态矩阵与「疑似校验」启发式标记，结论由分析者结合响应体判定。`;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function getCookies(args) {
  if (args.sessionFile && fs.existsSync(args.sessionFile)) {
    const raw = fs.readFileSync(args.sessionFile, 'utf8').trim();
    try { return JSON.parse(raw).cookies || raw; } catch { return raw; }
  }
  return args.session;
}

function variantsOf(tokens) {
  const valid = String(tokens.valid);
  const tamper = 'tamper' in tokens ? String(tokens.tamper)
    : valid ? `${valid.slice(0, -1)}${valid.endsWith('0') ? '1' : String.fromCharCode(valid.charCodeAt(valid.length - 1) ^ 1)}` : 'x';
  return [
    { name: 'valid', value: valid },
    { name: 'garbage', value: 'garbage' in tokens ? String(tokens.garbage) : 'INVALID_PROBE_TOKEN_1' },
    { name: 'tamper', value: tamper },
    { name: 'none', value: null },
  ];
}

function requestOnce(url, headers, timeoutMs) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const client = u.protocol === 'http:' ? http : https;
    const req = client.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        ...headers,
      },
      timeout: timeoutMs,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; if (body.length > 2048) { body = body.slice(0, 2048); req.destroy(); } });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '超时' }); });
    req.on('error', (err) => resolve({ status: 0, body: err.message }));
    req.end();
  });
}

async function run(args) {
  const cookies = getCookies(args);
  const baseline = { Cookie: cookies };
  const variants = variantsOf(args.tokens);
  // 每接口随机化变体顺序，避免「先有效后垃圾」的固定次序被站点顺序风控误伤
  const results = [];
  for (const url of args.endpoints) {
    const order = [...variants].sort(() => Math.random() - 0.5);
    const rows = [];
    for (const v of order) {
      const headers = { ...baseline };
      if (v.value !== null) headers[args.header] = v.value;
      const res = await requestOnce(url, headers, 15000);
      rows.push({ variant: v.name, status: res.status, bodyBrief: String(res.body).slice(0, 120).replace(/[\r\n]+/g, ' ') });
      await sleep(args.delayMs);
    }
    const byName = Object.fromEntries(rows.map((r) => [r.variant, r]));
    const valid = byName.valid && byName.valid.status;
    const others = ['garbage', 'tamper', 'none'].map((n) => byName[n] && byName[n].status);
    // 启发式：valid 200 且任一其它变体非 200 → 疑似服务端校验；全部 200 → 疑似装饰头
    const likelyValidated = valid === 200 && others.some((s) => s !== undefined && s !== 200);
    const likelyDecoration = [valid, ...others].every((s) => s === 200);
    results.push({ url, rows, likelyValidated, likelyDecoration, judged: likelyValidated || likelyDecoration });
  }
  return { results };
}

function renderMarkdown(out, headerName, delayMs) {
  const lines = ['# 多接口 × 多变体对照探针结果', '', `- 探测头：${headerName}`, `- 请求间隔：${delayMs}ms`, ''];
  for (const r of out.results) {
    const label = r.likelyValidated ? '**疑似服务端校验**' : r.likelyDecoration ? '疑似装饰头（未校验）' : '无法判定（需看响应体）';
    lines.push(`## ${r.url}`, '', `判定：${label}`, '');
    lines.push('| 变体 | 状态码 | 响应体摘要 |', '|---|---|---|');
    for (const row of r.rows) {
      const statusStr = row.status === 0 ? `❌${row.bodyBrief}` : String(row.status);
      lines.push(`| ${row.variant} | ${statusStr} | ${row.bodyBrief} |`);
    }
    lines.push('');
  }
  lines.push('> 说明：猜测仅由状态码启发；「有效=200 / 任一对照非 200（如 403 hit risk）」才够格判校验，最终结论须结合其余接口响应体与双对照纪律。篡改末位用于排除验证负载签名内容层，顺序随机用于排除频率风控时序效应。');
  return lines.join('\n') + '\n';
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { process.stdout.write(`${usage()}\n`); return; }
  const out = await run(args);
  if (args.json) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  else process.stdout.write(renderMarkdown(out, args.header, args.delayMs));
}

main().catch((err) => {
  process.stderr.write(`错误：${err.message}\n`);
  process.exitCode = 2;
});