/*
 * 官網一鍵填入（書籤小程式）
 * 使用者在自己的瀏覽器開官網 → 點書籤 → 讀取剪貼簿中核對完成的資料 → 填入欄位並標示。
 * 不按 Calculate、不接受條款、不處理驗證碼；填完列出成功與未填欄位，由使用者核對後自行計算。
 * 此函式會被 toString() 轉成 javascript: 書籤，因此必須完全自足、不可引用外部變數。
 */
window.IOL_FILL_MAIN = async function () {
  'use strict';
  const PANEL_ID = '__iol_fill_panel';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fmt = v => (v === null || v === undefined || v === '' ? null : String(v));

  async function readPayload() {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch (e) { text = ''; }
    if (!/"iolHelper"/.test(text)) text = window.prompt('請貼上 IOL 核對小幫手複製的資料（Cmd/Ctrl+V）：') || '';
    try {
      const d = JSON.parse(text);
      if (d.iolHelper !== 1) throw new Error();
      return d;
    } catch (e) { return null; }
  }

  const done = [], missing = [], notes = [];
  function mark(el, label, value) {
    el.style.outline = '3px solid #ff8a00';
    el.style.outlineOffset = '1px';
    el.title = 'IOL 小幫手填入：' + label;
    done.push({ label, value, el });
  }
  function setNative(el, v) {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function fill(el, label, value) {
    const v = fmt(value);
    if (v === null) return;
    if (!el) { missing.push(label + '（找不到欄位）'); return; }
    el.focus(); setNative(el, v); el.blur();
    mark(el, label, v);
  }

  /* ---------- APACRS Barrett Universal II ---------- */
  function apacrsKIndex(d) {
    const want = d.kIndex === 1.332 ? '332' : '337.5';
    const r = [...document.querySelectorAll('input[name$="RadioButtonList1"]')].find(x => x.value === want);
    if (r && !r.checked) { notes.push(`網站 K index 與資料（${d.kIndex}）不同，請先手動切換 K index（切換會重新載入頁面），再點一次書籤。`); return false; }
    return true;
  }
  function personalConstant(d) {
    const sel = document.getElementById('MainContent_IOLModel');
    if (sel && sel.value !== 'Personal Constant') { sel.value = 'Personal Constant'; mark(sel, 'IOL Model', 'Personal Constant'); }
    const lf = document.getElementById('MainContent_LensFactor');
    if (lf && lf.value) { setNative(lf, ''); notes.push('已清空 Lens Factor，改用 A constant。'); }
    fill(document.getElementById('MainContent_Aconstant'), 'A Constant', d.A);
    // Patient Name（網站必填）與 Patient ID 都填使用者輸入的病歷號
    [['MainContent_PatientName', 'Patient Name'], ['MainContent_PatientNo', 'Patient ID']].forEach(([id, label]) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (d.caseCode) fill(el, label + '（病歷號）', d.caseCode);
      else if (!el.value) missing.push(label + '（小幫手第一步未輸入病歷號）');
    });
  }
  function fillBarrett(d) {
    if (!apacrsKIndex(d)) return;
    const s = d.eye === 'OS' ? '0' : '';
    const g = id => document.getElementById('MainContent_' + id + s);
    personalConstant(d);
    fill(g('Axlength'), 'Axial Length', d.AL);
    fill(g('MeasuredK1'), 'Measured K1', d.K1);
    fill(g('MeasuredK2'), 'Measured K2', d.K2);
    fill(g('OpticalACD'), 'Optical ACD', d.ACD);
    fill(g('Refraction'), 'Refraction（目標）', d.target);
    fill(g('LensThickness'), 'Lens Thickness', d.LT);
    fill(g('WTW'), 'WTW', d.WTW);
    const other = d.eye === 'OS' ? '' : '0';
    const otherAL = document.getElementById('MainContent_Axlength' + other);
    if (otherAL && otherAL.value) notes.push('另一眼欄位已有數值，請確認不是舊資料。');
  }

  /* ---------- APACRS Barrett Toric ---------- */
  function fillToric(d) {
    if (!apacrsKIndex(d)) return;
    const r = document.getElementById(d.eye === 'OS' ? 'MainContent_Rad2' : 'MainContent_Rad1');
    if (r) { r.checked = true; r.dispatchEvent(new Event('click', { bubbles: true })); mark(r, '眼別', d.eye); }
    else missing.push('眼別選項');
    personalConstant(d);
    const g = id => document.getElementById('MainContent_' + id);
    const flatIsK1 = d.K1 <= d.K2;
    fill(g('MeasuredK'), 'Flat K', flatIsK1 ? d.K1 : d.K2);
    fill(g('MeasuredAxis'), 'Flat Axis', flatIsK1 ? d.K1axis : d.K2axis);
    fill(g('MeasuredK0'), 'Steep K', flatIsK1 ? d.K2 : d.K1);
    fill(g('MeasuredAxis0'), 'Steep Axis', flatIsK1 ? d.K2axis : d.K1axis);
    fill(g('AxLength'), 'Axial Length', d.AL);
    fill(g('OpticalACD'), 'Optical ACD', d.ACD);
    fill(g('Refraction'), 'Target Refraction', d.target);
    fill(g('InducedCyl'), 'Incision SIA', d.SIA);
    fill(g('IncisionAxis'), 'Incision Location', d.incisionAxis);
    fill(g('LensThickness'), 'Lens Thickness', d.LT);
    fill(g('WTW'), 'WTW', d.WTW);
  }

  /* ---------- ESCRS（MudBlazor，依欄名定位） ---------- */
  function escrsSection(eye) {
    const want = eye === 'OS' ? /^\s*OS\s*Left/ : /^\s*OD\s*Right/;
    return [...document.querySelectorAll('div')].filter(el => want.test(el.innerText || '') && el.querySelectorAll('input').length >= 8)
      .sort((a, b) => a.querySelectorAll('input').length - b.querySelectorAll('input').length)[0] || null;
  }
  function byLabel(scope, re) {
    return [...scope.querySelectorAll('input')].find(i => {
      const c = i.closest('.mud-input-control, .mud-checkbox, .mud-switch');
      const lab = c && (c.querySelector('label') || {}).innerText;
      return lab && re.test(lab.trim());
    }) || null;
  }
  async function escrsToggle(scope, re, want, label) {
    const cb = [...scope.querySelectorAll('input[type=checkbox]')].find(i => re.test((i.closest('label, .mud-switch, .mud-checkbox') || {}).innerText || ''));
    if (!cb) { missing.push(label + '（找不到開關）'); return; }
    if (cb.checked !== want) { cb.click(); await sleep(400); }
    if (want) mark(cb, label, '開啟');
  }
  async function escrsSelect(input, optionText, label) {
    if (!input) { missing.push(label + '（找不到欄位）'); return; }
    const host = input.closest('.mud-input-control');
    (host && host.querySelector('.mud-input')) && host.querySelector('.mud-input').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    input.click();
    await sleep(500);
    const opt = [...document.querySelectorAll('.mud-popover-open .mud-list-item')].find(e => e.innerText.trim() === optionText);
    if (opt) { opt.click(); await sleep(300); mark(input, label, optionText); }
    else { document.body.click(); missing.push(label + '（選項不符，請手動選擇）'); }
  }
  async function fillEscrs(d) {
    if (/I AGREE/.test(document.body.innerText) && !escrsSection(d.eye)) { notes.push('請先閱讀並自行按「I AGREE」接受使用條款，再點一次書籤。'); return; }
    const sec = escrsSection(d.eye);
    if (!sec) { missing.push(d.eye + ' 區塊（找不到）'); return; }
    const top = document;
    if (d.surgeon) fill(byLabel(top, /^Surgeon$/), 'Surgeon', d.surgeon);
    if (d.caseCode) fill(byLabel(top, /^Id$/), 'Id（病歷號）', d.caseCode);
    if (d.age != null) fill(byLabel(top, /^Age$/), 'Age', d.age);
    else missing.push('Age（網站必填，資料未提供）');
    if (d.gender) await escrsSelect(byLabel(top, /^Gender$/), d.gender === 'F' ? 'Female' : 'Male', 'Gender');
    else missing.push('Gender（網站必填，資料未提供）');
    if (d.toric) await escrsToggle(sec, /^\s*Toric\s*$/, true, 'Toric');
    if (d.postRefractive) await escrsToggle(sec, /Post LASIK/, true, 'Post LASIK/PRK/RK');
    fill(byLabel(sec, /^AL$/), 'AL', d.AL);
    fill(byLabel(sec, /^ACD$/), 'ACD', d.ACD);
    fill(byLabel(sec, /^LT$/), 'LT', d.LT);
    fill(byLabel(sec, /^CCT$/), 'CCT (µm)', d.CCT);
    fill(byLabel(sec, /^WTW$/), 'WTW', d.WTW);
    fill(byLabel(sec, /^K1$/), 'K1', d.K1);
    fill(byLabel(sec, /^K2$/), 'K2', d.K2);
    if (d.toric) {
      await sleep(300);
      const k1a = byLabel(sec, /^K1\s*(Axis|°)/i), k2a = byLabel(sec, /^K2\s*(Axis|°)/i);
      if (k1a) fill(k1a, 'K1 Axis', d.K1axis); else missing.push('K1 Axis（未找到，請手動）');
      if (k2a) fill(k2a, 'K2 Axis', d.K2axis); else missing.push('K2 Axis（未找到，請手動）');
      fill(byLabel(sec, /^Incision$/), 'Incision（切口位置）', d.incisionAxis);
      fill(byLabel(sec, /^SIA$/), 'SIA', d.SIA);
    }
    fill(byLabel(sec, /^Target Refraction$/), 'Target Refraction', d.target);
    if (d.kIndex && d.kIndex !== 1.3375) notes.push(`資料的 K index 為 ${d.kIndex}，請手動調整網站 Index。`);
    if (d.escrsConstants && d.A != null) {
      ['Barrett A-Constant', 'Cooke A-Constant', 'EVO A-Constant', 'Hill-RBF A-Constant', 'Kane A-Constant', 'Pearl DGS A-Constant']
        .forEach(n => fill(byLabel(sec, new RegExp('^' + n.replace(/[-]/g, '\\-') + '$')), n, d.A));
      notes.push('已把同一個 A 常數填入各公式欄（依你的選擇）；Hoffer® pACD 未填。');
    } else {
      notes.push(`鏡片與各公式常數未填：請在網站 Manufacturer／Select IOL 選擇鏡片（${d.lensName || '未指定'}），網站會帶入各公式常數，請與確認值 A = ${d.A ?? '—'} 比對。`);
    }
  }

  /* ---------- ASCRS（依欄名比對；尚未實測，未對上的欄位列出） ---------- */
  function fillAscrs(d) {
    const fields = [...document.querySelectorAll('input[type=text], input[type=number], input:not([type]), select')].filter(e => e.offsetParent);
    const ctx = el => {
      const lab = el.id && document.querySelector(`label[for="${el.id}"]`);
      const row = el.closest('tr');
      let sec = '';
      let p = el;
      while (p && !sec) { p = p.parentElement; if (!p) break; const h = p.querySelector('h1,h2,h3,h4,legend,.header,.section-header,th'); if (h && /pre|post|biometr/i.test(h.innerText)) sec = h.innerText; }
      return { label: ((lab && lab.innerText) || (row && row.innerText) || '').replace(/\s+/g, ' ').trim(), sec };
    };
    const info = fields.map(el => Object.assign({ el }, ctx(el)));
    const pick = (label, re, secRe) => {
      const c = info.filter(i => re.test(i.label) && (!secRe || secRe.test(i.sec + ' ' + i.label)));
      if (c.length === 1) return c[0].el;
      if (c.length > 1) missing.push(`${label}（找到 ${c.length} 個候選，請手動）`); else missing.push(`${label}（找不到欄位）`);
      return undefined;
    };
    const put = (label, re, secRe, v) => { if (fmt(v) === null) return; const el = pick(label, re, secRe); if (el) fill(el, label, v); };
    put('Patient Name', /patient name/i, null, d.caseCode);
    put('Patient ID', /patient (id|no)/i, null, d.caseCode);
    put('Axial Length', /axial length|\bAL\b/i, null, d.AL);
    put('ACD', /\bACD\b|anterior chamber/i, null, d.ACD);
    put('Lens Thickness', /lens thick|\bLT\b/i, null, d.LT);
    put('WTW', /\bWTW\b|white/i, null, d.WTW);
    put('K1', /\bK1\b|flat k/i, /biometr|optical|current|post/i, d.K1);
    put('K2', /\bK2\b|steep k/i, /biometr|optical|current|post/i, d.K2);
    put('Target Refraction', /target/i, null, d.target);
    put('A constant', /a[- ]?const|srk/i, null, d.A);
    put('Pentacam TNP_Apex_4.0 mm', /TNP|apex.*4/i, null, d.tnp4);
    put('Atlas 中央角膜度數', /atlas.*(0|cent)|zone\s*0/i, null, d.ccp);
    put('屈光手術前 K1', /\bK1\b/i, /pre/i, d.preK1);
    put('屈光手術前 K2', /\bK2\b/i, /pre/i, d.preK2);
    notes.push('ASCRS 欄位依欄名比對填入，尚未在官網實測；請逐欄核對，並手動填入未對上的欄位。');
  }

  /* ---------- 結果面板 ---------- */
  function panel(d, site) {
    const old = document.getElementById(PANEL_ID); if (old) old.remove();
    const box = document.createElement('div');
    box.id = PANEL_ID;
    box.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;width:340px;max-height:80vh;overflow:auto;background:#fff;color:#1c2330;border:2px solid #ff8a00;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.25);font:14px/1.5 -apple-system,"PingFang TC","Noto Sans TC",sans-serif;padding:12px';
    const eyeColor = d && d.eye === 'OS' ? '#1849a9' : '#b42318';
    const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    box.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <b style="flex:1">IOL 小幫手填入｜${esc(site)}</b>
        <button id="${PANEL_ID}_x" style="border:1px solid #ccc;background:#fff;border-radius:6px;cursor:pointer">關閉</button></div>
      ${d ? `<div style="font-size:20px;font-weight:800;color:${eyeColor};border:3px solid ${eyeColor};border-radius:8px;text-align:center;margin-bottom:8px">${d.eye === 'OS' ? 'OS 左眼' : 'OD 右眼'}</div>` : ''}
      ${notes.map(n => `<div style="background:#fff3e0;color:#8a4b00;border-radius:6px;padding:5px 8px;margin:4px 0">${esc(n)}</div>`).join('')}
      ${done.length ? `<div style="margin-top:6px"><b>已填入 ${done.length} 欄（橘框）</b><table style="width:100%;border-collapse:collapse;font-size:13px">${done.map(x => `<tr><td style="border-bottom:1px solid #eee">${esc(x.label)}</td><td style="border-bottom:1px solid #eee;text-align:right"><b>${esc(x.value)}</b></td></tr>`).join('')}</table></div>` : ''}
      ${missing.length ? `<div style="margin-top:6px;color:#b42318"><b>未填入 ${missing.length} 項</b><ul style="margin:2px 0;padding-left:18px">${missing.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}
      <div style="margin-top:8px;color:#5b6676;font-size:12.5px">已停在 Calculate 前。請核對每一欄後自行按 Calculate；網站若出現驗證或條款，請自行處理。</div>`;
    document.body.appendChild(box);
    document.getElementById(PANEL_ID + '_x').onclick = () => box.remove();
  }

  const host = location.hostname, path = location.pathname.toLowerCase();
  const site = host === 'calc.apacrs.org' && path.includes('barrett_universal') ? 'Barrett Universal II'
    : host === 'calc.apacrs.org' && path.includes('toric') ? 'Barrett Toric'
    : host === 'iolcalculator.escrs.org' ? 'ESCRS'
    : host === 'iolcalc.ascrs.org' ? 'ASCRS 屈光術後' : null;
  if (!site) { alert('IOL 小幫手：請在 ESCRS、APACRS（Barrett／Toric）或 ASCRS 計算器頁面使用此書籤。'); return; }
  const d = await readPayload();
  if (!d) { notes.push('沒有讀到 IOL 小幫手的資料。請回小幫手按「複製資料」後再點書籤。'); panel(null, site); return; }
  if (d.expiresAt && Date.now() > d.expiresAt) notes.push('這份資料已超過 2 小時，請確認是目前的個案。');
  try {
    if (site === 'Barrett Universal II') fillBarrett(d);
    else if (site === 'Barrett Toric') fillToric(d);
    else if (site === 'ESCRS') await fillEscrs(d);
    else fillAscrs(d);
  } catch (e) { notes.push('填入時發生錯誤：' + e.message); }
  await sleep(300);
  // 回讀：確認網站沒有改寫數值
  done.forEach(x => { if (x.el.type !== 'checkbox' && x.el.type !== 'radio' && x.el.tagName !== 'SELECT' && String(x.el.value).replace(/\.0+$/, '') !== String(x.value).replace(/\.0+$/, '') && Number(x.el.value) !== Number(x.value)) notes.push(`「${x.label}」回讀為 ${x.el.value}，與資料 ${x.value} 不同，請確認。`); });
  panel(d, site);
};
