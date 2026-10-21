const LO_BASE = new URL('lo/', document.baseURI).href;
const V = 'fb8d895f6a55';

const $ = (id) => document.getElementById(id);
let loPort = null;
let pdfBlob = null;
let pdfName = 'output.pdf';
let ready = false;
let bootError = null;

addEventListener('error', (e) => {
  if (!ready) bootError = e.message;
});

const CJK_FALLBACK = 'WenQuanYi Micro Hei';
const SANS_CJK = [
  'Noto Sans CJK SC', 'Noto Sans SC', 'Source Han Sans SC', 'Microsoft YaHei',
  'PingFang SC', 'Hiragino Sans GB', CJK_FALLBACK,
];
const SERIF_CJK = [
  'Noto Serif CJK SC', 'Noto Serif SC', 'Source Han Serif SC', 'SimSun',
  'Songti SC', CJK_FALLBACK,
];
const FAMILY_TABLE = [
  '黑体', 'SimHei', '等线', 'DengXian', '微软雅黑', 'Microsoft YaHei',
  '微软正黑体', 'Microsoft JhengHei', '宋体', 'SimSun', '新宋体', 'NSimSun',
  '新細明體', '新细明体', 'PMingLiU', '楷体', '楷體', 'KaiTi', '仿宋', 'FangSong',
  'Arial Unicode MS', '바탕', 'Batang',
];
const SERIF_FAMILIES = new Set([
  '宋体', 'SimSun', '新宋体', 'NSimSun', '新細明體', '新细明体', 'PMingLiU',
  '楷体', '楷體', 'KaiTi', '仿宋', 'FangSong',
]);
const FONT_STORE = 'fontMap';

const FONT_DB = 'pptx2pdf';
const SKIP_KEY = 'skipLocalFonts';
const localNames = new Set();
const localFaces = new Map();
const localFontFiles = [];

async function scanLocalFonts() {
  if (typeof window.queryLocalFonts !== 'function') return false;
  let fonts;
  try {
    fonts = await window.queryLocalFonts();
  } catch (e) {
    console.warn('[fonts] local font scan failed:', e);
    return false;
  }
  for (const f of fonts) {
    localNames.add(f.family);
    const prev = localFaces.get(f.family);
    const regular = /regular|normal|book|roman/i.test(f.style || '');
    if (!prev || (regular && !/regular|normal|book|roman/i.test(prev.style || ''))) {
      localFaces.set(f.family, f);
    }
  }
  return true;
}

function openFontDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FONT_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('fonts');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readCachedFonts() {
  try {
    const db = await openFontDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction('fonts').objectStore('fonts').get('local');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[fonts] cache read failed:', e);
    return null;
  }
}

