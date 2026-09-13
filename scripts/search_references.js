#!/usr/bin/env node
'use strict';

// references 知识点检索（SKILL.md §12 路由配套，2.3.116）。
// 动机：SKILL.md / references 中大量「见反模式 N / 规则 N」指针，跟进一次的代价是整读
// common-pitfalls.md（~40KB）/ experience-rules.md（~30KB）全文件——为单个编号读 2 万+
// tokens 与 SKILL.md §12「按需最小集合」相悖。本工具把指针变成按号提取：
// --id 从小节标题定位（标题行到下一个同级标题），--keyword 跨文件关键词兜底。
// 检索范围：references/**/*.md + scripts/README.md + assets/ast-patterns/README.md。

const fs = require('fs');
const path = require('path');
const { recordQueries } = require('./lib/query_log');

const SKILL_ROOT = path.resolve(__dirname, '..');
const DIR_SCOPES = ['references'];
const FILE_SCOPES = [path.join('scripts', 'README.md'), path.join('assets', 'ast-patterns', 'README.md')];
// 同号标题命中多个文件时的权威归属（反模式 → common-pitfalls，规则 → experience-rules）
const CANONICAL_HINTS = [
  { kind: '反模式', pattern: /common-pitfalls\.md$/ },
  { kind: '规则', pattern: /experience-rules\.md$/ },
];
const MAX_SECTION_LINES = 140;
const MAX_KEYWORD_FILES = 8;
const MAX_SAMPLES_PER_FILE = 3;
const SAMPLE_LINE_MAX = 200;

function parseArgs(argv) {
  const args = { ids: [], keywords: [], dirFilter: '', caseDir: '', json: false, markdown: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const nextVal = () => {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('-')) throw new Error(`参数 ${arg} 缺少值`);
      return argv[++i];
    };
    if (arg === '--id') args.ids.push(nextVal());
    else if (arg === '--keyword' || arg === '-k') args.keywords.push(nextVal());
    else if (arg === '--dir') args.dirFilter = nextVal();
    else if (arg === '--case-dir') args.caseDir = nextVal();
    else if (arg === '--json') args.json = true;
    else if (arg === '--markdown') args.markdown = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('-')) throw new Error(`未知参数：${arg}`);
    else args.ids.push(arg);
  }
  if (!args.ids.length && !args.keywords.length && !args.help) {
    throw new Error('至少提供一个 --id 或 --keyword（位置参数等同 --id）');
  }
  return args;
}

function usage() {
  return `用法：
  node scripts/search_references.js --id "反模式 28" --markdown
  node scripts/search_references.js --id "规则 34"
  node scripts/search_references.js --keyword 对齐探针 [--dir references/env]
  node scripts/search_references.js 反模式28 --json

选项：
  --id <编号>        按编号提取小节：支持「反模式 N」「规则 N」「经验规则 N」，空格可省略；
                     从小节标题提取到下一个同级标题（上限 ${MAX_SECTION_LINES} 行）
  -k, --keyword <词> 跨文件关键词检索（可重复，文件级 AND），按命中数排序
      --dir <子串>   限定文件路径子串（如 references/env、workflow）
      --case-dir <project-root>  提供时把本次查询记入 <case>/tmp/query-log.jsonl（重复检索 WARN）
      --json         输出 JSON
      --markdown     Markdown 输出
  -h, --help         显示帮助

说明：检索范围 references/**/*.md、scripts/README.md、assets/ast-patterns/README.md；
同号标题命中多个文件时按权威归属取正文（反模式 → common-pitfalls，规则 → experience-rules），其余列出一行指针。
引用知识点时用本工具按号提取，不要为单个编号整读 common-pitfalls.md / experience-rules.md 全文。`;
}

function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

function collectScopeFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full);
    }
  };
  for (const rel of DIR_SCOPES) walk(path.join(SKILL_ROOT, rel));
  for (const rel of FILE_SCOPES) {
    const full = path.join(SKILL_ROOT, rel);
    if (fs.existsSync(full)) files.push(full);
  }
  return files.sort();
}

// 解析 --id 入参 → { kind, number }；不合法抛错
function parseId(raw) {
  const m = String(raw).trim().match(/^(反模式|经验规则|规则)\s*0*(\d+)$/);
  if (!m) throw new Error(`无法解析编号「${raw}」：应为 反模式 N / 规则 N / 经验规则 N`);
  return { kind: m[1] === '经验规则' ? '规则' : m[1], number: Number(m[2]) };
}

