// 解析測試（純 JS）。Mac：osascript -l JavaScript tests/parse-tests.js
// Linux／Node：node tests/parse-tests.js
var load, print;
if (typeof require === 'function') {
  const fs = require('fs'), path = require('path');
  load = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  print = s => console.log(s);
} else {
  ObjC.import('Foundation');
  load = f => $.NSString.stringWithContentsOfFileEncodingError($(f), $.NSUTF8StringEncoding, null).js;
}
var module = { exports: {} };
eval(load('app/parse.js'));
var P = module.exports;

var out = [];
function check(name, cond, detail) { out.push((cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : '')); }

// 以像素排版產生「單字框」，模擬 Tesseract 輸出
function page(W, H, words, tiltDeg) {
  const t = (tiltDeg || 0) * Math.PI / 180;
  return words.map(([s, x, y, conf]) => {
    const w = s.length * 15, h = 26;
    const yy = y + (x - W / 2) * Math.tan(t);
    return { text: s, conf: conf == null ? 0.95 : conf, x: x / W, y: yy / H, w: w / W, h: h / H };
  });
}
function get(res, eye, field) { return res.cands.filter(c => c.eye === eye && c.field === field); }
function one(res, eye, field) { const g = get(res, eye, field); return g.length === 1 ? g[0] : null; }

/* 1. IOLMaster 雙欄：OD 左、OS 右；K 與 TK 分開；數值、單位、軸向為分開的字 */
function iolmasterWords() {
  const w = [['IOLMaster', 60, 95], ['700', 220, 95], ['Measurement', 60, 140], ['date:', 230, 140], ['2026-10-28', 320, 140],
    ['OD', 160, 210], ['right', 215, 210], ['OS', 760, 210], ['left', 815, 210]];
  const od = [['AL:', '24.52', 'mm', ''], ['ACD:', '3.21', 'mm', ''], ['LT:', '4.38', 'mm', ''], ['WTW:', '11.9', 'mm', ''],
    ['K1:', '43.25', 'D', '178°'], ['K2:', '44.62', 'D', '88°'], ['ΔK:', '-1.37', 'D', '178°'],
    ['TK1:', '43.18', 'D', '176°'], ['TK2:', '44.41', 'D', '86°'], ['CCT:', '541', 'µm', '']];
  const os = [['AL:', '24.31', 'mm', ''], ['ACD:', '3.05', 'mm', ''], ['LT:', '4.51', 'mm', ''], ['WTW:', '11.7', 'mm', ''],
    ['K1:', '43.80', 'D', '5°'], ['K2:', '44.95', 'D', '95°'], ['ΔK:', '-1.15', 'D', '5°'],
    ['TK1:', '43.66', 'D', '3°'], ['TK2:', '44.70', 'D', '93°'], ['CCT:', '538', 'µm', '']];
  const col = (rows, x0) => rows.forEach((r, i) => {
    const y = 280 + i * 52;
    w.push([r[0], x0, y], [r[1], x0 + 140, y], [r[2], x0 + 250, y]);
    if (r[3]) w.push(['@', x0 + 320, y], [r[3], x0 + 350, y]);
  });
  col(od, 80); col(os, 680);
  return w;
}
[0, 1.5].forEach(tilt => {
  const r = P.parseBiometry(page(1240, 860, iolmasterWords(), tilt));
  const tag = tilt ? '（傾斜 1.5°）' : '';
  check('眼別版面為左右欄' + tag, r.layout.mode === 'columns' && r.layout.odLeft);
  const exp = { OD: { AL: 24.52, ACD: 3.21, LT: 4.38, WTW: 11.9, K1: [43.25, 178], K2: [44.62, 88], TK1: [43.18, 176], TK2: [44.41, 86], CCT: 541 },
                OS: { AL: 24.31, ACD: 3.05, LT: 4.51, WTW: 11.7, K1: [43.80, 5], K2: [44.95, 95], TK1: [43.66, 3], TK2: [44.70, 93], CCT: 538 } };
  Object.keys(exp).forEach(eye => Object.keys(exp[eye]).forEach(f => {
    const c = one(r, eye, f), e = exp[eye][f];
    const val = Array.isArray(e) ? e[0] : e, ax = Array.isArray(e) ? e[1] : null;
    const ok = c && c.value === val && (ax == null || c.axis === ax) && c.status === 'ok';
    check(`IOLMaster ${eye} ${f}${tag}`, ok, c ? `${c.value} ${c.unit || ''} @${c.axis}  ${c.issues.join('；')}` : '找不到或重複');
  }));
  check('IOLMaster 日期 ISO' + tag, r.dates.length === 1 && r.dates[0].iso === '2026-10-28' && !r.dates[0].ambiguous);
  check('IOLMaster 儀器辨識' + tag, r.device === 'IOLMaster');
  const k1 = one(r, 'OD', 'K1');
  check('K1 原圖位置含欄名＋數值＋單位＋軸向' + tag, k1 && k1.tokens.length === 5, k1 && k1.tokens.map(t => t.t).join(' '));
});

