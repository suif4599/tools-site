let fonts = [];
let fixMod = null;

async function setup({ emfDir, loBase, v, fonts: bufs }) {
  fonts = bufs.map((b) => new Uint8Array(b));
  const emfBuf = await (await fetch(loBase + 'emf2svg.wasm?v=' + v)).arrayBuffer();
  const Emf2Svg = (await import(emfDir + 'emf2svg.js?v=' + v)).default;
  const emfMod = await Emf2Svg({
    instantiateWasm: (info, ok) => WebAssembly.instantiate(emfBuf, info).then((r) => ok(r.instance)),
  });
  globalThis.__emf2svgConvert = (u8) => {
    const ptr = emfMod._malloc(u8.length);
    new Uint8Array(emfMod.HEAPU8.buffer, ptr, u8.length).set(u8);
    const outPtrSlot = emfMod._malloc(4);
    const outLenSlot = emfMod._malloc(4);
    emfMod._emf2svg_convert(ptr, u8.length, outPtrSlot, outLenSlot);
    const outPtr = emfMod.getValue(outPtrSlot, 'i32');
    const outLen = emfMod.getValue(outLenSlot, 'i32');
    const svg = emfMod.UTF8ToString(outPtr, outLen);
    emfMod._emf2svg_free_out(outPtr);
    emfMod._free(ptr);
    emfMod._free(outPtrSlot);
    emfMod._free(outLenSlot);
    return svg;
  };
  fixMod = await import('./pptx_fix_wasm.js?v=' + v);
  const fixBuf = await (await fetch(loBase + 'pptx_fix_wasm_bg.wasm?v=' + v)).arrayBuffer();
  await fixMod.default({ module_or_path: fixBuf });
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      await setup(msg);
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', error: String(err) });
    }
    return;
  }
  if (msg.type === 'convert') {
    try {
      const cb = new fixMod.Callbacks(
        () => {},
        (cur, total, media) => self.postMessage({ type: 'media', cur, total, media }),
      );
      const out = fixMod.fix_pptx(msg.pptx, fonts, cb, msg.fontMap);
      self.postMessage({ type: 'done', pptx: out }, [out.buffer]);
    } catch (err) {
      self.postMessage({ type: 'error', error: String(err) });
    }
  }
};
