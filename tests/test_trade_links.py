import json
import sys
import tempfile
import unittest
import threading
import http.client
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from trade_journal import import_rows, update_annotation, load_annotations
from trade_links import mutate_links, load_links
from tests.test_trade_journal import equity
from serve_dashboard import DashboardHandler

class TradeLinksTest(unittest.TestCase):
    def test_api_rejects_stale_etag_and_cross_origin_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            journal,_=import_rows([equity(qty=10)],root/'journal.json')
            fill=journal['fills'][0]
            body={'action':'link','operation_id':'one','trade_id':fill['trade_id'],'role':'hedge',
                  'workflow_case':{'id':'case-a','title':'test','revision':1,'archived':False,'underlyings':[]},
                  'allocations':[{'fill_id':fill['fill_id'],'quantity':2}]}
            server=ThreadingHTTPServer(('127.0.0.1',0),partial(DashboardHandler,directory=str(root),journal_path=root/'journal.json'))
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                def request(method,headers=None):
                    connection=http.client.HTTPConnection('127.0.0.1',server.server_port)
                    connection.request(method,'/api/trade-links',json.dumps(body) if method=='POST' else None,headers or {})
                    response=connection.getresponse();result=(response.status,json.loads(response.read()),response.getheader('ETag'));connection.close();return result
                headers={'Content-Type':'application/json','If-None-Match':'*'}
                self.assertEqual(request('GET')[0],200)
                status,document,tag=request('POST',headers)
                self.assertEqual(status,200);self.assertTrue(tag)
                body['operation_id']='two'
                self.assertEqual(request('POST',headers)[0],409)
                self.assertEqual(request('POST',{'Content-Type':'application/json','If-Match':tag,'Origin':'https://foreign.example'})[0],403)
                self.assertEqual(request('POST',{'Content-Type':'application/json','If-Match':tag})[0],200)
            finally:
                server.shutdown();server.server_close();thread.join()

    def test_allocations_audit_unlink_idempotence_and_note_preservation(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            journal,_=import_rows([equity(qty=10,execution_id='one')],root/'journal.json')
            fill=journal['fills'][0]
            update_annotation(fill['trade_id'],'keep reason',journal,root/'annotations.json')
            path=root/'trade_links.json'
            body={'action':'link','operation_id':'one','trade_id':fill['trade_id'],'role':'entry',
                  'workflow_case':{'id':'case-a','title':'test','revision':1,'archived':False,'underlyings':['DELL']},
                  'allocations':[{'fill_id':fill['fill_id'],'quantity':6}]}
            doc=mutate_links(path,body,journal)
            self.assertEqual(mutate_links(path,body,journal)['revision'],1)
            with self.assertRaisesRegex(ValueError,'剩余'):
                mutate_links(path,{**body,'operation_id':'two'},journal)
            second=mutate_links(path,{**body,'operation_id':'two','allocations':[{'fill_id':fill['fill_id'],'quantity':4}]},journal)
            self.assertEqual(len(second['links']),2)
            link_id=doc['links'][0]['link_id']
            third=mutate_links(path,{'action':'unlink','operation_id':'three','link_id':link_id},journal)
            self.assertEqual(third['links'][-1]['status'],'unlinked')
            self.assertEqual(third['events'][0]['link']['status'],'active')
            self.assertEqual(load_links(path)['revision'],3)
            self.assertEqual(load_annotations(root/'annotations.json')['annotations'][fill['trade_id']]['reason'],'keep reason')
            self.assertEqual(json.loads((root/'journal.json').read_text())['fills'],journal['fills'])
    def test_reject_foreign_fill_incomplete_scope_and_fractional_options(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            journal,_=import_rows([equity(kind='option',sym='DELL 2026-11-06 120C',qty=2)],root/'journal.json')
            fill=journal['fills'][0]
            body={'action':'link','operation_id':'one','trade_id':fill['trade_id'],'role':'entry',
                  'workflow_case':{'id':'case-a','title':'test','revision':1,'archived':False,'underlyings':['DELL']},
                  'allocations':[{'fill_id':fill['fill_id'],'quantity':.5}]}
            with self.assertRaisesRegex(ValueError,'整数'):mutate_links(root/'links.json',body,journal)
            body['allocations'][0]['quantity']=1
            body['workflow_case']['underlyings']=[]
            with self.assertRaisesRegex(ValueError,'In Action'):mutate_links(root/'links.json',body,journal)
            body['role']='hedge'
            self.assertEqual(mutate_links(root/'links.json',body,journal)['revision'],1)

if __name__=='__main__':unittest.main()
