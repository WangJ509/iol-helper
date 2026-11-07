"""四個作者網站的標準 SE 查詢；僅傳送白名單測量欄位，不含病歷或 PDF。"""
import json
import math
import socket
import time
from html.parser import HTMLParser
from http.cookiejar import CookieJar
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, build_opener, HTTPCookieProcessor

SOURCES = {
    'cooke': ('Cooke K6 2024.01', 'https://cookeformula.com/api/v1/k6/v2024.01/preop'),
    'hoffer': ('Hoffer QST', 'https://hofferqst.com/compute'),
    'pearl': ('PEARL-DGS', 'https://iolsolver.com/graphql'),
    'evo': ('EVO 2.0', 'https://www.evoiolcalculator.com/Calculator.aspx'),
}
COOKE_FAMILIES = {'Other', 'JAndJ1PieceTecnisOrSensar', 'ZeissPlateHaptic', 'AlconMA60MA', 'AlconSA60AT', 'EnvistaEnhanced'}
PEARL_MODELS = {'Other_Men', 'SN60WF', 'Finevision', 'Panoptix', 'Vivinex', 'PCB', 'MX60', 'SA60AT', 'Asphina', '60MA', 'A1-UV', 'AR40', 'RayOne'}
EVO_MODELS = {'Standard', 'Tecnis', 'AR40e/E/M', 'MA60MA', 'SA60AT', 'SA60WF', 'SN60WF', 'CNA0T0', 'Vivity', 'Panoptix', 'ZCB00'}
LIMITS = {'AL': (12, 40), 'K1': (30, 65), 'K2': (30, 65), 'ACD': (1.1, 6),
          'LT': (2, 8), 'CCT': (250, 850), 'WTW': (8, 16), 'target': (-10, 10)}
TIMEOUT = 18
MAX_RESPONSE = 2 * 1024 * 1024

class InputError(ValueError):
    pass

class SourceError(ValueError):
    pass

