import http.client
import json
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
import server as web

class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd=web.ThreadingHTTPServer(('127.0.0.1',0),web.Handler)
        cls.port=cls.httpd.server_address[1]
        cls.thread=threading.Thread(target=cls.httpd.serve_forever,daemon=True);cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown();cls.httpd.server_close();cls.thread.join()
    def request(self,body=None,headers=None):
        conn=http.client.HTTPConnection('127.0.0.1',self.port,timeout=5)
        conn.request('POST' if body is not None else 'GET','/api/calculations' if body is not None else '/api/config',body=body,headers=headers or {})
        r=conn.getresponse();result=r.status,dict(r.getheaders()),r.read();conn.close();return result
    def test_config(self):
        status,headers,data=self.request()
        self.assertEqual(status,200);self.assertTrue(json.loads(data)['remoteCalculations']);self.assertEqual(headers['Cache-Control'],'no-store')
    def test_route(self):
        with patch.object(web,'calculate',return_value={'status':'ok','rows':[]}) as calc:
            status,_,data=self.request('{}',{'Content-Type':'application/json'})
        self.assertEqual(status,200);self.assertEqual(json.loads(data)['status'],'ok');calc.assert_called_once_with({})
    def test_cross_origin(self):
        with patch.object(web,'calculate') as calc:
            status,_,_=self.request('{}',{'Content-Type':'application/json','Origin':'https://unrelated.example'})
        self.assertEqual(status,403);calc.assert_not_called()
    def test_invalid_json_and_size(self):
        for body,status in [('{',400),('x'*17000,413)]:
            self.assertEqual(self.request(body,{'Content-Type':'application/json'})[0],status)
    def test_patient_fields(self):
        data={'formula':'cooke','measurements':{'caseCode':'SYNTHETIC'},'settings':{}}
        self.assertEqual(self.request(json.dumps(data),{'Content-Type':'application/json'})[0],400)
    def test_busy_and_content_type(self):
        self.assertEqual(self.request('{}',{'Content-Type':'text/plain'})[0],415)
        with patch.object(web.CALC_SLOTS,'acquire',return_value=False):
            self.assertEqual(self.request('{}',{'Content-Type':'application/json'})[0],429)
if __name__=='__main__':unittest.main()
