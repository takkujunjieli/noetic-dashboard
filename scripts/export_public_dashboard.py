#!/usr/bin/env python3
"""Publish full research Workflow plus a Takku-only portfolio rebased to $100,000 net equity."""
import argparse
import copy
import json
import math
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRIVATE = ROOT.parent / 'stock-dashboard-private'
KEY = 'research-desk.workflow.v1'
ACCOUNT = 'takku-rh-2566'
TARGET = 100000.0
DROP = object()
MONEY = {'equity','netliq','net_liq','net_liquidation','account_equity','accountEquity','accountNetLiq',
         'cash','cash_balance','buying_power','market_value','mkt_value','pnl','realized','unrealized','realized_gain',
         'amount','value','net_flow','net_deposits','deposits','withdrawals','fees','fee','commission','commissions',
         'net','gross_profit','gross_loss','avg_win','avg_loss','expectancy','max_win','max_loss','vol_daily','mar_daily','max_dd'}
QUANTITY = {'qty','quantity','shares','position_qty','allocated_quantity'}
PRICE = {'price','avg_cost','entry','mark','strike','underlyingPrice','underlying_price','referencePrice','referenceSpot','referenceMark'}
PNL_MONEY = MONEY - {'value'}


def atomic_json(path, value, private=False):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    name=None
    try:
        with tempfile.NamedTemporaryFile(mode='w',dir=path.parent,prefix='.public-export-',delete=False) as f:
            name=Path(f.name);json.dump(value,f,ensure_ascii=False,indent=1,allow_nan=False);f.write('\n')
        os.chmod(name,0o600 if private else 0o644);name.replace(path)
    finally:
        if name and name.exists():name.unlink()


def number(v):
    return isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v)


def scale(v,factor):
    if number(v):return v*factor
    if isinstance(v,str) and v.strip():
        try:
            parsed=float(v)
            if math.isfinite(parsed):return parsed*factor
        except ValueError:pass
    return v


def scale_fields(value,factor,keys):
    if isinstance(value,list):return [scale_fields(v,factor,keys) for v in value]
    if isinstance(value,dict):return {k:scale(v,factor) if k in keys and isinstance(v,(int,float,str)) else scale_fields(v,factor,keys) for k,v in value.items()}
    return value


def takku_portfolio(source):
    account=next((a for a in source.get('accounts',[]) if a.get('id')==ACCOUNT),None)
    if not account or not number(account.get('equity')) or account['equity']<=0:
        raise ValueError('Takku 必须有有效的正净值；不能用持仓市值替代净值进行 100k 折算')
    factor=TARGET/account['equity']
    # Explicit projection prevents another account or a future source field from leaking.
    allowed={'broker','account','price_as_of','price_source','sym','qty','avg_cost','price','kind','mkt_value','pnl','pnl_pct',
             'multiplier','underlying_price','delta','gamma','theta','vega','iv','implied_volatility'}
    positions=[scale_fields({k:copy.deepcopy(v) for k,v in p.items() if k in allowed},factor,MONEY|QUANTITY)
               for p in source.get('positions',[]) if p.get('account')==ACCOUNT]
    tx_keys={'account','broker','kind','price','qty','side','state','sym','ts','fees','commission'}
    transactions=[scale_fields({k:copy.deepcopy(v) for k,v in t.items() if k in tx_keys},factor,MONEY|QUANTITY)
                  for t in source.get('transactions',[]) if t.get('account')==ACCOUNT]
    return {'updated_at':source.get('updated_at'),'brokers':[account.get('broker','rh')],
            'accounts':[{'id':ACCOUNT,'label':account.get('label') or ACCOUNT,'broker':account.get('broker','rh'),
                         'equity':TARGET,'source_updated_at':account.get('source_updated_at')}],
            'positions':positions,'transactions':transactions},factor


