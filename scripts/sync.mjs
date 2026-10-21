#!/usr/bin/env node
// Pulls a locally-built tool into the hub: copies the app dir under public/<route>,
// injects /ui references, and uploads the r2/ dir to the bound bucket (incremental via manifest).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'smol-toml';

const BIG = 5 * 1024 * 1024;

const MIME = {
  wasm: 'application/wasm', js: 'application/javascript', json: 'application/json',
  metadata: 'application/json', data: 'application/octet-stream', ttf: 'font/ttf',
  ttc: 'font/ttf', otf: 'font/otf', html: 'text/html; charset=utf-8', ico: 'image/x-icon',
  png: 'image/png', br: 'application/octet-stream',
};

const args = process.argv.slice(2);
const id = args[0];
let from = null;
let mode = '--local';
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--from') from = args[++i];
  else if (args[i] === '--remote' || args[i] === '--local') mode = args[i];
  else usage();
}
if (!id || (mode !== '--local' && mode !== '--remote')) usage();

function usage() {
  console.error('usage: node scripts/sync.mjs <tool-id> [--from <dir>] [--local|--remote]');
  process.exit(1);
}

const tool = parse(readFileSync('tools.toml', 'utf8')).tool.find((t) => t.id === id);
if (!tool) {
  console.error(`sync: no tool "${id}" in tools.toml`);
  process.exit(1);
}

const srcRoot = resolve((from || tool.artifact).replace(/^~(?=\/|$)/, process.env.HOME));
const r2Prefix = tool['r2-prefix'] || null;
const appDir = r2Prefix ? join(srcRoot, 'dist') : srcRoot;
const r2Dir = r2Prefix ? join(srcRoot, 'r2') : null;
const destDir = join('public', ...tool.route.split('/').filter(Boolean));

if (!existsSync(join(appDir, 'index.html'))) {
  console.error(`sync: ${appDir}/index.html not found`);
  process.exit(1);
}
if (r2Prefix && !existsSync(join(r2Dir, 'sizes.json'))) {
  console.error(`sync: ${r2Dir}/sizes.json not found — stale build?`);
  console.error(`  pptx: LO_WASM_ARTIFACTS=~/lo-src/build-wasm/workdir/installation/LibreOffice/emscripten nix build --impure ~/Documents/temp#lo-wasm-dist`);
  process.exit(1);
}

rmSync(destDir, { recursive: true, force: true });
mkdirSync(destDir, { recursive: true });
for (const entry of readdirSync(appDir)) {
  if (entry === '_headers' || entry === 'worker') continue;
  cpSync(join(appDir, entry), join(destDir, entry), { recursive: true });
}
console.log(`sync: ${appDir} -> ${destDir}`);

injectUi(destDir, tool);

if (r2Dir) uploadR2();

function injectUi(dir, t) {
  const file = join(dir, 'index.html');
  let html = readFileSync(file, 'utf8');
  if (!html.includes('/ui/tokens.css')) {
    html = html.replace('<link rel="stylesheet"', '<link rel="stylesheet" href="/ui/tokens.css">\n<link rel="stylesheet"');
  }
  if (!html.includes('tool-shell')) {
    const shell = `<tool-shell title="${t.title}"></tool-shell>`;
    html = html.replace(/<body[^>]*>/, (m) => `${m}\n${shell}`);
    html = html.replace('</head>', '  <script defer src="/ui/shell.js"></script>\n</head>');
  }
  writeFileSync(file, html);
}

function sh(argv) {
  return spawnSync('node_modules/.bin/wrangler', argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function r2Get(key) {
  const r = sh(['r2', 'object', 'get', `tools-site/${key}`, '--pipe', mode]);
  return r.status === 0 ? r.stdout : null;
}

function r2Put(key, file) {
  const ext = key.split('.').pop();
  const argv = ['r2', 'object', 'put', `tools-site/${key}`, '--file', file, '--content-type', MIME[ext] || 'application/octet-stream', mode];
  const r = sh(argv);
  if (r.status !== 0 && /unknown option|unrecognized/i.test(String(r.stderr)) && mode === '--remote') {
    return sh(argv.slice(0, -1));
  }
  return r;
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, base));
    else out.push([full, full.slice(base.length + 1)]);
  }
  return out;
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function uploadR2() {
  const files = listFiles(r2Dir);
  const manifestKey = `${tool.id}/.manifest.json`;
  let manifest = { files: {} };
  try {
    manifest = JSON.parse(r2Get(manifestKey)) || manifest;
  } catch {}

  const pending = files.filter(([full, rel]) => manifest.files[rel] !== sha256(full));
  console.log(`sync: r2 ${files.length} files, ${pending.length} changed (${mode})`);

  for (const [full, rel] of pending) {
    const key = `${tool.id}/${r2Prefix}${rel}`;
    const size = statSync(full).size;
    if (size > BIG) process.stdout.write(`  put ${key} (${(size / 1048576).toFixed(1)} MB) ... `);
    const r = r2Put(key, resolve(full));
    if (size > BIG) console.log(r.status === 0 ? 'ok' : 'FAILED');
    if (r.status !== 0) {
      if (size <= BIG) console.error(`  put ${key} FAILED: ${r.stderr}`);
      process.exitCode = 1;
    }
  }

  manifest.files = Object.fromEntries(files.map(([full, rel]) => [rel, sha256(full)]));
  const tmp = join(r2Dir, '.manifest.json');
  writeFileSync(tmp, JSON.stringify(manifest));
  const r = r2Put(manifestKey, tmp);
  console.log(r.status === 0 ? 'sync: r2 manifest updated' : `sync: manifest upload FAILED: ${r.stderr}`);
}
