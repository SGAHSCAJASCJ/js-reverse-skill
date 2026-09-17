#!/usr/bin/env node
'use strict';

// 触发精度评估：衡量 description（技能选择阶段唯一的判据）能否既召回、又不误召。
// description 是「发现层」的全部信息，改它必须有可量化的回归依据而不是凭感觉
// （skill 规范：Keep discovery cheap and precise / Avoid catchalls that attract unrelated requests）。
//
// 用法：
//   node scripts/eval_trigger.js --list                  # 输出用例请求，交给模型逐条判定
//   node scripts/eval_trigger.js --template              # 输出 decisions.json 骨架
//   node scripts/eval_trigger.js --score decisions.json  # 打分：precision/recall/F1 + 逐条误判
//   node scripts/eval_trigger.js --self-test
//
// 判定协议：把每条 request 连同 SKILL.md frontmatter 的 description 交给模型，只问
// 「该请求是否应由本 skill 接管」。不得提供 SKILL.md 正文、用例标注或答案。
// decisions.json 形态：[{ "id": "T01", "decision": "trigger" | "no-trigger" }]

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.dirname(__dirname);
const DEFAULT_CASES = path.join(ROOT, 'tests', 'trigger-eval', 'cases.json');
const PRECISION_FLOOR = 0.95;
const RECALL_FLOOR = 0.95;

function parseArgs(argv) {
  const args = {
    cases: DEFAULT_CASES, score: null, list: false, template: false,
    markdown: true, json: false, selfTest: false, help: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const nextVal = () => {
      i += 1;
      if (i >= argv.length) throw new Error('参数 ' + a + ' 缺少值');
      return argv[i];
    };
    if (a === '--cases') args.cases = nextVal();
    else if (a === '--score') args.score = nextVal();
    else if (a === '--list') args.list = true;
    else if (a === '--template') args.template = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--json') { args.json = true; args.markdown = false; }
    else if (a === '--self-test') args.selfTest = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error('未知参数：' + a);
  }
  return args;
}

function usage() {
  return [
    '用法：',
    '  node scripts/eval_trigger.js --list',
    '  node scripts/eval_trigger.js --template',
    '  node scripts/eval_trigger.js --score <decisions.json> [--json]',
    '  node scripts/eval_trigger.js --self-test',
    '',
    '用例文件：tests/trigger-eval/cases.json（每条含 id / request / expect / why）。',
    '打分门槛：precision >= ' + PRECISION_FLOOR + ' 且 recall >= ' + RECALL_FLOOR + '，否则退出码 1。',
    '语料是小样本精选集：单条漏召/误召都视为必须处置的信号，门槛据此收紧。',
    '说明：触发精度无法离线判定，必须由模型对 request 逐条判定后回填 decisions.json。',
  ].join('\n');
}

function loadCases(file) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (!doc || !Array.isArray(doc.cases)) throw new Error('用例文件缺少 cases 数组');
  const seen = new Set();
  for (const c of doc.cases) {
    if (!c.id || !c.request) throw new Error('用例缺少 id 或 request：' + JSON.stringify(c).slice(0, 120));
    if (c.expect !== 'trigger' && c.expect !== 'no-trigger') {
      throw new Error(c.id + '：expect 必须是 trigger 或 no-trigger');
    }
    if (!c.why) throw new Error(c.id + '：缺少 why（没有标注理由的用例无法复核）');
    if (seen.has(c.id)) throw new Error('用例 id 重复：' + c.id);
    seen.add(c.id);
  }
  return doc.cases;
}

function scoreCases(cases, decisions) {
  const byId = new Map();
  for (const d of decisions) byId.set(d.id, d.decision);
  const rows = [];
  for (const c of cases) {
    const got = byId.has(c.id) ? byId.get(c.id) : '(缺失)';
    if (got === '(缺失)' || (got !== 'trigger' && got !== 'no-trigger')) {
      rows.push({ id: c.id, expect: c.expect, got, ok: false, reason: got === '(缺失)' ? 'decisions.json 未覆盖该用例' : 'decision 取值非法' });
      continue;
    }
    const ok = got === c.expect;
    rows.push({
      id: c.id, expect: c.expect, got, ok,
      reason: ok ? '' : (c.expect === 'trigger'
        ? '漏召（false negative）：该请求应由本 skill 接管——检查 description 是否漏了该能力/场景词'
        : '误召（false positive）：该请求不应触发——检查 description 的边界声明；标注理由：' + c.why),
    });
  }
  const tp = rows.filter((r) => r.ok && r.expect === 'trigger').length;
  const tn = rows.filter((r) => r.ok && r.expect === 'no-trigger').length;
  const fp = rows.filter((r) => !r.ok && r.expect === 'no-trigger').length;
  const fn = rows.filter((r) => !r.ok && r.expect === 'trigger').length;
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    rows, tp, tn, fp, fn, precision, recall, f1,
    accuracy: rows.length ? (tp + tn) / rows.length : 0,
    pass: precision >= PRECISION_FLOOR && recall >= RECALL_FLOOR,
  };
}

function pct(x) {
  return (x * 100).toFixed(1) + '%';
}

