#!/usr/bin/env node
'use strict';

/**
 * 厂商/平台名越界检查（配合 SKILL.md §3 「厂商知识分级 T1/T2」）。
 *
 * 规则：具体厂商名与目标平台名只允许出现在
 *   - cases/（案例）
 *   - references/captcha/（验证码厂商知识库）
 *   - 识别参考：crypto/algorithm-families.md、network/ip-risk-control.md、
 *     env/env-iframe.md、rendering/font-anti-crawl.md、rendering/image-content-reversal.md
 *     （后三者自带「知识分级」声明）
 *   - deobfuscation/obfuscation-identify.md（表内是 assets 真实子目录名）
 * 其余通用文档（含 SKILL.md 叙述与「相关案例表」）不得出现，只能写「见 <cases/xxx.md>」指针。
 *
 * 说明：纯 SDK/组件名（webmssdk、byted_acrawler、TCaptcha、smcp 等）属于识别信号，
 * 不在本词表内；本表只查「目标平台名」与「风控/验证码厂商品牌名」。
 */

const fs = require('fs');
const path = require('path');

const WORDS = [
  // 目标平台
  '抖音', 'TikTok', '快手', '小红书', '拼多多', '淘宝', '京东', '美团', '携程',
  '猿人学', '知乎', '微博', '物美', 'nmpa', '9air',
  // 风控 / 验证码 / 大厂品牌
  '瑞数', '同盾', 'TrustDecision', '极验', '易盾', '顶象', '数美',
  '腾讯', '百度', '阿里云', '阿里', '字节跳动', '字节系',
  'Cloudflare', 'Akamai', 'DataDome', 'Kasada', 'Turnstile', 'Imperva', 'Radware', 'Netacea',
];

const EXEMPT_PREFIX = [
  'cases/',
  'references/captcha/',
  'references/crypto/algorithm-families.md',
  'references/network/ip-risk-control.md',
  'references/env/env-iframe.md',
  'references/rendering/font-anti-crawl.md',
  'references/rendering/image-content-reversal.md',
  'references/deobfuscation/obfuscation-identify.md',
];

function parseArgs(argv) {
  const args = { projectDir: '.', markdown: false, json: false, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-dir') args.projectDir = argv[++i];
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--json') args.json = true;
    else if (a === '--self-test') args.selfTest = true;
  }
  if (!args.json && !args.markdown) args.markdown = true;
  return args;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function isExempt(rel) { return EXEMPT_PREFIX.some(p => rel.startsWith(p) || rel === p); }

function scan(root) {
  const files = [...walk(path.join(root, 'references'))];
  const skill = path.join(root, 'SKILL.md');
  if (fs.existsSync(skill)) files.push(skill);
  const hits = [];
  for (const f of files) {
    const rel = path.relative(root, f).replace(/\\/g, '/');
    if (isExempt(rel)) continue;
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const w of WORDS) {
        // 词边界：ASCII 词要求前后非标识符字符；CJK 直接子串匹配
        const ok = /^[\x00-\x7F]+$/.test(w)
          ? new RegExp(`(?<![\\w])${w}(?![\\w])`).test(line)
          : line.includes(w);
        if (ok) hits.push({ file: rel, line: i + 1, word: w });
      }
    });
  }
  return hits;
}

function selfTest() {
  const assert = require('assert');
  const os = require('os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-'));
  fs.mkdirSync(path.join(root, 'references/env'), { recursive: true });
  fs.writeFileSync(path.join(root, 'SKILL.md'), '目标站点 example\n');
  fs.writeFileSync(path.join(root, 'references/env/a.md'), '实战案例：抖音 a_bogus\n');
  fs.writeFileSync(path.join(root, 'references/captcha'), '');
  const hits = scan(root);
  assert(hits.some(h => h.word === '抖音'), '应命中抖音');
  fs.writeFileSync(path.join(root, 'references/env/a.md'), '实战案例：某短视频平台 a_bogus\n');
  assert(scan(root).length === 0, '通用表述应零命中');
  fs.rmSync(root, { recursive: true, force: true });
  console.log('check_vendor_leakage.js self-test: PASS');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return selfTest();
  const root = path.resolve(args.projectDir);
  const hits = scan(root);
  if (args.json) { console.log(JSON.stringify({ hits }, null, 2)); process.exit(hits.length ? 1 : 0); }
  const lines = ['# 厂商/平台名越界检查', '', `- 命中：${hits.length}`];
  if (hits.length) {
    lines.push('', '| 文件 | 行 | 词 |', '|---|---|---|');
    for (const h of hits) lines.push(`| ${h.file} | ${h.line} | ${h.word} |`);
    lines.push('', '[失败] 通用文档出现具体厂商名/目标平台名，请改为通用表述或「见 <cases/xxx.md>」指针。');
  } else {
    lines.push('', '[通过] 通过');
  }
  console.log(lines.join('\n'));
  process.exit(hits.length ? 1 : 0);
}

main();
