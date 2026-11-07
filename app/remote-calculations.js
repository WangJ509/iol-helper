/* 遠端 SE 查詢：常數分開、只送已核對測量值、結果綁定輸入快照。 */
(function (root) {
  'use strict';
  const providers = {
    cooke: { name: 'Cooke K6', url: 'https://cookeformula.com/', models: { Other: 'Other（其他鏡片）', JAndJ1PieceTecnisOrSensar: 'J&J 一片式 Tecnis／Sensar', ZeissPlateHaptic: 'Zeiss plate haptic', AlconMA60MA: 'Alcon MA60MA', AlconSA60AT: 'Alcon SA60AT', EnvistaEnhanced: 'enVista Enhanced' } },
    hoffer: { name: 'Hoffer QST', url: 'https://hofferqst.com/', models: { Default: 'Default（標準 SE）' } },
    pearl: { name: 'PEARL-DGS', url: 'https://iolsolver.com/regular', models: { SN60WF: 'SN60WF', Other_Men: 'Other IOL Model', Finevision: 'Finevision', Panoptix: 'PanOptix', Vivinex: 'Vivinex', PCB: 'PCB00／ZCB00', MX60: 'enVista MX60', SA60AT: 'SA60AT', Asphina: 'Asphina', '60MA': 'MA／MN60MA', 'A1-UV': 'A1-UV', AR40: 'AR40', RayOne: 'RayOne' } },
    evo: { name: 'EVO', url: 'https://www.evoiolcalculator.com/', models: { Standard: 'Standard', Tecnis: 'Tecnis', 'AR40e/E/M': 'AR40e/E/M', MA60MA: 'MA60MA', SN60WF: 'Alcon SN60WF', SA60AT: 'Alcon SA60AT', SA60WF: 'Alcon SA60WF', CNA0T0: 'Alcon CNA0T0', Vivity: 'Alcon Vivity', Panoptix: 'Alcon PanOptix', ZCB00: 'J&J ZCB00' } },
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
    return JSON.stringify([context.caseKey, context.data.lensName, context.blockers, request]);
  }
  function create(getContext, update) {
    const state = { available: null, consent: false, biometer: '', settings: {}, results: {}, running: {} };
    Object.keys(providers).forEach(id => { state.settings[id] = { constant: null, model: id === 'hoffer' ? 'Default' : '' }; });
    fetch('/api/config', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(c => {
      state.available = !!(c && c.remoteCalculations); update();
    }).catch(() => { state.available = false; update(); });
    const requestFor = (id, c) => buildRequest(id, c, state.settings[id], state.biometer);
    function current(id, context) {
      const result = state.results[id];
      return result && result.signature === signature(context, requestFor(id, context)) ? result.value : null;
    }
    function render(context) {
      const blocked = !state.available || context.blockers.length || !state.consent;
      const select = (id, field, options, value) => `<select data-remote="${field}" data-provider="${id}"><option value="">請選擇</option>${Object.entries(options).map(([v, label]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
      const resultById = Object.fromEntries(Object.keys(providers).map(id => [id, current(id, context)]));
      const cards = Object.entries(providers).map(([id, p]) => {
        const result = resultById[id], setting = state.settings[id], busy = state.running[id] === signature(context, requestFor(id, context));
        const stale = state.results[id] && !result;
        const status = busy ? '查詢中…' : result ? result.status === 'ok' ? `已取得 ${result.rows.length} 列` : result.message : stale ? '輸入或設定已變更，請重新查詢' : '尚未查詢';
        return `<div class="fcard"><h3>${p.name}</h3>
          <label class="f">${id === 'hoffer' ? 'pACD（不是 A 常數）' : 'A 常數'}<input type="number" step="0.01" data-remote="constant" data-provider="${id}" value="${setting.constant == null ? '' : esc(setting.constant)}"></label>
          <label class="f">鏡片模型／家族${select(id, 'model', p.models, setting.model)}</label>
          <p class="small ${result && result.status === 'error' ? 'remote-error' : 'muted'}" role="status">${esc(status)}</p>
          ${result && result.status === 'ok' ? `<p class="small muted">${esc(new Date(result.queriedAt * 1000).toLocaleTimeString())}｜常數 ${esc(result.constant)}｜${esc(result.model)}</p>` : ''}
          <div class="row"><button class="btn sm" data-remote-query="${id}" ${blocked || busy ? 'disabled' : ''}>${busy ? '查詢中' : '查詢'}</button><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">官網</a></div></div>`;
      }).join('');
      const powers = [...new Set(Object.values(resultById).filter(r => r && r.status === 'ok').flatMap(r => r.rows.map(row => row.power)))].sort((a, b) => a - b);
      const table = powers.length ? `<div class="remote-table"><table class="t"><caption>作者網站回傳的標準 SE 預測（D）</caption><thead><tr><th>IOL 度數</th>${Object.values(providers).map(p => `<th>${p.name}</th>`).join('')}</tr></thead><tbody>${powers.map(power => `<tr><th>${power.toFixed(2)}</th>${Object.keys(providers).map(id => {
        const r = resultById[id], row = r && r.status === 'ok' && r.rows.find(x => x.power === power);
        return `<td>${row ? display(row.refraction) : '—'}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div><p class="small muted">— 表示來源未提供該度數或尚未取得結果。結果僅對應目前已核對的數值與上述常數；尚未經臨床驗證。</p>` : '';
      return `<div class="card" id="remoteCalculations"><h2>遠端公式結果</h2>
        <p class="small">查詢標準 SE 預測；不含 Toric 柱鏡與屈光術後計算。請依各公式核對鏡片模型及常數，系統不會把平台 A 常數套用給全部公式。</p>
        ${state.available === false ? '<div class="msg warn">目前沒有可用的查詢後端。請使用 Python／Docker 版本；GitHub Pages 靜態版仍可使用核對與官網填入。</div>' : state.available === null ? '<p class="small muted">正在確認查詢後端…</p>' : ''}
        ${context.blockers.length ? `<div class="msg warn small">${esc(context.blockers.join('；'))}</div>` : ''}
        <label class="f">光學量測儀器${select('', 'biometer', { Other: '其他光學儀器', Lenstar: 'Lenstar', Argos: 'Argos' }, state.biometer)}</label>
        <div class="cards remote-cards">${cards}</div>
        <p class="small muted">查詢會將已核對的測量值、左右眼、性別及鏡片設定傳送至所選作者網站，不傳送 PDF、影像、病歷號、姓名或檔名。請確認符合各來源的使用條款。</p>
        <label class="row small"><input type="checkbox" data-remote="consent" ${state.consent ? 'checked' : ''}>我同意將上述資料送至所選來源進行計算</label>
        <button class="btn primary" data-remote-query="all" ${blocked || Object.values(state.running).some(Boolean) ? 'disabled' : ''}>查詢四個公式</button>
        ${table}
        <p class="small muted">Barrett、Kane、Hill-RBF 尚未提供本網站直接查詢，請使用下方 ESCRS 官網填入流程。</p></div>`;
    }
    function change(target, refresh = true) {
      const field = target.dataset.remote;
      if (!field) return false;
      if (field === 'consent') state.consent = target.checked;
      else if (field === 'biometer') state.biometer = target.value;
      else if (state.settings[target.dataset.provider]) state.settings[target.dataset.provider][field] = field === 'constant' ? target.value === '' ? null : Number(target.value) : target.value;
      if (refresh) update(); return true;
    }
    async function query(id) {
      const context = getContext();
      if (!state.available || !state.consent || context.blockers.length || !providers[id] || state.running[id]) return;
      const request = requestFor(id, context), key = signature(context, request);
      if (!state.biometer || !num(request.settings.constant) || !request.settings.model) {
        state.results[id] = { signature: key, value: { status: 'error', message: '請選擇儀器、鏡片模型並填入本公式常數' } }; update(); return;
      }
      state.running[id] = key; update();
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
      let value;
      try {
        const response = await fetch('/api/calculations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal });
        const data = await response.json();
        value = response.ok ? data : { status: 'error', message: data.error || '查詢失敗，請重試' };
        if (value.status === 'ok' && (!Array.isArray(value.rows) || !value.rows.length || value.rows.some(r => !num(r.power) || !num(r.refraction)))) throw new Error('invalid response');
      } catch (e) { value = { status: 'error', message: e.name === 'AbortError' ? '查詢逾時，請稍後重試' : '無法取得結果，請確認後端連線' }; }
      finally { clearTimeout(timer); delete state.running[id]; }
      // 較慢的舊請求不得覆蓋新個案或修改後的測量值。
      const now = getContext();
      if (key === signature(now, requestFor(id, now))) state.results[id] = { signature: key, value };
      update();
    }
    return { render, change, query: id => id === 'all' ? Promise.allSettled(Object.keys(providers).map(query)) : query(id) };
  }
  const api = { create, buildRequest, signature, display };
  root.IOLRemote = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