// 单个小节标题的匹配规则：反模式 → 「## 反模式 N：…」；
// 规则 → 「## 规则 N…」任意文件，或 experience-rules.md 的全局编号「### 34. …」
function matchIdHeading(line, relFile, kind, number) {
  const heading = line.match(/^(#{2,6})\s+(.*)$/);
  if (!heading) return false;
  const title = heading[2];
  if (kind === '反模式') {
    const m = title.match(/^反模式\s*0*(\d+)(?!\d)/);
    return !!m && Number(m[1]) === number;
  }
  const explicit = title.match(/^(?:经验)?规则\s*0*(\d+)(?!\d)/);
  if (explicit) return Number(explicit[1]) === number;
  if (toPosix(relFile).endsWith('experience-rules.md')) {
    const numbered = title.match(/^0*(\d+)[．.、]\s/);
    return !!numbered && Number(numbered[1]) === number;
  }
  return false;
}

// 提取小节：从标题行到下一个同级或更高级标题（上限 MAX_SECTION_LINES 行）
function extractSection(lines, startIndex, level) {
  const out = [];
  for (let i = startIndex; i < lines.length && out.length < MAX_SECTION_LINES; i++) {
    const line = lines[i];
    if (i > startIndex) {
      const next = line.match(/^(#{1,6})\s/);
      if (next && next[1].length <= level) break;
    }
    out.push(line);
  }
  while (out.length && (!out[out.length - 1].trim() || out[out.length - 1].trim() === '---')) out.pop();
  return { text: out.join('\n'), truncated: out.length >= MAX_SECTION_LINES };
}

// 全 scope 收集某 kind 编号的标题命中：[{ file, line, level }]
function findIdHeadings(scope, kind, number) {
  const hits = [];
  for (const item of scope) {
    const lines = item.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (matchIdHeading(lines[i], item.rel, kind, number)) {
        hits.push({ file: item.rel, line: i + 1, level: lines[i].match(/^#+/)[0].length, lines });
      }
    }
  }
  return hits;
}

function availableNumbers(scope, kind) {
  const byNumber = new Map();
  for (const item of scope) {
    for (const line of item.text.split(/\r?\n/)) {
      const heading = line.match(/^#{2,6}\s+(.*)$/);
      if (!heading) continue;
      let m = null;
      if (kind === '反模式') m = heading[1].match(/^反模式\s*0*(\d+)(?!\d)/);
      else m = heading[1].match(/^(?:经验)?规则\s*0*(\d+)(?!\d)/) || (toPosix(item.rel).endsWith('experience-rules.md') ? heading[1].match(/^0*(\d+)[．.、]\s/) : null);
      if (m) {
        const n = Number(m[1]);
        if (!byNumber.has(n)) byNumber.set(n, []);
        byNumber.get(n).push(item.rel);
      }
    }
  }
  return byNumber;
}

function lookupId(scope, rawId) {
  const { kind, number } = parseId(rawId);
  const label = `${kind} ${number}`;
  const hits = findIdHeadings(scope, kind, number);
  if (!hits.length) {
    const available = [...availableNumbers(scope, kind).keys()].sort((a, b) => a - b);
    return { label, found: false, message: `未找到 ${label}（现有编号：${available.join(', ')}）。编号可能已被合并或删除，用 --keyword <关键词> 兜底检索。` };
  }
  const hint = CANONICAL_HINTS.find((c) => c.kind === kind);
  const canonical = hint ? hits.find((h) => hint.pattern.test(h.file)) : null;
  const primary = canonical || hits[0];
  const section = extractSection(primary.lines, primary.line - 1, primary.level);
  const others = hits.filter((h) => h !== primary).map((h) => `${h.file}:L${h.line}`);
  return { label, found: true, file: primary.file, line: primary.line, text: section.text, truncated: section.truncated, others };
}

function searchKeywords(scope, keywords) {
  const hits = [];
  for (const item of scope) {
    const lines = item.text.split(/\r?\n/);
    const perKeyword = keywords.map((kw) => lines.filter((l) => l.toLowerCase().includes(String(kw).toLowerCase())).length);
    if (perKeyword.some((count) => count === 0)) continue;
    const total = perKeyword.reduce((a, b) => a + b, 0);
    const samples = [];
    for (let i = 0; i < lines.length && samples.length < MAX_SAMPLES_PER_FILE; i++) {
      if (keywords.some((kw) => lines[i].toLowerCase().includes(String(kw).toLowerCase()))) {
        const text = lines[i].trim();
        samples.push({ line: i + 1, text: text.length > SAMPLE_LINE_MAX ? `${text.slice(0, SAMPLE_LINE_MAX - 1)}…` : text });
      }
    }
    hits.push({ file: item.rel, count: total, samples });
  }
  hits.sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
  return hits.slice(0, MAX_KEYWORD_FILES);
}

function renderIdMarkdown(result) {
  if (!result.found) return `## ${result.label} · 未找到\n\n${result.message}`;
  const head = `## ${result.label} · ${result.file}:L${result.line}${result.truncated ? '（超长截断，完整内容读原文件）' : ''}`;
  const others = result.others.length ? `\n> 其他同号标题：${result.others.join('；')}` : '';
  return `${head}\n\n${result.text}\n${others}\n> 用法提示：引用知识点用本工具按号提取即可，不要为单个编号整读 common-pitfalls.md / experience-rules.md 全文（SKILL.md §12）。`;
}

function renderIdPlain(result) {
  if (!result.found) return `${result.label} · 未找到\n${result.message}`;
  const head = `${result.label} · ${result.file}:L${result.line}${result.truncated ? '（超长截断，完整内容读原文件）' : ''}`;
  const others = result.others.length ? `\n其他同号标题：${result.others.join('；')}` : '';
  return `${head}\n\n${result.text}\n${others}\n用法提示：引用知识点用本工具按号提取即可，不要为单个编号整读 common-pitfalls.md / experience-rules.md 全文（SKILL.md §12）。`;
}

function renderKeywordsMarkdown(keyword, hits) {
  if (!hits.length) return `## 关键词「${keyword}」· 未命中\n\n未在检索范围内命中该关键词（可拆词或换近义词重试）。`;
  const lines = [`## 关键词「${keyword}」· 命中 ${hits.length} 个文件：`, ''];
  for (const hit of hits) {
    lines.push(`- ${hit.file} × ${hit.count}`);
    for (const sample of hit.samples) lines.push(`  - L${sample.line}: ${sample.text}`);
  }
  return lines.join('\n');
}

function renderKeywordsPlain(keyword, hits) {
  if (!hits.length) return `关键词「${keyword}」· 未命中：未在检索范围内命中该关键词（可拆词或换近义词重试）。`;
  const lines = [`关键词「${keyword}」命中 ${hits.length} 个文件：`];
  for (const hit of hits) {
    lines.push(`${hit.file} × ${hit.count}`);
    for (const sample of hit.samples) lines.push(`  L${sample.line}: ${sample.text}`);
  }
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  // query-log 目标须落在 case/ 目录下（inferQueryLogPath 向上找名为 case 的目录）；
  // --case-dir 按 SKILL.md 惯例传 <project-root>，兼容直接传 <project-root>/case
  const caseBase = args.caseDir ? path.basename(path.resolve(args.caseDir)).toLowerCase() : '';
  const lookupTarget = args.caseDir
    ? path.join(args.caseDir, caseBase === 'case' ? 'tmp' : path.join('case', 'tmp'), 'references-lookup')
    : '';
  const scope = collectScopeFiles()
    .filter((full) => !args.dirFilter || toPosix(full).includes(args.dirFilter))
    .map((full) => ({ full, rel: toPosix(path.relative(SKILL_ROOT, full)), text: fs.readFileSync(full, 'utf8') }));
  if (!scope.length) throw new Error('检索范围为空：未找到 references/ 或 README 文件');

  const warnings = lookupTarget
    ? recordQueries('search_references', [
        ...args.ids.map((id) => ({ target: lookupTarget, query: id })),
        ...args.keywords.map((kw) => ({ target: lookupTarget, query: kw })),
      ])
    : [];
  for (const warning of warnings) process.stdout.write(`${warning}\n`);

  const idResults = args.ids.map((id) => lookupId(scope, id));
  const keywordResults = args.keywords.map((kw) => ({ keyword: kw, hits: searchKeywords(scope, [kw]) }));
  const anyMiss = idResults.some((r) => !r.found) || keywordResults.some((r) => !r.hits.length);
  if (!anyMiss) process.exitCode = 0; else process.exitCode = 1;

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ids: idResults, keywords: keywordResults, warnings }, null, 2)}\n`);
    return;
  }
  const parts = [];
  for (const result of idResults) parts.push(args.markdown ? renderIdMarkdown(result) : renderIdPlain(result));
  for (const result of keywordResults) parts.push(args.markdown ? renderKeywordsMarkdown(result.keyword, result.hits) : renderKeywordsPlain(result.keyword, result.hits));
  process.stdout.write(`${parts.join('\n\n')}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`错误：${process.env.DEBUG_STACK ? error.stack : error.message}\n`);
  process.exitCode = 2;
}
