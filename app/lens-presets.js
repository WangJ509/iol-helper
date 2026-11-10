/* 官網公開鏡片預設值；按製造商＋完整型號精確對應，不推算其他公式常數。 */
(function (root) {
  'use strict';
  const entries = {
  "AMO|AAB00": {
    "cooke": {
      "model": "JAndJ1PieceTecnisOrSensar",
      "constant": 118.9942,
      "reference": "J&J Sensar AAB00"
    },
    "hoffer": {
      "model": "Default",
      "constant": 5.56,
      "reference": "J&J - SENSAR AAB00"
    },
    "pearl": {
      "model": "Other_Men",
      "constant": null,
      "reference": "通用模型；官網未列出這片鏡片的預設常數"
    },
    "evo": {
      "model": "Standard",
      "constant": null,
      "reference": "通用模型；官網未列出這片鏡片的預設常數"
    }
  },
  "AMO|ICB00": {
    "cooke": {
      "model": "JAndJ1PieceTecnisOrSensar",
      "constant": 119.4303,
      "reference": "J&J Tecnis 1-Piece (ZCB00, ICB00, ZCU***, ZXR00)"
    },
    "hoffer": {
      "model": "Default",
      "constant": 5.8,
      "reference": "J&J - EYHANCE ICB00/DIB00"
    },
    "pearl": {
      "model": "Other_Men",
      "constant": null,
      "reference": "通用模型；官網未列出這片鏡片的預設常數"
    },
    "evo": {
      "model": "Eyhance",
      "constant": 119.3,
      "reference": "Eyhance"
    }
  },
  "B&L|MX60": {
    "cooke": {
      "model": "Other",
      "constant": 119.294,
      "reference": "B&L Envista MX60"
    },
    "hoffer": {
      "model": "Default",
      "constant": 5.68,
      "reference": "B+L - EnVista MX60"
    },
    "pearl": {
      "model": "MX60",
      "constant": 119.3,
      "reference": "Envista MX60"
    },
    "evo": {
      "model": "Standard",
      "constant": null,
      "reference": "通用模型；官網未列出這片鏡片的預設常數"
    }
  },
  "Alcon|MA60AC": {
    "cooke": {
      "model": "Other",
      "constant": null,
      "reference": "通用模型；官網未列出這片鏡片的預設常數"
    },
    "hoffer": {
      "model": "Default",
      "constant": 5.67,
      "reference": "Alcon - MA60AC"
    },
    "pearl": {
      "model": "Other_Men",
      "constant": null,
      "reference": "通用模型；官網未列出這片鏡片的預設常數"
    },
    "evo": {
      "model": "Standard",
      "constant": null,
      "reference": "通用模型；官網未列出這片鏡片的預設常數"
    }
  },
  "Alcon|MA60MA": {
    "cooke": {
      "model": "AlconMA60MA",
      "constant": 118.9,
      "reference": "Alcon MA60MA/MN60MA"
    },
    "hoffer": {
      "model": "Default",
      "constant": 5.8,
      "reference": "Alcon - MA60MA"
    },
    "pearl": {
      "model": "60MA",
      "constant": null,
      "reference": "通用模型；官網未列出這片鏡片的預設常數"
    },
    "evo": {
      "model": "MA60MA",
      "constant": 119.2,
      "reference": "MA60MA"
    }
  },
  "Alcon|SN60WF": {
    "cooke": {
      "model": "Other",
      "constant": 118.9648,
      "reference": "Alcon SA60WF/SN60WF"
    },
    "hoffer": {
      "model": "Default",
      "constant": 5.67,
      "reference": "Alcon - SN60WF/SA60WF"
    },
    "pearl": {
      "model": "SN60WF",
      "constant": 119.1,
      "reference": "SN60WF"
    },
    "evo": {
      "model": "SN60WF",
      "constant": 119.0,
      "reference": "SN60WF"
    }
  },
  "AMO|ZCB00": {
    "cooke": {
      "model": "JAndJ1PieceTecnisOrSensar",
      "constant": 119.4303,
      "reference": "J&J Tecnis 1-Piece (ZCB00, ICB00, ZCU***, ZXR00)"
    },
    "hoffer": {
      "model": "Default",
      "constant": 5.8,
      "reference": "J&J - TECNIS ZCB00/PCB00"
    },
    "pearl": {
      "model": "PCB",
      "constant": 119.35,
      "reference": "PCB00/ZCB00"
    },
    "evo": {
      "model": "ZCB00",
      "constant": 119.3,
      "reference": "ZCB00"
    }
  },
  "Alcon|SA60AT": {
    "cooke": {
      "model": "AlconSA60AT",
      "constant": 118.8041,
      "reference": "Alcon SA60AT/SN60AT"
    },
    "hoffer": {
      "model": "Default",
      "constant": 5.43,
      "reference": "Alcon - SN60AT/SA60AT"
    },
    "pearl": {
      "model": "SA60AT",
      "constant": 118.85,
      "reference": "SA60AT"
    },
    "evo": {
      "model": "SA60AT",
      "constant": 118.8,
      "reference": "SA60AT"
    }
  }
};
  const sources = {
  "cooke": {
    "url": "https://cookeformula.com/",
    "checkedAt": "2026-11-10"
  },
  "hoffer": {
    "url": "https://hofferqst.com/",
    "checkedAt": "2026-11-10"
  },
  "pearl": {
    "url": "https://iolsolver.com/regular",
    "checkedAt": "2026-11-10"
  },
  "evo": {
    "url": "https://www.evoiolcalculator.com/Calculator.aspx",
    "checkedAt": "2026-11-10"
  }
};
  function defaults(lens) {
    const key = lens ? lens.maker + '|' + lens.model : '';
    const entry = entries[key] || {};
    return Object.fromEntries(['cooke', 'hoffer', 'pearl', 'evo'].map(id => [id, {
      model: entry[id] ? entry[id].model : id === 'hoffer' ? 'Default' : '',
      constant: entry[id] ? entry[id].constant : null,
      reference: entry[id] ? entry[id].reference : '尚無可靠對照，請確認完整型號後補填',
      source: sources[id],
    }]));
  }
  const api = { defaults, entries, sources };
  root.IOLLensPresets = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
