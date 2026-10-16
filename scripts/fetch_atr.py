#!/usr/bin/env python3
"""为 Trading Desk ticker 与本地持仓算 ATR14(Yahoo 日线,免 key),供风险敞口止损。
读 config/tickers.json 的 watchlist 与 data/portfolio.json 的正股持仓，写 data/atr.json。
本地跑:python3 scripts/fetch_atr.py(ATR14 变化慢,隔几天跑一次即可)。"""
import argparse
import json
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
PF = ROOT / "data" / "portfolio.json"
TICKERS = ROOT / "config" / "tickers.json"
OUT = ROOT / "data" / "atr.json"
UA = {"User-Agent": "Mozilla/5.0"}


def daily(sym):
    u = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=3mo&interval=1d"
    r = requests.get(u, headers=UA, timeout=30)
    r.raise_for_status()
    q = r.json()["chart"]["result"][0]["indicators"]["quote"][0]
    return q["high"], q["low"], q["close"]


def atr14(h, l, c):
    """Wilder TR 的近 14 日均值(够用);缺值跳过。"""
    trs = []
    for i in range(1, len(c)):
        if None in (h[i], l[i], c[i], c[i - 1]):
            continue
        trs.append(max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1])))
    return round(sum(trs[-14:]) / min(len(trs), 14), 4) if trs else None


def main(argv=None):
    parser = argparse.ArgumentParser(description="更新 Trading Desk、当前正股持仓及指定标的的 ATR14")
    parser.add_argument("symbols", nargs="*", help="额外纳入计算的 ticker，例如 AMD LITE")
    parser.add_argument("--only", action="store_true", help="只更新指定 ticker，不重算正股持仓")
    args = parser.parse_args(argv)
    holdings = set()
    if PF.exists():
        pf = json.loads(PF.read_text())
        holdings = {p["sym"] for p in pf.get("positions", [])
                    if p.get("kind") == "equity" and " " not in p.get("sym", "")}
    else:
        print("未找到 data/portfolio.json；继续计算 Trading Desk ticker")
    desk = set()
    if TICKERS.exists():
        desk = {s.strip().upper() for s in json.loads(TICKERS.read_text()).get("watchlist", [])
                if isinstance(s, str) and s.strip()}
    extra = {s.strip().upper() for s in args.symbols if s.strip()}
    syms = sorted(extra if args.only else desk | holdings | extra)
    previous = {}
    if OUT.exists():
        try:
            previous = json.loads(OUT.read_text()).get("atr14", {})
        except (json.JSONDecodeError, OSError):
            pass
    # 保留已有值：局部更新或网络暂时失败都不应抹掉其他标的的可用 ATR。
    out = previous.copy()
    for s in syms:
        try:
            out[s] = atr14(*daily(s))
            print(f"{s}: ATR14={out[s]}")
        except Exception as e:
            print(f"{s} 失败: {e}")
    if not out:
        print("没有成功取得任何 ATR；保留原有快照，不写入空文件")
        return
    OUT.write_text(json.dumps({"updated": time.strftime("%Y-%m-%dT%H:%M:%S"), "atr14": out}, ensure_ascii=False))
    print(f"→ {OUT.relative_to(ROOT)} ({len(out)} 只)")


if __name__ == "__main__":
    main()
