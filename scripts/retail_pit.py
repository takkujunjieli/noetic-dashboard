"""Frozen, observed-time retail signals and daily cross-sectional evaluation.
No synthetic PIT backfill. Main signal excludes revisable Google Trends.
"""
import math
from datetime import datetime, timedelta
from statistics import mean, stdev

VERSION = 'retail-pit-v1'
MIN_HISTORY = 5
LOOKBACK = 20
MIN_NAMES = 10
QUANTILES = 5
COST_BPS = 5  # per leg, per side: 100% long + 100% short => 4 * cost


def sessions_between(start, end):
    import exchange_calendars as xc
    lo = (datetime.fromisoformat(start) - timedelta(days=7)).date().isoformat()
    hi = (datetime.fromisoformat(end) + timedelta(days=7)).date().isoformat()
    cal = xc.get_calendar('XNYS', start=lo, end=hi)
    return [{'date': s.strftime('%Y-%m-%d'),
             'open': cal.session_open(s).isoformat(),
             'close': cal.session_close(s).isoformat()}
            for s in cal.sessions_in_range(start, end)]


def instant(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00'))


def z_at(value, history):
    vals = [v for v in history if v is not None][-LOOKBACK:]
    if value is None or len(vals) < MIN_HISTORY:
        return None
    sd = stdev(vals)
    return (value - mean(vals)) / sd if sd > 0 else None


def freeze(ledger, days, sessions, now):
    """Freeze once per execution session. All inputs were observed by now.
    Old raw observations may normalize a CURRENT signal; never backdate it.
    """
    closed = [s for s in sessions if instant(s['close']) <= instant(now)]
    future = [s for s in sessions if instant(s['open']) > instant(now)]
    if not closed or not future:
        return
    source, entry = closed[-1]['date'], future[0]['date']
    key = VERSION + ':' + entry
    if key in ledger.setdefault('snapshots', {}) or not days.get(source):
        return
    history_dates = [s['date'] for s in closed if s['date'] < source][-LOOKBACK:]
    names = {}
    for tk, row in sorted(days[source].items()):
        nb, it = row.get('netbuy'), row.get('intensity')
        zn = z_at(nb, [days.get(d, {}).get(tk, {}).get('netbuy') for d in history_dates])
        zi = z_at(it, [days.get(d, {}).get(tk, {}).get('intensity') for d in history_dates])
        names[tk] = {'netbuy': nb, 'intensity': it,
                     'signal': zn * zi if zn is not None and zi is not None else None}
    ledger['snapshots'][key] = {'version': VERSION, 'formed_at': now,
        'source_date': source, 'entry_date': entry, 'names': names}


def rank(xs):
    order = sorted(range(len(xs)), key=xs.__getitem__)
    out, i = [0.] * len(xs), 0
    while i < len(xs):
        j = i + 1
        while j < len(xs) and xs[order[i]] == xs[order[j]]:
            j += 1
        for k in order[i:j]:
            out[k] = (i + j - 1) / 2
        i = j
    return out


def spearman(xs, ys):
    if len(xs) < MIN_NAMES:
        return None
    x, y = rank(xs), rank(ys)
    mx, my = mean(x), mean(y)
    den = math.sqrt(sum((v-mx)**2 for v in x) * sum((v-my)**2 for v in y))
    return sum((a-mx)*(b-my) for a,b in zip(x,y)) / den if den else None


def summary(rows, horizon):
    ics = [r['ic'] for r in rows if r['ic'] is not None]
    ls = [r['long_short_gross'] for r in rows if r['long_short_gross'] is not None]
    sd = stdev(ics) if len(ics) >= 2 else None
    return {'n_days': len(ics), 'mean_ic': mean(ics) if ics else None,
            'ic_std': sd, 'icir': mean(ics) / sd if sd else None,
            'positive_ic_rate': mean([v > 0 for v in ics]) if ics else None,
            'status': 'insufficient' if len(ics) < 60 else 'descriptive',
            'ls_days': len(ls), 'mean_ls_gross': mean(ls) if ls else None,
            'mean_ls_net': mean(ls) - 4*COST_BPS/10000 if ls else None,
            'overlapping': horizon > 1}


def evaluate(ledger, prices, sessions, now):
    idx = {s['date']: i for i,s in enumerate(sessions)}
    out = {}
    for field in ('signal', 'netbuy'):
        out[field] = {}
        for h in (1, 5):
            rows = []
            for snap in sorted(ledger.get('snapshots', {}).values(), key=lambda s:s['entry_date']):
                if snap.get('version') != VERSION:
                    continue
                i = idx.get(snap['entry_date'])
                if i is None or i+h-1 >= len(sessions):
                    continue
                entry, end = sessions[i], sessions[i+h-1]
                if instant(snap['formed_at']) >= instant(entry['open']):
                    continue
                if instant(end['close']) > instant(now):
                    continue
                # Membership and quantile assignment use signals ONLY, before looking at returns.
                universe = sorted([(tk, v[field]) for tk,v in snap['names'].items()
                                   if v.get(field) is not None], key=lambda p:(p[1], p[0]))
                returns = {}
                for tk, _ in universe:
                    bars = prices.get(tk, {})
                    a, b = bars.get(entry['date'], {}), bars.get(end['date'], {})
                    op, cl = a.get('o'), b.get('c')
                    if op and cl and op > 0 and cl > 0:
                        returns[tk] = cl / op - 1
                pairs = [(v, returns[tk]) for tk,v in universe if tk in returns]
                ic = spearman([p[0] for p in pairs], [p[1] for p in pairs])
                groups = [[] for _ in range(QUANTILES)]
                for k,(tk, _) in enumerate(universe):
                    groups[k*QUANTILES//len(universe)].append(tk)
                # Do not arbitrarily split tied signal values across a quantile boundary.
                ties = any(universe[k][1] == universe[k-1][1]
                           for k in range(1,len(universe))
                           if k*QUANTILES//len(universe) != (k-1)*QUANTILES//len(universe))
                complete = len(universe) >= MIN_NAMES and len(returns) == len(universe) and not ties
                qr = [mean([returns[tk] for tk in g]) for g in groups] if complete else None
                spread = qr[-1] - qr[0] if qr else None
                rows.append({'source_date': snap['source_date'], 'formed_at': snap['formed_at'],
                    'entry_date': entry['date'], 'exit_date': end['date'],
                    'n_universe': len(universe), 'n_returns': len(pairs), 'ic': ic,
                    'quantile_returns': qr, 'quantile_members': groups,
                    'long_short_gross': spread,
                    'long_short_net': spread - 4*COST_BPS/10000 if spread is not None else None,
                    'ls_status': 'ok' if complete else 'insufficient_names_or_missing_returns_or_ties'})
            out[field][str(h)] = {'summary': summary(rows,h), 'daily': rows}
    return {'version': VERSION, 'updated': now, 'snapshot_count': len(ledger.get('snapshots',{})),
        'min_names': MIN_NAMES, 'min_history': MIN_HISTORY, 'lookback_sessions': LOOKBACK,
        'cost_bps_per_side': COST_BPS, 'results': out,
        'method': 'Actual frozen timestamp → next XNYS open → session 1/5 close; daily cross-sectional Spearman; ICIR=mean(IC)/sample_std(IC), not annualized.',
        'caveats': [
            '旧数据没有信号快照，不补造 PIT 历史；严格结果从首次实际冻结后积累。',
            '主信号=z(netbuy)×z(intensity)，仅用前20个交易日、至少5个有效观测标准化；Google Trends不参与。',
            '股票池为每次冻结时实际有信号的股票，不按未来收益筛选；缺收益披露覆盖率，多空组合缺任一成分收益则整日不计。',
            '1D=下一可交易日开盘至当日收盘；5D=同一开盘至第5个交易日收盘。',
            '五分位等权，Q5−Q1；100%多+100%空，成本每腿每边5bp，整组往返20bp；不含借券费用及可借约束。',
            '5D每日建仓的收益窗口重叠，仅展示各批次均值，不复利成资金曲线；ICIR不年化、不作为显著性检验。',
            '收益使用拆股调整价格，不含现金分红；固定跟踪池存在选股偏差，结果不能外推全市场。',
            '不足60个有效IC日期标为样本不足；即使超过也仅是描述性证据。']}