async function writeCachedFonts() {
  try {
    const db = await openFontDb();
    const entry = {
      families: [...localNames],
      files: localFontFiles.map(([name, bytes]) => ({ name, bytes: bytes.slice().buffer })),
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction('fonts', 'readwrite');
      tx.objectStore('fonts').put(entry, 'local');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('[fonts] cache write failed:', e);
  }
}

function applyCachedFonts(entry) {
  for (const f of entry.families) localNames.add(f);
  for (const f of entry.files) localFontFiles.push([f.name, new Uint8Array(f.bytes)]);
}

async function enableLocalFonts() {
  localFaces.clear();
  localNames.clear();
  localFontFiles.length = 0;
  if (!(await scanLocalFonts()) || localFaces.size === 0) return false;
  await loadLocalFonts();
  await writeCachedFonts();
  return true;
}

function autoTarget(fam) {
  if (localNames.has(fam)) return fam;
  for (const c of SERIF_FAMILIES.has(fam) ? SERIF_CJK : SANS_CJK) {
    if (localNames.has(c)) return c;
  }
  return CJK_FALLBACK;
}

function savedFontMap() {
  try {
    return JSON.parse(localStorage.getItem(FONT_STORE)) || {};
  } catch (e) {
    return {};
  }
}

function resolvedTargets() {
  const saved = savedFontMap();
  const out = new Map();
  for (const fam of FAMILY_TABLE) {
    const sel = fam in saved ? saved[fam] : 'auto';
    out.set(fam, sel === 'auto' ? autoTarget(fam) : sel);
  }
  return out;
}

function effectiveFontMap() {
  const map = {};
  for (const [fam, target] of resolvedTargets()) {
    if (target && target !== fam) map[fam] = target;
  }
  return map;
}

async function loadLocalFonts() {
  const targets = new Set(resolvedTargets().values());
  for (const c of [...SANS_CJK, ...SERIF_CJK]) targets.add(c);
  targets.delete(CJK_FALLBACK);
  for (const fam of targets) {
    const face = localFaces.get(fam);
    if (!face) continue;
    const bytes = new Uint8Array(await (await face.blob()).arrayBuffer());
    const magic = String.fromCharCode(...bytes.subarray(0, 4));
    const ext = magic === 'ttcf' ? 'ttc' : magic === 'OTTO' ? 'otf' : 'ttf';
    localFontFiles.push([`${fam.replace(/[^\w.-]+/g, '_')}.${ext}`, bytes]);
  }
}

function buildFontPanel() {
  const saved = savedFontMap();
  const box = $('fontmap');
  box.textContent = '';
  const opts = ['auto', CJK_FALLBACK, ''];
  for (const c of [...SANS_CJK, ...SERIF_CJK]) {
    if (localNames.has(c) && !opts.includes(c)) opts.push(c);
  }
  for (const fam of FAMILY_TABLE) {
    const label = document.createElement('label');
    label.textContent = fam;
    const sel = document.createElement('select');
    for (const opt of opts) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt === 'auto' ? 'auto' : opt || 'leave unchanged';
      sel.appendChild(o);
    }
    const want = fam in saved ? saved[fam] : 'auto';
    sel.value = opts.includes(want) ? want : 'auto';
    sel.addEventListener('change', () => {
      const m = savedFontMap();
      m[fam] = sel.value;
      localStorage.setItem(FONT_STORE, JSON.stringify(m));
    });
    box.append(label, sel);
  }
  const rescan = document.createElement('button');
  rescan.textContent = 'Rescan local fonts';
  rescan.addEventListener('click', async () => {
    rescan.disabled = true;
    if (await enableLocalFonts()) {
      localStorage.removeItem(SKIP_KEY);
      location.reload();
    } else {
      rescan.disabled = false;
    }
  });
  box.append(rescan);
}

buildFontPanel();

$('usefonts').addEventListener('click', async () => {
  $('fontgate').hidden = true;
  setStage('Scanning local fonts');
  if (await enableLocalFonts()) localStorage.removeItem(SKIP_KEY);
  buildFontPanel();
  launch();
});

$('skipfonts').addEventListener('click', () => {
  localStorage.setItem(SKIP_KEY, '1');
  $('fontgate').hidden = true;
  launch();
});

function setStage(text) {
  $('progress').hidden = false;
  $('progress').classList.toggle('done', text === 'Ready');
  $('stage').textContent = text;
}

function setBar(frac) {
  const pct = Math.round(Math.min(1, Math.max(0, frac)) * 100);
  $('fill').style.width = `${pct}%`;
  $('bar').setAttribute('aria-valuenow', String(pct));
}

function setDetail(text) {
  $('detail').textContent = text;
}

function fail(msg) {
  $('progress').hidden = true;
  const e = $('error');
  e.hidden = false;
  e.textContent = msg;
}

function mb(n) {
  return `${(n / 1048576).toFixed(1)} MB`;
}

async function prefetch(url, expected, onBytes) {
  const res = await fetch(url);
  const enc = (res.headers.get('Content-Encoding') || '') === 'br';
  const raw = expected ? expected.raw || 0 : 0;
  const total = expected ? (enc ? expected.br : expected.raw) : (+res.headers.get('Content-Length') || 0);
  if (!res.body) return res.arrayBuffer();
  const parts = [];
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onBytes(raw ? got * (total / raw) : got, total);
  }
  const out = new Uint8Array(got);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out.buffer;
}

async function boot() {
  setStage('Loading engine');
  if (!crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
    throw new Error('page is not cross-origin isolated: serve it with COOP: same-origin and COEP: require-corp');
  }
  const cached = await readCachedFonts();
  if (cached) {
    applyCachedFonts(cached);
    buildFontPanel();
    launch();
    return;
  }
  if (typeof window.queryLocalFonts !== 'function' || localStorage.getItem(SKIP_KEY) === '1') {
    launch();
    return;
  }
  $('fontgate').hidden = false;
  $('progress').hidden = true;
}

