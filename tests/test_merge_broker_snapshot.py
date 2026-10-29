import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/merge_broker_snapshot.py'


class AccountDisplayNameTests(unittest.TestCase):
    def test_broker_refresh_preserves_label_and_allows_explicit_rename(self):
        with tempfile.TemporaryDirectory() as directory:
            target, fresh = Path(directory)/'old.json', Path(directory)/'new.json'
            target.write_text(json.dumps({'accounts': [{'id': 'rh-7159', 'label': 'hui-rh-7159'}],
                                          'positions': [], 'transactions': []}))
            snapshot = {'accounts': [{'id': 'rh-7159', 'equity': 1000}],
                        'positions': [{'account': 'rh-7159', 'sym': 'A', 'qty': 5, 'avg_cost': 90}],
                        'transactions': [{'account': 'rh-7159', 'execution_id': 'original-fill'}]}
            fresh.write_text(json.dumps(snapshot))
            subprocess.run([sys.executable, str(SCRIPT), str(target), str(fresh)], check=True, capture_output=True)
            merged = json.loads(target.read_text())
            self.assertEqual(merged['accounts'][0]['label'], 'hui-rh-7159')
            self.assertEqual(merged['positions'], snapshot['positions'])
            self.assertEqual(merged['transactions'], snapshot['transactions'])
            snapshot['accounts'][0]['label'] = 'Updated name'
            fresh.write_text(json.dumps(snapshot))
            subprocess.run([sys.executable, str(SCRIPT), str(target), str(fresh)], check=True, capture_output=True)
            self.assertEqual(json.loads(target.read_text())['accounts'][0]['label'], 'Updated name')


if __name__ == '__main__':
    unittest.main()