def scoped_accounts(data,factor,kind):
    if not data:return None
    account=data.get('accounts',{}).get(ACCOUNT)
    if account is None:return None
    if kind=='pnl':
        account=scale_fields(copy.deepcopy(account),factor,PNL_MONEY)
        for window in account.get('windows',{}).values():
            for t in window.get('trades',[]):t['p']=scale(t.get('p'),factor)
    elif kind=='monthly':
        account=copy.deepcopy(account)
        account['realized']={k:scale(v,factor) for k,v in account.get('realized',{}).items()}
        account['snapshots']=scale_fields(account.get('snapshots',{}),factor,MONEY)
    else:
        account=scale_fields(copy.deepcopy(account),factor,MONEY|QUANTITY|{'p','cum_pnl','cum_pnl_long','cum_pnl_short','capital','daily_pnl'})
        account['curve']=[[r[0],*(scale(v,factor) for v in r[1:])] for r in account.get('curve',[])]
        if 'floor_gross' in account:account['floor_gross']=scale(account['floor_gross'],factor)
    out={k:copy.deepcopy(v) for k,v in data.items() if k in ('updated_at','updated','as_of','risk_free_annual','dates','benchmarks','benchmark','window_starts','rf_annual','note')}
    out['accounts']={ACCOUNT:account}
    return out


def workflow_projection(store,other_accounts,fill_accounts,factor=1,portfolio=None):
    """Keep all research content/history; strip other accounts' scoped records and capital snapshots."""
    private_tokens={str(t) for a in other_accounts for t in (a.get('id'),a.get('label')) if t}
    def clean(value,key=''):
        if isinstance(value,list):
            return [out for item in value if (out:=clean(item,key)) is not DROP]
        if isinstance(value,dict):
            account=value.get('account') or value.get('account_id')
            if account and account!=ACCOUNT:return DROP
            if any(isinstance(value.get(k),str) and any(t in value[k] for t in private_tokens)
                   for k in ('key','position_key','positionKey')):return DROP
            if key=='accounts':
                return {ACCOUNT:clean(value[ACCOUNT],ACCOUNT)} if ACCOUNT in value else {}
            if 'fill_id' in value and fill_accounts.get(value['fill_id'])!=ACCOUNT:return DROP
            # Auto-filled legs carry the broker quote timestamp but legacy legs
            # omitted account IDs. Only publish a unique, verified Takku match.
            if value.get('type') in ('stock','call','put') and value.get('quoteAt') and 'entry' in value:
                matches=[]
                for p in (portfolio or {}).get('positions',[]):
                    root=str(p.get('sym','')).split(' ')[0]
                    multiplier=1 if value['type']=='stock' else 100
                    if value['type']=='stock' and p.get('kind')!='equity':continue
                    if value['type']!='stock':
                        contract=re.fullmatch(r'\S+ (\d{4}-\d{2}-\d{2}) (\d+(?:\.\d+)?)([CP])',str(p.get('sym','')))
                        if not contract or contract[1]!=value.get('expiry') or float(contract[2])!=float(value.get('strike') or 0) or contract[3]!=('C' if value['type']=='call' else 'P'):continue
                    if (root==value.get('underlying') and number(p.get('qty')) and number(p.get('avg_cost'))
                        and math.isclose(abs(p['qty']),float(value.get('qty') or 0),rel_tol=1e-8)
                        and math.isclose(p['avg_cost']/multiplier,float(value.get('entry') or 0),rel_tol=1e-8)
                        and ('short' if p['qty']<0 else 'long')==value.get('side')):
                        matches.append(p)
                if len(matches)!=1 or matches[0].get('account')!=ACCOUNT:return DROP
                out=copy.deepcopy(value);out['qty']=scale(out['qty'],factor)
                if value['type']=='stock':out['underlyingPrice']=out['entry']
                return out
            out={}
            for k,v in value.items():
                if k in private_tokens:continue
                if k.lower() in ('ghpat','password','authorization','accesstoken','access_token','refresh_token','credentials'):continue
                # Embedded account settings are actual capital, not research assumptions.
                if k in ('account_equity','accountEquity','accountNetLiq','netliq','net_liq'):
                    out[k]=TARGET
                elif k in ('accountSnapshot','accountRisk','accountBalances'):
                    out[k]={'equity':TARGET}
                elif k in ('source_file','sourceFile'):
                    continue
                elif account==ACCOUNT and k in MONEY|QUANTITY and number(v):
                    out[k]=scale(v,factor)
                elif 'fill_id' in value and k=='quantity':
                    out[k]=scale(v,factor)
                else:
                    result=clean(v,k)
                    if result is not DROP:out[k]=result
            if 'transactions' in out and 'transaction_count' in out:
                out['transaction_count']=len(out['transactions'])
            if isinstance(out.get('legs'),list) and isinstance(out.get('candidate'),dict):
                original=value.get('legs',[])
                if any(isinstance(l,dict) and l.get('quoteAt') for l in original):
                    out['candidate']['referenceCapital']=sum(abs(float(l.get('qty') or 0)*float(l.get('entry') or 0)*(1 if l.get('type')=='stock' else 100)) for l in out['legs']) or ''
            if key=='executionLinks':
                return out if out.get('allocations') else DROP
            return out
        if isinstance(value,str):
            if key=='accountRiskSnapshot':
                try:return json.dumps(clean(json.loads(value)),ensure_ascii=False,separators=(',',':'))
                except (ValueError,TypeError):return ''
            # Some legacy records encoded account snapshots as JSON strings.
            if value.lstrip().startswith(('{','[')):
                try:
                    parsed=json.loads(value)
                    if isinstance(parsed,(dict,list)):
                        out=clean(parsed,key)
                        return '' if out is DROP else json.dumps(out,ensure_ascii=False,separators=(',',':'))
                except ValueError:pass
            if any(token in value for token in private_tokens):
                return '其他账户财务信息已过滤'
        return copy.deepcopy(value)
    result=clean(store)
    if not isinstance(result,dict) or not isinstance(result.get('cases'),list):raise ValueError('Workflow source is missing cases')
    return result


