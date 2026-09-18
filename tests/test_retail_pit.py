import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from retail_pit import VERSION, freeze, evaluate, sessions_between, summary, z_at


def session(day, op='13:30:00', cl='20:00:00'):
    return {'date': day, 'open': f'{day}T{op}+00:00', 'close': f'{day}T{cl}+00:00'}


class PITTests(unittest.TestCase):
    def setUp(self):
        self.sessions = [session(d) for d in ['2026-09-04','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-14']]
        names = {f'T{i:02}': {'signal': i, 'netbuy': i/10} for i in range(10)}
        self.ledger = {'snapshots': {'test': {'version':VERSION, 'source_date':'2026-09-04',
            'entry_date':'2026-09-08', 'formed_at':'2026-09-05T03:00:00+00:00', 'names':names}}}
        self.prices = {tk:{s['date']:{'o':100, 'c':100+i} for s in self.sessions} for i,tk in enumerate(names)}

    def result(self, h=1, now='2026-09-15T03:00:00+00:00'):
        return evaluate(self.ledger,self.prices,self.sessions,now)['results']['signal'][str(h)]

    def test_entry_open_and_fifth_session(self):
        r = self.result(5)['daily'][0]
        self.assertEqual(r['exit_date'], '2026-09-14')
        self.assertAlmostEqual(r['ic'], 1)
        self.assertAlmostEqual(r['quantile_returns'][0], .005)
        self.assertAlmostEqual(r['long_short_gross'], .08)
        self.assertAlmostEqual(r['long_short_net'], .078)

    def test_unmatured_labels_are_absent(self):
        self.assertEqual(self.result(5, '2026-09-14T19:59:59+00:00')['daily'], [])

    def test_after_open_snapshot_is_rejected(self):
        self.ledger['snapshots']['test']['formed_at'] = '2026-09-08T13:30:00+00:00'
        self.assertEqual(self.result()['daily'], [])

    def test_missing_loser_does_not_reselect_quantiles(self):
        before = self.result()['daily'][0]['quantile_members']
        del self.prices['T00']
        row = self.result()['daily'][0]
        self.assertEqual(row['quantile_members'], before)
        self.assertIsNone(row['long_short_gross'])
        self.assertIsNone(row['ic'])  # fewer than 10 matched names
        self.assertEqual(row['n_returns'], 9)

    def test_ties_do_not_create_arbitrary_portfolio(self):
        for n in self.ledger['snapshots']['test']['names'].values():
            n['signal'] = 1
        row = self.result()['daily'][0]
        self.assertIsNone(row['ic'])
        self.assertIsNone(row['long_short_gross'])

    def test_daily_ic_equal_weight_and_unannualized_icir(self):
        s = summary([{'ic':.1,'long_short_gross':.02}, {'ic':.3,'long_short_gross':.04}],5)
        self.assertAlmostEqual(s['mean_ic'], .2)
        self.assertAlmostEqual(s['icir'], 2**.5)
        self.assertTrue(s['overlapping'])

    def test_freeze_never_rewrites_and_never_backdates(self):
        sessions = [session(f'2026-09-{d:02}') for d in range(1,10)]
        days = {s['date']:{'X':{'netbuy':i, 'intensity':i*.1}} for i,s in enumerate(sessions[:7])}
        ledger = {'snapshots':{}}
        freeze(ledger,days,sessions,'2026-09-07T21:00:00+00:00')
        saved = copy.deepcopy(ledger)
        self.assertEqual(len(ledger['snapshots']),1)
        snap = next(iter(ledger['snapshots'].values()))
        self.assertEqual(snap['entry_date'],'2026-09-08')
        self.assertIsNotNone(snap['names']['X']['signal'])
        days['2026-09-07']['X']['netbuy'] = 999
        days['2026-09-09'] = {'X':{'netbuy':999,'intensity':999}}
        freeze(ledger,days,sessions,'2026-09-08T03:00:00+00:00')
        self.assertEqual(saved,ledger)

    def test_after_open_formation_uses_next_open(self):
        ledger = {'snapshots':{}}
        freeze(ledger, {'2026-09-04':{'X':{'netbuy':1,'intensity':1}}}, self.sessions,
               '2026-09-08T14:00:00+00:00')
        self.assertEqual(next(iter(ledger['snapshots'].values()))['entry_date'],'2026-09-09')

    def test_history_threshold_and_zero_variance(self):
        self.assertIsNone(z_at(1,[1,2,3,4]))
        self.assertIsNone(z_at(1,[1]*10))

    def test_future_observations_cannot_change_new_signal(self):
        sessions = [session(f'2026-09-{d:02}') for d in range(1,10)]
        days = {s['date']:{'X':{'netbuy':i, 'intensity':i*.1}} for i,s in enumerate(sessions[:7])}
        first, second = {'snapshots':{}}, {'snapshots':{}}
        freeze(first, days, sessions, '2026-09-07T21:00:00+00:00')
        days['2026-09-09'] = {'X':{'netbuy':1000000,'intensity':1000000}}
        freeze(second, days, sessions, '2026-09-07T21:00:00+00:00')
        self.assertEqual(first, second)

    def test_collector_session_bounds(self):
        from fetch_tick_flow import _rth_bounds
        lo, hi = _rth_bounds('2026-11-27')
        self.assertEqual(lo.hour, 14)
        self.assertEqual(hi.hour, 18)
        with self.assertRaises(ValueError):
            _rth_bounds('2026-11-26')

    def test_actual_calendar_holiday_dst_and_early_close(self):
        s = sessions_between('2026-09-04','2026-12-01')
        dates = {v['date']:v for v in s}
        self.assertNotIn('2026-09-07',dates)
        self.assertNotIn('2026-11-26',dates)
        self.assertIn('14:30:00',dates['2026-11-02']['open'])
        self.assertIn('18:00:00',dates['2026-11-27']['close'])


if __name__ == '__main__':
    unittest.main()
