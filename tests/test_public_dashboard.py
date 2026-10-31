import copy
import json
import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from export_public_dashboard import ACCOUNT,TARGET,export_snapshot,validate_public_snapshot,write_public_snapshot
from build_public_site import build
from serve_dashboard import DashboardHandler
NODES=('hypothesis','construction','returns','risk','positions','attribution')
OTHER='other-private-account'

def source():
    pf={'updated_at':'2026-10-26T12:00:00Z','accounts':[{'id':ACCOUNT,'label':'Takku','equity':50000,'broker':'rh'},{'id':OTHER,'label':'PRIVATE_LABEL','equity':999999}],
        'positions':[{'account':ACCOUNT,'broker':'rh','kind':'equity','sym':'REAL','qty':10,'avg_cost':15,'price':20,'mkt_value':200,'pnl':50,'pnl_pct':33.333},
                     {'account':OTHER,'kind':'equity','sym':'REAL','qty':37,'avg_cost':7777,'price':20,'mkt_value':740,'pnl':-5555}],
        'transactions':[{'account':ACCOUNT,'sym':'REAL','qty':1.25,'price':15,'ts':'2026-10-26T12:00:00Z'},{'account':OTHER,'sym':'OTHER','qty':999,'price':888}]}
    c={'id':'real-case-id','title':'真实论点','symbol':'REAL','nodes':{k:{'state':'running','data':{}} for k in NODES},'events':[],
       'design':{'plans':[{'id':'p1','name':'原始方案','construction':{'candidate':{'underlying':'REAL','referenceCapital':9999},'legs':[
        {'underlying':'REAL','type':'stock','side':'long','qty':10,'entry':15,'underlyingPrice':700,'quoteAt':'2026-10-26T12:00:00Z'},
        {'underlying':'REAL','type':'stock','side':'long','qty':37,'entry':7777,'quoteAt':'2026-10-26T12:00:00Z'}]}}]},
       'accountRiskSnapshot':json.dumps({'policy':{'account_equity':999999,'bundles':{'研究':{'risk_pct':2}}}})}
    c['nodes']['hypothesis']['data']={'rationale':'真实正文，保持原样','expectation':'未来上涨 10%'}
    c['nodes']['positions']['data']={'executionLinks':[{'allocations':[{'fill_id':'tak-fill','quantity':5},{'fill_id':'other-fill','quantity':9876}]}]}
    c['events']=[{'type':'历史修改','reason':'原始说明','snapshot':copy.deepcopy(c)}]
    w={'version':1,'entries':{'research-desk.workflow.v1':{'version':1,'cases':[c]},'riskPolicy':{'account_equity':999999}}}
    return pf,w