def read_json(path,default=None):
    return json.loads(Path(path).read_text()) if Path(path).exists() else copy.deepcopy(default)


def export_snapshot(portfolio,workflow,*,pnl=None,monthly=None,robustness=None,policy=None,journal=None,annotations=None,broker_pnl=None,transactions=None):
    pf,factor=takku_portfolio(portfolio)
    entries=workflow.get('entries',{}) if isinstance(workflow,dict) and 'entries' in workflow else {KEY:workflow}
    store=entries.get(KEY)
    if not isinstance(store,dict) or not isinstance(store.get('cases'),list):raise ValueError('Workflow source is missing cases')
    journal=journal or {'fills':[]}
    fill_accounts={f.get('fill_id'):f.get('account') for f in journal.get('fills',[])}
    other=[a for a in portfolio.get('accounts',[]) if a.get('id')!=ACCOUNT]
    published_store=workflow_projection(store,other,fill_accounts,factor,portfolio)
    published_store={'version':published_store.get('version',1),'cases':published_store['cases']}
    settings={k:workflow_projection({KEY:[],'cases':[], 'value':entries[k]},other,fill_accounts)['value']
              for k in ['riskPolicy','riskGroups','riskMaxHeat','riskStops','riskTargets','completedTheses','thesisEvents'] if k in entries}
    risk_policy=workflow_projection({'cases':[],'value':policy or settings.get('riskPolicy',{})},other,fill_accounts)['value']
    risk_policy['account_equity']=TARGET
    settings['riskPolicy']={**settings.get('riskPolicy',{}),'account_equity':TARGET}
    files={'data/portfolio.json':pf,'data/pnl.json':scoped_accounts(pnl,factor,'pnl'),
           'data/monthly_returns.json':scoped_accounts(monthly,factor,'monthly'),
           'data/robustness.json':scoped_accounts(robustness,factor,'robust'),
           'config/risk_policy.json':risk_policy,
           'data/completed_theses.json':settings.get('completedTheses',[]),'data/thesis_events.json':settings.get('thesisEvents',[])}
    fills=[scale_fields({k:copy.deepcopy(v) for k,v in f.items() if k not in ('source_file','source_hash','imported_at')},factor,MONEY|QUANTITY)
           for f in journal.get('fills',[]) if f.get('account')==ACCOUNT]
    trade_ids={f.get('trade_id') for f in fills}
    notes={k:copy.deepcopy(v) for k,v in (annotations or {}).get('annotations',{}).items() if k in trade_ids}
    events=[scale_fields(copy.deepcopy(e),factor,MONEY|QUANTITY) for e in (broker_pnl or {}).get('events',[]) if e.get('account')==ACCOUNT]
    api={'/api/trade-journal':{'fills':fills},'/api/trade-annotations':{'annotations':notes},
         '/api/broker-pnl':{'schema':'broker-realized-pnl','version':1,'updated_at':(broker_pnl or {}).get('updated_at'),'events':events},
         '/api/trade-links':{'links':[],'events':[]}}
    # Only Takku's records are made available to Monitor and Attribution.
    for c in published_store['cases']:
        file=copy.deepcopy((transactions or {}).get(c['id']))
        if file:
            file['transactions']=[scale_fields(t,factor,MONEY|QUANTITY) for t in file.get('transactions',[]) if t.get('account')==ACCOUNT]
            file['transaction_count']=len(file['transactions'])
            file['source']={'sources':[{'file':'Takku','source_updated_at':pf['accounts'][0]['source_updated_at']} ]}
            file['scope']='Takku only; dollar totals and quantities normalized to $100,000 current net equity.'
            api['/api/thesis-transactions/'+c['id']]={'file':file,'path':'public/thesis-transactions/'+c['id']+'.json'}
    result={'schema':'public-dashboard','version':2,'publishedAt':datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'basis':{'account':ACCOUNT,'netEquity':TARGET,'method':'constant current-net-equity scale; retain leverage, per-unit prices and ratios'},
            'workflow':{'store':published_store,'settings':settings},'files':files,'api':api}
    validate_public_snapshot(result)
    return result


