/*
 * IOL 核對小幫手：OCR 結果的行列配對
 *
 * 輸入：OCR 文字框陣列 [{text, conf(0–1), x, y, w, h}]，座標 0–1 正規化、原點左上。
 *       可以是單字框（Tesseract）或整行框（PaddleOCR 等），整行會依字元比例拆成單字。
 * 輸出：依眼別分組的候選值，每個候選都帶原圖位置（欄名、數值、單位、軸向的框）。
 *
 * 原則：不猜值。找不到、重複、超出範圍、信心低都標記 status，交給人工確認。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IOLParse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 欄位定義 ---------- */
  const BIO_FIELDS = {
    AL:  { name: '眼軸 AL', unit: 'mm', min: 14, max: 40 },
    ACD: { name: '前房深度 ACD', unit: 'mm', min: 1.5, max: 6.5 },
    LT:  { name: '水晶體厚度 LT', unit: 'mm', min: 2, max: 7.5 },
    WTW: { name: '角膜直徑 WTW', unit: 'mm', min: 9, max: 15 },
    CCT: { name: '中央角膜厚度 CCT', unit: 'µm', min: 350, max: 800 },
    K1:  { name: 'K1（平坦）', unit: 'D', min: 30, max: 60, axis: true },
    K2:  { name: 'K2（陡峭）', unit: 'D', min: 30, max: 60, axis: true },
    dK:  { name: 'ΔK 角膜散光', unit: 'D', min: -12, max: 12, axis: true },
    TK1: { name: 'TK1', unit: 'D', min: 30, max: 60, axis: true },
    TK2: { name: 'TK2', unit: 'D', min: 30, max: 60, axis: true },
    dTK: { name: 'ΔTK', unit: 'D', min: -12, max: 12, axis: true },
  };
  const BIO_LABELS = [
    [/^(AL|A\.?L\.?|AXL|AXIAL ?LENGTH)$/, 'AL'],
    [/^ACD$/, 'ACD'],
    [/^(LT|LENS)$/, 'LT'],
    [/^(WTW|W-?T-?W|W2W)$/, 'WTW'],
    [/^CCT$/, 'CCT'],
    [/^K1$/, 'K1'], [/^K2$/, 'K2'], [/^[ΔA∆D]K$/, 'dK'],
    [/^TK1$/, 'TK1'], [/^TK2$/, 'TK2'], [/^[ΔA∆D]TK$/, 'dTK'],
  ];
  // 只用來「停止往右找」的其他欄名，不產生候選
  const STOP_LABELS = /^(SE|TSE|SD|SNR|VCD|VITREOUS|AVE|AVG|R1|R2|CYL|P|FIX|K|TK|R|R:|n|SPH|AX|AXIS|S|C|A|Q|PUPIL|P:)$/;

  const OD_RE = /^(OD|0D|O\.D\.?|RIGHT|<R>?|\(R\)|\[R\]|右眼?)$/;
  const OS_RE = /^(OS|0S|O\.S\.?|LEFT|<L>?|\(L\)|\[L\]|左眼?)$/;
  const UNIT_RE = /^(mm|D|dpt|µm|μm|um)$/i;
  const NUM_RE = /^[-+−]?\d+(?:[.,]\d+)?$/;

  /* ---------- 文字整理 ---------- */
  function cleanText(s) {
    return String(s).normalize('NFKC').replace(/[：:]+$/, '').replace(/[−–—]/g, '-').trim();
  }
  // 欄名常見 OCR 誤讀：K1 讀成 Kl / KI / K|
  function labelKey(s) {
    let t = cleanText(s).toUpperCase().replace(/\s+/g, ' ');
    t = t.replace(/^(T?K)[IL|!]$/, '$11');
    return t;
  }
  function parseNum(s) {
    const m = cleanText(s).replace(/^</, '').replace(/>$/, '').replace(',', '.').match(/^([-+]?\d+(?:\.\d+)?)(mm|D|dpt|µm|μm|um|°)?$/i);
    return m ? { value: Number(m[1]), unit: m[2] || null, raw: m[0] } : null;
  }

  /* ---------- 文字框 → 單字 token ---------- */
  function explode(boxes) {
    const out = [];
    boxes.forEach((b, bi) => {
      const text = String(b.text || '').trim();
      if (!text) return;
      const parts = text.split(/\s+/);
      if (parts.length === 1) {
        out.push(mk(parts[0], b.x, b.y, b.w, b.h, b.conf, bi));
        return;
      }
      // 整行框：依字元數比例估算各字位置
      const total = text.length;
      let pos = 0;
      parts.forEach(p => {
        const start = text.indexOf(p, pos);
        const x0 = b.x + b.w * (start / total);
        const w = b.w * (p.length / total);
        out.push(mk(p, x0, b.y, w, b.h, b.conf, bi));
        pos = start + p.length;
      });
    });
    out.forEach((t, i) => { t.id = i; });
    return out;
    function mk(t, x, y, w, h, conf, bi) {
      return { t, x0: x, y0: y, x1: x + w, y1: y + h, cx: x + w / 2, cy: y + h / 2, h, conf: conf == null ? 1 : conf, box: bi };
    }
  }

  const vOverlap = (a, b) => {
    const ov = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    return ov / Math.min(a.h, b.h);
  };
  const sameRow = (a, b) => vOverlap(a, b) > 0.35;

  // 同一列的「片語」欄名（例：Axial length）
  function joinedLabel(tokens, t) {
    const right = tokens.filter(o => o !== t && sameRow(o, t) && o.x0 > t.x1 - 0.002 && o.x0 - t.x1 < t.h * 1.2)
      .sort((a, b) => a.x0 - b.x0)[0];
    return right ? { text: labelKey(t.t + ' ' + right.t), extra: right } : null;
  }

  /* ---------- 眼別分區 ---------- */
  function detectEyeLayout(tokens) {
    const od = tokens.filter(t => OD_RE.test(labelKey(t.t)));
    const os = tokens.filter(t => OS_RE.test(labelKey(t.t)));
    // 「Eye: OS」這種單一標示 → 整頁同一眼
    if (od.length && !os.length) return { mode: 'page', eye: 'OD', markers: od.slice(0, 1) };
    if (os.length && !od.length) return { mode: 'page', eye: 'OS', markers: os.slice(0, 1) };
    if (!od.length && !os.length) return { mode: 'unknown', markers: [] };
    // 優先順序：<R>／<L>（auto 單分區）> OD／OS 文字 > 其他（例如眼壓區的 [R]）；同級取最大字、再取最上方
    const rank = t => { const k = labelKey(t.t); return /^</.test(k) ? 3 : /^(OD|OS|0D|0S|RIGHT|LEFT)/.test(k) ? 2 : 1; };
    const pick = arr => arr.slice().sort((a, b) => (rank(b) - rank(a)) || (b.h - a.h) || (a.cy - b.cy))[0];
    const a = pick(od), b = pick(os);
    const dx = Math.abs(a.cx - b.cx), dy = Math.abs(a.cy - b.cy);
    if (dx > dy) {
      return { mode: 'columns', split: (a.cx + b.cx) / 2, odLeft: a.cx < b.cx, top: Math.min(a.y0, b.y0) - a.h * 0.5, markers: [a, b] };
    }
    return { mode: 'rows', odFirst: a.cy < b.cy, odY: a.y0 - a.h * 0.3, osY: b.y0 - b.h * 0.3, markers: [a, b] };
  }
  function eyeOf(t, L) {
    if (L.mode === 'page') return L.eye;
    if (L.mode === 'unknown') return null;
    if (L.mode === 'columns') {
      if (t.cy < L.top) return null;
      const left = t.cx < L.split;
      return left === L.odLeft ? 'OD' : 'OS';
    }
    const first = Math.min(L.odY, L.osY), second = Math.max(L.odY, L.osY);
    if (t.cy < first) return null;
    const inFirst = t.cy < second;
    return inFirst === L.odFirst ? 'OD' : 'OS';
  }

  /* ---------- 日期與儀器 ---------- */
  function rowsOf(tokens) {
    const sorted = tokens.slice().sort((a, b) => a.cy - b.cy);
    const rows = [];
    sorted.forEach(t => {
      const r = rows.find(r => sameRow(r[0], t));
      if (r) r.push(t); else rows.push([t]);
    });
    return rows.map(r => r.sort((a, b) => a.x0 - b.x0));
  }
  function detectDates(tokens) {
    const found = [];
    rowsOf(tokens).forEach(row => {
      const line = row.map(t => t.t).join(' ');
      let m;
      const iso = /(20\d{2}|19\d{2})[-./年](\d{1,2})[-./月](\d{1,2})/g;
      while ((m = iso.exec(line))) {
        found.push({ raw: m[0], iso: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`, ambiguous: false, tokens: row });
      }
      const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
      const mon = /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[-./ ](\d{1,2})[-./, ]+(20\d{2}|19\d{2})/gi;
      const lineM = line.replace(/\b0CT\b/gi, 'OCT').replace(/\bN0V\b/gi, 'NOV');   // OCR 常把 O 讀成 0
      while ((m = mon.exec(lineM))) {
        const mm = String(MON[m[1].toUpperCase()]).padStart(2, '0');
        found.push({ raw: m[0], iso: `${m[3]}-${mm}-${m[2].padStart(2, '0')}`, ambiguous: false, tokens: row });
      }
      const dmy = /(\d{1,2})[-./](\d{1,2})[-./](20\d{2}|19\d{2})/g;
      while ((m = dmy.exec(line))) {
        const p = Number(m[1]), q = Number(m[2]);
        let iso2 = null, amb = true;
        if (p > 12 && q <= 12) { iso2 = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; amb = false; }
        else if (q > 12 && p <= 12) { iso2 = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; amb = false; }
        found.push({ raw: m[0], iso: iso2, ambiguous: amb, tokens: row });
      }
    });
    return found;
  }
  function detectDevice(tokens) {
    const all = tokens.map(t => t.t).join(' ').toUpperCase();
    if (/IOL ?MASTER/.test(all)) return 'IOLMaster';
    if (/LENSTAR/.test(all)) return 'Lenstar';
    if (/SONOMED|ESCALON/.test(all)) return 'A-scan';
    if (/ARGOS/.test(all)) return 'Argos';
    if (/A-?SCAN|ULTRASOUND|VELOCITY/.test(all)) return 'A-scan';
    if (/AUTO ?REF|KERATO|REF\/KER|\bREF\b/.test(all)) return 'Auto refraction';
    if (/PENTACAM/.test(all)) return 'Pentacam';
    return null;
  }

  /* ---------- 生物測量 ---------- */
  function bioLabelOf(tokens, t) {
    const k = labelKey(t.t);
    for (const [re, f] of BIO_LABELS) if (re.test(k)) return { field: f, tokens: [t] };
    const j = joinedLabel(tokens, t);
    if (j) for (const [re, f] of BIO_LABELS) if (re.test(j.text)) return { field: f, tokens: [t, j.extra] };
    return null;
  }
  function isAnyLabel(tokens, t) {
    const k = labelKey(t.t);
    return !!bioLabelOf(tokens, t) || STOP_LABELS.test(k) || OD_RE.test(k) || OS_RE.test(k);
  }

  function valueAfter(tokens, label, field, sameEye) {
    const lastLabel = label.tokens[label.tokens.length - 1];
    const row = tokens.filter(o => !label.tokens.includes(o) && sameEye(o) && sameRow(o, lastLabel) && o.cx > lastLabel.x1)
      .sort((a, b) => a.x0 - b.x0);
    const res = { value: null, unit: null, axis: null, tokens: [], where: 'right' };
    for (let i = 0; i < row.length; i++) {
      const o = row[i];
      if (res.value == null) {
        if (isAnyLabel(tokens, o)) break;          // 遇到下一個欄名就停
        const n = parseNum(o.t);
        if (n && n.unit !== '°') { res.value = n.value; res.raw = n.raw; res.tokens.push(o); if (n.unit) res.unit = n.unit; continue; }
        continue;
      }
      // 已取得數值：接著看單位與軸向
      const k = cleanText(o.t);
      if (!res.unit && UNIT_RE.test(k)) { res.unit = k; res.tokens.push(o); continue; }
      if (field.axis && res.axis == null) {
        const ax = k.match(/^@?(\d{1,3})°?$/);
        const prevAt = row[i - 1] && cleanText(row[i - 1].t) === '@';
        if (ax && (k.startsWith('@') || k.endsWith('°') || prevAt)) {
          res.axis = Number(ax[1]);
          if (prevAt) res.tokens.push(row[i - 1]);
          res.tokens.push(o);
          break;
        }
        if (k === '@') continue;
      }
      if (isAnyLabel(tokens, o) || parseNum(o.t)) break;
    }
    if (res.value != null) return res;

    // 右側沒有數值 → 找正下方（欄名在上、數值在下的版型）
    const below = tokens.filter(o => !label.tokens.includes(o) && sameEye(o) && o.cy > lastLabel.y1 &&
      o.cy - lastLabel.cy < lastLabel.h * 3.2 && o.cx > label.tokens[0].x0 - lastLabel.h && o.cx < lastLabel.x1 + lastLabel.h * 1.5)
      .sort((a, b) => a.cy - b.cy);
    for (const o of below) {
      if (isAnyLabel(tokens, o)) break;
      const n = parseNum(o.t);
      if (n && n.unit !== '°') {
        const r = { value: n.value, raw: n.raw, unit: n.unit, axis: null, tokens: [o], where: 'below' };
        const u = tokens.find(q => q.cy > o.y1 && q.cy - o.cy < o.h * 2.2 && Math.abs(q.cx - o.cx) < o.h * 2 && UNIT_RE.test(cleanText(q.t)));
        if (!r.unit && u) { r.unit = cleanText(u.t); r.tokens.push(u); }
        return r;
      }
    }
    return null;
  }

  function normUnit(u) {
    if (!u) return null;
    const k = u.toLowerCase();
    if (k === 'um' || k === 'μm' || k === 'µm') return 'µm';
    if (k === 'dpt' || k === 'd') return 'D';
    return k;
  }

  // 只讀到 OD 或 OS 一邊，但同一欄名在同一列重複出現 → 其實是左右分欄，另一眼的標示被 OCR 漏掉
  function twinColumns(tokens, layout) {
    if (layout.mode !== 'page' || layout.forced) return layout;
    const labs = tokens.map(t => { const l = bioLabelOf(tokens, t); return l && l.tokens[0] === t && l.field !== 'LT' ? { field: l.field, t } : null; }).filter(Boolean);   // 度數表的 Lens 同一眼也會並排
    const rights = [];
    labs.forEach(a => labs.forEach(b => { if (a.field === b.field && a.t.cx < b.t.cx && sameRow(a.t, b.t)) rights.push(b.t.x0); }));
    if (rights.length < 2) return layout;
    const m = layout.markers[0], split = Math.min.apply(null, rights) - m.h * 0.2;
    return { mode: 'columns', split, odLeft: (m.cx < split) === (layout.eye === 'OD'), top: m.y0 - m.h * 0.5, markers: [m], inferredFrom: layout.eye };
  }

  function parseBiometry(boxes, opts) {
    const o = opts || {};
    const tokens = explode(boxes);
    const layout = o.forceEye ? { mode: 'page', eye: o.forceEye, markers: [], forced: true } : twinColumns(tokens, detectEyeLayout(tokens));
    const cands = [];
    tokens.forEach(t => {
      const lab = bioLabelOf(tokens, t);
      if (!lab || lab.tokens[0] !== t) return;
      const field = BIO_FIELDS[lab.field];
      const eye = eyeOf(t, layout);
      const v = valueAfter(tokens, lab, field, o => eyeOf(o, layout) === eye);
      // Sonomed 等 A-scan 的度數表也寫「Lens 118.0」，那是 A 常數，不是水晶體厚度
      if (lab.field === 'LT' && v && v.value > 20) return;
      const c = { kind: 'bio', field: lab.field, eye, label: lab.tokens.map(x => x.t).join(' '),
        value: v ? v.value : null, raw: v ? v.raw : null, unit: v ? normUnit(v.unit) : null, axis: v ? v.axis : null,
        tokens: lab.tokens.concat(v ? v.tokens : []), where: v ? v.where : null, issues: [] };
      const confs = c.tokens.map(x => x.conf);
      c.conf = confs.length ? Math.min.apply(null, confs) : 0;
      if (c.value == null) c.issues.push('找到欄名但沒有配對到數值');
      else {
        // OCR 漏小數點（4400D、330mm）：還原後一定標成需確認，由人工對照原圖
        const div = c.value > field.max && Number.isInteger(c.value) ? [100, 10].find(n => c.value / n >= field.min && c.value / n <= field.max) : null;
        if (div) {
          c.value /= div;
          c.issues.push(`影像讀到「${c.raw}」，疑似漏小數點，暫列為 ${c.value}，請對照原圖`);
        }
        // 模糊時 D 常讀成 0：44.25D → 44.250
        if (!c.unit && field.unit === 'D' && /^\d+\.\d\d0$/.test(c.raw)) c.unit = 'D';
        if (c.value < field.min || c.value > field.max) c.issues.push(`數值超出合理範圍 ${field.min}–${field.max}`);
        if (!c.unit) c.issues.push(`未讀到單位（預期 ${field.unit}）`);
        else if (c.unit !== field.unit) c.issues.push(`單位為 ${c.unit}，預期 ${field.unit}`);
        if (field.axis && c.axis == null) c.issues.push('未讀到軸向');
        if (c.axis != null && (c.axis < 0 || c.axis > 180)) c.issues.push('軸向超出 0–180');
        if (c.conf < 0.8) c.issues.push(`OCR 信心偏低（${Math.round(c.conf * 100)}%）`);
        if (c.where === 'below') c.issues.push('數值取自欄名下方，請確認對應');
      }
      if (!eye) c.issues.push('無法判定眼別');
      else if (layout.inferredFrom && eye !== layout.inferredFrom) c.issues.push('沒有讀到此眼標示，依左右分欄推定眼別');
      cands.push(c);
    });
    return finish({ kind: 'biometry', tokens, layout, cands, dates: detectDates(tokens), device: detectDevice(tokens) });
  }

  /* ---------- Auto refraction：只取角膜 K（R1／R2 的 D 值與軸向） ---------- */
  // 例（NIDEK）：<R1  7.78  43.50  0>   <R2  7.76  43.50  90>
  function keratLabel(t) {
    const k = labelKey(t.t).replace(/^</, '').replace(/>$/, '').replace(/^([RK])[IL|!]$/, '$11');
    return /^(R1|K1)$/.test(k) ? 'K1' : /^(R2|K2)$/.test(k) ? 'K2' : null;
  }
  function parseAutoref(boxes, opts) {
    const o = opts || {};
    const tokens = explode(boxes);
    const layout = o.forceEye ? { mode: 'page', eye: o.forceEye, markers: [], forced: true } : detectEyeLayout(tokens);
    const cands = [];
    tokens.forEach(lab => {
      const which = keratLabel(lab);
      if (!which) return;
      const eye = eyeOf(lab, layout);
      // 同一列、欄名右側，依序找：半徑 mm（5–11）→ 度數 D（30–60）→ 軸向（0–180 整數）
      const row = tokens.filter(t => t !== lab && sameRow(t, lab) && t.cx > lab.x1 && t.x0 - lab.x1 < lab.h * 26)
        .sort((a, b) => a.x0 - b.x0);
      let mm = null, d = null, ax = null;
      for (const t of row) {
        if (keratLabel(t)) break;                       // 遇到下一個欄名就停
        const n = parseNum(t.t);
        if (!n) continue;
        const dec = /\./.test(n.raw);
        if (!mm && !d && dec && n.value >= 5 && n.value <= 11) { mm = { t, v: n.value }; continue; }
        if (!d && dec && n.value >= 30 && n.value <= 60) { d = { t, v: n.value }; continue; }
        if (d && !dec && n.value >= 0 && n.value <= 180) { ax = { t, v: n.value }; break; }
      }
      const issues = [];
      let value = d ? d.v : null;
      if (!d && mm) { value = Math.round(337.5 / mm.v * 100) / 100; issues.push(`只讀到半徑 ${mm.v} mm，D 值由 337.5/r 換算`); }
      if (value == null) issues.push('沒有配對到角膜度數 D');
      if (!ax) issues.push('未讀到軸向');
      if (mm && d && Math.abs(337.5 / mm.v - d.v) > 0.6) issues.push(`半徑 ${mm.v} mm 換算約 ${(337.5 / mm.v).toFixed(2)} D，與讀到的 ${d.v} D 不一致，請確認`);
      const tk = [lab].concat([mm, d, ax].filter(Boolean).map(x => x.t));
      const c = { kind: 'kerat', field: which, eye, value, unit: 'D', axis: ax ? ax.v : null, radius: mm ? mm.v : null,
        label: lab.t, tokens: tk, conf: Math.min.apply(null, tk.map(t => t.conf)), issues };
      if (c.conf < 0.8) issues.push(`OCR 信心偏低（${Math.round(c.conf * 100)}%）`);
      if (!eye) issues.push('無法判定眼別');
      cands.push(c);
    });
    return finish({ kind: 'autoref', tokens, layout, cands, dates: detectDates(tokens), device: detectDevice(tokens) });
  }

  /* ---------- 彙整：同眼同欄位多個候選 ---------- */
  function finish(res) {
    const groups = {};
    res.cands.forEach(c => {
      const key = `${c.eye || '?'}|${c.field}`;
      (groups[key] = groups[key] || []).push(c);
    });
    Object.values(groups).forEach(g => {
      const vals = new Set(g.filter(c => c.value != null).map(c => `${c.value}|${c.axis}|${c.cyl}`));
      if (vals.size > 1) g.forEach(c => c.issues.push(`同眼「${c.field}」有 ${vals.size} 個不同數值，不自動採用`));
    });
    res.cands.forEach((c, i) => {
      c.id = `${res.kind}-${i}`;
      c.status = c.issues.length ? 'check' : 'ok';
    });
    res.otherEyeCount = eye => res.cands.filter(c => c.eye && c.eye !== eye).length;
    return res;
  }

  /* ---------- Tesseract.js 結果 → 標準文字框 ---------- */
  function fromTesseract(data, width, height) {
    const words = [];
    (data.words || []).forEach(w => {
      words.push({ text: w.text, conf: (w.confidence || 0) / 100,
        x: w.bbox.x0 / width, y: w.bbox.y0 / height, w: (w.bbox.x1 - w.bbox.x0) / width, h: (w.bbox.y1 - w.bbox.y0) / height });
    });
    return words;
  }

  /* 成對欄位（K1＋K2、TK1＋TK2）以單張報告為一組，不跨單混用。list 項目為 {c, d}，d.id 為單張 */
  function pairSets(listA, listB) {
    const ids = [];
    listA.concat(listB).forEach(x => { if (!ids.includes(x.d.id)) ids.push(x.d.id); });
    const side = (list, id) => {
      const mine = list.filter(x => x.d.id === id && x.c.value != null);
      const vals = new Set(mine.map(x => `${x.c.value}|${x.c.axis}`));
      return { pick: vals.size === 1 ? mine[0] : null, ambiguous: vals.size > 1 };
    };
    return ids.map(id => {
      const a = side(listA, id), b = side(listB, id);
      return { docId: id, d: listA.concat(listB).find(x => x.d.id === id).d, a, b, complete: !!(a.pick && b.pick) };
    });
  }
  // 只有一張單子，或每張的數值完全相同時才預選；其餘由使用者選，不猜
  function defaultSet(sets) {
    if (sets.length === 1) return sets[0];
    const key = s => [s.a, s.b].map(x => `${x.pick.c.value}|${x.pick.c.axis}`).join('/');
    return sets.length && sets.every(s => s.complete) && new Set(sets.map(key)).size === 1 ? sets[0] : null;
  }

  return { BIO_FIELDS, parseBiometry, parseAutoref, explode, detectEyeLayout, detectDates, fromTesseract, labelKey, parseNum, pairSets, defaultSet };
});
