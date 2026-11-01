// 執行：Mac  osascript -l JavaScript formulas/formula-tests.js
//       Linux／Node  node formulas/formula-tests.js
var src, print;
if (typeof require === 'function') {
  src = require('fs').readFileSync(require('path').join(__dirname, 'iol-formulas.js'), 'utf8');
  print = s => console.log(s);
} else {
  ObjC.import('Foundation');
  src = $.NSString.stringWithContentsOfFileEncodingError($('formulas/iol-formulas.js'), $.NSUTF8StringEncoding, null).js;
}
var module = { exports: {} };
eval(src);
var F = module.exports;

const results = [];
function check(name, cond, detail) { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const f2 = x => x.toFixed(2);

// 1. 反算一致性：refraction(power(target)) 應回到 target
const eyes = [
  { AL: 21.0, K: 46.5, ACD: 2.6 }, { AL: 23.5, K: 43.875, ACD: 3.2 },
  { AL: 26.5, K: 42.0, ACD: 3.6 }, { AL: 30.5, K: 41.0, ACD: 3.9 },
];
for (const e of eyes) {
  const fs = {
    'SRK/T': F.srkt(Object.assign({ A: 119.0 }, e)),
    'Holladay 1': F.holladay1(Object.assign({ A: 119.0 }, e)),
    'Hoffer Q': F.hofferQ(Object.assign({ A: 119.0 }, e)),
    'Haigis': F.haigis(Object.assign({ a0: 1.2, a1: 0.4, a2: 0.1 }, e)),
  };
  for (const [n, f] of Object.entries(fs)) {
    for (const t of [-3, -0.5, 0, 1]) {
      const P = f.power(t);
      check(`${n} 反算 AL${e.AL} 目標${t}`, near(f.refraction(P), t, 1e-6), `P=${f2(P)}`);
    }
  }
}

// 2. 常數換算（Holladay SF、Hoffer pACD）
check('Holladay SF(A=118.4)=1.45', near(F.holladaySF(118.4), 1.45, 0.005), f2(F.holladaySF(118.4)));
check('Hoffer pACD(A=118.4)≈5.20', near(F.hofferPACD(118.4), 5.20, 0.005), f2(F.hofferPACD(118.4)));

// 3. Haigis-L：doctor-hill.com 範例 r meas 8.73 → r corr 9.0、D corr 37.50
const rc = F.haigisLRadius(337.5 / 8.73);
check('Haigis-L r corr 範例', near(rc, 9.0, 0.01), rc.toFixed(3));
check('Haigis-L D corr 範例', near(337.5 / rc, 37.5, 0.05), f2(337.5 / rc));

// 4. 與 APACRS Barrett 官網合成測試的合理性比對（不同公式，只檢查同一量級）
// 官網（2026-11-01 合成資料）AL 23.5、K1 43.5、K2 44.25、ACD 3.2、A 119.0 → 21.0 D 時 -0.08
const s = F.srkt({ AL: 23.5, K: (43.5 + 44.25) / 2, A: 119.0 });
const h = F.holladay1({ AL: 23.5, K: (43.5 + 44.25) / 2, A: 119.0 });
const q = F.hofferQ({ AL: 23.5, K: (43.5 + 44.25) / 2, A: 119.0 });
check('SRK/T 與 Barrett 同量級(±0.75D)', near(s.power(-0.08), 21.0, 0.75), `SRK/T=${f2(s.power(-0.08))}`);
check('Holladay 1 與 Barrett 同量級', near(h.power(-0.08), 21.0, 0.75), `H1=${f2(h.power(-0.08))}`);
check('Hoffer Q 與 Barrett 同量級', near(q.power(-0.08), 21.0, 0.75), `HQ=${f2(q.power(-0.08))}`);

// 5. 長眼軸 SRK/T 走 LCOR 分支、短眼軸 Hoffer Q 夾限
check('SRK/T 長眼 LCOR 分支連續', near(F.srktElp(24.2, 44, 118.4), F.srktElp(24.2001, 44, 118.4), 0.01));
check('Hoffer Q AL<18.5 夾限', near(F.hofferQ({ AL: 17, K: 44, A: 118.4 }).ELP, F.hofferQ({ AL: 18.5, K: 44, A: 118.4 }).ELP, 1e-9));

// 6. Toric：Abulafia-Koch 對順規散光應減少、逆規散光應增加
const wtr = F.toricPlan({ K1: 43, K1axis: 180, K2: 45, K2axis: 90, AL: 23.5, A: 119, cylinders: [] });
const atr = F.toricPlan({ K1: 43, K1axis: 90, K2: 45, K2axis: 180, AL: 23.5, A: 119, cylinders: [] });
check('AK：順規 2D 估算總散光 < 2', wtr.total.mag < 2, `${f2(wtr.total.mag)} @${wtr.total.axis.toFixed(0)}`);
check('AK：逆規 2D 估算總散光 > 2', atr.total.mag > 2, `${f2(atr.total.mag)} @${atr.total.axis.toFixed(0)}`);
check('Toric 比值合理(0.6–0.8)', wtr.ratio > 0.6 && wtr.ratio < 0.8, wtr.ratio.toFixed(3));
const plan = F.toricPlan({ K1: 43, K1axis: 180, K2: 45, K2axis: 90, AL: 23.5, A: 119, SIA: 0.1, incisionAxis: 180,
  cylinders: [{ name: 'T2', cyl: 1.0 }, { name: 'T3', cyl: 1.5 }, { name: 'T4', cyl: 2.25 }] });
plan.options.forEach(o => check(`Toric ${o.name} 殘餘散光可計算`, Number.isFinite(o.residual),
  `殘餘 ${f2(o.residual)} @${o.residualAxis.toFixed(0)}`));

// 7. 缺值不推定
let threw = false; try { F.haigis({ AL: 23, K: 44, ACD: 3 }); } catch (e) { threw = true; }
check('Haigis 缺常數會報錯', threw);

const fails = results.filter(r => r.startsWith('FAIL')).length;
results.push(`\n共 ${results.length} 項，失敗 ${fails} 項`);
if (print) print(results.join('\n')); else results.join('\n');