/* 2. OCR 誤讀：K1 讀成 Kl、TK2 讀成 TK|；低信心標記 */
(() => {
  const w = iolmasterWords().map(x => x[0] === 'K1:' && x[1] === 80 ? ['Kl:', x[1], x[2]] : x[0] === 'TK1:' && x[1] === 680 ? ['TK|:', x[1], x[2]] : x)
    .map(x => x[0] === '3.21' ? [x[0], x[1], x[2], 0.55] : x);
  const r = P.parseBiometry(page(1240, 860, w));
  check('Kl 視為 K1', one(r, 'OD', 'K1') && one(r, 'OD', 'K1').value === 43.25);
  check('TK| 視為 TK1，不混入 K1', one(r, 'OS', 'TK1') && one(r, 'OS', 'TK1').value === 43.66 && one(r, 'OS', 'K1').value === 43.80);
  const acd = one(r, 'OD', 'ACD');
  check('低信心標記需確認', acd && acd.status === 'check' && acd.issues.some(s => /信心/.test(s)), acd && acd.issues.join('；'));
})();

/* 3. 缺值：欄名後沒有數字 → 不猜值 */
(() => {
  const w = iolmasterWords().filter(x => !(x[0] === '24.31'));
  const r = P.parseBiometry(page(1240, 860, w));
  const al = one(r, 'OS', 'AL');
  check('OS AL 缺值時保持空白', al && al.value === null && al.status === 'check', al && al.issues.join('；'));
  check('OS AL 缺值時不借用 OD 數值', !get(r, 'OS', 'AL').some(c => c.value === 24.52));
})();

/* 4. 同眼重複且不同值 → 不自動採用 */
(() => {
  const w = iolmasterWords().concat([['AL:', 80, 820], ['24.60', 220, 820], ['mm', 330, 820]]);
  const r = P.parseBiometry(page(1240, 900, w));
  const g = get(r, 'OD', 'AL');
  check('OD AL 兩個不同值 → 全部標記需確認', g.length === 2 && g.every(c => c.status === 'check'), g.map(c => c.value).join(' / '));
})();

/* 5. A-scan：單眼（Eye: OS）、欄名在上數值在下 */
(() => {
  const w = [['A-SCAN', 50, 100], ['Eye:', 200, 100], ['OS', 270, 100], ['Date', 650, 100], ['2026/10/20', 720, 100],
    ['AL', 90, 200], ['ACD', 260, 200], ['Lens', 430, 200], ['VCD', 600, 200],
    ['23.86', 80, 250], ['3.12', 255, 250], ['4.62', 425, 250], ['16.12', 590, 250],
    ['mm', 90, 300], ['mm', 265, 300], ['mm', 435, 300], ['Velocity', 80, 400], ['1550', 220, 400], ['m/s', 300, 400]];
  const r = P.parseBiometry(page(1000, 520, w));
  check('A-scan 整頁判定 OS', r.layout.mode === 'page' && r.layout.eye === 'OS');
  const al = one(r, 'OS', 'AL'), acd = one(r, 'OS', 'ACD'), lt = one(r, 'OS', 'LT');
  check('A-scan AL 由下方配對', al && al.value === 23.86 && al.unit === 'mm', al && al.issues.join('；'));
  check('A-scan ACD', acd && acd.value === 3.12);
  check('A-scan Lens → LT', lt && lt.value === 4.62);
  check('A-scan 下方配對標記需確認', al && al.status === 'check');
  check('A-scan VCD 不被當成 LT', !get(r, 'OS', 'LT').some(c => c.value === 16.12));
  check('A-scan 日期', r.dates[0] && r.dates[0].iso === '2026-10-20');
  check('A-scan 儀器辨識', r.device === 'A-scan');
})();

