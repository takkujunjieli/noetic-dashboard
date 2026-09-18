#!/usr/bin/env python3
"""Build retail UI data and preserve real-time, immutable PIT signal snapshots."""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from retail_pit import freeze, evaluate, sessions_between

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'


def read(name, default):
    path = DATA / name
    return json.loads(path.read_text()) if path.exists() else default


def main():
    raw = read('retail_flow_raw.json', {})
    days = raw.get('days', {})
    if not days:
        print('No retail raw observations'); return
    now = datetime.now(timezone.utc)
    stamp = now.isoformat(timespec='seconds')
    ledger = read('retail_pit.json', {'snapshots': {}})
    starts = list(days) + [s['entry_date'] for s in ledger['snapshots'].values()]
    sessions = sessions_between(min(starts), (now.date()+timedelta(days=30)).isoformat())
    freeze(ledger, days, sessions, stamp)
    path = DATA / 'retail_pit.json'
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(ledger, ensure_ascii=False, separators=(',', ':')))
    tmp.replace(path)
    price_store = read('retail_prices.json', {})
    research = evaluate(ledger, price_store.get('prices', {}), sessions, stamp)
    research['price_updated'] = price_store.get('updated')
    research['price_errors'] = price_store.get('errors', {})
    trading_dates = {s['date'] for s in sessions}
    dates = sorted(d for d in days if d in trading_dates and days[d])
    tickers = sorted({t for d in dates for t in days[d]})
    trends = read('retail_trends.json', {}).get('data', {})
    frozen = {}
    for snap in ledger['snapshots'].values():
        for tk, row in snap['names'].items():
            frozen[(snap['source_date'], tk)] = row['signal']
    data = {}
    for tk in tickers:
        data[tk] = {k: [days[d].get(tk, {}).get(k) for d in dates]
                    for k in ('netbuy', 'intensity', 'px')}
        data[tk]['attention'] = [trends.get(tk, {}).get(d) for d in dates]
        data[tk]['signal'] = [frozen.get((d,tk)) for d in dates]
    out = {'topic':'retailflow', 'freq':'daily', 'window_days': raw.get('window_days'),
           'updated': raw.get('updated'), 'tickers':tickers, 'dates':dates, 'data':data,
           'validation':raw.get('validation',{}),
           'sampled':any(r.get('method') == 'sample' for d in days.values() for r in d.values()),
           'research':research, 'meta':{'source':'massive-equity-ticks',
                'netbuy_method':'off-exchange sub-penny candidates; bid/ask quote rule + candidate tick rule',
                'attention':'display-only, excluded from PIT signal'}}
    (DATA/'retailflow.json').write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
    print(f"retailflow: {len(tickers)} names, {len(dates)} dates, {research['snapshot_count']} frozen snapshots")


if __name__ == '__main__':
    main()
