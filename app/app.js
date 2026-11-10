/* IOL 核對小幫手：主程式（狀態只存在分頁記憶體，重新整理即清除） */
(function () {
  'use strict';
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const toNum = v => (v === '' || v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  const p2 = v => (isNum(v) ? v.toFixed(2) : '—');
  const s2 = v => (isNum(v) ? (v > 0 ? '+' : '') + v.toFixed(2) : '—');
  const ax = a => (isNum(a) ? (Math.round(a) === 0 ? 180 : Math.round(a)) : '—');

  const BIO_ORDER = ['AL', 'ACD', 'LT', 'WTW', 'CCT', 'K1', 'K2', 'TK1', 'TK2'];
  const REQUIRED = ['AL', 'K1', 'K2', 'ACD'];
  const PAIRS = { K: ['bio:K1', 'bio:K2'], TK: ['bio:TK1', 'bio:TK2'], AR: ['ar:K1', 'ar:K2'] };   // 兩欄必須來自同一張單子
  const HISTORY = [['none', '無屈光手術'], ['LASIK', 'LASIK'], ['PRK', 'PRK'], ['RK', 'RK'], ['SMILE', 'SMILE'], ['other', '其他角膜手術'], ['unknown', '不確定']];
  const OFFICIAL = {
    escrs: { name: 'ESCRS IOL Calculator', group: '一般眼', url: 'https://iolcalculator.escrs.org/' },
    barrett: { name: 'Barrett Universal II（APACRS）', group: '一般眼', url: 'https://calc.apacrs.org/barrett_universal2105/' },
    toric: { name: 'Barrett Toric（APACRS）', group: 'Toric', url: 'https://calc.apacrs.org/toric_calculator20/Toric%20Calculator.aspx' },
    ascrs: { name: 'ASCRS 屈光術後計算器', group: '屈光術後', url: 'https://iolcalc.ascrs.org/wbfrmCalculator.aspx' },
  };

  const fresh = () => ({
    step: 'eye', eye: null, caseCode: '', remoteCaseKey: Date.now() + ':' + Math.random(),
    docs: [],              // 每頁影像一筆
    items: {},             // 已選定的值（只限手術眼）
    active: null,          // 目前定位 {docId, tokens}
    viewDoc: null, zoom: 1, viewerCollapsed: false,
    history: { type: '', myopic: 'myopic', tnp: null, tnpDate: '', preK1: null, preK2: null, lvcSE: null, ccp: null, note: '' },
    lens: { idx: '', A: null, alSource: 'optical', confirmUnclear: false },
    plan: { target: 0, SIA: 0, incision: 0, age: null, gender: '' },
    escrsConstants: false, kActive: null, setStore: {},
  });
  let S = fresh();
  const remote = IOLRemote.create(() => remoteContext(), () => { if (S.step === 'calc') render(); });

  /* ---------- 頂部 ---------- */
  function renderTop() {
    const b = $('#eyeBadge');
    if (S.eye) { b.className = 'eye-badge ' + S.eye.toLowerCase(); b.textContent = S.eye === 'OD' ? 'OD 右眼' : 'OS 左眼'; }
    else { b.className = 'eye-badge none'; b.textContent = '尚未選擇手術眼'; }
    $('#caseChip').hidden = !S.caseCode; $('#caseChip').textContent = '病歷號 ' + S.caseCode;
    $$('#steps button').forEach(btn => {
      btn.setAttribute('aria-current', btn.dataset.step === S.step ? 'step' : 'false');
      btn.disabled = btn.dataset.step !== 'eye' && !S.eye;
    });
    const prog = progress();
    $('#progressChip').hidden = !S.eye || S.step === 'eye';
    $('#progressChip').textContent = `已核對 ${prog.done}/${prog.total}`;
    document.documentElement.style.setProperty('--header-h', $('#top').offsetHeight + 'px');
  }
  window.addEventListener('resize', () => document.documentElement.style.setProperty('--header-h', $('#top').offsetHeight + 'px'));
  $('#steps').addEventListener('click', e => { const b = e.target.closest('button[data-step]'); if (b && !b.disabled) go(b.dataset.step); });
  $('#resetBtn').addEventListener('click', () => { if (confirm('清除目前所有資料並開新個案？')) { S = fresh(); go('eye'); } });
  // iOS 主畫面 web app（standalone）裡開外站會進到 App 內瀏覽器，沒有 Safari 分享選單，捷徑無法執行
  const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  let toSafari = false;
  window.addEventListener('beforeunload', e => { if (S.docs.length && !toSafari) { e.preventDefault(); e.returnValue = ''; } });

  function go(step) { S.step = step; render(); window.scrollTo(0, 0); }
  function render() {
    const m = $('#main');
    if (S.step === 'eye') m.innerHTML = viewEye();
    else if (S.step === 'upload') m.innerHTML = viewUpload();
    else if (S.step === 'verify') { buildItems(); m.innerHTML = viewVerify(); drawViewer(); }
    else m.innerHTML = viewCalc();
    renderTop();
  }

  /* ---------- 1 選眼 ---------- */
  function viewEye() {
    return `<div class="card"><h2>第一步：選擇手術眼</h2>
      <p class="muted small">選定後會固定顯示在頁面最上方，後續所有頁面只採用這一眼的數值，另一眼的數值會被排除。</p>
      <div class="eye-pick">
        <button type="button" class="od" data-eye="OD" aria-pressed="${S.eye === 'OD'}">右眼 OD</button>
        <button type="button" class="os" data-eye="OS" aria-pressed="${S.eye === 'OS'}">左眼 OS</button>
      </div>
      <div class="row" style="margin-top:14px">
        <label class="f">病歷號（選填；會填入官網的 Patient Name 與 Patient ID）<input type="text" id="caseCode" value="${esc(S.caseCode)}" maxlength="30"></label>
      </div>
      <div class="row" style="margin-top:14px"><button class="btn primary" id="toUpload" ${S.eye ? '' : 'disabled'}>下一步：上傳報告</button></div></div>`;
  }
  document.addEventListener('click', e => {
    const eyeBtn = e.target.closest('.eye-pick [data-eye]');
    if (eyeBtn) {
      const eye = eyeBtn.dataset.eye;
      if (S.eye && S.eye !== eye && Object.keys(S.items).length && !confirm('更換手術眼會清除已核對的項目，確定？')) return;
      if (S.eye !== eye) resetItems();
      S.eye = eye; render();
    }
    if (e.target.id === 'toUpload') go('upload');
  });
  document.addEventListener('input', e => { if (e.target.id === 'caseCode') { S.caseCode = e.target.value.trim(); renderTop(); } });

  /* ---------- 2 上傳 ---------- */
  function viewUpload() {
    const zone = (kind, title, hint) => `
      <div class="card"><h2>${title}</h2><p class="muted small">${hint}</p>
        <div class="drop" data-kind="${kind}">拖曳檔案到這裡，或 <label class="btn sm">選擇檔案<input type="file" accept="image/*,.pdf,.heic" multiple hidden data-kind="${kind}"></label>
          <label class="btn sm m-only">拍照<input type="file" accept="image/*" capture="environment" hidden data-kind="${kind}"></label>
          <div class="small" style="margin-top:6px">支援 JPG／PNG／PDF（HEIC 需 Safari 或先轉檔）。照片在你的瀏覽器內辨識，不上傳伺服器。</div></div>
        <div class="docs">${S.docs.filter(d => d.kind === kind).map(docCard).join('') || ''}</div></div>`;
    return zone('biometry', '生物測量報告（IOLMaster／Lenstar／A-scan 等）', '可上傳多張（例如同一次量測的多頁）。系統依欄名與數字的行列位置配對，K 與 TK 分開，左右眼依版面判定。') +
      zone('autoref', 'Auto refraction 單', '只辨識左右眼角膜 K：R1、R2 列的 D 值與軸向（例：R1 7.78 43.50 0 → K1 43.50 @0°）。用來與生物測量的 K 比對。') +
      `<div class="row"><button class="btn primary" id="toVerify" ${S.docs.some(d => d.status === 'done') ? '' : 'disabled'}>下一步：核對量測資料</button>
        ${S.docs.some(d => d.status === 'ocr') ? '<span class="muted small">辨識中…</span>' : ''}</div>`;
  }
  function docCard(d) {
    const res = d.parse;
    const mine = res ? res.cands.filter(c => c.eye === S.eye).length : 0;
    const other = res ? res.cands.filter(c => c.eye && c.eye !== S.eye).length : 0;
    const noEye = res ? res.cands.filter(c => !c.eye).length : 0;
    const layoutText = !res ? '' : res.layout.forced ? `人工指定整頁為 ${res.layout.eye}` :
      res.layout.mode === 'columns' ? '左右欄版面（OD／OS 分欄）' : res.layout.mode === 'rows' ? '上下分區版面' :
      res.layout.mode === 'page' ? `整頁標示為 ${res.layout.eye}` : '未找到眼別標示';
    return `<div class="doc" data-doc="${d.id}">
      <div class="thumb">${d.imageUrl ? `<img src="${d.imageUrl}" alt="">` : '<span class="muted small">處理中</span>'}</div>
      <div class="body">
        <div class="small"><b>${esc(d.fileName)}</b>${d.pageCount > 1 ? `（第 ${d.page}/${d.pageCount} 頁）` : ''}</div>
        ${d.status === 'ocr' ? `<div class="progress"><div style="width:${Math.round((d.progress || 0) * 100)}%"></div></div><div class="small muted">辨識中 ${Math.round((d.progress || 0) * 100)}%</div>` : ''}
        ${d.status === 'error' ? `<div class="msg bad">${esc(d.error)}</div>` : ''}
        ${d.status === 'done' ? `
          <div class="small muted">${esc(d.engine)}｜${esc(layoutText)}</div>
          <div class="small">手術眼 ${S.eye} 候選 <b>${mine}</b> 項${other ? `｜另一眼 ${other} 項（已排除）` : ''}${noEye ? `｜<span style="color:var(--warn)">未判定眼別 ${noEye} 項</span>` : ''}</div>
          ${res.layout.mode === 'unknown' || noEye ? `<div class="msg warn small">找不到眼別標示。若整頁只屬於一眼，請指定：
            <button class="btn sm" data-force="OD" data-doc="${d.id}">整頁為 OD</button> <button class="btn sm" data-force="OS" data-doc="${d.id}">整頁為 OS</button></div>` : ''}
          <div class="grid2">
            <label class="f">儀器／來源<select data-docfield="device" data-doc="${d.id}">
              ${['', 'IOLMaster', 'Lenstar', 'Argos', 'A-scan', 'Auto refraction', 'Pentacam', '其他'].map(o => `<option ${d.device === o ? 'selected' : ''} value="${o}">${o || '— 請選擇 —'}</option>`).join('')}
            </select></label>
            <label class="f">報告日期（需確認）<input type="date" data-docfield="date" data-doc="${d.id}" value="${esc(d.date || '')}"></label>
          </div>
          ${d.dateHint ? `<div class="small muted">${esc(d.dateHint)}</div>` : ''}` : ''}
        <div class="row">
          <button class="btn sm" data-rotate="${d.id}">向右旋轉 90° 並重新辨識</button>
          <button class="btn sm" data-psm="${d.id}">${d.psm === 6 ? '改回合併模式' : '只用整塊版面'}重新辨識</button>
          <button class="btn sm" data-remove="${d.id}">移除</button>
        </div>
      </div></div>`;
  }

  let docSeq = 0;
  async function addFiles(files, kind) {
    for (const file of files) await runOcr({ file, kind, rotation: 0, psm: 'auto' });
  }
  async function runOcr(job, replaceIds) {
    const temp = { id: 'tmp' + (++docSeq), kind: job.kind, fileName: job.file.name, status: 'ocr', progress: 0, page: 1, pageCount: 1 };
    if (replaceIds) S.docs = S.docs.filter(d => !replaceIds.includes(d.id));
    S.docs.push(temp); if (S.step === 'upload') render();
    try {
      const pages = await IOLOcr.recognizeFile(job.file, { rotation: job.rotation, psm: job.psm, onProgress: p => {
        temp.progress = p;
        const el = $(`.doc[data-doc="${temp.id}"] .progress > div`); if (el) el.style.width = Math.round(p * 100) + '%';
      } });
      S.docs = S.docs.filter(d => d !== temp);
      pages.forEach((pg, i) => {
        const d = { id: 'doc' + (++docSeq), kind: job.kind, fileName: job.file.name, file: job.file, rotation: job.rotation, psm: job.psm,
          page: i + 1, pageCount: pages.length, imageUrl: pg.imageUrl, width: pg.width, height: pg.height, boxes: pg.boxes,
          engine: pg.engine === 'OCR' ? `OCR（${job.psm === 6 ? '只用整塊版面' : '整塊＋稀疏合併'}）` : pg.engine,
          uploadedAt: new Date().toISOString(), status: 'done', forceEye: null };
        parseDoc(d);
        d.device = d.parse.device || (job.kind === 'autoref' ? 'Auto refraction' : '');
        const dt = d.parse.dates;
        if (dt.length && dt.every(x => x.iso === dt[0].iso) && !dt[0].ambiguous) { d.date = dt[0].iso; d.dateHint = `由影像讀到「${dt[0].raw}」，請確認。`; }
        else if (dt.length) d.dateHint = `影像中的日期字串：${dt.map(x => x.raw).join('、')}（格式不明確，請手動選擇）`;
        else d.dateHint = '影像中沒有讀到日期，請手動填寫。';
        S.docs.push(d);
      });
    } catch (err) {
      temp.status = 'error'; temp.error = err.message || String(err);
    }
    resetItems();   // 新資料進來，重新建立核對清單
    if (S.step === 'upload') render();
  }
  function parseDoc(d) {
    const opts = d.forceEye ? { forceEye: d.forceEye } : {};
    d.parse = d.kind === 'autoref' ? IOLParse.parseAutoref(d.boxes, opts) : IOLParse.parseBiometry(d.boxes, opts);
    d.parse.cands.forEach(c => { c.id = d.id + ':' + c.id; });   // 多張單子時 id 才不會互撞
  }

  document.addEventListener('change', e => {
    const inp = e.target.closest('input[type=file][data-kind]');
    if (inp) { addFiles(Array.from(inp.files), inp.dataset.kind); inp.value = ''; }
    const df = e.target.closest('[data-docfield]');
    if (df) { const d = S.docs.find(x => x.id === df.dataset.doc); if (d) { d[df.dataset.docfield] = df.value; resetItems(); } }
  });
  document.addEventListener('dragover', e => { const z = e.target.closest('.drop'); if (z) { e.preventDefault(); z.classList.add('over'); } });
  document.addEventListener('dragleave', e => { const z = e.target.closest('.drop'); if (z) z.classList.remove('over'); });
  document.addEventListener('drop', e => {
    const z = e.target.closest('.drop');
    if (!z) return;
    e.preventDefault(); z.classList.remove('over');
    addFiles(Array.from(e.dataTransfer.files), z.dataset.kind);
  });
  document.addEventListener('click', e => {
    const t = e.target;
    if (t.id === 'toVerify') go('verify');
    if (t.dataset.force) { const d = S.docs.find(x => x.id === t.dataset.doc); d.forceEye = t.dataset.force; parseDoc(d); resetItems(); render(); }
    if (t.dataset.remove) { S.docs = S.docs.filter(x => x.id !== t.dataset.remove); resetItems(); render(); }
    if (t.dataset.rotate || t.dataset.psm) {
      const d = S.docs.find(x => x.id === (t.dataset.rotate || t.dataset.psm));
      const siblings = S.docs.filter(x => x.file === d.file).map(x => x.id);
      runOcr({ file: d.file, kind: d.kind, rotation: t.dataset.rotate ? (d.rotation + 1) % 4 : d.rotation, psm: t.dataset.psm ? (d.psm === 6 ? 'auto' : 6) : d.psm }, siblings);
    }
  });

  /* ---------- 3 核對 ---------- */
  function candsFor(kind, field) {
    const out = [];
    S.docs.filter(d => d.status === 'done' && d.kind === kind).forEach(d =>
      d.parse.cands.filter(c => c.eye === S.eye && c.field === field).forEach(c => out.push({ c, d })));
    return out;
  }
  function otherEyeCount() {
    return S.docs.filter(d => d.status === 'done').reduce((n, d) => n + d.parse.cands.filter(c => c.eye && c.eye !== S.eye).length, 0);
  }
  function itemKeys() {
    const keys = BIO_ORDER.map(f => 'bio:' + f);
    if (S.docs.some(d => d.kind === 'autoref' && d.status === 'done')) keys.push('ar:K1', 'ar:K2');
    return keys;
  }
  function pairOf(key) { return Object.values(PAIRS).find(p => p.includes(key)); }
  function setsFor(pair) {
    const [a, b] = pair.map(k => S.items[k]);
    return a && b ? IOLParse.pairSets(a.cands, b.cands) : [];
  }
  function resetItems() { S.items = {}; S.setStore = {}; }
  // 每張單子的 K 各自保存修改與核對狀態，切換組別不會互相覆蓋
  function saveSet(pair) {
    pair.forEach(k => {
      const { candId, docId, value, axis, unit, manual, checked } = S.items[k];
      if (docId) S.setStore[k + '@' + docId] = { candId, docId, value, axis, unit, manual, checked };
    });
  }
  function choosePair(pair, set) {
    saveSet(pair);
    [[pair[0], set.a], [pair[1], set.b]].forEach(([k, side]) => Object.assign(S.items[k], S.setStore[k + '@' + set.docId] ||
      Object.assign({ checked: false }, side.pick ? fromCand(side.pick) : { candId: null, docId: set.docId, value: null, axis: null, unit: null, manual: false })));
  }
  function setField(key, set, side) {
    const it = S.items[key];
    if (it.docId === set.docId) return it;
    return S.setStore[key + '@' + set.docId] || (side.pick ? { value: side.pick.c.value, axis: side.pick.c.axis, checked: false } : { value: null, axis: null, checked: false });
  }
  function buildItems() {
    const fresh = [];
    itemKeys().forEach(key => {
      if (S.items[key]) return;
      fresh.push(key);
      const [src, field] = key.split(':');
      const list = candsFor(src === 'bio' ? 'biometry' : 'autoref', field);
      const vals = new Set(list.filter(x => x.c.value != null).map(x => `${x.c.value}|${x.c.axis}`));
      const it = { key, src, field, cands: list, checked: false, manual: false, candId: null, docId: null, value: null, axis: null, unit: null };
      if (!pairOf(key) && list.length && vals.size === 1) {
        const pick = list.find(x => x.c.value != null);
        Object.assign(it, fromCand(pick));
      }
      S.items[key] = it;
    });
    Object.values(PAIRS).filter(p => p.every(k => fresh.includes(k))).forEach(p => {
      const set = IOLParse.defaultSet(setsFor(p));
      if (set) choosePair(p, set);
    });
  }
  function fromCand(x) {
    return { candId: x.c.id, docId: x.d.id, value: x.c.value, axis: x.c.axis, unit: x.c.unit, manual: false };
  }
  function itemState(it) {
    const hasVal = isNum(it.value);
    if (!hasVal) return { cls: 'miss', text: !it.cands.length ? '照片中未找到' : pairOf(it.key) && it.docId && !candPool(it).length ? '此單未找到' : '需選擇／輸入' };
    const cand = it.cands.find(x => x.c.id === it.candId);
    if (it.manual) return { cls: 'check', text: '人工輸入' };
    if (cand && cand.c.status !== 'ok') return { cls: 'check', text: '需確認' };
    return { cls: 'ok', text: '已配對' };
  }
  // 成對欄位只能從已選定的那張單子取值
  function candPool(it) { return pairOf(it.key) ? it.cands.filter(x => x.d.id === it.docId && x.c.value != null) : it.cands; }
  function isRequired(it) { return it.src === 'bio' ? REQUIRED.includes(it.field) : true; }
  function needsAxis(it) { return ['K1', 'K2', 'TK1', 'TK2'].includes(it.field); }

  function progress() {
    if (!S.eye) return { done: 0, total: 0 };
    const items = Object.values(S.items).filter(it => isRequired(it) || isNum(it.value));
    return { done: items.filter(i => i.checked).length, total: items.length };
  }

  function pairK(pair) {
    const [k1, k2] = pair.map(k => S.items[k]);
    return k1 && k2 && k1.docId === k2.docId && isNum(k1.value) && isNum(k2.value) ? { K1: k1.value, K1axis: k1.axis, K2: k2.value, K2axis: k2.axis } : null;
  }
  function bioK() { return pairK(PAIRS.K); }
  function autoK() { return pairK(PAIRS.AR); }
  function kPolar(k) {
    const steep = k.K2 >= k.K1 ? k.K2axis : k.K1axis;
    return { mean: (k.K1 + k.K2) / 2, cyl: Math.abs(k.K2 - k.K1), steep };
  }
  function kCompare(a = bioK(), b = autoK()) {
    if (!a || !b) return null;
    const pa = kPolar(a), pb = kPolar(b);
    let dAx = null;
    if (isNum(pa.steep) && isNum(pb.steep)) { dAx = Math.abs(pa.steep - pb.steep) % 180; if (dAx > 90) dAx = 180 - dAx; }
    const flags = { mean: Math.abs(pb.mean - pa.mean) >= 0.5, cyl: Math.abs(pb.cyl - pa.cyl) >= 0.5,
      axis: dAx != null && pa.cyl >= 0.75 && pb.cyl >= 0.75 && dAx >= 15 };
    return { a: pa, b: pb, dAx, flags, any: flags.mean || flags.cyl || flags.axis };
  }
  function alerts() {
    const out = [];
    const tc = toricCyl();
    if (tc && tc.cyl > 1) out.push({ cls: 'warn', text: `${tc.src}角膜散光 |K1−K2| = ${p2(tc.cyl)} D（> 1 D）：請評估 toric IOL。` });
    const k = bioK() || autoK();
    if (k && (k.K1 + k.K2) / 2 < 40) out.push({ cls: 'warn', text: `平均 K ${p2((k.K1 + k.K2) / 2)} D（< 40 D）：請確認是否有 LASIK／PRK／RK 等屈光手術史。` });
    [['生物測量', PAIRS.K], ['Auto 單', PAIRS.AR]].forEach(([n, p]) => {
      const sets = setsFor(p);
      if (sets.length > 1 && !S.items[p[0]].docId) out.push({ cls: 'warn', text: `${n}有 ${sets.length} 張單子的 K，請點選一組核對；K1、K2 必須來自同一張，每組都可以分別計算。` });
    });
    const cmp = kCompare();
    if (cmp && cmp.any) out.push({ cls: 'bad', text: '生物測量與 auto 單的 K 值差異大，請確認量測品質（見下方比較）。' });
    return out;
  }
  // toric 判斷：優先用 auto 單的角膜散光；沒有 auto 單時用生物測量 K
  function toricCyl() {
    const a = autoK(), b = bioK();
    if (a) return { cyl: Math.abs(a.K2 - a.K1), src: 'Auto 單' };
    if (b) return { cyl: Math.abs(b.K2 - b.K1), src: '生物測量' };
    return null;
  }
  function isToric() { const t = toricCyl(); return !!(t && t.cyl > 1); }
  function isPostRefractive() { return ['LASIK', 'PRK', 'RK', 'SMILE', 'other'].includes(S.history.type); }

  function viewVerify() {
    const bioDocs = S.docs.filter(d => d.status === 'done');
    if (!bioDocs.length) return '<div class="card"><p>尚未有完成辨識的報告，請先上傳。</p></div>';
    const other = otherEyeCount();
    const al = alerts();
    const items = itemKeys().map(k => S.items[k]);
    const bio = items.filter(i => i.src === 'bio'), ar = items.filter(i => i.src === 'ar');
    return `<div class="verify">
      <div class="viewer${S.viewerCollapsed ? ' collapsed' : ''}" id="viewer">
        <div class="viewer-bar">
          ${bioDocs.map((d, i) => `<button type="button" class="tab" data-view="${d.id}" aria-pressed="${(S.viewDoc || bioDocs[0].id) === d.id}">${d.kind === 'autoref' ? 'Auto' : '生物測量'} ${i + 1}${d.pageCount > 1 ? `-${d.page}` : ''}</button>`).join('')}
          <span class="spacer"></span>
          <button type="button" class="btn sm m-only" data-collapse>${S.viewerCollapsed ? '展開原圖' : '收合原圖'}</button>
          <button type="button" class="btn sm" data-zoom="-1">－</button><span class="small" id="zoomTxt">${Math.round(S.zoom * 100)}%</span><button type="button" class="btn sm" data-zoom="1">＋</button>
        </div>
        <div class="viewer-scroll" id="viewerScroll"><div class="stage" id="stage"></div></div>
        <div class="small muted" id="viewerSrc" style="padding:4px 8px;border-top:1px solid var(--line)"></div>
      </div>
      <div class="checklist" id="checklist">
        ${al.map(a => `<div class="msg ${a.cls}">${esc(a.text)}</div>`).join('')}
        ${other ? `<div class="msg info small">另一眼（${S.eye === 'OD' ? 'OS' : 'OD'}）有 ${other} 個數值，已排除，不會採用。</div>` : ''}
        <div class="sec"><h3>生物測量（${S.eye}）<span class="spacer"></span><span class="prog-line">${bio.filter(i => i.checked).length}/${bio.filter(i => isRequired(i) || isNum(i.value)).length} 已核對</span></h3>
          <p class="small muted" style="margin:0">K 為角膜前表面 keratometry；TK 為全角膜，兩者分開，不互相替代。點選項目會在原圖標示位置。</p>
          ${bio.map(i => (i.field === 'K1' ? setsHtml('K', 'K') : i.field === 'TK1' ? setsHtml('TK', 'TK') : '') + itemHtml(i)).join('')}</div>
        ${ar.length ? `<div class="sec"><h3>Auto refraction（${S.eye}）</h3>${setsHtml('AR', 'K')}${ar.map(itemHtml).join('')}${kCompareHtml()}</div>` : ''}
        ${historyHtml()}
        ${lensHtml()}
        ${planHtml()}
        <div class="row" style="margin:6px 0 30px"><button class="btn primary" data-goto="calc">下一步：計算與官網</button>
          <span class="small muted">${progress().done}/${progress().total} 已核對</span></div>
      </div></div>`;
  }

  function itemHtml(it) {
    const st = itemState(it);
    const name = it.src === 'ar' ? `角膜 ${it.field}（auto 單 R${it.field.slice(1)} 的 D 值）` : IOLParse.BIO_FIELDS[it.field].name;
    const d = S.docs.find(x => x.id === it.docId);
    const cand = it.cands.find(x => x.c.id === it.candId);
    const issues = cand ? cand.c.issues : [];
    const pool = candPool(it);
    const conflict = new Set(pool.filter(x => x.c.value != null).map(x => `${x.c.value}|${x.c.axis}`)).size > 1;
    const unit = (IOLParse.BIO_FIELDS[it.field] || { unit: 'D' }).unit;
    const vals = `<label class="f">數值<input type="number" step="0.01" data-item="${it.key}" data-k="value" value="${it.value ?? ''}"></label><span class="unit">${unit}${it.unit && it.unit !== unit ? `（讀到 ${esc(it.unit)}）` : ''}</span>
         ${needsAxis(it) || it.src === 'ar' ? `<label class="f">軸向 °<input type="number" step="1" data-item="${it.key}" data-k="axis" value="${it.axis ?? ''}"></label>` : ''}`;
    return `<div class="item ${it.checked ? 'checked' : ''} ${S.active && S.active.key === it.key ? 'active' : ''}" data-focus="${it.key}">
      <div class="item-head">
        <input type="checkbox" class="big-check" data-check="${it.key}" ${it.checked ? 'checked' : ''} ${st.cls === 'miss' ? 'disabled' : ''} aria-label="已核對 ${esc(name)}">
        <span class="name">${esc(name)}${isRequired(it) ? '' : ' <span class="muted small">（選填）</span>'}</span>
        <span class="state ${st.cls}">${st.text}</span>
      </div>
      ${conflict || pool.length > 1 ? `<div class="cands">${pool.map(x => `<label><input type="radio" name="c-${it.key}" data-pick="${it.key}" value="${x.c.id}" ${x.c.id === it.candId ? 'checked' : ''}>
        ${x.c.value ?? '空白'}${x.c.axis != null ? ' @' + x.c.axis + '°' : ''}
        <span class="muted">（${esc(docLabel(x.d))}）</span></label>`).join('')}</div>` : ''}
      <div class="item-vals">${vals}</div>
      ${issues.length ? `<ul class="issues">${issues.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      ${pairOf(it.key) && it.cands.length && !it.docId ? '<ul class="issues"><li>請先在上方選擇要採用哪一組。</li></ul>' : ''}
      ${pairOf(it.key) && it.docId && it.cands.length && !pool.length ? `<ul class="issues"><li>這張單子沒有讀到此欄位，請看原圖手動輸入；不會用其他單子的數值。</li></ul>` : ''}
      ${!it.cands.length ? `<ul class="issues"><li>照片中沒有找到此欄位。${isRequired(it) ? '此項為計算必要欄位，請確認原始報告後手動輸入。' : '若報告無此項可留空。'}</li></ul>` : ''}
      <div class="src">${d ? `來源：${esc(docLabel(d))}｜${esc(d.device || '儀器未填')}｜報告日期 ${esc(d.date || '未確認')}｜${esc(d.engine)}` : it.manual ? '來源：人工輸入' : ''}</div>
    </div>`;
  }
  // 一組完整且數值合理才計算；OCR 漏小數點（4250）這類讀值要先修正
  function setK(pair, set) {
    const a = setField(pair[0], set, set.a), b = setField(pair[1], set, set.b);
    const { min, max } = IOLParse.BIO_FIELDS.K1;
    if (![a.value, b.value].every(v => isNum(v) && v >= min && v <= max)) return null;
    return { K1: a.value, K1axis: a.axis, K2: b.value, K2axis: b.axis, checked: !!(a.checked && b.checked) };
  }
  function setsHtml(name, label) {
    const pair = PAIRS[name], sets = setsFor(pair);
    if (sets.length < 2) return '';
    const chosen = S.items[pair[0]].docId;
    const base = sets.find(s => s.docId === chosen && setK(pair, s)) || sets.find(s => setK(pair, s));
    const val = (key, s, side, f) => {
      const x = setField(key, s, side);
      if (isNum(x.value)) return `${f} ${x.value}${x.axis != null ? ' @' + x.axis + '°' : ''}${!x.manual && side.pick && side.pick.c.status !== 'ok' ? ' <span class="kdiff">需確認</span>' : ''}`;
      return `${f} ${side.ambiguous ? '多個數值' : '未找到'}`;
    };
    const row = s => {
      const k = setK(pair, s), p = k && kPolar(k), c = k && base && s !== base ? kCompare(setK(pair, base), k) : null;
      return `<label class="kset ${s.docId === chosen ? 'on' : ''}"><input type="radio" name="set-${name}" data-set="${name}" value="${s.docId}" ${s.docId === chosen ? 'checked' : ''}>
        <span><b>${esc(docLabel(s.d))}</b> <span class="muted">${esc(s.d.date || '日期未確認')}</span> ${k && k.checked ? '<span class="state ok">已核對</span>' : '<span class="state check">未核對</span>'}<br>
        ${val(pair[0], s, s.a, label + '1')}　${val(pair[1], s, s.b, label + '2')}
        ${p ? `<br><span class="muted">平均 ${p2(p.mean)}｜散光 ${p2(p.cyl)}</span>` : ''}
        ${c ? `<br><span class="${c.any ? 'kdiff' : 'muted'}">與基準組差：平均 ${s2(c.b.mean - c.a.mean)}｜散光 ${s2(c.b.cyl - c.a.cyl)}${c.dAx == null ? '' : `｜陡軸 ${c.dAx}°`}</span>` : ''}
        ${k && s === base ? '<br><span class="muted small">基準組</span>' : ''}</span></label>`;
    };
    return `<div class="ksets" data-kname="${name}"><div class="small"><b>${label} 組別</b>（${sets.length} 張單子，${label}1、${label}2 一定取自同一張；點選一組後在下方核對）</div>${sets.map(row).join('')}</div>`;
  }
  function docLabel(d) { return `${d.fileName}${d.pageCount > 1 ? ` p${d.page}` : ''}`; }

  function kCompareHtml() {
    const c = kCompare();
    if (!c) return '<p class="small muted">生物測量與 auto 單的 K1、K2 都有數值後，會在這裡比較差異。</p>';
    const f = b => (b ? ' class="flag"' : '');
    return `<h3 style="margin-top:10px">K 值比較（生物測量 vs auto）</h3>
      <table class="t"><tr><th></th><th>生物測量</th><th>Auto</th><th>差</th></tr>
        <tr><td>平均 K</td><td>${p2(c.a.mean)}</td><td>${p2(c.b.mean)}</td><td${f(c.flags.mean)}>${s2(c.b.mean - c.a.mean)}</td></tr>
        <tr><td>角膜散光</td><td>${p2(c.a.cyl)}</td><td>${p2(c.b.cyl)}</td><td${f(c.flags.cyl)}>${s2(c.b.cyl - c.a.cyl)}</td></tr>
        <tr><td>陡軸</td><td>${ax(c.a.steep)}°</td><td>${ax(c.b.steep)}°</td><td${f(c.flags.axis)}>${c.dAx == null ? '—' : c.dAx + '°'}</td></tr></table>
      <p class="small muted">標紅門檻：平均 K 差 ≥ 0.5 D、散光差 ≥ 0.5 D、兩者散光皆 ≥ 0.75 D 時陡軸差 ≥ 15°。</p>`;
  }

  function historyHtml() {
    const h = S.history, post = isPostRefractive();
    const missingTnp = post && !isNum(h.tnp);
    return `<div class="sec"><h3>屈光手術史</h3>
      <div class="grid2"><label class="f">手術史<select data-h="type">${['<option value="">— 請選擇 —</option>'].concat(HISTORY.map(([v, t]) => `<option value="${v}" ${h.type === v ? 'selected' : ''}>${t}</option>`)).join('')}</select></label>
      ${['LASIK', 'PRK', 'SMILE'].includes(h.type) ? `<label class="f">矯正類型<select data-h="myopic"><option value="myopic" ${h.myopic === 'myopic' ? 'selected' : ''}>近視</option><option value="hyperopic" ${h.myopic === 'hyperopic' ? 'selected' : ''}>遠視</option></select></label>` : ''}</div>
      ${post ? `<div class="grid2" style="margin-top:8px">
        <label class="f">Pentacam TNP_Apex_4.0 mm Zone (D)＊<input type="number" step="0.01" data-h="tnp" value="${h.tnp ?? ''}"></label>
        <label class="f">Pentacam 日期<input type="date" data-h="tnpDate" value="${esc(h.tnpDate)}"></label>
        <label class="f">屈光手術矯正量 SE（選填）<input type="number" step="0.25" data-h="lvcSE" value="${h.lvcSE ?? ''}"></label>
        <label class="f">術前 K1（選填）<input type="number" step="0.01" data-h="preK1" value="${h.preK1 ?? ''}"></label>
        <label class="f">術前 K2（選填）<input type="number" step="0.01" data-h="preK2" value="${h.preK2 ?? ''}"></label>
        <label class="f">Atlas 中央角膜度數（選填）<input type="number" step="0.01" data-h="ccp" value="${h.ccp ?? ''}"></label></div>
        ${missingTnp ? '<div class="msg warn small">屈光術後需輸入 Pentacam TNP_Apex_4.0 mm Zone。</div>' : ''}` : ''}</div>`;
  }

  function lensHtml() {
    const L = S.lens;
    const c = IOL_CONSTANTS[L.idx];
    const col = L.alSource === 'ascan' ? 'ascan' : 'srkt';
    const tableVal = c ? c[col] : null;
    const msgs = [];
    if (c && tableVal == null) msgs.push(`原表「${col === 'ascan' ? 'A-scan' : 'SRK/T'}」欄沒有此鏡片的數值，不自動補值；請確認後手動輸入。`);
    if (c && c.status === 'unclear') msgs.push(`常數來源需確認：${c.note}`);
    if (c && isNum(L.A) && tableVal != null && L.A !== tableVal) msgs.push(`目前使用 ${L.A}，與常數表 ${tableVal} 不同，請確認依據。`);
    const ascanDoc = S.docs.some(d => d.device === 'A-scan' && d.id === (S.items['bio:AL'] || {}).docId);
    if (ascanDoc && L.alSource !== 'ascan') msgs.push('眼軸來源報告標記為 A-scan，請確認是否應改用 A-scan 常數。');
    return `<div class="sec"><h3>鏡片與常數</h3>
      <div class="grid2">
        <label class="f" style="grid-column:1/-1">鏡片（院內表／官網參考值）<select data-l="idx"><option value="">— 請選擇 —</option>
          ${IOL_CONSTANTS.map((k, i) => `<option value="${i}" ${String(L.idx) === String(i) ? 'selected' : ''} ${k.status === 'excluded' ? 'disabled' : ''}>${esc(k.maker)} ${esc(k.model)}（A-scan ${k.ascan ?? '缺'}／SRK/T ${k.srkt ?? '缺'}）${k.status === 'excluded' ? '－停用' : ''}</option>`).join('')}</select></label>
        <label class="f">眼軸來源<select data-l="alSource"><option value="optical" ${L.alSource === 'optical' ? 'selected' : ''}>光學（IOLMaster 等）→ SRK/T 欄</option><option value="ascan" ${L.alSource === 'ascan' ? 'selected' : ''}>A-scan → A-scan 欄</option></select></label>
        <label class="f">使用的 A 常數<input type="number" step="0.01" data-l="A" value="${L.A ?? ''}"></label>
      </div>
      ${c && c.source ? `<p class="small muted">此鏡片光學 A 常數來自 <a href="${esc(c.source)}" target="_blank" rel="noopener noreferrer">${esc(c.sourceLabel)}</a>，不是院內原表；遠端公式依各自對照帶入。</p>` : ''}
      ${msgs.map(m => `<div class="msg warn small">${esc(m)}</div>`).join('')}
      ${c && c.status === 'unclear' ? `<label class="row small"><input type="checkbox" data-l="confirmUnclear" ${L.confirmUnclear ? 'checked' : ''}>我已向原始資料確認此常數</label>` : ''}</div>`;
  }

  function planHtml() {
    const P = S.plan;
    return `<div class="sec"><h3>計算設定</h3>
      <div class="grid2">
        <label class="f">目標屈光 (D)<input type="number" step="0.25" data-p="target" value="${P.target ?? ''}"></label>
        <label class="f">SIA (D)<input type="number" step="0.05" data-p="SIA" value="${P.SIA ?? ''}"></label>
        <label class="f">切口位置 (°)<input type="number" step="1" data-p="incision" value="${P.incision ?? ''}"></label>
        <label class="f">年齡（ESCRS 必填）<input type="number" step="1" data-p="age" value="${P.age ?? ''}"></label>
        <label class="f">性別（ESCRS 必填）<select data-p="gender"><option value="">—</option><option value="M" ${P.gender === 'M' ? 'selected' : ''}>男</option><option value="F" ${P.gender === 'F' ? 'selected' : ''}>女</option></select></label>
      </div></div>`;
  }

  // 核對頁事件
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.remote === 'constant') { remote.change(t, false); return; }
    if (t.dataset.item) {
      const it = S.items[t.dataset.item];
      it[t.dataset.k] = toNum(t.value);
      it.manual = true; it.checked = false;
      refreshItem(it);
    }
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.check) { const it = S.items[t.dataset.check]; it.checked = t.checked; refreshItem(it); focusItem(it.key); }
    if (t.dataset.set) {
      const pair = PAIRS[t.dataset.set];
      choosePair(pair, setsFor(pair).find(s => s.docId === t.value));
      rerenderChecklist(); focusItem(pair[0]);
    }
    if (t.dataset.pick) {
      const it = S.items[t.dataset.pick];
      const x = it.cands.find(y => y.c.id === t.value);
      Object.assign(it, fromCand(x)); it.checked = false; refreshItem(it); focusItem(it.key);
    }
    if (t.dataset.h !== undefined) {
      const k = t.dataset.h; S.history[k] = ['tnp', 'preK1', 'preK2', 'lvcSE', 'ccp'].includes(k) ? toNum(t.value) : t.value;
      rerenderChecklist();
    }
    if (t.dataset.l !== undefined) {
      const k = t.dataset.l;
      if (k === 'confirmUnclear') S.lens.confirmUnclear = t.checked;
      else if (k === 'A') S.lens.A = toNum(t.value);
      else {
        S.lens[k] = t.value;
        const c = IOL_CONSTANTS[S.lens.idx];
        S.lens.A = c ? c[S.lens.alSource === 'ascan' ? 'ascan' : 'srkt'] : null;   // 連動常數表，缺值保持空白
        S.lens.confirmUnclear = false;
      }
      rerenderChecklist();
    }
    if (t.dataset.p !== undefined) { const k = t.dataset.p; S.plan[k] = k === 'gender' ? t.value : toNum(t.value); rerenderChecklist(); }
  });
  document.addEventListener('click', e => {
    const t = e.target;
    const f = t.closest('[data-focus]');
    if (f && !t.closest('input[type=checkbox]')) focusItem(f.dataset.focus);
    if (t.dataset.view) { S.viewDoc = t.dataset.view; S.active = null; drawViewer(); $$('[data-view]').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === S.viewDoc)); }
    if (t.dataset.zoom) { S.zoom = Math.min(6, Math.max(0.5, S.zoom + Number(t.dataset.zoom) * 0.25)); drawViewer(); }
    if (t.dataset.goto) go(t.dataset.goto);
    if (t.dataset.collapse !== undefined) setCollapsed(!S.viewerCollapsed);
  });
  function setCollapsed(v) {
    S.viewerCollapsed = v;
    const vw = $('#viewer'); if (!vw) return;
    vw.classList.toggle('collapsed', v);
    const b = vw.querySelector('[data-collapse]'); if (b) b.textContent = v ? '展開原圖' : '收合原圖';
  }
  document.addEventListener('focusin', e => { const f = e.target.closest && e.target.closest('[data-focus]'); if (f) focusItem(f.dataset.focus); });

  function rerenderChecklist() {
    const cl = $('#checklist'); if (!cl) return;
    const top = cl.scrollTop;
    const active = document.activeElement;
    const sel = active && active.dataset ? Object.entries(active.dataset).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}="${v}"]`).join('') : '';
    const tmp = document.createElement('div'); tmp.innerHTML = viewVerify();
    cl.innerHTML = tmp.querySelector('#checklist').innerHTML;
    cl.scrollTop = top;   // 只更新右側清單，左圖與捲動位置不動
    if (sel) { const el = cl.querySelector(sel); if (el && el.type !== 'checkbox') el.focus(); }
    renderTop();
  }
  function refreshItem(it) {
    const el = $(`.item[data-focus="${it.key}"]`);
    if (!el) return;
    const st = itemState(it);
    el.classList.toggle('checked', it.checked);
    const badge = el.querySelector('.state'); badge.className = 'state ' + st.cls; badge.textContent = st.text;
    const cb = el.querySelector('[data-check]'); cb.disabled = st.cls === 'miss'; cb.checked = it.checked;
    const name = Object.keys(PAIRS).find(n => PAIRS[n].includes(it.key));
    const box = name && $(`.ksets[data-kname="${name}"]`);
    if (box) box.outerHTML = setsHtml(name, name === 'TK' ? 'TK' : 'K');
    const al = alerts();
    // 提醒與比較可能改變：只更新這些區塊
    const cl = $('#checklist');
    $$('#checklist > .msg').forEach(m => m.remove());
    cl.insertAdjacentHTML('afterbegin', al.map(a => `<div class="msg ${a.cls}">${esc(a.text)}</div>`).join(''));
    renderTop();
  }

  function focusItem(key) {
    const it = S.items[key];
    if (!it) return;
    if (S.viewerCollapsed) setCollapsed(false);   // 手機收合原圖時，點項目自動展開
    $$('.item.active').forEach(x => x.classList.remove('active'));
    const el = $(`.item[data-focus="${key}"]`); if (el) el.classList.add('active');
    const cand = it.cands.find(x => x.c.id === it.candId) || (pairOf(key) && it.docId ? candPool(it) : it.cands)[0];
    S.active = cand ? { key, docId: cand.d.id, tokens: cand.c.tokens } : { key, docId: null, tokens: [] };
    if (cand && S.viewDoc !== cand.d.id) { S.viewDoc = cand.d.id; $$('[data-view]').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === S.viewDoc)); }
    drawViewer(true);
  }

  /* 雙指縮放只作用在原圖：改 stage 寬度，並讓兩指中心點保持在原位 */
  let pinch = null;
  const touchDist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  document.addEventListener('touchstart', e => {
    const sc = e.target.closest && e.target.closest('#viewerScroll');
    if (!sc || e.touches.length !== 2) return;
    const r = sc.getBoundingClientRect();
    pinch = { sc, d0: touchDist(e.touches), z0: S.zoom,
      cx: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top };
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const stage = $('#stage'); if (!stage) return;
    const { sc, cx, cy } = pinch;
    const z = Math.min(6, Math.max(0.5, pinch.z0 * touchDist(e.touches) / pinch.d0));
    const ratio = z / S.zoom;
    const px = sc.scrollLeft + cx, py = sc.scrollTop + cy;
    S.zoom = z;
    stage.style.width = (z * 100) + '%';
    sc.scrollLeft = px * ratio - cx; sc.scrollTop = py * ratio - cy;
    $('#zoomTxt').textContent = Math.round(z * 100) + '%';
  }, { passive: false });
  document.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; });
  document.addEventListener('gesturestart', e => { if (e.target.closest && e.target.closest('#viewerScroll')) e.preventDefault(); });   // iOS Safari 的整頁縮放手勢

  function drawViewer(scrollTo) {
    const stage = $('#stage'); if (!stage) return;
    const docs = S.docs.filter(d => d.status === 'done');
    const d = docs.find(x => x.id === S.viewDoc) || docs[0];
    if (!d) return;
    S.viewDoc = d.id;
    $('#zoomTxt').textContent = Math.round(S.zoom * 100) + '%';
    stage.style.width = (S.zoom * 100) + '%';
    const rect = t => `left:${t.x0 * 100}%;top:${t.y0 * 100}%;width:${(t.x1 - t.x0) * 100}%;height:${(t.y1 - t.y0) * 100}%`;
    const mine = d.parse.cands.filter(c => c.eye === S.eye).flatMap(c => c.tokens);
    const hl = S.active && S.active.docId === d.id ? S.active.tokens : [];
    stage.innerHTML = `<img src="${d.imageUrl}" alt="原始報告影像">` +
      mine.filter(t => !hl.includes(t)).map(t => `<div class="ov" style="${rect(t)}"></div>`).join('') +
      hl.map(t => `<div class="ov hl" style="${rect(t)}"></div>`).join('');
    $('#viewerSrc').textContent = `${docLabel(d)}｜${d.device || '儀器未填'}｜報告日期 ${d.date || '未確認'}｜${d.engine}` +
      (S.active && S.active.docId === d.id ? '｜橘框為目前項目的欄名、數值、單位與軸向' : '');
    if (scrollTo && hl.length) {
      const sc = $('#viewerScroll');
      const img = stage.querySelector('img');
      const go = () => {
        const y0 = Math.min.apply(null, hl.map(t => t.y0)) * img.clientHeight, x0 = Math.min.apply(null, hl.map(t => t.x0)) * img.clientWidth;
        sc.scrollTo({ top: Math.max(0, y0 - sc.clientHeight / 3), left: Math.max(0, x0 - sc.clientWidth / 4), behavior: 'smooth' });
      };
      if (img.complete) go(); else img.onload = go;
    }
  }

  /* ---------- 4 計算與官網 ---------- */
  function valueOf(field) { const it = S.items['bio:' + field]; return it && isNum(it.value) ? it.value : null; }
  function checkedValue(field) { const it = S.items['bio:' + field]; return it && it.checked && isNum(it.value) ? it.value : null; }
  function axisOf(field) { const it = S.items['bio:' + field]; return it && isNum(it.axis) ? it.axis : null; }
  // 複製到官網前必須核對的項目；選填欄位未核對時可複製，但不送出
  function requiredUnverified() {
    const out = [];
    ['bio:AL', 'bio:ACD'].forEach(k => { const it = S.items[k]; if (!it || !it.checked) out.push(k.slice(4)); });
    const act = activeSet();
    if (!act) out.push('K1、K2'); else if (!act.checked) out.push(`${act.label} 的 K1、K2`);
    if (isPostRefractive() && !isNum(S.history.tnp)) out.push('Pentacam TNP_Apex_4.0 mm');
    const c = IOL_CONSTANTS[S.lens.idx];
    if (!c || !isNum(S.lens.A)) out.push('鏡片與 A 常數'); else if (c.status === 'unclear' && !S.lens.confirmUnclear) out.push('確認鏡片常數');
    if (!isNum(S.plan.target)) out.push('目標屈光');
    return out;
  }
  function optionalUnverified() {
    return Object.values(S.items).filter(it => it.src === 'bio' && !REQUIRED.includes(it.field) && isNum(it.value) && !it.checked).map(it => it.field);
  }
  function payload() {
    const act = activeSet(), k = act && act.k;
    const c = IOL_CONSTANTS[S.lens.idx];
    return {
      iolHelper: 1, createdAt: Date.now(), expiresAt: Date.now() + 2 * 3600 * 1000, kSet: act ? act.label : '',
      eye: S.eye, caseCode: S.caseCode || undefined,
      AL: checkedValue('AL'), ACD: checkedValue('ACD'), LT: checkedValue('LT'), WTW: checkedValue('WTW'), CCT: checkedValue('CCT'),
      K1: k ? k.K1 : null, K1axis: k ? k.K1axis : null, K2: k ? k.K2 : null, K2axis: k ? k.K2axis : null, kIndex: 1.3375,
      target: S.plan.target, A: S.lens.A, lensName: c ? `${c.maker} ${c.model}` : null,
      SIA: S.plan.SIA, incisionAxis: S.plan.incision, age: S.plan.age, gender: S.plan.gender || null,
      toric: isToric(), postRefractive: isPostRefractive() ? S.history.type : null,
      tnp4: S.history.tnp, ccp: S.history.ccp, preK1: S.history.preK1, preK2: S.history.preK2, lvcSE: S.history.lvcSE,
      escrsConstants: S.escrsConstants,
    };
  }
  function remoteContext() {
    const blockers = [];
    const missing = requiredUnverified();
    if (missing.length) blockers.push('請先完成必要核對：' + missing.join('、'));
    if (S.history.type !== 'none') blockers.push('遠端查詢目前僅支援已確認無角膜屈光手術的標準 SE');
    if (S.lens.alSource !== 'optical') blockers.push('目前遠端查詢只支援光學生物測量，A-scan 請使用官網');
    const lens = IOL_CONSTANTS[S.lens.idx];
    const alDoc = S.docs.find(d => d.id === (S.items['bio:AL'] || {}).docId);
    return { data: payload(), history: S.history.type, caseKey: S.remoteCaseKey, blockers,
      lens: lens ? { maker: lens.maker, model: lens.model, alSource: S.lens.alSource } : null,
      biometer: alDoc ? ({ IOLMaster: 'Other', Lenstar: 'Lenstar', Argos: 'Argos' })[alDoc.device] || '' : '' };
  }
  function bookmarkletHref() {
    // 去掉縮排與整行註解以縮短書籤（保留換行，避免改變語意）
    const src = window.IOL_FILL_MAIN.toString().split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//')).join('\n');
    return 'javascript:' + encodeURIComponent(`(${src})()`);
  }

  function formulaSet(k) {
    if (!k) return null;
    const K = (k.K1 + k.K2) / 2;
    const base = { AL: valueOf('AL'), ACD: valueOf('ACD'), K, A: S.lens.A };
    return [['SRK/T', () => IOLFormulas.srkt(base)], ['Holladay 1', () => IOLFormulas.holladay1(base)], ['Hoffer Q', () => IOLFormulas.hofferQ(base)]]
      .map(([n, mk]) => { try { const f = mk(); return { n, f, P: f.power(S.plan.target || 0), table: IOLFormulas.powerTable(f, S.plan.target || 0, 0.5) }; } catch (e) { return { n, err: e.message }; } });
  }

  // 每張單子的 K 都是一組：可分別跑後續計算，AL、ACD 等沿用核對頁同一份
  function kSetList() {
    const out = [];
    [['K', '生物測量'], ['AR', 'Auto 單']].forEach(([name, n]) => {
      const pair = PAIRS[name];
      if (!S.items[pair[0]]) return;
      setsFor(pair).forEach(s => {
        const k = setK(pair, s);
        if (k) out.push({ id: `${name}:${s.docId}`, label: `${s.d.device || n}｜${docLabel(s.d)}`, date: s.d.date, k, checked: k.checked });
      });
      const typed = !S.items[pair[0]].docId && pairK(pair);
      if (typed) out.push({ id: `${name}:manual`, label: `${n}｜人工輸入`, date: '', k: typed, checked: S.items[pair[0]].checked && S.items[pair[1]].checked });
    });
    return out;
  }
  function activeSet() {
    const list = kSetList();
    return list.find(x => x.id === S.kActive) || list.find(x => x.checked) || list[0] || null;
  }
  function kSetsHtml() {
    const list = kSetList(), act = activeSet();
    if (!list.length) return '';
    const base = formulaSet(act.k);
    const rows = list.map(x => {
      const on = x.id === act.id, pol = kPolar(x.k), res = formulaSet(x.k);
      const axis = v => (v != null ? ' @' + v + '°' : '');
      return `<label class="kset ${on ? 'on' : ''}"><input type="radio" name="kset" value="${esc(x.id)}" ${on ? 'checked' : ''} data-kset>
        <span><b>${esc(x.label)}</b> <span class="muted">${esc(x.date || '日期未確認')}</span> ${x.checked ? '<span class="state ok">已核對</span>' : '<span class="state check">未核對</span>'}<br>
        K1 ${p2(x.k.K1)}${axis(x.k.K1axis)}　K2 ${p2(x.k.K2)}${axis(x.k.K2axis)}<span class="muted">｜平均 ${p2(pol.mean)}｜散光 ${p2(pol.cyl)}</span><br>
        ${res.map((r, i) => (r.err ? `${r.n} —` : `${r.n} <b>${p2(r.P)}</b>${!on && base[i] && !base[i].err ? ` <span class="muted">(${s2(r.P - base[i].P)})</span>` : ''}`)).join('　')}</span></label>`;
    });
    return `<div class="card"><h2>K 組</h2><p class="small muted">每張單子的 K1、K2 是一組。選哪一組，下方公式、Toric、屈光術後與官網填入就用哪一組；AL、ACD 等其他數值沿用核對頁。括號為與目前選定組的度數差。</p>${rows.join('')}</div>`;
  }

  function viewCalc() {
    const miss = requiredUnverified();
    const optMiss = optionalUnverified();
    buildItems();
    const act = activeSet(), bk = act && act.k;
    const A = formulaSet(bk);
    const cards = A ? A.map(x => x.err ? `<div class="fcard"><h3>${x.n}</h3><div class="small muted">${esc(x.err)}</div></div>` :
      `<div class="fcard"><h3>${x.n}</h3><div class="big">${p2(x.P)} D</div><div class="small muted">${esc(act.label)}｜ELP ${p2(x.f.ELP)} mm</div>
        <table class="t">${x.table.rows.map(r => `<tr><td>${p2(r.power)}</td><td>${s2(r.refraction)}</td></tr>`).join('')}</table></div>`).join('') : '<p class="muted">缺少 K1／K2，無法計算。</p>';
    let toric = '';
    if (bk && (isToric() || Math.abs(bk.K2 - bk.K1) >= 1)) {
      try {
        const plan = IOLFormulas.toricPlan(Object.assign({ AL: valueOf('AL'), A: S.lens.A, SIA: S.plan.SIA, incisionAxis: S.plan.incision,
          cylinders: [1.0, 1.5, 2.25, 3.0, 3.75, 4.5].map((c, i) => ({ name: 'T' + (i + 2), cyl: c })) }, bk));
        toric = `<div class="card"><h2>Toric 平台估算（非 Barrett Toric）</h2>
          <p class="small">前表面 ${p2(plan.anterior.mag)} D @${ax(plan.anterior.axis)}°｜Abulafia-Koch 估算總角膜 ${p2(plan.total.mag)} D @${ax(plan.total.axis)}°｜含 SIA ${p2(plan.net.mag)} D @${ax(plan.net.axis)}°｜<b>建議軸向 ${ax(plan.placementAxis)}°</b></p>
          <table class="t"><tr><th>IOL 平面柱鏡（範例級距）</th><th>角膜平面</th><th>殘餘散光</th></tr>${plan.options.map(o => `<tr><td>${o.name}（${p2(o.cylIOL)}）</td><td>${p2(o.cylCornea)}</td><td>${p2(o.residual)} @${ax(o.residualAxis)}°</td></tr>`).join('')}</table>
          <p class="small muted">柱鏡級距為範例，請依實際鏡片規格；正式選擇請以 Barrett Toric 官網結果為準。</p></div>`;
      } catch (e) { toric = ''; }
    }
    let post = '';
    if (isPostRefractive() && bk) {
      const K = (bk.K1 + bk.K2) / 2;
      const rows = [];
      if (S.history.myopic === 'myopic' && ['LASIK', 'PRK', 'SMILE'].includes(S.history.type)) {
        rows.push(`Haigis-L 校正 K：${p2(337.5 / IOLFormulas.haigisLRadius(K))} D（Haigis 需 a0/a1/a2，未提供時僅顯示校正 K）`);
        rows.push(`Shammas 校正 K（1.14K − 6.8）：${p2(IOLFormulas.shammasKc(K))} D`);
        if (isNum(S.history.ccp)) rows.push(`Wang-Koch-Maloney 校正 K：${p2(IOLFormulas.wkmKc(S.history.ccp))} D`);
        if (isNum(S.history.lvcSE) && A && A[0].f) rows.push(`Masket：${p2(A[0].P + IOLFormulas.masketAdjust(S.history.lvcSE))} D；Modified Masket：${p2(A[0].P + IOLFormulas.modMasketAdjust(S.history.lvcSE))} D（以 SRK/T 為基礎；正負號慣例請核對原文）`);
      }
      rows.push(`Pentacam TNP_Apex_4.0 mm：${p2(S.history.tnp)} D（Potvin-Hill 係數未公開，請用 ASCRS 官網）`);
      post = `<div class="card"><h2>屈光術後（已公開的校正方法）</h2><ul class="small">${rows.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
        <div class="msg warn small">屈光術後請以 ASCRS 官網結果為主；以上僅供交叉參考。</div></div>`;
    }
    const sites = ['escrs', 'barrett'].concat(isToric() || (bk && Math.abs(bk.K2 - bk.K1) >= 1) ? ['toric'] : []).concat(isPostRefractive() ? ['ascrs'] : []);
    const others = Object.keys(OFFICIAL).filter(k => !sites.includes(k));
    const siteCard = k => `<div class="card"><h3>${OFFICIAL[k].name}</h3><div class="small muted">${OFFICIAL[k].group}${k === 'ascrs' ? '｜欄位對應尚未實測' : ''}</div>
      <div class="row" style="margin-top:8px"><button class="btn primary sm" data-copy="${k}" ${miss.length ? 'disabled' : ''}>複製資料並開啟官網</button></div></div>`;
    return `${miss.length ? `<div class="msg warn">必要項目尚未完成：${esc(miss.join('、'))}。完成後才能複製資料到官網。</div>` : '<div class="msg ok">必要項目已完成，可以複製到官網。</div>'}
      ${optMiss.length ? `<div class="msg info small">選填欄位未核對：${esc(optMiss.join('、'))}。這些數值不會送到官網；若要使用，請回上一步核對。</div>` : ''}
      ${alerts().map(a => `<div class="msg ${a.cls}">${esc(a.text)}</div>`).join('')}
      ${kSetsHtml()}
      <div class="card"><h2>平台內建公式（公開公式，非官網結果）</h2>
        <p class="small muted">A 常數 ${S.lens.A ?? '—'}（${S.lens.alSource === 'ascan' ? 'A-scan 欄' : 'SRK/T 欄'}）｜目標 ${s2(S.plan.target)} D${act ? `｜K：${esc(act.label)}` : ''}</p>
        <div class="cards">${cards}</div></div>
      ${remote.render(remoteContext())}
      ${toric}${post}
      <div class="card"><h2>官方網站：一鍵填入</h2>
        <ol class="small">
          <li>第一次使用：把這個按鈕拖曳到瀏覽器書籤列 → <a class="bm" id="bmLink" href="#">IOL 小幫手填入</a>（只需安裝一次）
            <details class="m-help"><summary>iPhone：用捷徑填入（建議）</summary>
              <ol><li>安裝捷徑：<a href="IOL%E5%B0%8F%E5%B9%AB%E6%89%8B%E5%A1%AB%E5%85%A5.shortcut" download>下載「IOL小幫手填入」捷徑</a>，在 Safari 下載項目點開，選「加入捷徑」。</li>
                <li>第一次使用前：到 iPhone「設定 › App › 捷徑 › 進階」（iOS 17 以前為「設定 › 捷徑 › 進階」），開啟「允許執行腳本」。</li>
                <li>在小幫手按「複製資料並開啟官網」，到官網頁面按 Safari 的「分享」，選「IOL小幫手填入」。</li>
                <li>第一次在每個官網執行時，捷徑會詢問是否允許存取該網站，選「允許」。</li></ol>
              <div class="small muted">從主畫面的小幫手 App 使用時，按「複製資料並開啟官網」會自動切到 Safari 開官網（需 iOS 17 以上），小幫手留在背景，資料不會消失。</div>
              <div class="small muted">捷徑內含填入程式；小幫手更新填入功能後需重新下載安裝。</div></details>
            <details class="m-help"><summary>手機或平板無法拖曳？（書籤做法）</summary>
              <ol><li>按 <button class="btn sm" id="bmCopy" type="button">複製書籤程式碼</button></li>
                <li>把目前這頁加入書籤（Safari：分享 › 加入書籤；Chrome：⋮ › ☆）。</li>
                <li>編輯那個書籤：名稱改成「IOL 小幫手填入」，網址整段刪掉，貼上剛才複製的內容後儲存。</li>
                <li>在官網分頁使用：Safari 從書籤列表點它；Chrome 在網址列輸入「IOL 小幫手填入」，點選書籤建議項目。</li></ol></details></li>
          <li>按下方「複製資料並開啟官網」，會複製這個個案已核對的資料並開新分頁。</li>
          <li>在官網分頁點書籤列的「IOL 小幫手填入」，欄位會自動填入並以橘框標示，右上角列出已填與未填欄位。</li>
          <li>核對後由你自己按 Calculate。網站的使用條款、驗證碼請自行處理。</li>
        </ol>
        <div class="row small">
          <span class="row">送到官網的 K：<b>${act ? esc(act.label) : '尚未有完整的 K 組'}</b></span>
          <label class="row"><input type="checkbox" data-escrsc ${S.escrsConstants ? 'checked' : ''}>ESCRS 各公式常數也填入同一 A 常數（預設不填，由網站依鏡片帶入）</label>
        </div>
        <h3 style="margin-top:10px">本個案建議</h3><div class="official">${sites.map(siteCard).join('')}</div>
        ${others.length ? `<details style="margin-top:8px"><summary class="small">其他計算器</summary><div class="official" style="margin-top:8px">${others.map(siteCard).join('')}</div></details>` : ''}
        <div id="copyMsg"></div></div>
      <div class="card"><h2>匯出</h2><button class="btn" id="exportBtn">下載核對紀錄 JSON（不含影像）</button>
        <span class="small muted">內容含醫療量測與檔名，請依院內規範保存。</span></div>`;
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    }
  }
  document.addEventListener('click', async e => {
    const t = e.target;
    const remoteButton = t.closest('[data-remote-query]');
    if (remoteButton && !remoteButton.disabled) remote.query(remoteButton.dataset.remoteQuery);
    const remoteAction = t.closest('[data-remote-action]');
    if (remoteAction) remote.action(remoteAction.dataset.remoteAction, remoteAction.dataset.provider);
    if (t.id === 'bmLink') { e.preventDefault(); alert('請把這個按鈕「拖曳」到瀏覽器的書籤列，不要直接點。手機請用下方「複製書籤程式碼」。'); }
    if (t.id === 'bmCopy') { const ok = await copyText(bookmarkletHref()); t.textContent = ok ? '已複製' : '複製失敗'; }
    if (t.dataset.copy) {
      const site = OFFICIAL[t.dataset.copy];
      const data = payload();
      if (standalone) {
        // 先複製再用 x-safari- 網址交給 Safari（iOS 17+），小幫手留在背景、資料不會消失
        const ok = await copyText(JSON.stringify(data));
        $('#copyMsg').innerHTML = ok
          ? `<div class="msg ok">已複製 ${S.eye}（${data.kSet}）資料，正在用 Safari 開啟 ${esc(site.name)}。到官網按「分享」選「IOL小幫手填入」。沒有跳到 Safari 時，請按 <a href="${esc(site.url)}" target="_blank" rel="noopener">這個連結</a> 後選「在 Safari 中打開」。</div>`
          : '<div class="msg bad">無法寫入剪貼簿，請確認瀏覽器權限。</div>';
        if (ok) { toSafari = true; location.href = 'x-safari-' + site.url; setTimeout(() => { toSafari = false; }, 1500); }
        return;
      }
      const win = window.open(site.url, '_blank', 'noopener');
      const ok = await copyText(JSON.stringify(data));
      $('#copyMsg').innerHTML = ok
        ? `<div class="msg ok">已複製 ${S.eye}（${data.kSet}）資料${win ? '並開啟' : '。瀏覽器擋下新分頁，請自行開啟'} ${esc(site.name)}。到官網分頁點書籤「IOL 小幫手填入」。</div>`
        : '<div class="msg bad">無法寫入剪貼簿，請確認瀏覽器權限。</div>';
    }
    if (t.id === 'exportBtn') {
      const rec = { exportedAt: new Date().toISOString(), eye: S.eye, caseCode: S.caseCode,
        docs: S.docs.filter(d => d.status === 'done').map(d => ({ file: d.fileName, page: d.page, kind: d.kind, device: d.device, date: d.date, engine: d.engine, uploadedAt: d.uploadedAt })),
        kSets: kSetList().map(x => ({ label: x.label, date: x.date, K1: x.k.K1, K1axis: x.k.K1axis, K2: x.k.K2, K2axis: x.k.K2axis, checked: x.checked, used: x.id === (activeSet() || {}).id })),
        items: Object.values(S.items).map(it => ({ field: (it.src === 'ar' ? 'auto ' : '') + it.field, value: it.value, axis: it.axis, checked: it.checked, manual: it.manual,
          source: (S.docs.find(d => d.id === it.docId) || {}).fileName || null })),
        history: S.history, lens: Object.assign({}, S.lens, { name: (IOL_CONSTANTS[S.lens.idx] || {}).model }), plan: S.plan };
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(rec, null, 2)], { type: 'application/json' }));
      a.download = `iol-check-${S.caseCode || 'case'}-${S.eye}.json`; a.click();
    }
  });
  document.addEventListener('change', e => {
    if (remote.change(e.target)) return;
    if (e.target.dataset.kset !== undefined) { S.kActive = e.target.value; if (S.step === 'calc') render(); }
    if (e.target.dataset.escrsc !== undefined) S.escrsConstants = e.target.checked;
  });

  // 書籤連結在畫面產生後補上 href（避免 innerHTML 中出現超長字串）
  new MutationObserver(() => { const a = $('#bmLink'); if (a && a.getAttribute('href') === '#') a.setAttribute('href', bookmarkletHref()); })
    .observe($('#main'), { childList: true, subtree: true });

  render();
})();
