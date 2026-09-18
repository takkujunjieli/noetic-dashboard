#!/usr/bin/env python3
"""Fetch independent daily bars for frozen universes, including names since removed.
Refresh the full per-name evaluation interval to keep split adjustments consistent.
"""
import json
from datetime import datetime, timezone
from pathlib import Path
from fetch_tick_flow import get

DATA = Path(__file__).resolve().parent.parent / 'data'


def main():
    path = DATA/'retail_pit.json'
    if not path.exists():
        return
    snapshots = json.loads(path.read_text()).get('snapshots', {}).values()
    starts = {}
    for s in snapshots:
        for tk in s['names']:
            starts[tk] = min(starts.get(tk, s['entry_date']), s['entry_date'])
    now = datetime.now(timezone.utc)
    end = now.date().isoformat()
    out = {'updated':now.isoformat(), 'prices':{}, 'errors':{}}
    for tk, start in sorted(starts.items()):
        if start > end:
            continue
        try:
            payload = get(f'/v2/aggs/ticker/{tk}/range/1/day/{start}/{end}?adjusted=true&sort=asc&limit=50000')
            if payload.get('next_url'):
                raise ValueError('Unexpected truncated daily price response')
            bars = {}
            for r in payload.get('results') or []:
                day = datetime.fromtimestamp(r['t']/1000, timezone.utc).date().isoformat()
                bars[day] = {'o':r.get('o'), 'c':r.get('c')}
            out['prices'][tk] = bars
        except Exception as exc:
            # Never combine fresh and stale split-adjustment regimes.
            out['errors'][tk] = type(exc).__name__
            print(f'{tk}: price fetch failed ({type(exc).__name__})')
    target = DATA/'retail_prices.json'
    tmp = target.with_suffix('.tmp')
    tmp.write_text(json.dumps(out, separators=(',',':')))
    tmp.replace(target)
    print(f"Retail forward prices: {len(out['prices'])} names, {len(out['errors'])} errors")


if __name__ == '__main__':
    main()