def validate_public_snapshot(data):
    if data.get('schema')!='public-dashboard' or data.get('version')!=2:raise ValueError('Invalid public dashboard schema')
    if set(data)!= {'schema','version','publishedAt','basis','workflow','files','api'}:raise ValueError('Unexpected public export fields')
    if data['basis'].get('netEquity')!=TARGET or data['basis'].get('account')!=ACCOUNT:raise ValueError('Public basis must be Takku / 100k')
    pf=data['files'].get('data/portfolio.json',{})
    if len(pf.get('accounts',[]))!=1 or pf['accounts'][0].get('id')!=ACCOUNT or pf['accounts'][0].get('equity')!=TARGET:raise ValueError('Only the normalized Takku account can be published')
    def inspect(v):
        if isinstance(v,dict):
            for name in ('account','account_id'):
                if v.get(name) and v[name]!=ACCOUNT:raise ValueError('Other account record in public snapshot')
            if isinstance(v.get('accounts'),dict) and set(v['accounts'])-{ACCOUNT}:raise ValueError('Other account summary in public snapshot')
            if 'scaleFactor' in v or 'sourceEquity' in v or 'originalEquity' in v:raise ValueError('Original capital and normalization factor must remain private')
            for x in v.values():inspect(x)
        elif isinstance(v,list):
            for x in v:inspect(x)
    inspect(data)
    return data


def write_public_snapshot(portfolio_path=ROOT/'data/portfolio.json',workflow_path=PRIVATE/'workflow.json',
                          output=ROOT/'data/public-dashboard.json',aliases_path=None,workflow=None):
    # aliases_path is accepted for callers of the previous exporter; no alias book is read or written.
    portfolio=read_json(portfolio_path)
    private=Path(workflow_path).parent
    capture=private/'public_workflow_source.json'
    supplied=workflow is not None
    if workflow is None:
        workflow=read_json(workflow_path)
        if capture.exists() and (not Path(workflow_path).exists() or capture.stat().st_mtime>Path(workflow_path).stat().st_mtime):
            workflow=read_json(capture).get('workflow',workflow)
    if not portfolio or not workflow:raise ValueError('缺少已保存的 Portfolio / Workflow 来源')
    kwargs={name:read_json(private/file) for name,file in [('pnl','pnl.json'),('monthly','monthly_returns.json'),('robustness','robustness.json'),
           ('policy','risk_policy.json'),('journal','trade_journal/journal.json'),('annotations','trade_journal/annotations.json'),('broker_pnl','trade_journal/broker_pnl.json')]}
    kwargs['transactions']={p.stem:read_json(p) for p in (private/'thesis_transactions').glob('*.json')}
    result=export_snapshot(portfolio,workflow,**kwargs)
    if supplied:
        atomic_json(capture,{'capturedAt':datetime.now(timezone.utc).isoformat(),'workflow':workflow},private=True)
    atomic_json(output,result)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--portfolio',type=Path,default=ROOT/'data/portfolio.json')
    parser.add_argument('--workflow',type=Path,default=PRIVATE/'workflow.json')
    parser.add_argument('--output',type=Path,default=ROOT/'data/public-dashboard.json')
    args=parser.parse_args()
    result=write_public_snapshot(args.portfolio,args.workflow,args.output)
    print(f"Public Workflow: {len(result['workflow']['store']['cases'])} cases; Takku: {len(result['files']['data/portfolio.json']['positions'])} positions at $100,000 net equity")


if __name__=='__main__':main()
