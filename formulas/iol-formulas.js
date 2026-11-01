/*
 * IOL 核對小幫手：公開發表公式引擎
 *
 * 只收錄方程式已公開發表、可逐式查證的公式。專有公式（Barrett Universal II、
 * Barrett Toric、Barrett True-K、Kane、EVO、Hill-RBF、Hoffer QST、Cooke K6、
 * PEARL-DGS 訓練模型、Potvin-Hill Pentacam、Shammas-PL 原式）未公開，不在此重寫，
 * 仍須由官方網站計算。
 *
 * 單位：AL／ACD／LT 為 mm，K 為 D（keratometric index 1.3375），目標屈光為眼鏡平面 D。
 * 所有函式只做計算，不做臨床判斷；缺值會丟出錯誤而非推定。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IOLFormulas = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NA = 1.336;          // 房水／玻璃體折射率
  const V = 12;              // 眼鏡頂點距離 (mm)
  const KERATOMETRIC = 337.5;

  function need(obj, keys, label) {
    const missing = keys.filter(k => !Number.isFinite(obj[k]));
    if (missing.length) throw new Error(`${label} 缺少數值：${missing.join(', ')}`);
  }

  const deg = x => x * Math.PI / 180;
  const round2 = x => Math.round(x * 100) / 100;

  // 一般「厚度簡化」vergence 公式（SRK/T 與 Holladay 1 共用的形式）
  // ncm1 = 角膜折射率 - 1；L = 光學眼軸；E = ELP；r = 角膜曲率半徑
  function vergencePower(L, E, r, ncm1, ref) {
    const u = NA * r - ncm1 * L;
    const w = NA * r - ncm1 * E;
    return (1000 * NA * (u - 0.001 * ref * (V * u + L * r))) /
           ((L - E) * (w - 0.001 * ref * (V * w + E * r)));
  }
  function vergenceRefraction(L, E, r, ncm1, P) {
    const u = NA * r - ncm1 * L;
    const w = NA * r - ncm1 * E;
    return (1000 * NA * u - P * (L - E) * w) /
           (NA * (V * u + L * r) - 0.001 * P * (L - E) * (V * w + E * r));
  }

  /* ---------- SRK/T（Retzlaff, Sanders, Kraff 1990；含 1990 勘誤） ---------- */
  function srktElp(AL, K, A, Kelp) {
    // Kelp：Double-K 時用於 ELP 的術前 K；一般眼與 K 相同
    const kE = Number.isFinite(Kelp) ? Kelp : K;
    const rE = KERATOMETRIC / kE;
    const LCOR = AL <= 24.2 ? AL : -3.446 + 1.716 * AL - 0.0237 * AL * AL;
    const Cw = -5.40948 + 0.58412 * LCOR + 0.098 * kE;
    const disc = rE * rE - (Cw * Cw) / 4;
    const H = rE - Math.sqrt(Math.max(disc, 0));
    const ACDconst = 0.62467 * A - 68.747;
    return H + (ACDconst - 3.336);
  }
  function srkt(inp) {
    need(inp, ['AL', 'K', 'A'], 'SRK/T');
    const { AL, K, A } = inp;
    const r = KERATOMETRIC / K;
    const ELP = srktElp(AL, K, A, inp.Kelp);
    const LOPT = AL + (0.65696 - 0.02029 * AL);
    return {
      ELP,
      power: ref => vergencePower(LOPT, ELP, r, 0.333, ref),
      refraction: P => vergenceRefraction(LOPT, ELP, r, 0.333, P),
    };
  }

  /* ---------- Holladay 1（Holladay et al. 1988） ---------- */
  function holladaySF(A) { return 0.5663 * A - 65.6; }
  function holladay1(inp) {
    need(inp, ['AL', 'K'], 'Holladay 1');
    const SF = Number.isFinite(inp.SF) ? inp.SF : (Number.isFinite(inp.A) ? holladaySF(inp.A) : NaN);
    if (!Number.isFinite(SF)) throw new Error('Holladay 1 缺少 A 常數或 Surgeon Factor');
    const { AL, K } = inp;
    const r = KERATOMETRIC / K;
    const rE = KERATOMETRIC / (Number.isFinite(inp.Kelp) ? inp.Kelp : K);
    const Rag = rE < 7 ? 7 : rE;
    const AG = Math.min(12.5 * AL / 23.45, 13.5);
    const ACD = 0.56 + Rag - Math.sqrt(Rag * Rag - (AG * AG) / 4);
    const ELP = ACD + SF;
    const L = AL + 0.2;
    return {
      ELP, SF,
      power: ref => vergencePower(L, ELP, r, 1 / 3, ref),
      refraction: P => vergenceRefraction(L, ELP, r, 1 / 3, P),
    };
  }

  /* ---------- Hoffer Q（Hoffer 1993；2007 勘誤：角度以「度」計、AL 夾限） ---------- */
  function hofferPACD(A) { return 0.58357 * A - 63.896; }
  function hofferQ(inp) {
    need(inp, ['AL', 'K'], 'Hoffer Q');
    const pACD = Number.isFinite(inp.pACD) ? inp.pACD : (Number.isFinite(inp.A) ? hofferPACD(inp.A) : NaN);
    if (!Number.isFinite(pACD)) throw new Error('Hoffer Q 缺少 A 常數或 pACD');
    const { AL, K } = inp;
    const kE = Number.isFinite(inp.Kelp) ? inp.Kelp : K;
    const ALc = Math.min(Math.max(AL, 18.5), 31);
    const M = ALc <= 23 ? 1 : -1;
    const G = ALc <= 23 ? 28 : 23.5;
    const ACD = pACD + 0.3 * (ALc - 23.5) + Math.pow(Math.tan(deg(kE)), 2) +
      0.1 * M * Math.pow(23.5 - ALc, 2) * Math.tan(deg(0.1 * Math.pow(G - ALc, 2))) - 0.99166;
    const d = (ACD + 0.05) / 1000;
    const A1 = 1336 / (AL - ACD - 0.05);
    return {
      ELP: ACD, pACD,
      power: ref => {
        const Rc = ref / (1 - 0.012 * ref);
        return A1 - 1.336 / (1.336 / (K + Rc) - d);
      },
      refraction: P => {
        const Kr = 1.336 / (1.336 / (A1 - P) + d);
        const Rc = Kr - K;
        return Rc / (1 + 0.012 * Rc);
      },
    };
  }

  /* ---------- Haigis（Haigis 2004）；需三個常數，不由 A 常數推定 ---------- */
  function haigis(inp) {
    need(inp, ['AL', 'ACD', 'a0', 'a1', 'a2'], 'Haigis');
    if (!Number.isFinite(inp.K) && !Number.isFinite(inp.R)) throw new Error('Haigis 缺少 K 或角膜半徑');
    const n = NA, nC = 1.3315, dx = 0.012;
    const Rmm = Number.isFinite(inp.R) ? inp.R : KERATOMETRIC / inp.K;
    const Dc = (nC - 1) / (Rmm / 1000);
    const dmm = inp.a0 + inp.a1 * inp.ACD + inp.a2 * inp.AL;
    const L = inp.AL / 1000, d = dmm / 1000;
    return {
      ELP: dmm, Dc,
      power: ref => {
        const z = Dc + ref / (1 - ref * dx);
        return n / (L - d) - n / (n / z - d);
      },
      refraction: P => {
        const z = n / (n / (n / (L - d) - P) + d);
        const q = z - Dc;
        return q / (1 + q * dx);
      },
    };
  }

  /* ---------- 屈光術後：已公開的角膜度數校正 ---------- */
  // Haigis-L（近視術後；Haigis 2008，doctor-hill.com 公開式）
  function haigisLRadius(Kmeas) {
    const rmeas = KERATOMETRIC / Kmeas;
    return 331.5 / (-5.1625 * rmeas + 82.2603 - 0.35);
  }
  function haigisL(inp) {
    need(inp, ['K'], 'Haigis-L');
    const R = haigisLRadius(inp.K);
    const f = haigis(Object.assign({}, inp, { R, K: undefined }));
    return Object.assign(f, { Rcorr: R, Kcorr: KERATOMETRIC / R });
  }
  // Shammas no-history 校正 K：Kc = 1.14 × Kpost − 6.8
  function shammasKc(Kpost) { return 1.14 * Kpost - 6.8; }
  // Wang-Koch-Maloney：Kc = 1.114 × Atlas 中央角膜度數 − 6.1
  function wkmKc(ccp) { return 1.114 * ccp - 6.1; }
  // Masket（2006）：以 EyeWiki 的符號慣例，LVC SE 近視矯正為負值
  function masketAdjust(lvcSE) { return lvcSE * -0.326 + 0.101; }
  // Modified Masket（Hill）
  function modMasketAdjust(lvcSE) { return lvcSE * -0.4385 + 0.029; }

  /* ---------- Toric：向量運算＋Abulafia-Koch 迴歸（平台估算，非 Barrett Toric） ---------- */
  // 以「陡軸」表示散光；x = C·cos2θ、y = C·sin2θ
  function toVec(mag, axis) { return { x: mag * Math.cos(deg(2 * axis)), y: mag * Math.sin(deg(2 * axis)) }; }
  function fromVec(v) {
    const mag = Math.hypot(v.x, v.y);
    let axis = Math.atan2(v.y, v.x) * 90 / Math.PI;
    if (axis <= 0) axis += 180;
    return { mag, axis: mag < 1e-9 ? 0 : axis };
  }
  function abulafiaKoch(vec) {
    return { x: 0.508 + 0.926 * vec.x, y: 0.009 + 0.932 * vec.y };
  }
  function toricPlan(inp) {
    need(inp, ['K1', 'K1axis', 'K2', 'K2axis', 'AL', 'A'], 'Toric 估算');
    const steepK = Math.max(inp.K1, inp.K2);
    const flatK = Math.min(inp.K1, inp.K2);
    const steepAxis = inp.K2 >= inp.K1 ? inp.K2axis : inp.K1axis;
    const anterior = toVec(steepK - flatK, steepAxis);
    const total = inp.usePosteriorRegression === false ? anterior : abulafiaKoch(anterior);
    // SIA：切口子午線變平，等同在切口 +90° 變陡
    const sia = Number.isFinite(inp.SIA) && inp.SIA > 0 && Number.isFinite(inp.incisionAxis)
      ? toVec(inp.SIA, (inp.incisionAxis + 90) % 180) : { x: 0, y: 0 };
    const net = { x: total.x + sia.x, y: total.y + sia.y };
    const netPolar = fromVec(net);
    const Kmean = (inp.K1 + inp.K2) / 2;
    const ELP = srktElp(inp.AL, Kmean, inp.A);
    const ratio = Math.pow(1 - (ELP / 1000) * Kmean / NA, 2);
    const options = (inp.cylinders || []).map(c => {
      const atCornea = c.cyl * ratio;
      const res = { x: net.x - atCornea * Math.cos(deg(2 * netPolar.axis)), y: net.y - atCornea * Math.sin(deg(2 * netPolar.axis)) };
      const p = fromVec(res);
      return { name: c.name, cylIOL: c.cyl, cylCornea: atCornea, residual: p.mag, residualAxis: p.axis };
    });
    return {
      anterior: fromVec(anterior), total: fromVec(total), net: netPolar,
      placementAxis: netPolar.axis, ratio, ELP, options,
    };
  }

  /* ---------- 共用：產生度數表 ---------- */
  function powerTable(formula, target, step) {
    const s = step || 0.5;
    const exact = formula.power(target);
    const center = Math.round(exact / s) * s;
    const rows = [];
    for (let i = 3; i >= -3; i--) {
      const P = round2(center + i * s);
      rows.push({ power: P, refraction: round2(formula.refraction(P)) });
    }
    return { exact: round2(exact), rows };
  }

  return {
    srkt, holladay1, hofferQ, haigis, haigisL,
    holladaySF, hofferPACD, srktElp, haigisLRadius,
    shammasKc, wkmKc, masketAdjust, modMasketAdjust,
    toVec, fromVec, abulafiaKoch, toricPlan, powerTable,
  };
});
