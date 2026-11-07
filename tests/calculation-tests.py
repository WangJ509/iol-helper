"""離線測試：使用虛構案例回應，無外部請求。"""
import copy
import io
import json
import math
from pathlib import Path
import socket
import sys
import unittest
from urllib.error import HTTPError
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from calculations import calculate, validate, InputError

FIXTURES = Path(__file__).parent / 'fixtures'

def body(name='cooke'):
    return {'formula': name, 'measurements': {'eye': 'OD', 'history': 'none', 'biometer': 'Other', 'gender': 'F', 'kIndex': 1.3375, 'AL': 24, 'K1': 43, 'K2': 44, 'ACD': 3.2, 'LT': 4.5, 'CCT': 550, 'WTW': 12, 'target': 0}, 'settings': {'constant': {'cooke': 119, 'hoffer': 5.67, 'pearl': 119.1, 'evo': 119}[name], 'model': {'cooke': 'Other', 'hoffer': 'Default', 'pearl': 'SN60WF', 'evo': 'SN60WF'}[name]}}

class FakeOpener:
    def __init__(self, *responses): self.responses, self.requests = list(responses), []
    def open(self, request, **kwargs):
        self.requests.append(request)
        data = self.responses.pop(0)
        if isinstance(data, Exception): raise data
        return io.BytesIO(data.encode() if isinstance(data, str) else data)

class CalculationTests(unittest.TestCase):
    def test_three_real_synthetic_response_shapes_and_mappings(self):
        for name, expected in [('cooke', -.2347), ('hoffer', -.15), ('pearl', -.215)]:
            with self.subTest(name=name):
                opener = FakeOpener((FIXTURES / (name + '.json')).read_bytes())
                result = calculate(body(name), opener)
                self.assertEqual(result['status'], 'ok')
                self.assertAlmostEqual(next(row['refraction'] for row in result['rows'] if row['power'] == 20), expected)
                wire = json.loads(opener.requests[0].data)
                if name == 'hoffer': self.assertEqual(wire['pACD'], 5.67); self.assertEqual(wire['Gender'], 'Female')
                if name == 'pearl': self.assertTrue(wire['variables']['inputs']['side'])
    def test_evo_gets_fresh_state_and_only_parses_prediction_table(self):
        opener = FakeOpener('<input type="hidden" name="__VIEWSTATE" value="fresh&amp;state">', '<table><tr><td>999</td></tr></table><table class="pred"><tr><td>20</td><td>-0.21</td></tr></table>')
        result = calculate(body('evo'), opener)
        self.assertEqual(result['rows'], [{'power': 20, 'refraction': -.21}])
        self.assertIn(b'__VIEWSTATE=fresh%26state', opener.requests[1].data)
        self.assertIn(b'TextBoxName=Anonymous', opener.requests[1].data)
    def test_unverified_or_identifying_inputs_cannot_reach_upstream(self):
        for key, value in [('AL', None), ('AL', True), ('AL', math.nan), ('history', 'LASIK'), ('history', 'unknown'), ('caseCode', 'TEST'), ('K1', 50), ('eye', 'OU')]:
            request = body(); request['measurements'][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(InputError): validate(request)
        request = body('hoffer'); request['settings']['constant'] = 119
        with self.assertRaises(InputError): validate(request)
    def test_only_allowlisted_models_and_formula_hosts(self):
        request = body(); request['settings']['model'] = 'unknown'
        with self.assertRaises(InputError): validate(request)
        request = body(); request['formula'] = 'http://127.0.0.1/'
        with self.assertRaises(InputError): validate(request)
    def test_missing_optional_values_are_not_sent_as_zero(self):
        request = body(); request['measurements']['LT'] = None
        opener = FakeOpener((FIXTURES / 'cooke.json').read_bytes()); calculate(request, opener)
        self.assertNotIn('LT', json.loads(opener.requests[0].data)['Eyes'][0])
    def test_argos_requires_lens_thickness_for_cooke(self):
        request = body(); request['measurements']['biometer'] = 'Argos'; request['measurements']['LT'] = None
        with self.assertRaises(InputError): validate(request)
    def test_failed_sources_never_return_success_or_zero_rows(self):
        for response in [socket.timeout(), HTTPError('https://example.org', 403, '', {}, None), '{}', '[{"IOLs":[{"Predictions":[{"IOL":20,"Rx":null}]}]}]']:
            result = calculate(body(), FakeOpener(response))
            self.assertEqual(result['status'], 'error'); self.assertNotIn('rows', result)
        result = calculate(body('evo'), FakeOpener('<html>verification</html>'))
        self.assertEqual(result['status'], 'error')
    def test_graphql_errors_are_not_treated_as_empty_success(self):
        result = calculate(body('pearl'), FakeOpener('{"errors":[{"message":"private details"}]}'))
        self.assertEqual(result['status'], 'error'); self.assertNotIn('private details', str(result))

if __name__ == '__main__': unittest.main()
