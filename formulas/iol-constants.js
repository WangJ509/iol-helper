/*
 * 依「IOL constant.pdf」（桌面 R1眼科）建立。欄位：ascan = A-scan 欄、srkt = SRK/T（光學）欄。
 * 原表空白、「?」、「___」、「..」一律記為 null 並加註，不補猜。
 * status：ok = 兩欄皆有值；partial = 只有一欄；unclear = 需確認；excluded = 原表刪除線或非 IOL。
 */
(function (root) {
  const C = [
    { maker: 'AMO', model: 'AAB00', note: '單焦點球面', ascan: 118.4, srkt: 119.0, status: 'ok' },
    { maker: 'AMO', model: 'ICB00', note: '短延焦 Tecnis Eyhance', ascan: 118.8, srkt: 119.3, status: 'ok' },
    { maker: 'AMO', model: 'DIU', note: '散光；原表常數欄僅寫「..」，意義不明', ascan: null, srkt: null, status: 'unclear' },
    { maker: 'AMO', model: 'PureSee', note: '長延焦；原表常數空白', ascan: null, srkt: null, status: 'unclear' },
    { maker: 'NIDEK', model: 'SZ-1', note: '單非（與 NP-1 同列）', ascan: 119.1, srkt: 119.6, status: 'ok' },
    { maker: 'NIDEK', model: 'NP-1', note: '單非 preload（與 SZ-1 同列）', ascan: 119.1, srkt: 119.6, status: 'ok' },
    { maker: 'B&L', model: 'MX60', note: '單非（與 MX60T 同列）', ascan: 118.7, srkt: 119.15, status: 'ok' },
    { maker: 'B&L', model: 'MX60T', note: '單非散（與 MX60 同列）', ascan: 118.7, srkt: 119.15, status: 'ok' },
    { maker: 'Aspira', model: 'AXA', note: '原表整列刪除線，不使用', ascan: null, srkt: null, status: 'excluded' },
    { maker: 'Aspira', model: 'aAY', note: '黃片 單非', ascan: 118.4, srkt: 118.78, status: 'ok' },
    { maker: 'Aspira', model: 'triva aAY', note: '三焦黃', ascan: 118.1, srkt: 119.29, status: 'ok' },
    { maker: 'Alcon', model: 'CZ70BD', note: '健保硬片', ascan: 118.81, srkt: 119.14, status: 'ok' },
    { maker: 'Alcon', model: 'MA60AC', note: '健保 3 piece', ascan: 118.4, srkt: 119.2, status: 'ok' },
    { maker: 'Alcon', model: 'MA60MA', note: 'three piece（低度數）', ascan: 118.9, srkt: 119.2, status: 'ok' },
    { maker: 'PhysIOL', model: 'Ankoris', note: '單焦散黃', ascan: 118.73, srkt: 118.95, status: 'ok' },
    { maker: 'PhysIOL', model: 'PODF', note: '多焦黃；A-scan 欄為「___」', ascan: null, srkt: 118.95, status: 'partial' },
    { maker: 'Zeiss', model: 'TORBI', note: '單焦散 白', ascan: 118.3, srkt: 118.5, status: 'ok' },
    { maker: 'Zeiss', model: 'LARA', note: '長延焦 +/-散', ascan: 117.8, srkt: 118.5, status: 'ok' },
    { maker: 'Zeiss', model: 'LISA', note: '多焦 +/-散', ascan: 118.2, srkt: 118.5, status: 'ok' },
    { maker: 'Zeiss', model: 'Asphina 409', note: '單非；原表僅寫「Optical 118.3」', ascan: null, srkt: 118.3, status: 'partial' },
    { maker: 'Rayner', model: 'RAO600C', note: '單焦 +/-散', ascan: 118.0, srkt: 118.6, status: 'ok' },
    { maker: 'Hanita', model: 'Seelens HP', note: 'preloaded', ascan: 118.86, srkt: 119.2, status: 'ok' },
    { maker: 'Hanita', model: 'Vistor', note: '單焦散；A-scan 欄為「?」', ascan: null, srkt: 117.7, status: 'partial' },
    { maker: '優視德 Synthesis', model: '長延焦', note: '價錢是短延散；A-scan 欄為「?」', ascan: null, srkt: 118.0, status: 'partial' },
    { maker: 'HOYA', model: 'isert-150 / XY1A-SP', note: '健保 單散黃；XY1A-SP 另有一列空白，來源衝突需確認', ascan: 118.4, srkt: 118.5, status: 'unclear' },
    { maker: 'HOYA', model: 'vivinex', note: '單焦', ascan: 118.9, srkt: 119.2, status: 'ok' },
    { maker: 'HOYA', model: 'vivinex Gemetric plus (GP)', note: '非球面三焦點', ascan: 118.9, srkt: 119.2, status: 'ok' },
    { maker: 'HD', model: '單非', note: '', ascan: 118.0, srkt: 118.4, status: 'ok' },
    { maker: '辛生／樂敦', model: 'Ray-61PL / 62L', note: '四腳／兩腳；A-scan 欄為「___」', ascan: null, srkt: 118.0, status: 'partial' },
    { maker: 'Artisan', model: '前', note: '', ascan: 115.0, srkt: 115.7, status: 'ok' },
    { maker: 'Artisan', model: '後（主要用後夾式）', note: '', ascan: 116.8, srkt: 116.9, status: 'ok' },
  ];
  root.IOL_CONSTANTS = C;
  if (typeof module === 'object' && module.exports) module.exports = C;
})(typeof self !== 'undefined' ? self : this);
