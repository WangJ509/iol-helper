/* 遠端 SE 查詢：常數分開、只送已核對測量值、結果綁定輸入快照。 */
(function (root) {
  'use strict';
  const providers = {
    cooke: { name: 'Cooke K6', url: 'https://cookeformula.com/', models: { Other: 'Other（其他鏡片）', JAndJ1PieceTecnisOrSensar: 'J&J 一片式 Tecnis／Sensar', ZeissPlateHaptic: 'Zeiss plate haptic', AlconMA60MA: 'Alcon MA60MA', AlconSA60AT: 'Alcon SA60AT', EnvistaEnhanced: 'enVista Enhanced' } },
    hoffer: { name: 'Hoffer QST', url: 'https://hofferqst.com/', models: { Default: 'Default（標準 SE）' } },
    pearl: { name: 'PEARL-DGS', url: 'https://iolsolver.com/regular', models: { SN60WF: 'SN60WF', Other_Men: 'Other IOL Model', Finevision: 'Finevision', Panoptix: 'PanOptix', Vivinex: 'Vivinex', PCB: 'PCB00／ZCB00', MX60: 'enVista MX60', SA60AT: 'SA60AT', Asphina: 'Asphina', '60MA': 'MA／MN60MA', 'A1-UV': 'A1-UV', AR40: 'AR40', RayOne: 'RayOne' } },
    evo: { name: 'EVO', url: 'https://www.evoiolcalculator.com/', models: { Standard: 'Standard', Tecnis: 'Tecnis', 'AR40e/E/M': 'AR40e/E/M', MA60MA: 'MA60MA', SN60WF: 'Alcon SN60WF', SA60AT: 'Alcon SA60AT', SA60WF: 'Alcon SA60WF', CNA0T0: 'Alcon CNA0T0', Vivity: 'Alcon Vivity', Panoptix: 'Alcon PanOptix', ZCB00: 'J&J ZCB00', Eyhance: 'J&J Eyhance' } },
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const num = n => typeof n === 'number' && Number.isFinite(n);
  const display = n => num(n) ? (n > 0 ? '+' : '') + (Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100 * Math.sign(n)).toFixed(2) : '—';
  function buildRequest(formula, context, setting, biometer) {
    const d = context.data;
    const measurements = { eye: d.eye, history: context.history, biometer, gender: d.gender, kIndex: d.kIndex };
    ['AL', 'K1', 'K2', 'ACD', 'LT', 'WTW', 'CCT', 'target'].forEach(key => { if (num(d[key])) measurements[key] = d[key]; });
    return { formula, measurements, settings: { constant: setting.constant, model: setting.model } };
  }
  function signature(context, request) {
    return JSON.stringify([context.caseKey, context.data.lensName, context.lens || null, context.blockers, request]);
  }
  function create(getContext, update, storage) {
    const presets = root.IOLLensPresets || (typeof require === 'function' ? require('./lens-presets.js') : null);
    if (storage === undefined) { try { storage = root.localStorage; } catch (_) { storage = null; } }
    const storeKey = 'iol-helper.remote-lens-settings.v1';
    const state = { available: null, consent: false, biometer: '', biometerSource: null, token: null, settings: {}, defaults: {}, results: {}, running: {}, revisions: {}, notice: '' };
    const lensKey = context => context.lens ? context.lens.maker + '|' + context.lens.model : '';
    const validConstant = (id, value) => num(value) && value >= (id === 'hoffer' ? 0 : 112) && value <= (id === 'hoffer' ? 10 : id === 'cooke' ? 123 : 125);
    function readSaved(key) {
      try {
        const all = JSON.parse(storage && storage.getItem(storeKey) || '{}');
        const saved = all && Object.prototype.hasOwnProperty.call(all, key) ? all[key] : null;
        if (!saved || typeof saved !== 'object') return {};
        return Object.fromEntries(Object.entries(providers).filter(([id, provider]) => saved[id] && validConstant(id, saved[id].constant) && Object.prototype.hasOwnProperty.call(provider.models, saved[id].model)).map(([id]) => [id, { constant: saved[id].constant, model: saved[id].model }]));
      } catch (_) { return {}; }
    }
    function invalidate(id) {
      state.revisions[id] = (state.revisions[id] || 0) + 1;
      delete state.results[id];
      if (state.running[id]) state.running[id].controller.abort();
      delete state.running[id];
    }
    function applyDefaults(context, useSaved) {
      state.defaults = presets.defaults(context.lens);
      const saved = useSaved ? readSaved(lensKey(context)) : {};
      Object.keys(providers).forEach(id => {
        invalidate(id);
        const d = state.defaults[id];
        state.settings[id] = saved[id]
          ? { ...saved[id], origin: 'saved', modelManual: saved[id].model !== d.model }
          : { constant: d.constant, model: d.model, origin: 'official', modelManual: false };
      });
    }
    function sync(context) {
      const token = JSON.stringify([context.caseKey, lensKey(context), context.lens && context.lens.alSource]);
      if (token !== state.token) {
        const previousCase = state.caseKey;
        state.token = token; state.caseKey = context.caseKey;
        if (previousCase !== context.caseKey) state.consent = false;
        state.notice = ''; applyDefaults(context, true);
        state.biometerSource = null;
      }
      const source = context.biometer || '';
      if (state.biometerSource !== source) { state.biometerSource = source; state.biometer = source; Object.keys(providers).forEach(invalidate); }
      Object.keys(providers).forEach(id => {
        const s = state.settings[id];
        if (s.origin === 'upper' && s.constant !== context.data.A) { invalidate(id); s.constant = context.data.A; }
      });
    }
    const requestFor = (id, context) => buildRequest(id, context, state.settings[id], state.biometer);
    const keyFor = (id, context) => signature(context, requestFor(id, context)) + ':' + state.revisions[id];
    function missing(id, context) {
      const s = state.settings[id], out = [];
      if (!state.biometer) out.push('光學量測儀器');
      if (!s.model) out.push('模型／家族');
      if (!validConstant(id, s.constant)) out.push(id === 'hoffer' ? 'pACD（0–10）' : id === 'cooke' ? 'A 常數（112–123）' : 'A 常數（112–125）');
      if (id === 'hoffer' && !['F', 'M'].includes(context.data.gender)) out.push('性別（回核對頁選擇）');
      if (id === 'cooke' && state.biometer === 'Argos' && !num(context.data.LT)) out.push('已核對的 LT');
      return out;
    }
    function current(id, context) {
      const result = state.results[id];
      return result && result.signature === keyFor(id, context) ? result.value : null;
    }
    fetch('/api/config', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(c => {
      state.available = !!(c && c.remoteCalculations); update();
    }).catch(() => { state.available = false; update(); });
    function render(context) {
      if (state.available !== true) return '';
      sync(context);
      const blocked = context.blockers.length || !state.consent;
      const select = (id, field, options, value) => `<select data-remote="${field}" data-provider="${id}"><option value="">請選擇</option>${Object.entries(options).map(([v, label]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
      const resultById = Object.fromEntries(Object.keys(providers).map(id => [id, current(id, context)]));
      const ready = Object.keys(providers).filter(id => !missing(id, context).length);
      const cards = Object.entries(providers).map(([id, p]) => {
        const result = resultById[id], s = state.settings[id], d = state.defaults[id], needed = missing(id, context);
        const busy = state.running[id] && state.running[id].key === keyFor(id, context);
        const status = busy ? '查詢中…' : result ? result.status === 'ok' ? `已取得 ${result.rows.length} 列` : result.message : needed.length ? '待補：' + needed.join('、') : '設定齊全，可以查詢';
        const origin = s.origin === 'saved' ? '來源：此瀏覽器已儲存的鏡片設定' : s.origin === 'manual' ? '來源：本次手動輸入' : s.origin === 'upper' ? '來源：上方光學 SRK/T A 常數（隨上方數值連動）' : num(s.constant) ? `來源：官網預設 ${d.source.checkedAt}` : '官網無此鏡片預設常數，請補填或使用自己的光學常數';
        const canUseUpper = id !== 'hoffer' && context.lens && context.lens.alSource === 'optical' && validConstant(id, context.data.A) && s.model;
        return `<div class="fcard"><h3>${p.name}</h3>
          <p class="small muted">${esc(s.modelManual ? '模型已手動指定；請確認與上方鏡片相符' : d.reference)}</p>
          <label class="f">${id === 'hoffer' ? 'pACD（不是 A 常數）' : 'A 常數'}<input type="number" step="any" data-remote="constant" data-provider="${id}" value="${s.constant == null ? '' : esc(s.constant)}"></label>
          <label class="f">鏡片模型／家族${select(id, 'model', p.models, s.model)}</label>
          <p class="small muted">${esc(origin)} · <a href="${esc(d.source.url)}" target="_blank" rel="noopener noreferrer">官網參考</a></p>
          ${canUseUpper ? `<button class="btn sm" data-remote-action="use-upper" data-provider="${id}">沿用上方光學 A＝${esc(context.data.A)}</button><p class="small muted">這是你的光學常數，並非此公式的官網預設值；請先確認適用。</p>` : ''}
          <p class="small ${result && result.status === 'error' ? 'remote-error' : 'muted'}" role="status">${esc(status)}</p>
          ${result && result.status === 'ok' ? `<p class="small muted">${esc(new Date(result.queriedAt * 1000).toLocaleTimeString())}｜常數 ${esc(result.constant)}｜${esc(result.model)}</p>` : ''}
          <div class="row"><button class="btn sm" data-remote-query="${id}" ${blocked || busy || needed.length ? 'disabled' : ''}>${busy ? '查詢中' : '查詢'}</button><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">官網</a></div></div>`;
      }).join('');
      const powers = [...new Set(Object.values(resultById).filter(r => r && r.status === 'ok').flatMap(r => r.rows.map(row => row.power)))].sort((a, b) => a - b);
      const table = powers.length ? `<div class="remote-table"><table class="t"><caption>作者網站回傳的標準 SE 預測（D）</caption><thead><tr><th>IOL 度數</th>${Object.values(providers).map(p => `<th>${p.name}</th>`).join('')}</tr></thead><tbody>${powers.map(power => `<tr><th>${power.toFixed(2)}</th>${Object.keys(providers).map(id => {
        const r = resultById[id], row = r && r.status === 'ok' && r.rows.find(x => x.power === power);
        return `<td>${row ? display(row.refraction) : '—'}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div><p class="small muted">— 表示來源未提供該度數或尚未取得結果。結果僅對應目前已核對的數值與上述常數；尚未經臨床驗證。</p>` : '';
      return `<div class="card" id="remoteCalculations"><h2>遠端公式結果</h2>
        <p><b>目前鏡片：${esc(context.data.lensName || '請先在核對頁選鏡片')}</b></p>
        <p class="small">依同一片鏡片帶入各公式的官網預設值，可再手動修改。缺少對照時保持空白；不將 A 常數換算為 Hoffer pACD。</p>
        ${context.blockers.length ? `<div class="msg warn small">${esc(context.blockers.join('；'))}</div>` : ''}
        <label class="f">光學量測儀器${select('', 'biometer', { Other: '其他光學儀器（含 IOLMaster）', Lenstar: 'Lenstar', Argos: 'Argos' }, state.biometer)}</label>
        <p class="small muted">已依所選眼軸報告帶入；若報告未辨識儀器，請自行選擇。</p>
        <div class="row"><button class="btn sm" data-remote-action="restore">恢復這片鏡片的官網預設值</button><button class="btn sm" data-remote-action="save" ${lensKey(context) ? '' : 'disabled'}>記住這片鏡片的設定</button><button class="btn sm" data-remote-action="forget" ${lensKey(context) ? '' : 'disabled'}>清除已記住的設定</button></div>
        <p class="small muted">「記住」僅在此瀏覽器保存鏡片、模型與常數，不保存病患或量測資料。換鏡片會切換設定，換回時讀取你已儲存的設定。</p>
        ${state.notice ? `<p class="msg info small" role="status">${esc(state.notice)}</p>` : ''}
        <div class="cards remote-cards">${cards}</div>
        <p class="small muted">查詢會將已核對的測量值、左右眼、性別及鏡片設定傳送至所選作者網站，不傳送 PDF、影像、病歷號、姓名或檔名。請確認符合各來源的使用條款。</p>
        <label class="row small"><input type="checkbox" data-remote="consent" ${state.consent ? 'checked' : ''}>我同意將上述資料送至所選來源進行計算</label>
        <button class="btn primary" data-remote-query="all" ${blocked || !ready.length || Object.keys(state.running).length ? 'disabled' : ''}>${ready.length === 4 ? '查詢四個公式' : `查詢已完成設定的 ${ready.length} 個公式`}</button>
        ${table}
        <p class="small muted">查詢標準 SE；不含 Toric 柱鏡與屈光術後計算。Barrett、Kane、Hill-RBF 請使用下方 ESCRS 官網填入流程。</p></div>`;
    }
    function change(target, refresh = true) {
      const field = target.dataset.remote;
      if (!field) return false;
      sync(getContext());
      if (field === 'consent') state.consent = target.checked;
      else if (field === 'biometer') { state.biometer = target.value; Object.keys(providers).forEach(invalidate); }
      else if (state.settings[target.dataset.provider] && ['constant', 'model'].includes(field)) {
        const id = target.dataset.provider, s = state.settings[id]; invalidate(id);
        if (field === 'model') {
          s.model = target.value; s.constant = null; s.origin = 'manual'; s.modelManual = true;
        } else { s.constant = target.value === '' ? null : Number(target.value); s.origin = 'manual'; }
      }
      if (refresh) update(); return true;
    }
    function action(name, id) {
      const context = getContext(); sync(context);
      if (name === 'restore') { applyDefaults(context, false); state.notice = '已恢復官網預設值；已記住的設定需另按清除才會刪除。'; }
      else if (name === 'use-upper' && providers[id] && id !== 'hoffer' && context.lens && context.lens.alSource === 'optical' && state.settings[id].model && validConstant(id, context.data.A)) {
        invalidate(id); state.settings[id].constant = context.data.A; state.settings[id].origin = 'upper';
      } else if (['save', 'forget'].includes(name) && lensKey(context)) {
        try {
          if (!storage) throw new Error('storage unavailable');
          let all = JSON.parse(storage.getItem(storeKey) || '{}');
          if (!all || typeof all !== 'object' || Array.isArray(all)) all = {};
          if (name === 'forget') { delete all[lensKey(context)]; }
          else {
            const settings = Object.fromEntries(Object.keys(providers).filter(id => validConstant(id, state.settings[id].constant) && Object.prototype.hasOwnProperty.call(providers[id].models, state.settings[id].model)).map(id => [id, { constant: state.settings[id].constant, model: state.settings[id].model }]));
            if (!Object.keys(settings).length) { state.notice = '請先完成至少一個公式的模型與常數，再記住設定。'; update(); return; }
            all[lensKey(context)] = settings;
          }
          storage.setItem(storeKey, JSON.stringify(all));
          state.notice = name === 'forget' ? '已清除此鏡片的已記住設定，目前畫面的數值仍可使用。' : '已記住有效的模型與常數，下次選擇同一片鏡片會自動帶入。';
        } catch (_) { state.notice = '此瀏覽器無法儲存設定；本次查詢仍可使用。'; }
      }
      update();
    }
    async function query(id) {
      const context = getContext(); sync(context);
      if (!state.available || !state.consent || context.blockers.length || !providers[id] || missing(id, context).length) return;
      const request = requestFor(id, context);
      if (state.running[id] && state.running[id].key === keyFor(id, context)) return;
      invalidate(id);
      const task = { key: keyFor(id, context), controller: new AbortController() };
      state.running[id] = task; update();
      const timer = setTimeout(() => task.controller.abort(), 25000);
      let value;
      try {
        const response = await fetch('/api/calculations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: task.controller.signal });
        const data = await response.json();
        value = response.ok ? data : { status: 'error', message: data.error || '查詢失敗，請重試' };
        if (value.status === 'ok' && (!Array.isArray(value.rows) || !value.rows.length || value.rows.some(r => !num(r.power) || !num(r.refraction)))) throw new Error('invalid response');
      } catch (e) { value = { status: 'error', message: e.name === 'AbortError' ? '查詢逾時，請稍後重試' : '無法取得結果，請確認後端連線' }; }
      finally { clearTimeout(timer); }
      const now = getContext(); sync(now);
      if (state.running[id] === task) {
        delete state.running[id];
        if (task.key === keyFor(id, now)) state.results[id] = { signature: task.key, value };
      }
      update();
    }
    return { render, change, action, query: id => id === 'all' ? Promise.allSettled(Object.keys(providers).map(query)) : query(id) };
  }
  const api = { create, buildRequest, signature, display };
  root.IOLRemote = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