function launch() {
  startEngine().catch((e) => fail(`boot: ${e}`));
}

async function startEngine() {
  setStage('Loading engine');
  const realFetch = window.fetch;
  let wasmShown = 0, dataShown = 0, wasmTotal = 0, dataTotal = 0;
  const report = () => {
    const total = wasmTotal + dataTotal;
    const shown = wasmShown + dataShown;
    setBar(total ? shown / total : 0);
    setDetail(`${mb(shown)} / ${mb(total)}`);
  };
  const sizes = await fetch(LO_BASE + 'sizes.json?v=' + V).then((r) => r.json()).catch(() => ({}));
  const wasmP = prefetch(LO_BASE + 'soffice.wasm?v=' + V, sizes['soffice.wasm'], (s, t) => { wasmShown = s; wasmTotal = t; report(); });
  const dataP = prefetch(LO_BASE + 'soffice.data?v=' + V, sizes['soffice.data'], (s, t) => { dataShown = s; dataTotal = t; report(); });
  const wasmBuf = await wasmP;
  const dataBuf = await dataP;

  window.fetch = (input, init) => {
    const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
    if (path.endsWith('/soffice.wasm')) return Promise.resolve(new Response(wasmBuf, { headers: { 'Content-Type': 'application/wasm' } }));
    if (path.endsWith('/soffice.data')) return Promise.resolve(new Response(dataBuf));
    return realFetch(input, init);
  };

  setStage('Starting LibreOffice');
  let loStatus = '';
  window.Module = {
    locateFile: (f) => LO_BASE + f + '?v=' + V,
    wasmBinary: wasmBuf,
    preRun: [() => {
      const dir = '/instdir/share/fonts/truetype';
      for (const [name, bytes] of localFontFiles) {
        try {
          window.Module.FS.mkdirTree(dir);
          window.Module.FS.writeFile(`${dir}/${name}`, bytes);
        } catch (e) {
          console.warn('[fonts] writing local font failed:', name, e);
        }
      }
    }],
    setStatus: (t) => {
      loStatus = t;
      setDetail(t);
      console.log('[lo]', t);
    },
  };
  console.log('[boot] loading soffice.js');
  await new Promise((resolve, reject) => {
    const nodeProcess =
      typeof process === 'object' && process && process.versions?.node && process.type !== 'renderer'
        ? process
        : null;
    const restoreProcess = () => {
      if (nodeProcess) {
        try { window.process = nodeProcess; } catch (e) {}
      }
    };
    if (nodeProcess) {
      try { window.process = undefined; } catch (e) {}
    }
    const watchdog = setTimeout(
      () => {
        restoreProcess();
        reject(new Error(`LibreOffice did not start (last status: ${loStatus || 'none'})`));
      },
      180000,
    );
    const s = document.createElement('script');
    s.src = LO_BASE + 'soffice.js?v=' + V;
    s.onload = () => {
      restoreProcess();
      console.log('[boot] soffice.js evaluated');
      if (!Module.uno_main) {
        clearTimeout(watchdog);
        reject(new Error(`soffice.js did not define uno_main${bootError ? `: ${bootError}` : ''}`));
        return;
      }
      Module.uno_main.then((port) => {
        clearTimeout(watchdog);
        loPort = port;
        loPort.onmessage = onLoMessage;
        resolve();
      }, (e) => {
        clearTimeout(watchdog);
        reject(e);
      });
    };
    s.onerror = () => {
      restoreProcess();
      clearTimeout(watchdog);
      reject(new Error('failed to load soffice.js'));
    };
    document.head.appendChild(s);
  });
  console.log('[boot] uno ready');

  setStage('Ready');
  setBar(1);
  setDetail('');
  $('open').classList.add('ready');
  ready = true;
}

let loSeq = 0;
const loPending = new Map();

function onLoMessage(e) {
  const m = e.data;
  const p = loPending.get(m.id);
  if (!p) return;
  loPending.delete(m.id);
  if (m.ok) p.resolve(m);
  else p.reject(new Error(m.error));
}

function loCall(msg) {
  return new Promise((resolve, reject) => {
    const id = ++loSeq;
    loPending.set(id, { resolve, reject });
    loPort.postMessage({ ...msg, id });
  });
}

let fixWorker = null;
let fixReady = null;

