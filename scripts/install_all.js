#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = findProjectRoot();
const TOOLS_DIR = path.join(PROJECT_ROOT, 'tools');
const RUYIPAGE_BROWSERS_DIR = path.join(TOOLS_DIR, 'ruyipage-browsers');
const RUYITRACE_DIR = path.join(TOOLS_DIR, 'RuyiTrace');

function findProjectRoot() {
  let cur = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(cur, 'SKILL.md'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return process.cwd();
}

function parseArgs(argv) {
  const args = { python: 'python', yes: false, json: false, markdown: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--python') args.python = argv[++i] || 'python';
    else if (a === '--yes' || a === '-y') args.yes = true;
    else if (a === '--json') args.json = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (!args.json && !args.markdown) args.markdown = true;
  return args;
}

function usage() {
  return `用法：
  node scripts/install_all.js --markdown
  node scripts/install_all.js --python python --yes --markdown

说明：检测并自动安装 ruyiPage（Python 包 + 定制 Firefox runtime）和 RuyiTrace（定制 trace 内核）。
默认安装目录：
  - ruyiPage runtime：<项目根>/tools/ruyipage-browsers/
  - RuyiTrace：       <项目根>/tools/RuyiTrace/
--yes：跳过用户确认，直接安装缺失项。`;
}

function run(cmd, args, timeout = 300000) {
  const ret = spawnSync(cmd, args, { encoding: 'utf8', timeout, windowsHide: true });
  return {
    ok: ret.status === 0,
    status: ret.status,
    stdout: (ret.stdout || '').trim(),
    stderr: (ret.stderr || '').trim(),
    error: ret.error ? ret.error.message : '',
  };
}

function exists(p) {
  try { return !!p && fs.existsSync(p); } catch { return false; }
}

function detectState(python) {
  const result = {
    node: { ok: false, version: '' },
    ruyipagePackage: false,
    ruyipageRuntime: false,
    ruyitrace: false,
    ruyitraceKernel: false,
  };

  const nodeMajor = parseInt(process.version.replace(/^v/, '').split('.')[0], 10) || 0;
  result.node = { ok: nodeMajor >= 18, version: process.version };

  const pkgCode = 'import ruyipage, json; print(json.dumps({"ok": True}, ensure_ascii=False))';
  const pkgRet = run(python, ['-c', pkgCode], 20000);
  result.ruyipagePackage = pkgRet.ok && /"ok":\s*true/i.test(pkgRet.stdout);

  if (result.ruyipagePackage) {
    const checkScript = path.join(__dirname, 'check_external_tools.js');
    const checkRet = run(process.execPath, [checkScript, '--python', python, '--ruyipage-install-dir', RUYIPAGE_BROWSERS_DIR, '--json'], 60000);
    try {
      const parsed = JSON.parse(checkRet.stdout.replace(/^\uFEFF/, ''));
      result.ruyipageRuntime = !!(parsed.ruyiPage && parsed.ruyiPage.managedRuntimeVerified);
    } catch { /* ignore */ }
  }

  const exeName = process.platform === 'win32' ? 'RuyiTrace.exe' : 'RuyiTrace';
  const ruyitraceExe = path.join(RUYITRACE_DIR, exeName);
  const ruyitraceFirefox = path.join(RUYITRACE_DIR, 'firefox', process.platform === 'win32' ? 'firefox.exe' : 'firefox');
  const ruyitraceMarker = path.join(RUYITRACE_DIR, 'firefox', 'RUYI_DOMTRACE.txt');
  result.ruyitraceKernel = exists(ruyitraceFirefox) && exists(ruyitraceMarker);
  result.ruyitrace = exists(ruyitraceExe) && result.ruyitraceKernel;

  return result;
}

function installRuyipagePackage(python) {
  const ret = run(python, ['-m', 'pip', 'install', 'ruyiPage', 'requests', '--upgrade'], 180000);
  return { ok: ret.ok, output: (ret.stdout || ret.stderr || ret.error || '').slice(0, 2000) };
}

function installRuyipageRuntime(python) {
  fs.mkdirSync(RUYIPAGE_BROWSERS_DIR, { recursive: true });
  const ret = run(python, ['-m', 'ruyipage', 'install', '--install-dir', RUYIPAGE_BROWSERS_DIR], 900000);
  return { ok: ret.ok, output: (ret.stdout || ret.stderr || ret.error || '').slice(0, 2000) };
}

function downloadAndExtractRuyiTrace() {
  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  const script = path.join(__dirname, 'download_ruyi_tool.js');
  const ret = run(process.execPath, [script, '--tool', 'ruyitrace', '--dest', TOOLS_DIR, '--extract', '--json'], 600000);
  let parsed = null;
  try { parsed = JSON.parse(ret.stdout.replace(/^\uFEFF/, '')); } catch { /* ignore */ }
  return {
    ok: ret.ok && parsed && parsed.downloaded && parsed.extracted,
    output: (ret.stdout || ret.stderr || ret.error || '').slice(0, 2000),
    extractDir: parsed ? parsed.extractDir : '',
  };
}

function install(state, args) {
  const steps = [];

  if (!state.ruyipagePackage) {
    steps.push({ name: '安装 ruyiPage Python 包 + requests', ...installRuyipagePackage(args.python) });
  }

  if (!state.ruyipageRuntime) {
    steps.push({ name: '安装 ruyiPage 定制 Firefox runtime', ...installRuyipageRuntime(args.python) });
  }

  if (!state.ruyitrace) {
    steps.push({ name: '下载并解压 RuyiTrace', ...downloadAndExtractRuyiTrace() });
  }

  return steps;
}

function verify(args) {
  const script = path.join(__dirname, 'check_external_tools.js');
  const ret = run(process.execPath, [script, '--python', args.python, '--ruyipage-install-dir', RUYIPAGE_BROWSERS_DIR, '--ruyitrace-home', RUYITRACE_DIR, '--json'], 60000);
  let parsed = null;
  try { parsed = JSON.parse(ret.stdout.replace(/^\uFEFF/, '')); } catch { /* ignore */ }
  return parsed;
}

function renderMarkdown(result) {
  const lines = ['# 一键安装结果', '', `- 项目根目录：${PROJECT_ROOT}`, `- 安装目录：${TOOLS_DIR}`, `- Python：${result.python}`, ''];

  lines.push('## 安装前状态');
  lines.push(`- Node.js：${result.before.node.ok ? '通过' : '不通过'}（${result.before.node.version}）`);
  lines.push(`- ruyiPage Python 包：${result.before.ruyipagePackage ? '已安装' : '未安装'}`);
  lines.push(`- ruyiPage 定制 Firefox runtime：${result.before.ruyipageRuntime ? '已验证' : '未安装'}`);
  lines.push(`- RuyiTrace：${result.before.ruyitrace ? '已安装' : '未安装'}`);
  lines.push(`- RuyiTrace 定制 trace 内核：${result.before.ruyitraceKernel ? '已验证' : '未验证'}`);

  if (result.skipped) {
    lines.push('', '## 跳过安装（所有组件已就绪）');
    return lines.join('\n') + '\n';
  }

  if (result.steps.length) {
    lines.push('', '## 安装步骤');
    for (const s of result.steps) {
      lines.push(`### ${s.name}：${s.ok ? '成功' : '失败'}`);
      if (s.output) lines.push('```', s.output, '```');
    }
  }

  if (result.after) {
    lines.push('', '## 安装后状态');
    const a = result.after;
    if (a.node) lines.push(`- Node.js：${a.node.ok ? '通过' : '不通过'}（${a.node.version}）`);
    if (a.ruyiPage) {
      lines.push(`- ruyiPage Python 包：${a.ruyiPage.packageInstalled ? '已安装' : '未安装'}`);
      lines.push(`- ruyiPage 定制 Firefox runtime：${a.ruyiPage.managedRuntimeVerified ? '已验证' : '未验证'}`);
    }
    if (a.ruyiTrace) {
      lines.push(`- RuyiTrace：${a.ruyiTrace.installed ? '已安装' : '未安装'}`);
      lines.push(`- RuyiTrace 定制 trace 内核：${a.ruyiTrace.kernelVerified ? '已验证' : '未验证'}`);
    }
  }

  const allOk = result.after && result.after.node && result.after.node.ok
    && result.after.ruyiPage && result.after.ruyiPage.packageInstalled
    && result.after.ruyiPage.managedRuntimeVerified
    && result.after.ruyiTrace && result.after.ruyiTrace.installed
    && result.after.ruyiTrace.kernelVerified;
  lines.push('', `## 结果：${allOk ? '全部通过' : '部分未通过，请检查上方日志'}`);
  return lines.join('\n') + '\n';
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(usage()); return; }

  const before = detectState(args.python);
  const allInstalled = before.node.ok && before.ruyipagePackage && before.ruyipageRuntime && before.ruyitrace && before.ruyitraceKernel;

  const result = {
    python: args.python,
    before,
    skipped: allInstalled,
    steps: [],
    after: null,
  };

  if (allInstalled) {
    if (args.json) console.log(JSON.stringify(result, null, 2));
    if (args.markdown) process.stdout.write(renderMarkdown(result));
    return;
  }

  if (!args.yes) {
    console.log('检测到缺失组件，将安装到：');
    if (!before.ruyipagePackage) console.log(`  - ruyiPage Python 包（pip install）`);
    if (!before.ruyipageRuntime) console.log(`  - ruyiPage 定制 Firefox runtime → ${RUYIPAGE_BROWSERS_DIR}`);
    if (!before.ruyitrace) console.log(`  - RuyiTrace 定制 trace 内核 → ${RUYITRACE_DIR}`);
    console.log('\n添加 --yes 跳过确认直接安装。');
    if (args.markdown) {
      const lines = ['# 一键安装', '', '检测到缺失组件，添加 `--yes` 确认安装：', ''];
      if (!before.ruyipagePackage) lines.push('- ruyiPage Python 包（pip install）');
      if (!before.ruyipageRuntime) lines.push(`- ruyiPage 定制 Firefox runtime → \`${RUYIPAGE_BROWSERS_DIR}\``);
      if (!before.ruyitrace) lines.push(`- RuyiTrace 定制 trace 内核 → \`${RUYITRACE_DIR}\``);
      lines.push('', '```bash', `node scripts/install_all.js --yes --markdown`, '```');
      process.stdout.write(lines.join('\n') + '\n');
    }
    return;
  }

  result.steps = install(before, args);
  result.after = verify(args);

  if (args.json) console.log(JSON.stringify(result, null, 2));
  if (args.markdown) process.stdout.write(renderMarkdown(result));
}

try {
  main();
} catch (err) {
  console.error(err.message || String(err));
  console.error(usage());
  process.exit(1);
}