class PublicDataTest(unittest.TestCase):
    def result(self):
        pf,w=source()
        return export_snapshot(pf,w,
            pnl={'accounts':{ACCOUNT:{'label':'Takku','windows':{'ytd':{'metrics':{'n':4,'net':10,'avg_win':3,'max_dd':-8,'sharpe':1.5,'win_rate':.75},'trades':[{'s':'REAL','p':5}]}}},OTHER:{'pnl':999}}},
            monthly={'accounts':{ACCOUNT:{'realized':{'2026-01':10},'snapshots':{'2026-01':{'netliq':25000,'net_flow':100}}},OTHER:{'netliq':999}}},
            robustness={'accounts':{ACCOUNT:{'curve':[['2026-01-01',10,4,6]],'floor_gross':100,'monthly':[{'pnl':5,'ret_pct':3}], 'windows':{'ytd':{'sharpe':1.2}}},'_all':{'pnl':999}}},
            journal={'fills':[{'fill_id':'tak-fill','trade_id':'tak-trade','account':ACCOUNT,'qty':5,'price':15},{'fill_id':'other-fill','account':OTHER,'qty':9876}]},
            broker_pnl={'events':[{'account':ACCOUNT,'realized_gain':10,'quantity':2,'price':15},{'account':OTHER,'realized_gain':7777}]})
    def test_single_scale_preserves_prices_returns_signs_and_source_data(self):
        pf,w=source();before=copy.deepcopy((pf,w));result=export_snapshot(pf,w)
        self.assertEqual((pf,w),before)
        out=result['files']['data/portfolio.json'];self.assertEqual(out['accounts'][0]['equity'],100000)
        self.assertEqual(len(out['positions']),1);p=out['positions'][0]
        for key,v in {'qty':20,'mkt_value':400,'pnl':100,'avg_cost':15,'price':20,'pnl_pct':33.333}.items():self.assertEqual(p[key],v)
        self.assertEqual(out['transactions'][0]['qty'],2.5)
        self.assertNotIn('sourceEquity',json.dumps(result));self.assertNotIn('scaleFactor',json.dumps(result))
    def test_pnl_monthly_and_robustness_all_use_same_scale(self):
        r=self.result();files=r['files'];m=files['data/pnl.json']['accounts'][ACCOUNT]['windows']['ytd']['metrics']
        self.assertEqual((m['net'],m['avg_win'],m['max_dd'],m['n'],m['sharpe'],m['win_rate']),(20,6,-16,4,1.5,.75))
        self.assertEqual(files['data/pnl.json']['accounts'][ACCOUNT]['windows']['ytd']['trades'][0]['p'],10)
        monthly=files['data/monthly_returns.json']['accounts'][ACCOUNT]
        self.assertEqual(monthly['realized']['2026-01'],20);self.assertEqual(monthly['snapshots']['2026-01']['netliq'],50000)
        self.assertEqual(monthly['snapshots']['2026-01']['net_flow'],200)
        robust=files['data/robustness.json']['accounts'][ACCOUNT]
        self.assertEqual(robust['curve'][0],['2026-01-01',20,8,12]);self.assertEqual(robust['floor_gross'],200)
        self.assertEqual(robust['monthly'][0],{'pnl':10,'ret_pct':3})
    def test_real_workflow_prose_states_structure_history_retained_other_finances_removed(self):
        r=self.result();c=r['workflow']['store']['cases'][0]
        self.assertEqual(c['title'],'真实论点');self.assertEqual(c['symbol'],'REAL')
        self.assertEqual(c['nodes']['hypothesis']['data']['rationale'],'真实正文，保持原样')
        self.assertEqual(c['events'][0]['reason'],'原始说明')
        for case in [c,c['events'][0]['snapshot']]:
            legs=case['design']['plans'][0]['construction']['legs'];self.assertEqual(len(legs),1)
            self.assertEqual((legs[0]['qty'],legs[0]['entry']),(20,15))
            self.assertEqual(case['design']['plans'][0]['construction']['candidate']['referenceCapital'],300)
            allocations=case['nodes']['positions']['data']['executionLinks'][0]['allocations']
            self.assertEqual(allocations,[{'fill_id':'tak-fill','quantity':10}])
        raw=json.dumps(r);self.assertNotIn(OTHER,raw);self.assertNotIn('PRIVATE_LABEL',raw)
        self.assertNotIn('7777',raw);self.assertNotIn('9876',raw)
        self.assertEqual(json.loads(c['accountRiskSnapshot'])['policy']['account_equity'],100000)
    def test_exit_labels_only_publish_valid_rules_for_takku_underlyings(self):
        pf,w=source()
        w['entries']['portfolioExitRules']={'real':'expected-return-based','PRIVATE_TICKER':'target-based','OTHER':'trailing-based'}
        r=export_snapshot(pf,w)
        self.assertEqual(r['workflow']['settings']['portfolioExitRules'],{'REAL':'expected-return-based'})
        self.assertNotIn('PRIVATE_TICKER',json.dumps(r))
        pf['positions'][0].update(kind='option',sym='REAL 2030-01-01 20C')
        w['entries']['portfolioExitRules']={'REAL':'trailing-based'}
        self.assertEqual(export_snapshot(pf,w)['workflow']['settings']['portfolioExitRules'],{'REAL':'trailing-based'})
        for invalid in ['sell-everything','',123,{'pnl':999}]:
            w['entries']['portfolioExitRules']={'REAL':invalid}
            self.assertEqual(export_snapshot(pf,w)['workflow']['settings']['portfolioExitRules'],{})

    def test_fail_closed_on_unknown_or_nonpositive_equity_and_tampered_account(self):
        for equity in [None,0,-1,float('nan')]:
            pf,w=source();pf['accounts'][0]['equity']=equity
            with self.assertRaises(ValueError):export_snapshot(pf,w)
        r=self.result();r['files']['data/portfolio.json']['positions'][0]['account']=OTHER
        with self.assertRaises(ValueError):validate_public_snapshot(r)
    def test_short_options_and_fractional_contracts_keep_per_contract_prices(self):
        pf,w=source();pf['positions'][0].update(kind='option',sym='REAL 2030-01-01 20C',qty=-.75,price=30,avg_cost=40,mkt_value=-22.5,pnl=7.5)
        p=export_snapshot(pf,w)['files']['data/portfolio.json']['positions'][0]
        self.assertEqual((p['qty'],p['price'],p['avg_cost'],p['mkt_value'],p['pnl']),(-1.5,30,40,-45,15))
    def test_artifact_only_contains_projected_dataset_and_static_assets(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)/'repo';root.mkdir();(root/'data').mkdir();(root/'assets').mkdir()
            subprocess.run(['git','init','-q',str(root)],check=True)
            (root/'portfolio.html').write_text('<head></head>')
            (root/'data/public-dashboard.json').write_text(json.dumps(self.result()))
            for name in ['portfolio.json','pnl.json','workflow.json']:(root/'data'/name).write_text('PRIVATE')
            (root/'HANDOFF.md').write_text('PRIVATE')
            (root/'assets/link.json').symlink_to(root/'data/portfolio.json')
            subprocess.run(['git','add','.'],cwd=root,check=True)
            out=Path(d)/'site';copied=build(root,out)
            self.assertEqual(set(copied),{'portfolio.html','data/public-dashboard.json'})
            self.assertIn('dashboard-mode',(out/'portfolio.html').read_text())
    def test_regenerating_from_changed_equity_rebases_again_to_100k(self):
        pf,w=source();r1=export_snapshot(pf,w);pf['accounts'][0]['equity']=100000;r2=export_snapshot(pf,w)
        self.assertEqual(r1['files']['data/portfolio.json']['accounts'][0]['equity'],r2['files']['data/portfolio.json']['accounts'][0]['equity'])
        self.assertEqual(r1['files']['data/portfolio.json']['positions'][0]['qty'],2*r2['files']['data/portfolio.json']['positions'][0]['qty'])
    def test_local_export_endpoint_and_origin_guard_without_browser_or_listening_socket(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);data=root/'data';data.mkdir();private=root/'private';private.mkdir()
            pf,w=source();(data/'portfolio.json').write_text(json.dumps(pf))
            body=json.dumps({'workflow':w}).encode()
            handler=object.__new__(DashboardHandler);handler.path='/api/public-dashboard/export'
            handler.headers={'Host':'localhost:8642','Origin':'https://other.example','Content-Type':'application/json','Content-Length':str(len(body))}
            handler.rfile=io.BytesIO(body);handler.data_dir=data;handler.private_dir=private/'thesis_transactions'
            replies=[];handler.reply=lambda status,response,*args:replies.append((status,response))
            handler.do_POST();self.assertEqual(replies[-1][0],403)
            handler.headers['Origin']='http://localhost:8642';handler.rfile=io.BytesIO(body)
            handler.do_POST();self.assertEqual(replies[-1][0],200)
            result=replies[-1][1]['snapshot'];validate_public_snapshot(result)
            self.assertEqual(result['files']['data/portfolio.json']['accounts'][0]['equity'],100000)
            self.assertEqual((private/'public_workflow_source.json').stat().st_mode&0o777,0o600)
            self.assertFalse((private/'workflow.json').exists())

if __name__=='__main__':unittest.main()
