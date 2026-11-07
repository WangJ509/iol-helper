const assert = require('node:assert/strict');
const { buildRequest, signature, display, create } = require('../app/remote-calculations.js');
const context = { caseKey: 'one', blockers: [], history: 'none', data: { eye: 'OD', caseCode: 'PRIVATE', lensName: 'Alcon SN60WF', gender: 'F', kIndex: 1.3375, AL: 24, K1: 43, K2: 44, ACD: 3.2, LT: null, target: 0, fileName: 'private.pdf' } };
const request = buildRequest('cooke', context, { constant: 119, model: 'Other' }, 'Other');
assert.equal(request.measurements.AL, 24);
assert.ok(!('LT' in request.measurements));
assert.ok(!JSON.stringify(request).includes('PRIVATE'));
assert.ok(!JSON.stringify(request).includes('private.pdf'));
assert.notEqual(signature(context, request), signature({ ...context, caseKey: 'two' }, request));
assert.notEqual(signature(context, request), signature({ ...context, data: { ...context.data, lensName: 'different' } }, request));
assert.equal(display(-.215), '-0.22');
assert.equal(display(.122), '+0.12');
assert.equal(display(null), '—');
(async () => {
  let active = context, resolveSlow;
  const oldFetch = global.fetch;
  global.fetch = async (url) => url === '/api/config' ? { ok: true, json: async () => ({ remoteCalculations: true }) } : new Promise(resolve => { resolveSlow = resolve; });
  try {
    const remote = create(() => active, () => {});
    await new Promise(resolve => setImmediate(resolve));
    remote.change({ dataset: { remote: 'consent' }, checked: true });
    remote.change({ dataset: { remote: 'biometer' }, value: 'Other' });
    remote.change({ dataset: { remote: 'constant', provider: 'cooke' }, value: '119' });
    remote.change({ dataset: { remote: 'model', provider: 'cooke' }, value: 'Other' });
    const pending = remote.query('cooke');
    active = { ...context, caseKey: 'new-case' };
    resolveSlow({ ok: true, json: async () => ({ status: 'ok', rows: [{ power: 20, refraction: -.23 }], constant: 119, model: 'Other', queriedAt: 1 }) });
    await pending;
    assert.ok(!remote.render(active).includes('作者網站回傳的標準 SE 預測（D）'));
    const next = remote.query('cooke');
    resolveSlow({ ok: true, json: async () => ({ status: 'ok', rows: [{ power: 20, refraction: -.23 }], constant: 119, model: 'Other', queriedAt: 1 }) });
    await next;
    assert.ok(remote.render(active).includes('-0.23'));
    remote.change({ dataset: { remote: 'constant', provider: 'cooke' }, value: '119.1' });
    assert.ok(!remote.render(active).includes('作者網站回傳的標準 SE 預測（D）'));
    console.log('Remote tests passed: payload privacy, rounding, stale responses, settings invalidation.');
  } finally { global.fetch = oldFetch; }
})().catch(error => { console.error(error); process.exitCode = 1; });
