import copy
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import workflow_database as wd


def fixture():
    return {'version': 1, 'cases': [{'id': 'case-1', 'revision': 1, 'nodes': {'hypothesis': {'data': {'expectation': 'original'}}}, 'events': [{'id': 'old', 'revision': 1, 'type': '创建实例', 'snapshot': {'id': 'case-1', 'revision': 1}}]}]}


class WorkflowDatabaseTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'workflow.sqlite3'

    def test_migration_and_plain_saves_do_not_generate_versions(self):
        original = fixture()
        self.assertIsNone(wd.read(self.path)['store'])
        saved = wd.save(self.path, original, None)
        self.assertEqual(saved['store']['cases'][0]['events'], original['cases'][0]['events'])
        for i in range(5):
            store = copy.deepcopy(saved['store'])
            store['cases'][0]['nodes']['hypothesis']['data']['expectation'] = str(i)
            saved = wd.save(self.path, store, saved['revision'])
            self.assertEqual(len(saved['store']['cases'][0]['events']), 1)
            self.assertEqual(saved['store']['cases'][0]['revision'], 1)
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM workflow_versions').fetchone()[0], 1)
            current = json.loads(db.execute('SELECT body FROM current_workflow').fetchone()[0])
            self.assertNotIn('events', current['cases'][0])

    def test_only_explicit_checkpoint_appends_a_version_and_conflicts_are_atomic(self):
        saved = wd.save(self.path, fixture(), None)
        store = copy.deepcopy(saved['store'])
        case = store['cases'][0]
        case['revision'] += 1
        item = {'id': 'manual-2', 'revision': 2, 'type': '手动生成版本', 'snapshot': {k: v for k, v in case.items() if k != 'events'}}
        case['events'].append(item)
        latest = wd.save(self.path, store, saved['revision'], {'caseId': case['id'], 'event': item})
        self.assertEqual(len(latest['store']['cases'][0]['events']), 2)
        with self.assertRaises(wd.WorkflowConflict):
            wd.save(self.path, store, saved['revision'])
        self.assertEqual(wd.read(self.path), latest)
        invalid = copy.deepcopy(store)
        invalid['cases'][0]['nodes']['hypothesis']['data']['expectation'] = 'different'
        with self.assertRaises(ValueError):
            wd.save(self.path, invalid, latest['revision'], {'caseId': case['id'], 'event': item})
        self.assertEqual(wd.read(self.path), latest)

    def test_bad_import_never_overwrites_the_source_file(self):
        source = self.path.with_name('workflow.json')
        source.write_text(json.dumps({'entries': {wd.KEY: fixture()}}))
        before = source.read_bytes()
        baseline = wd.legacy(source)
        wd.save(self.path, baseline, None)
        self.assertEqual(source.read_bytes(), before)
        bad = fixture()
        bad['cases'].append(copy.deepcopy(bad['cases'][0]))
        with self.assertRaises(ValueError):
            wd.save(self.path, bad, 1)
        self.assertEqual(wd.read(self.path)['store']['cases'][0]['nodes'], baseline['cases'][0]['nodes'])

class WorkflowHTTPTest(unittest.TestCase):
    def test_api_migrates_and_saves_without_automatic_versions(self):
        import http.client
        import threading
        from functools import partial
        from http.server import ThreadingHTTPServer
        from serve_dashboard import DashboardHandler
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            server = ThreadingHTTPServer(('127.0.0.1', 0), partial(DashboardHandler, directory=str(root), private_dir=root / 'thesis_transactions', data_dir=root))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            conn = http.client.HTTPConnection('127.0.0.1', server.server_port)
            try:
                conn.request('GET', '/api/workflow')
                response = conn.getresponse()
                self.assertEqual(response.status, 200)
                self.assertIsNone(json.loads(response.read())['store'])
                conn.request('PUT', '/api/workflow', json.dumps({'store': fixture(), 'revision': None}), {'Content-Type': 'application/json'})
                response = conn.getresponse()
                self.assertEqual(response.status, 200)
                saved = json.loads(response.read())
                self.assertEqual(saved['revision'], 1)
                self.assertEqual(saved['store']['cases'][0]['historyMode'], 'manual')
                conn.request('PUT', '/api/workflow', json.dumps({'store': saved['store'], 'revision': None}), {'Content-Type': 'application/json'})
                response = conn.getresponse()
                self.assertEqual(response.status, 409)
                response.read()
            finally:
                conn.close()
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == '__main__':
    unittest.main()