function renderScore(result) {
  const lines = [];
  lines.push('# 触发精度评估');
  lines.push('');
  lines.push('- 用例：' + result.rows.length + '（TP ' + result.tp + ' / TN ' + result.tn + ' / FP ' + result.fp + ' / FN ' + result.fn + '）');
  lines.push('- precision：' + pct(result.precision) + '（门槛 ' + pct(PRECISION_FLOOR) + '）');
  lines.push('- recall：' + pct(result.recall) + '（门槛 ' + pct(RECALL_FLOOR) + '）');
  lines.push('- F1：' + pct(result.f1) + '，accuracy：' + pct(result.accuracy));
  lines.push('');
  const misses = result.rows.filter((r) => !r.ok);
  if (misses.length === 0) {
    lines.push('[通过] 全部用例判定一致');
  } else {
    for (const m of misses) lines.push('- [未通过] ' + m.id + ' 期望 ' + m.expect + '、实得 ' + m.got + '：' + m.reason);
  }
  lines.push('');
  lines.push(result.pass ? '[通过] 通过' : '[未通过] 低于门槛：触发精度不足会让 skill 静默失效或干扰无关请求');
  return lines.join('\n');
}

function selfTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trigger-eval-'));
  try {
    const cases = [
      { id: 'T01', request: 'a', expect: 'trigger', why: '标注理由A' },
      { id: 'T02', request: 'b', expect: 'no-trigger', why: '标注理由B' },
      { id: 'T03', request: 'c', expect: 'trigger', why: '标注理由C' },
      { id: 'T04', request: 'd', expect: 'no-trigger', why: '标注理由D' },
    ];
    const perfect = scoreCases(cases, [
      { id: 'T01', decision: 'trigger' }, { id: 'T02', decision: 'no-trigger' },
      { id: 'T03', decision: 'trigger' }, { id: 'T04', decision: 'no-trigger' },
    ]);
    assert.strictEqual(perfect.pass, true, '全对必须通过');
    assert.strictEqual(perfect.precision, 1);
    assert.strictEqual(perfect.recall, 1);

    const withMiss = scoreCases(cases, [
      { id: 'T01', decision: 'trigger' }, { id: 'T02', decision: 'no-trigger' },
      { id: 'T03', decision: 'no-trigger' }, { id: 'T04', decision: 'trigger' },
    ]);
    assert.strictEqual(withMiss.fn, 1, '漏召必须计入 fn');
    assert.strictEqual(withMiss.fp, 1, '误召必须计入 fp');
    assert.strictEqual(withMiss.pass, false, '一半误判不得通过');
    assert(withMiss.rows.find((r) => r.id === 'T04').reason.includes('标注理由D'), '误召理由必须回带该用例的标注 why');

    const missing = scoreCases(cases, [{ id: 'T01', decision: 'trigger' }]);
    assert.strictEqual(missing.rows.filter((r) => !r.ok).length, 3, '未覆盖用例必须计为未通过');

    const file = path.join(dir, 'cases.json');
    fs.writeFileSync(file, JSON.stringify({ cases }), 'utf8');
    assert.strictEqual(loadCases(file).length, 4, '合规用例文件应加载 4 条');
    fs.writeFileSync(file, JSON.stringify({ cases: [{ id: 'X', request: 'a', expect: 'maybe', why: 'w' }] }), 'utf8');
    assert.throws(() => loadCases(file), /trigger 或 no-trigger/, '非法 expect 必须被拒绝');
    fs.writeFileSync(file, JSON.stringify({ cases: [{ id: 'X', request: 'a', expect: 'trigger' }] }), 'utf8');
    assert.throws(() => loadCases(file), /why/, '缺 why 必须被拒绝');
    return 'self-test passed';
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    console.error(err.message);
    console.error(usage());
    return 2;
  }
  if (args.help) {
    console.log(usage());
    return 0;
  }
  if (args.selfTest) {
    console.log(selfTest());
    return 0;
  }
  let cases;
  try {
    cases = loadCases(args.cases);
  } catch (err) {
    console.error('用例文件不可用：' + err.message);
    return 2;
  }
  if (args.list) {
    for (const c of cases) console.log(c.id + '\t' + c.request);
    console.log('');
    console.log('# 共 ' + cases.length + ' 条。判定协议见 --help；把结果写成 [{ "id": "...", "decision": "trigger|no-trigger" }] 后用 --score 回填。');
    return 0;
  }
  if (args.template) {
    console.log(JSON.stringify({ decisions: cases.map((c) => ({ id: c.id, decision: '' })) }, null, 2));
    return 0;
  }
  if (args.score) {
    let decisions;
    try {
      const doc = JSON.parse(fs.readFileSync(args.score, 'utf8').replace(/^\uFEFF/, ''));
      decisions = Array.isArray(doc) ? doc : doc.decisions;
      if (!Array.isArray(decisions)) throw new Error('缺少 decisions 数组');
    } catch (err) {
      console.error('decisions 文件不可用：' + err.message);
      return 2;
    }
    const result = scoreCases(cases, decisions);
    if (args.json) {
      console.log(JSON.stringify({
        precision: result.precision, recall: result.recall, f1: result.f1, accuracy: result.accuracy,
        tp: result.tp, tn: result.tn, fp: result.fp, fn: result.fn, pass: result.pass,
        misses: result.rows.filter((r) => !r.ok),
      }, null, 2));
    } else {
      console.log(renderScore(result));
    }
    return result.pass ? 0 : 1;
  }
  console.error('必须指定 --list / --template / --score / --self-test 之一');
  console.error(usage());
  return 2;
}

process.exit(main());