def number(value, label, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise InputError('%s 必須是 %s–%s 範圍內的數字' % (label, low, high))
    return value

def validate(body):
    if not isinstance(body, dict) or set(body) != {'formula', 'measurements', 'settings'}:
        raise InputError('只接受 formula、measurements、settings')
    name, m, settings = body['formula'], body['measurements'], body['settings']
    if not isinstance(name, str) or name not in SOURCES:
        raise InputError('不支援的公式')
    if not isinstance(m, dict) or set(m) - (set(LIMITS) | {'eye', 'gender', 'kIndex', 'history', 'biometer'}):
        raise InputError('測量欄位格式不符；不可附帶病歷號、姓名或 PDF')
    if not isinstance(settings, dict) or set(settings) - {'constant', 'model'}:
        raise InputError('公式設定格式不符')
    for key in ('AL', 'K1', 'K2', 'ACD', 'target'):
        if key not in m:
            raise InputError('缺少 ' + key)
        number(m[key], key, *LIMITS[key])
    m = dict(m)
    for key, limits in LIMITS.items():
        if key in m and m[key] is not None:
            number(m[key], key, *limits)
    if m.get('history') != 'none':
        raise InputError('遠端查詢目前僅支援已確認無角膜屈光手術的標準 SE')
    if m.get('eye') not in ('OD', 'OS'):
        raise InputError('請確認左右眼')
    if m['K1'] > m['K2']:
        raise InputError('K1 不可大於 K2，請回核對頁確認同一組 K')
    if m.get('kIndex') not in (1.3375, 1.332, 1.3315):
        raise InputError('不支援的 K index')
    if m.get('biometer') not in ('Other', 'Lenstar', 'Argos'):
        raise InputError('請選擇光學生物測量儀器類別')
    if m.get('gender') not in (None, '', 'M', 'F'):
        raise InputError('性別格式不符')
    constant = number(settings.get('constant'), 'pACD' if name == 'hoffer' else 'A 常數', 0 if name == 'hoffer' else 112, 10 if name == 'hoffer' else 125)
    model = settings.get('model')
    if not isinstance(model, str):
        raise InputError('請選擇公式使用的鏡片模型／家族')
    allowed = {'cooke': COOKE_FAMILIES, 'pearl': PEARL_MODELS, 'evo': EVO_MODELS, 'hoffer': {'Default'}}[name]
    if model not in allowed:
        raise InputError('不支援的鏡片模型／家族')
    if name == 'hoffer' and m.get('gender') not in ('M', 'F'):
        raise InputError('Hoffer QST 需要性別')
    if name == 'cooke':
        for key, limits in {'AL': (13, 40), 'K1': (32, 57), 'K2': (32, 57), 'ACD': (1.1, 5.9)}.items():
            number(m[key], key, *limits)
        number(constant, 'Cooke A 常數', 112, 123)
        if m['biometer'] == 'Argos' and m.get('LT') is None:
            raise InputError('Cooke 的 Argos 模式需要 LT')
    return name, m, {'constant': constant, 'model': model}

def compact(data):
    return {key: value for key, value in data.items() if value is not None}

def json_request(url, data):
    return Request(url, data=json.dumps(data, allow_nan=False).encode(), headers={'Content-Type': 'application/json', 'Accept': 'application/json'}, method='POST')

def read_response(opener, request, timeout):
    with opener.open(request, timeout=timeout) as response:
        data = response.read(MAX_RESPONSE + 1)
        if len(data) > MAX_RESPONSE:
            raise SourceError('來源回應過大')
        return data.decode('utf-8')

class EvoForm(HTMLParser):
    def __init__(self):
        super().__init__()
        self.values = {}
    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        if tag == 'input' and data.get('type') == 'hidden' and data.get('name'):
            self.values[data['name']] = data.get('value', '')

class EvoTable(HTMLParser):
    def __init__(self):
        super().__init__()
        self.depth, self.in_cell, self.text, self.cells = 0, False, '', []
    def handle_starttag(self, tag, attrs):
        if tag == 'table' and 'pred' in dict(attrs).get('class', '').split():
            self.depth = 1
        elif tag == 'table' and self.depth:
            self.depth += 1
        if tag == 'td' and self.depth:
            self.in_cell, self.text = True, ''
    def handle_data(self, text):
        if self.in_cell:
            self.text += text
    def handle_endtag(self, tag):
        if tag == 'td' and self.in_cell:
            self.cells.append(self.text.strip())
            self.in_cell = False
        if tag == 'table' and self.depth:
            self.depth -= 1

def normalize(pairs):
    rows = []
    for power, rx in pairs:
        # float(None)、bool、NaN 均不可變成可用預測。
        if power is None or rx is None or isinstance(power, bool) or isinstance(rx, bool):
            raise SourceError('來源預測有缺值')
        p, r = float(power), float(rx)
        if not math.isfinite(p) or not math.isfinite(r) or not -30 <= p <= 100 or not -50 <= r <= 50:
            raise SourceError('來源預測格式不符')
        rows.append({'power': p, 'refraction': r})
    if not rows or len(rows) > 100 or len({r['power'] for r in rows}) != len(rows):
        raise SourceError('來源未回傳有效的預測表格')
    return sorted(rows, key=lambda row: row['power'])

def calculate(body, opener=None, timeout=TIMEOUT):
    name, m, s = validate(body)
    title, url = SOURCES[name]
    started = time.monotonic()
    if opener is None:
        opener = build_opener(HTTPCookieProcessor(CookieJar()))
        opener.addheaders = [('User-Agent', 'IOLHelper/1.0 (+https://github.com/WangJ509/iol-helper)')]
    c = s['constant']
    try:
        if name == 'cooke':
            eye = compact({'SpecialSituation': 'None', 'TgtRx': m['target'], 'Biometer': m['biometer'], **{k: m.get(k) for k in ('AL', 'K1', 'K2', 'ACD', 'LT', 'CCT', 'WTW')}})
            result = json.loads(read_response(opener, json_request(url, {'KIndex': m['kIndex'], 'PredictionsPerIol': 7, 'IOLs': [{'AConstant': c, 'Family': s['model']}], 'Eyes': [eye]}), timeout))
            predictions = result[0]['IOLs'][0]['Predictions']
            pairs = [(p['IOL'], p['Rx']) for p in predictions]
        elif name == 'hoffer':
            data = compact({'Index': m['kIndex'], 'Eye': 'Right' if m['eye'] == 'OD' else 'Left', 'Gender': 'Female' if m['gender'] == 'F' else 'Male', 'AL': m['AL'], 'ACD': m['ACD'], 'LT': m.get('LT'), 'pACD': c, 'IOLName': s['model'], 'TargetRx': m['target'], 'CalculationChoice': 'SE', 'K1': m['K1'], 'K2': m['K2'], 'PostLasik': False, 'PostRK': False})
            result = json.loads(read_response(opener, json_request(url, data), timeout))['SE'][0]
            if len(result['IOL']) != len(result['ExpectedRx']):
                raise SourceError('來源表格長度不符')
            pairs = list(zip(result['IOL'], result['ExpectedRx']))
        elif name == 'pearl':
            inputs = compact({'keratometric_index': m['kIndex'], 'biometer': 'Argos' if m['biometer'] == 'Argos' else 'Other', 'side': m['eye'] == 'OD', 'iol_model': s['model'], 'aconst': c, 'target': m['target'], **{k.lower(): m.get(k) for k in ('AL', 'K1', 'K2', 'ACD', 'LT', 'CCT')}})
            query = 'query solve($inputs: IolInputsType!) { solve(inputs: $inputs) { target p1 { es power } p05 { es power } p0 { es power } pm05 { es power } pm1 { es power } } }'
            result = json.loads(read_response(opener, json_request(url, {'operationName': 'solve', 'query': query, 'variables': {'inputs': inputs}}), timeout))
            if result.get('errors'):
                raise SourceError('PEARL 回報資料或計算錯誤，請確認鏡片與測量值')
            solution = result['data']['solve']
            pairs = [(solution[k]['power'], solution[k]['es']) for k in ('p1', 'p05', 'p0', 'pm05', 'pm1')]
        else:
            form = EvoForm()
            form.feed(read_response(opener, Request(url), timeout))
            if '__VIEWSTATE' not in form.values:
                raise SourceError('EVO 表單不可用或需要驗證，請改用官網')
            form.values.update(compact({'TextBoxName': 'Anonymous', 'TextBoxID': '', 'TextBoxSurgeon': '', 'RadioButtonRLEye': '1' if m['eye'] == 'OD' else '0', 'txtAL': m['AL'], 'txtK1': m['K1'], 'txtK2': m['K2'], 'txtACD': m['ACD'], 'txtLT': m.get('LT'), 'txtCCT': m.get('CCT'), 'txtRefraction': m['target'], 'txtAConstant': c, 'DropDownArgos': '1' if m['biometer'] == 'Argos' else '0', 'DropDownIOLModel': s['model'], 'DropDownKIndex': m['kIndex'], 'DropDownLASIK': '0', 'DropDownListPK': 'IOLMaster 700', 'txtPK1': '', 'txtPK2': '', 'btnCalculate': 'Calculate'}))
            table = EvoTable()
            request = Request(url, data=urlencode(form.values).encode(), headers={'Content-Type': 'application/x-www-form-urlencoded'}, method='POST')
            remaining = max(1, timeout - (time.monotonic() - started))
            table.feed(read_response(opener, request, remaining))
            if not table.cells or len(table.cells) % 2:
                raise SourceError('EVO 未回傳預測表格，請確認輸入或改用官網')
            pairs = list(zip(table.cells[::2], table.cells[1::2]))
        rows = normalize(pairs)
        return {'formula': name, 'name': title, 'status': 'ok', 'rows': rows, 'source': url, 'constant': c, 'model': s['model'], 'queriedAt': time.time(), 'elapsedMs': round((time.monotonic() - started) * 1000)}
    except HTTPError as error:
        message = '來源要求驗證或拒絕連線，請改用官網' if error.code in (401, 403) else '來源暫時無法計算（HTTP %s）' % error.code
    except (socket.timeout, TimeoutError):
        message = '來源回應逾時，請稍後重試'
    except URLError:
        message = '無法連線至來源，請稍後重試'
    except SourceError as error:
        message = str(error)
    except (ValueError, TypeError, KeyError, IndexError, AttributeError):
        message = '來源回應格式已變更或資料未被接受，請改用官網'
    return {'formula': name, 'name': title, 'status': 'error', 'message': message, 'source': url}
