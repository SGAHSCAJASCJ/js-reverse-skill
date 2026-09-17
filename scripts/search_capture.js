#!/usr/bin/env node
'use strict';

// 抓包检索工具：从 ruyipage 取证产物 capture.json 中检索请求。
// 解决 baidu-finance 实测痛点：用户追问「哪些接口携带 X 头、是否被服务端校验」时，
// 此前用手工 PowerShell/JSON 解析，还会踩 header 大小写/pair 拼接漏匹配的坑（2.3.125）。
// 用法示例：
//   node scripts/search_capture.js --capture <case>/forensic/capture.json --by-header acs-token
//   node scripts/search_capture.js --capture ... --by-header acs-token --status 403
//   node scripts/search_capture.js --capture ... --by-url hotrank
//   node scripts/search_capture.js --capture ... --set-cookie
//
// 注意：本工具只回答「哪些接口携带头/状态码分布」，不能证明服务端是否真校验；判定
// 校验与否仍需对同一会话做 有效/垃圾/篡改 对照（scripts/probe_endpoints.js）。

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { capture: '', byHeader: '', byUrl: '', setCookie: false, status: '', showHits: false, json: false, markdown: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--capture' || a === '-c') args.capture = nextVal('');
    else if (a === '--by-header') args.byHeader = nextVal('');
    else if (a === '--by-url') args.byUrl = nextVal('');
    else if (a === '--set-cookie') args.setCookie = true;
    else if (a === '--status') args.status = nextVal('');
    else if (a === '--show-hits') args.showHits = true;
    else if (a === '--json') args.json = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (!args.capture) throw new Error('必须提供 --capture <capture.json 路径>');
  if (!args.byHeader && !args.byUrl && !args.setCookie) throw new Error('至少指定 --by-header / --by-url / --set-cookie 之一');
  if (!args.json && !args.markdown) args.markdown = true;
  return args;
}

function usage() {
  return `用法：
  node scripts/search_capture.js --capture <case>/forensic/capture.json --by-header <头名>
  node scripts/search_capture.js --capture ... --by-header acs-token --status 403
  node scripts/search_capture.js --capture ... --by-url <url关键词>
  node scripts/search_capture.js --capture ... --set-cookie

选项：
  -c, --capture <路径>   ruyipage 取证产物 capture.json（数组：url/method/request_headers/response_status/response_headers）
      --by-header <名>   检索携带该请求头的接口（大小写不敏感），输出状态码分布与接口清单
      --by-url <关键词>  按 url 子串检索请求，标注是否携带指定头
      --set-cookie       列出服务端下发 Set-Cookie 的接口与 cookie 名
      --status <码>      与 --by-header 组合时只显示该状态码的接口
      --show-hits        展示 header 命中的实际值（默认脱敏，只显示长度/前段）
      --json / --markdown 输出格式（默认 markdown）
  -h, --help             显示帮助

说明：只回答「哪些接口携带某头、状态码如何」，不能证明服务端是否真校验；
判定校验需要 probe_endpoints.js 的有效/垃圾/篡改多态对照。`;
}

function maskHeaderValue(value) {
  const s = String(value == null ? '' : value);
  if (!s) return '(空)';
  if (/token|cookie|sign|auth|secret|password|key/i.test(s)) {
    return `${s.slice(0, 24)}…[${s.length} 字符]`;
  }
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

function headerOf(rec, name) {
  const h = rec && rec.request_headers;
  if (!h || typeof h !== 'object') return null;
  const key = Object.keys(h).find((k) => k.toLowerCase() === String(name).toLowerCase());
  return key ? { key, value: h[key] } : null;
}

function analyze(args) {
  const records = JSON.parse(fs.readFileSync(args.capture, 'utf8'));
  if (!Array.isArray(records)) throw new Error('capture.json 应为数组（每条含 url/request_headers/response_status）');

  const result = { capture: args.capture, total: records.length, matched: [] };

  if (args.byHeader) {
    const name = args.byHeader;
    const linkMatches = records.map((r, idx) => ({ rec: r, idx, hit: headerOf(r, name) })).filter((x) => x.hit);
    let rows = linkMatches;
    if (args.status) rows = rows.filter((x) => String(x.rec.response_status) === args.status);
    result.mode = `by-header:${name}` + (args.status ? ` status=${args.status}` : '');
    result.matched = rows.map((x) => ({
      idx: x.idx,
      url: x.rec.url,
      method: x.rec.method,
      status: x.rec.response_status,
      headerValue: args.showHits ? maskHeaderValue(x.hit.value) : null,
    }));
  } else if (args.byUrl) {
    const kw = String(args.byUrl).toLowerCase();
    result.mode = `by-url:${args.byUrl}`;
    result.matched = records
      .map((r, idx) => ({ rec: r, idx }))
      .filter((x) => String(x.rec.url || '').toLowerCase().includes(kw))
      .map((x) => ({
        idx: x.idx,
        url: x.rec.url,
        method: x.rec.method,
        status: x.rec.response_status,
        headerValue: args.showHits ? null : null,
      }));
  } else if (args.setCookie) {
    result.mode = 'set-cookie';
    for (const [idx, r] of records.entries()) {
      const sc = r.response_headers && r.response_headers['set-cookie'];
      const list = Array.isArray(sc) ? sc : sc ? [sc] : [];
      if (!list.length) continue;
      const names = list.map((c) => String(c).split('=')[0].trim()).filter(Boolean);
      result.matched.push({ idx, url: r.url, method: r.method, status: r.response_status, cookieNames: names });
    }
  }
  return result;
}

function statusCounts(matched) {
  const counts = {};
  for (const m of matched) {
    const s = String(m.status == null ? '?' : m.status);
    counts[s] = (counts[s] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
function domainCount(matched) {
  const counts = {};
  for (const m of matched) {
    const host = (() => { try { return new URL(m.url || '').host; } catch { return m.url; } })();
    counts[host] = (counts[host] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function renderMarkdown(result) {
  const lines = ['# 抓包检索结果', '', `- 抓包文件：${result.capture}`, `- 总请求数：${result.total}`, `- 检索模式：${result.mode}`, ''];
  if (!result.matched.length) {
    lines.push('未匹配到任何请求。');
    return lines.join('\n') + '\n';
  }
  lines.push(`## 命中 ${result.matched.length} 个请求`);
  lines.push('');
  lines.push('### 状态码分布');
  for (const [s, c] of statusCounts(result.matched)) lines.push(`- ${s}：${c} 个`);
  lines.push('');
  lines.push('### 域名分布');
  for (const [h, c] of domainCount(result.matched)) lines.push(`- ${h}：${c} 个`);
  lines.push('');
  if (result.mode.startsWith('by-header')) {
    lines.push('> 携带该头只说明客户端发送了它，不能证明服务端校验；判定校验需用 probe_endpoints.js 做 有效/垃圾/篡改 对照。');
    lines.push('');
  }
  lines.push('## 接口清单');
  for (const m of result.matched.slice(0, 200)) {
    const extra = m.headerValue ? `（${m.headerValue}）` : '';
    lines.push(`- [${m.idx}] ${m.method || '?'} ${m.status || '?'} ${m.url || ''}${extra}`);
  }
  if (result.matched.length > 200) lines.push(`...还有 ${result.matched.length - 200} 个未展示`);
  return lines.join('\n') + '\n';
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { process.stdout.write(`${usage()}\n`); return; }
  const result = analyze(args);
  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(renderMarkdown(result));
  if (!result.matched.length) process.exitCode = 1;
}

try {
  main();
} catch (err) {
  process.stderr.write(`错误：${err.message}\n`);
  process.exitCode = 2;
}