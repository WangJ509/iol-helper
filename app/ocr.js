/*
 * OCR 轉接層：把任何 OCR 引擎的結果轉成同一種格式
 *   { imageUrl, width, height, boxes: [{text, conf, x, y, w, h}] }（0–1 正規化、左上原點）
 * 預設引擎：瀏覽器內 Tesseract.js（照片不離開瀏覽器）。
 * 伺服器若設定 IOL_OCR_CMD，/api/config 會回報 serverOcr: true，可改用伺服器引擎。
 * 自架離線部署時，可在載入本檔前設定 window.IOL_OCR_CONFIG = { workerPath, corePath, langPath }。
 */
(function (root) {
  'use strict';
  const MAX_SIDE = 3000;
  let workerPromise = null;
  let serverOcr = null;

  async function hasServerOcr() {
    if (serverOcr !== null) return serverOcr;
    try { serverOcr = !!(await (await fetch('api/config')).json()).serverOcr; } catch (e) { serverOcr = false; }
    return serverOcr;
  }

  function getWorker(onProgress) {
    if (!root.Tesseract) throw new Error('Tesseract.js 未載入（需要網路連線，或依說明自架檔案）');
    if (!workerPromise) {
      const cfg = Object.assign({}, root.IOL_OCR_CONFIG || {});
      cfg.logger = m => { if (m.status === 'recognizing text' && root.__iolOcrProgress) root.__iolOcrProgress(m.progress); };
      workerPromise = root.Tesseract.createWorker('eng', 1, cfg);
    }
    return workerPromise;
  }

  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('無法解碼影像。HEIC 請先轉成 JPG／PNG，或改用 Safari。'));
      img.src = src;
    });
  }

  // 將任一來源畫到畫布：套用旋轉、限制尺寸（瀏覽器已依 EXIF 轉正照片）
  function toCanvas(source, w, h, quarterTurns) {
    const k = ((quarterTurns || 0) % 4 + 4) % 4;
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    const sw = Math.round(w * scale), sh = Math.round(h * scale);
    const c = document.createElement('canvas');
    c.width = k % 2 ? sh : sw; c.height = k % 2 ? sw : sh;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(k * Math.PI / 2);
    ctx.drawImage(source, -sw / 2, -sh / 2, sw, sh);
    return c;
  }

  // 檔案 → 一或多張頁面畫布（PDF 每頁一張，最多 4 頁）
  async function fileToCanvases(file, quarterTurns) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (isPdf) {
      if (!root.pdfjsLib) throw new Error('PDF 元件未載入');
      const pdf = await root.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      const out = [];
      for (let i = 1; i <= Math.min(pdf.numPages, 4); i++) {
        const page = await pdf.getPage(i);
        const vp1 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(4, MAX_SIDE / Math.max(vp1.width, vp1.height)) });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        const canvas = toCanvas(c, c.width, c.height, quarterTurns);
        // PDF 內含文字層時直接取文字與座標（比 OCR 準確）；旋轉時改走 OCR
        if (!quarterTurns) {
          const tc = await page.getTextContent();
          const boxes = tc.items.filter(it => it.str && it.str.trim()).map(it => {
            const tx = root.pdfjsLib.Util.transform(vp.transform, it.transform);
            const fh = Math.hypot(tx[2], tx[3]);
            return { text: it.str, conf: 1, x: tx[4] / c.width, y: (tx[5] - fh) / c.height, w: (it.width * vp.scale) / c.width, h: fh / c.height };
          });
          if (boxes.length >= 5) canvas.textLayer = boxes;
        }
        out.push(canvas);
      }
      return out;
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      return [toCanvas(img, img.naturalWidth, img.naturalHeight, quarterTurns)];
    } finally { URL.revokeObjectURL(url); }
  }

  async function recognizeCanvas(canvas, opts) {
    const o = opts || {};
    root.__iolOcrProgress = o.onProgress || null;
    if (await hasServerOcr()) {
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      const resp = await fetch('api/ocr', { method: 'POST', body: blob });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || '伺服器 OCR 失敗');
      return data.boxes;
    }
    const worker = await getWorker();
    // PSM 11（稀疏文字）擅長分散的欄名與數字，但會漏掉單一字元（S／C／A、個位數軸向）；
    // PSM 6（整塊文字）可補回。預設兩種都跑再合併。
    const modes = o.psm === 'auto' || !o.psm ? [6, 11] : [o.psm];
    let merged = [];
    for (let i = 0; i < modes.length; i++) {
      await worker.setParameters({ tessedit_pageseg_mode: String(modes[i]), preserve_interword_spaces: '1' });
      const prog = root.__iolOcrProgress;
      root.__iolOcrProgress = prog ? p => prog((i + p) / modes.length) : null;
      const { data } = await worker.recognize(canvas);
      root.__iolOcrProgress = prog;
      merged = mergeBoxes(merged, root.IOLParse.fromTesseract(data, canvas.width, canvas.height));
    }
    return merged;
  }

  // 合併兩次辨識：重疊（IoU > 0.4）視為同一字，保留信心較高者
  function mergeBoxes(a, b) {
    const iou = (p, q) => {
      const ix = Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x));
      const iy = Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y));
      const inter = ix * iy;
      return inter / (p.w * p.h + q.w * q.h - inter || 1);
    };
    const out = a.slice();
    b.forEach(q => {
      const i = out.findIndex(p => iou(p, q) > 0.4);
      if (i < 0) out.push(q);
      else if (q.conf > out[i].conf) out[i] = q;
    });
    return out.filter(x => String(x.text).trim());
  }

  async function recognizeFile(file, opts) {
    const o = opts || {};
    const canvases = await fileToCanvases(file, o.rotation);
    const pages = [];
    for (let i = 0; i < canvases.length; i++) {
      const c = canvases[i];
      const boxes = c.textLayer || await recognizeCanvas(c, { psm: o.psm, onProgress: p => o.onProgress && o.onProgress((i + p) / canvases.length) });
      pages.push({ imageUrl: c.toDataURL('image/jpeg', 0.88), width: c.width, height: c.height, boxes, engine: c.textLayer ? 'PDF 文字層' : 'OCR' });
    }
    return pages;
  }

  root.IOLOcr = { recognizeFile, hasServerOcr };
})(window);
