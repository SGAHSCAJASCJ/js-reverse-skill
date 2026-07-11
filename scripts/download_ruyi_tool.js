#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const REPOS = {
  ruyitrace: { owner: 'LoseNine', repo: 'Firefox-FingerPrint-Analyzer', asset: /RuyiTrace\.zip$/i },
  'ruyipage-firefox': { owner: 'LoseNine', repo: 'ruyipage', asset: null },
};

function parseArgs(argv) {
  const args = { tool: '', dest: '', extract: false, dryRun: false, json: false, markdown: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tool') args.tool = argv[++i] || '';
    else if (a === '--dest') args.dest = argv[++i] || '';
    else if (a === '--extract') args.extract = true;
    else if (a === '--dry-run') args.dryRun = true;
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
  node scripts/download_ruyi_tool.js --tool ruyitrace --dest <download-dir> --dry-run --markdown
  node scripts/download_ruyi_tool.js --tool ruyitrace --dest <download-dir> --markdown
  node scripts/download_ruyi_tool.js --tool ruyitrace --dest <download-dir> --extract --markdown
  node scripts/download_ruyi_tool.js --tool ruyipage-firefox --dest <download-dir> --dry-run --markdown

说明：仅在用户确认后下载。--extract 自动解压 zip 到 dest 目录（Windows 用 Expand-Archive）。`;
}

function extractZip(zipFile, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const ret = spawnSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -Path '${zipFile}' -DestinationPath '${destDir}' -Force`,
  ], { encoding: 'utf8', timeout: 120000, windowsHide: true });
  if (ret.status !== 0) {
    return {
      ok: false,
      stdout: (ret.stdout || '').trim(),
      stderr: (ret.stderr || '').trim(),
      error: ret.error ? ret.error.message : '',
    };
  }
  // 修复嵌套目录：zip 内部可能有一个与 destDir 同名的根目录（如 RuyiTrace.zip → RuyiTrace/）
  const entries = fs.readdirSync(destDir);
  const dirName = path.basename(destDir);
  if (entries.length === 1 && entries[0] === dirName) {
    const nestedDir = path.join(destDir, entries[0]);
    for (const entry of fs.readdirSync(nestedDir)) {
      fs.renameSync(path.join(nestedDir, entry), path.join(destDir, entry));
    }
    fs.rmdirSync(nestedDir);
  }
  return {
    ok: true,
    stdout: (ret.stdout || '').trim(),
    stderr: (ret.stderr || '').trim(),
    error: '',
  };
}

function getJson(url) {
  // 用 curl 代替 Node.js https.get，避免透明代理自签 CA 导致的 TLS 校验失败
  const ret = spawnSync('curl', ['-sk', '-L', '--max-time', '60', '-H', 'User-Agent: web-js-env-patcher-skill', url], { encoding: 'utf8', timeout: 90000, windowsHide: true });
  if (ret.status !== 0 || !ret.stdout) throw new Error(`请求失败：${ret.stderr || ret.error || ret.stdout || ''}`);
  try { return JSON.parse(ret.stdout); } catch (err) { throw new Error(`JSON 解析失败：${err.message}`); }
}

function pickRuyiPageAsset(assets) {
  if (process.platform === 'win32') return assets.find(a => /win64\.zip$/i.test(a.name));
  if (process.platform === 'linux' && process.arch === 'x64') return assets.find(a => /linux.*x86_64.*\.tar\.xz$/i.test(a.name));
  return assets.find(a => /firefox/i.test(a.name));
}

function selectAsset(tool, assets) {
  if (tool === 'ruyipage-firefox') return pickRuyiPageAsset(assets);
  const rule = REPOS[tool].asset;
  return assets.find(a => rule.test(a.name));
}

function mirrorUrl(url) {
  const mirror = process.env.GITHUB_MIRROR || '';
  if (!mirror) return url;
  // 只代理 github.com 的下载 URL（release asset），不代理 api.github.com
  // 原因：ghproxy 等镜像只转发 releases/download 路径，api.github.com 返回 403
  if (url.startsWith('https://github.com/') || url.startsWith('http://github.com/')) {
    return mirror.replace(/\/$/, '') + '/' + url;
  }
  return url;
}

function downloadFile(url, file) {
  // 用 curl 代替 Node.js https.get，避免透明代理自签 CA 导致的 TLS 校验失败
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const ret = spawnSync('curl', ['-sk', '-L', '--max-time', '1800', '-o', file, url], { encoding: 'utf8', timeout: 1800000, windowsHide: true });
  if (ret.status !== 0 || !fs.existsSync(file)) throw new Error(`下载失败：${ret.stderr || ret.error || ''}`);
  return file;
}

function plan(args) {
  if (!args.tool || !REPOS[args.tool]) throw new Error(`必须提供 --tool，可选：${Object.keys(REPOS).join(', ')}`);
  if (!args.dest) throw new Error('必须提供 --dest');
  const repo = REPOS[args.tool];
  const apiUrl = mirrorUrl(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`);
  const release = getJson(apiUrl);
  const asset = selectAsset(args.tool, release.assets || []);
  if (!asset) throw new Error(`未找到适合当前工具 / 平台的 release asset：${args.tool}`);
  const destDir = path.resolve(args.dest);
  const file = path.join(destDir, asset.name);
  const isZip = /\.zip$/i.test(asset.name);
  const extractDir = isZip ? path.join(destDir, asset.name.replace(/\.zip$/i, '')) : '';
  const downloadUrl = mirrorUrl(asset.browser_download_url);
  const result = {
    tool: args.tool,
    repo: `${repo.owner}/${repo.repo}`,
    releaseName: release.name || '',
    tagName: release.tag_name || '',
    releaseUrl: release.html_url || '',
    assetName: asset.name,
    assetSize: asset.size,
    downloadUrl,
    mirror: process.env.GITHUB_MIRROR || '',
    destFile: file,
    extractDir,
    dryRun: args.dryRun,
    downloaded: false,
    extracted: false,
  };
  if (!args.dryRun) {
    downloadFile(downloadUrl, file);
    result.downloaded = true;
    if (args.extract && isZip) {
      const ex = extractZip(file, extractDir);
      result.extracted = ex.ok;
      result.extractError = ex.ok ? '' : (ex.stderr || ex.error || '解压失败');
    }
  }
  return result;
}

function renderMarkdown(result) {
  const lines = ['# Ruyi 工具下载结果', '', `- 工具：${result.tool}`, `- 仓库：${result.repo}`, `- Release：${result.releaseName || result.tagName}`, `- Release URL：${result.releaseUrl}`, `- 资产：${result.assetName}`, `- 大小：${result.assetSize}`, `- 目标文件：${result.destFile}`, `- dry-run：${result.dryRun ? '是' : '否'}`, `- 是否已下载：${result.downloaded ? '是' : '否'}`];
  if (result.mirror) lines.unshift(`> GitHub 镜像：${result.mirror}`, '');
  if (result.extractDir) {
    lines.push(`- 解压目录：${result.extractDir}`);
    lines.push(`- 是否已解压：${result.extracted ? '是' : '否'}`);
    if (result.extractError) lines.push(`- 解压错误：${result.extractError}`);
  }
  lines.push('', '## 下一步');
  if (result.dryRun) lines.push('- 当前只是下载计划；只有用户确认后再去掉 `--dry-run` 下载。');
  else if (result.extracted) lines.push('- 下载并解压完成。请重新运行检测脚本验证。');
  else lines.push('- 下载完成。请用户解压 / 安装后，提供工具目录并重新运行检测脚本。');
  return lines.join('\n') + '\n';
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(usage()); return; }
  const result = plan(args);
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