/* 6. Auto refraction：<R>/<L> 上下分區；只取 R1／R2 的 D 值與軸向 */
(() => {
  const w = [['AUTO', 40, 85], ['REF/KERATOMETER', 120, 85], ['2026.10.30', 40, 120],
    ['<R>', 40, 180], ['S', 130, 225], ['C', 300, 225], ['A', 460, 225],
    ['-1.25', 110, 270], ['-0.75', 280, 270], ['175', 450, 270],
    ['R1', 30, 420], ['7.82', 110, 420], ['43.25', 280, 420], ['177', 450, 420],
    ['R2', 30, 460], ['7.57', 110, 460], ['44.75', 280, 460], ['87', 450, 460],
    ['CYL', 30, 500], ['-1.50', 280, 500], ['177', 450, 500],
    ['<L>', 40, 600], ['S', 130, 645], ['C', 300, 645], ['A', 460, 645],
    ['-0.75', 110, 690], ['-1.50', 280, 690], ['5', 450, 690],
    ['R1', 30, 800], ['7.71', 110, 800], ['43.75', 280, 800], ['4', 450, 800],
    ['R2', 30, 840], ['7.50', 110, 840], ['45.00', 280, 840], ['94', 450, 840]];
  const r = P.parseAutoref(page(700, 1100, w));
  check('Auto 眼別上下分區', r.layout.mode === 'rows' && r.layout.odFirst);
  const k1 = one(r, 'OD', 'K1'), k2 = one(r, 'OD', 'K2'), lk1 = one(r, 'OS', 'K1'), lk2 = one(r, 'OS', 'K2');
  check('Auto OD K1 43.25@177', k1 && k1.value === 43.25 && k1.axis === 177 && k1.radius === 7.82);
  check('Auto OD K2 44.75@87', k2 && k2.value === 44.75 && k2.axis === 87);
  check('Auto OS K1 43.75@4（個位數軸向）', lk1 && lk1.value === 43.75 && lk1.axis === 4);
  check('Auto OS K2 45.00@94', lk2 && lk2.value === 45 && lk2.axis === 94);
  check('Auto 不產生驗光候選', !r.cands.some(c => c.field === 'REF'));
  check('Auto 日期 2026.10.30', r.dates[0] && r.dates[0].iso === '2026-10-30');
})();

/* 7. Auto 只有 mm 半徑 → 換算並標記 */
(() => {
  const w = [['<R>', 40, 100], ['R1', 30, 200], ['7.82', 110, 200], ['177', 450, 200]];
  const r = P.parseAutoref(page(700, 400, w));
  const k1 = one(r, 'OD', 'K1');
  check('只有半徑時換算 D 並標記', k1 && Math.abs(k1.value - 43.16) < 0.01 && k1.status === 'check', k1 && k1.issues.join('；'));
})();

/* 8. 整行框（PaddleOCR 類）也能拆字配對 */
(() => {
  const W = 1000, H = 400;
  const lines = [
    { text: 'OD right', x: 100 / W, y: 40 / H, w: 120 / W, h: 26 / H, conf: 0.98 },
    { text: 'OS left', x: 600 / W, y: 40 / H, w: 105 / W, h: 26 / H, conf: 0.98 },
    { text: 'AL: 23.10 mm', x: 80 / W, y: 120 / H, w: 180 / W, h: 26 / H, conf: 0.97 },
    { text: 'K1: 42.50 D @ 10°', x: 80 / W, y: 170 / H, w: 255 / W, h: 26 / H, conf: 0.97 },
    { text: 'AL: 23.40 mm', x: 580 / W, y: 120 / H, w: 180 / W, h: 26 / H, conf: 0.97 },
  ];
  const r = P.parseBiometry(lines);
  check('整行框 OD AL', one(r, 'OD', 'AL') && one(r, 'OD', 'AL').value === 23.1);
  check('整行框 OD K1 含軸向', one(r, 'OD', 'K1') && one(r, 'OD', 'K1').axis === 10);
  check('整行框 OS AL', one(r, 'OS', 'AL') && one(r, 'OS', 'AL').value === 23.4);
})();