async function fetchFontBuffers() {
  const base = LO_BASE + 'fonts/';
  const list = await (await fetch(base + 'index.json?v=' + V)).json();
  const bufs = [];
  for (const f of list) bufs.push(await (await fetch(base + f + '?v=' + V)).arrayBuffer());
  return bufs;
}

function initFixWorker() {
  if (fixReady) return fixReady;
  fixReady = (async () => {
    const fonts = await fetchFontBuffers();
    const w = new Worker(new URL('fix-worker.js', document.baseURI), { type: 'module' });
    fixWorker = w;
    await new Promise((resolve, reject) => {
      const onMsg = (e) => {
        if (e.data.type === 'ready') {
          w.removeEventListener('message', onMsg);
          resolve();
        } else if (e.data.type === 'error') {
          w.removeEventListener('message', onMsg);
          reject(new Error(e.data.error));
        }
      };
      w.addEventListener('message', onMsg);
      w.onerror = (e) => reject(new Error(e.message || 'fix worker failed'));
      w.postMessage(
        { type: 'init', emfDir: new URL('vendor/', document.baseURI).href, loBase: LO_BASE, v: V, fonts },
        fonts,
      );
    });
    return w;
  })();
  return fixReady;
}

function fixPptx(pptx, fontMap) {
  return new Promise((resolve, reject) => {
    const w = fixWorker;
    const onMsg = (e) => {
      const m = e.data;
      if (m.type === 'media') {
        setBar(0.05 + 0.85 * (m.cur / m.total));
        setDetail(`${m.cur}/${m.total}: ${m.media}`);
      } else if (m.type === 'done') {
        w.removeEventListener('message', onMsg);
        resolve(m.pptx);
      } else if (m.type === 'error') {
        w.removeEventListener('message', onMsg);
        reject(new Error(m.error));
      }
    };
    w.addEventListener('message', onMsg);
    const buf = pptx instanceof Uint8Array ? pptx.buffer : pptx;
    w.postMessage({ type: 'convert', pptx: new Uint8Array(buf), fontMap }, [buf]);
  });
}

async function convert(bytes, name) {
  const FS = Module.FS;
  try { FS.mkdir('/work'); } catch (e) {}

  let pptxBytes = bytes;
  if (name.toLowerCase().endsWith('.ppt')) {
    setStage('Converting .ppt to .pptx');
    setBar(0.05);
    FS.writeFile('/work/in.ppt', new Uint8Array(bytes));
    await loCall({ url: 'file:///work/in.ppt', out: 'file:///work/step.pptx', storeFilter: 'Impress MS PowerPoint 2007 XML' });
    pptxBytes = FS.readFile('/work/step.pptx');
  }

  setStage('Fixing formulas');
  setBar(0.05);
  await initFixWorker();
  const fixed = await fixPptx(pptxBytes, effectiveFontMap());

  setStage('Exporting PDF');
  setBar(0.9);
  setDetail('');
  FS.writeFile('/work/fixed.pptx', fixed);
  await loCall({ url: 'file:///work/fixed.pptx', out: 'file:///work/out.pdf', storeFilter: 'impress_pdf_Export' });
  const pdf = FS.readFile('/work/out.pdf');
  FS.unlink('/work/fixed.pptx');
  FS.unlink('/work/out.pdf');
  setBar(1);
  return new Blob([pdf], { type: 'application/pdf' });
}

$('file').addEventListener('change', async () => {
  const f = $('file').files[0];
  if (!f) return;
  $('error').hidden = true;
  $('result').hidden = true;
  setStage('Reading');
  setBar(0);
  try {
    const bytes = await f.arrayBuffer();
    pdfBlob = await convert(bytes, f.name);
    pdfName = f.name.replace(/\.(pptx|ppt)$/i, '') + '.pdf';
    $('progress').hidden = true;
    $('result').hidden = false;
    $('pdfsize').textContent = mb(pdfBlob.size);
    $('preview').src = URL.createObjectURL(pdfBlob);
  } catch (e) {
    let msg = String(e);
    if (typeof Module !== 'undefined' && Module.catchUnoException) {
      const uno = Module.catchUnoException(e);
      if (uno) msg += `\nUNO: ${uno}`;
    }
    fail(msg);
  }
});

$('download').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(pdfBlob);
  a.download = pdfName;
  a.click();
});

addEventListener('unhandledrejection', (e) => fail(`boot: ${e.reason}`));
boot().catch((e) => fail(`boot: ${e}`));