/* 9. 無眼別標示 → 標記，可人工指定整頁眼別 */
(() => {
  const w = [['AL:', 80, 100], ['23.5', 200, 100], ['mm', 290, 100]];
  const r = P.parseBiometry(page(800, 300, w));
  check('無眼別 → 需確認', one(r, null, 'AL') && one(r, null, 'AL').status === 'check');
  const r2 = P.parseBiometry(page(800, 300, w), { forceEye: 'OD' });
  check('人工指定整頁 OD', one(r2, 'OD', 'AL') && one(r2, 'OD', 'AL').value === 23.5);
})();

/* 10. 日期 dd/mm/yyyy 模糊 → 標記 */
(() => {
  const d = P.detectDates(P.explode(page(800, 200, [['05/06/2026', 50, 50]])));
  check('05/06/2026 標為模糊日期', d[0] && d[0].ambiguous && d[0].iso === null);
  const d2 = P.detectDates(P.explode(page(800, 200, [['28/10/2026', 50, 50]])));
  check('28/10/2026 可判定', d2[0] && d2[0].iso === '2026-10-28');
})();

/* 11. 模擬 NIDEK TONOREF III 單據（手機斜拍）的 OCR 結果；數值為虛構 */
(() => {
  const W = 1500, H = 2000;
  const w = [['0000', 510, 440, 0.5], ['BCVA.', 600, 520, 0.6], ['0CT/15/2025', 475, 710], ['09:00', 650, 710],
    ['VD=12.00mm', 450, 740],
    ['<R', 445, 790], ['S', 540, 790], ['C', 630, 790], ['A', 712, 790],
    ['KM', 432, 998], ['(Phi=3.', 474, 998], ['3)', 560, 998],
    ['<R1', 430, 1053], ['<R16.5.7,', 380, 1053, 0], ['7.63', 510, 1053], ['44.25', 600, 1053], ['0>', 710, 1053],
    ['We', 820, 1053, 0.48], ['FEE', 900, 1053, 0.12], ['2', 1000, 1053, 0.28],
    ['<R2', 430, 1081], ['7.63', 510, 1081], ['44.25', 600, 1081], ['90>', 700, 1081], ['5', 820, 1081, 0.25],
    ['<AVG', 430, 1109], ['7.63', 510, 1109], ['44.25', 600, 1109],
    ['<CYL', 430, 1137], ['-', 590, 1137], ['0.00', 610, 1137], ['0>', 710, 1137],
    ['<L>', 420, 1192], ['S', 520, 1192], ['C', 620, 1192], ['A', 705, 1192],
    ['+0.50', 470, 1370], ['-0.75', 590, 1370], ['95>', 690, 1370],
    ['IOP', 410, 1530], ['[R]', 470, 1557], ['[L]', 640, 1565], ['15', 470, 1585], ['16', 640, 1593]];
  const r = P.parseAutoref(page(W, H, w, 0.6));
  check('單據：眼別以 <R／<L> 分區（不被眼壓 [R][L] 干擾）', r.layout.mode === 'rows' && r.layout.markers.map(m => m.t).join(' ') === '<R <L>',
    r.layout.markers.map(m => m.t).join(' '));
  const k1 = one(r, 'OD', 'K1'), k2 = one(r, 'OD', 'K2');
  check('單據：OD K1 = R1 的 44.25 @0', k1 && k1.value === 44.25 && k1.axis === 0 && k1.status === 'ok', k1 && `${k1.value}@${k1.axis} ${k1.issues.join('；')}`);
  check('單據：OD K2 = R2 的 44.25 @90', k2 && k2.value === 44.25 && k2.axis === 90 && k2.status === 'ok', k2 && `${k2.value}@${k2.axis} ${k2.issues.join('；')}`);
  check('單據：右側貼紙雜字不被當成軸向', k1 && k1.tokens.length === 4);
  check('單據：OS 沒有 KM → 不產生候選（不猜值）', get(r, 'OS', 'K1').length === 0 && get(r, 'OS', 'K2').length === 0);
  check('單據：日期 0CT/15/2025 → 2025-10-15', r.dates[0] && r.dates[0].iso === '2025-10-15', r.dates.map(d => d.raw).join(','));
})();

var fails = out.filter(s => s.indexOf('FAIL') === 0).length;
out.push('\n共 ' + out.length + ' 項，失敗 ' + fails + ' 項');
if (print) print(out.join('\n')); else out.join('\n');
