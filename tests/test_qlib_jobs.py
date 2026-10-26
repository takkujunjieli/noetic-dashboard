import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import qlib_jobs
from serve_dashboard import DashboardHandler


class QlibJobsTest(unittest.TestCase):
    def test_status_shows_only_current_research_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = root / "data/qlib-v1"
            state.mkdir(parents=True)
            result = state / "refresh-result.json"
            process = Mock()
            process.poll.return_value = 1
            with patch.object(qlib_jobs, "RESEARCH", root), patch.object(qlib_jobs, "PROCESS", process), patch.object(qlib_jobs, "STARTED", "2026-10-25T14:00:00+00:00"), patch.object(qlib_jobs, "KIND", "research"):
                result.write_text(json.dumps({"started_at": "2026-10-25T14:00:01+00:00", "exit_code": 1, "error": "日线 OHLC 价格不一致"}))
                self.assertEqual(qlib_jobs.status()["error"], "日线 OHLC 价格不一致")
                result.write_text(json.dumps({"started_at": "2026-10-24T14:00:01+00:00", "exit_code": 1, "error": "previous failure"}))
                self.assertIsNone(qlib_jobs.status()["error"])

    def test_universe_save_validates_and_prevents_stale_overwrite(self):
        actual = qlib_jobs.RESEARCH
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root/'config').mkdir()
            (root/'qlib_v1').mkdir()
            for name in ['qlib-v1.json','qlib-universes.json','qlib-industry-catalog.json']:
                (root/'config'/name).write_bytes((actual/'config'/name).read_bytes())
            (root/'qlib_v1/universe.py').write_bytes((actual/'qlib_v1/universe.py').read_bytes())
            with patch.object(qlib_jobs,'RESEARCH',root):
                before = qlib_jobs.universe_config()
                settings = before['settings']
                settings['profiles'][settings['active']].update(include_base=False, groups=['cryptocurrency'],include=['PURR'])
                saved = qlib_jobs.save_universe(settings,before['revision'])
                self.assertEqual(saved['preview_symbols'],['ASST','BMNR','BTBT','DFDV','MSTR','PURR','SBET','SMLR','UPXI'])
                self.assertNotEqual(saved['revision'],before['revision'])
                with self.assertRaises(ValueError):
                    qlib_jobs.save_universe(settings,before['revision'])
                self.assertEqual(qlib_jobs.universe_config()['revision'],saved['revision'])
                settings['profiles'][settings['active']]['filters']['min_market_cap'] = -1
                with self.assertRaises(ValueError):
                    qlib_jobs.save_universe(settings,saved['revision'])

    def test_universe_put_rejects_cross_origin_and_requires_explicit_schema(self):
        payload = json.dumps({'settings':{},'revision':'version'}).encode()
        handler = self.handler(payload)
        handler.path = '/api/qlib/universe'
        with patch.object(qlib_jobs,'save_universe',return_value={'saved':True}) as save:
            handler.do_PUT()
            save.assert_called_once_with({},'version')
            handler.reply.assert_called_once_with(200,{'saved':True})
        handler = self.handler(payload,{'Origin':'https://example.com'})
        handler.path = '/api/qlib/universe'
        with patch.object(qlib_jobs,'save_universe') as save:
            handler.do_PUT()
            save.assert_not_called()
            self.assertEqual(handler.reply.call_args.args[0],403)

    def tearDown(self):
        if qlib_jobs.LOG is not None:
            qlib_jobs.LOG.close()
        qlib_jobs.PROCESS = qlib_jobs.LOG = qlib_jobs.STARTED = qlib_jobs.KIND = None

    def test_observations_job_runs_only_the_non_predictive_script(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            python=root/'.venv-qlib/bin/python';python.parent.mkdir(parents=True);python.touch()
            (root/'run_qlib.py').touch();(root/'run_market_observations.py').touch()
            process=Mock();process.poll.return_value=None
            with patch.object(qlib_jobs,'RESEARCH',root),patch.object(qlib_jobs.subprocess,'Popen',return_value=process) as popen,patch.dict(qlib_jobs.os.environ,{},clear=True):
                job=qlib_jobs.start(observations=True)
                self.assertEqual(job['kind'],'observations')
                self.assertEqual(popen.call_args.args[0],[str(python),str(root/'run_market_observations.py'),'--fetch','yahoo'])

    def test_observations_endpoint_cannot_invoke_research(self):
        handler=self.handler();handler.path='/api/qlib/observations/refresh'
        with patch.object(qlib_jobs,'start',return_value={'running':True}) as start:
            handler.do_POST()
            start.assert_called_once_with(observations=True)
            handler.reply.assert_called_once_with(202,{'running':True})

    def test_fixed_command_provider_selection_and_single_background_job(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            python = root / ".venv-qlib/bin/python"
            python.parent.mkdir(parents=True)
            python.touch()
            (root / "run_qlib.py").touch()
            process = Mock()
            process.poll.return_value = None
            with patch.object(qlib_jobs, "RESEARCH", root), patch.object(qlib_jobs.subprocess, "Popen", return_value=process) as popen, patch.dict(qlib_jobs.os.environ, {}, clear=True):
                self.assertEqual(qlib_jobs.start()["provider"], "yahoo")
                self.assertTrue(qlib_jobs.start()["running"])
                popen.assert_called_once()
                command = popen.call_args.args[0]
                self.assertEqual(command, [str(python), str(root / "run_qlib.py"), "--fetch", "yahoo"])
                self.assertNotIn("shell", popen.call_args.kwargs)
                process.poll.return_value = 0
                self.assertEqual(qlib_jobs.status()["exit_code"], 0)
                self.assertIsNone(qlib_jobs.LOG)
            qlib_jobs.PROCESS = None
            with patch.object(qlib_jobs, "RESEARCH", root), patch.object(qlib_jobs.subprocess, "Popen", return_value=process) as popen, patch.dict(qlib_jobs.os.environ, {"ALPACA_API_KEY": "test", "ALPACA_API_SECRET": "test"}, clear=True):
                self.assertEqual(qlib_jobs.start()["provider"], "alpaca")
                self.assertEqual(popen.call_args.args[0][-1], "alpaca")

    def handler(self, body=b"{}", headers=None):
        handler = DashboardHandler.__new__(DashboardHandler)
        handler.path = "/api/qlib/refresh"
        handler.headers = {"Host": "127.0.0.1:8642", "Content-Type": "application/json", "Content-Length": str(len(body)), **(headers or {})}
        handler.rfile = io.BytesIO(body)
        handler.reply = Mock()
        return handler

    def test_api_rejects_cross_origin_non_json_and_command_injection(self):
        for body, headers, expected in [(b"{}", {"Origin": "https://example.com"}, 403),
                                        (b"{}", {"Sec-Fetch-Site": "cross-site"}, 403),
                                        (b"{}", {"Content-Type": "text/plain"}, 400),
                                        (b'{"x":"rm"}', {}, 400),
                                        (b"{}", {"Host": "example.com:8642"}, 403)]:
            handler = self.handler(body, headers)
            with patch.object(qlib_jobs, "start") as start:
                handler.do_POST()
                self.assertEqual(handler.reply.call_args.args[0], expected)
                start.assert_not_called()

    def test_api_starts_only_explicit_empty_json(self):
        handler = self.handler()
        with patch.object(qlib_jobs, "start", return_value={"running": True}) as start:
            handler.do_POST()
            start.assert_called_once_with()
            handler.reply.assert_called_once_with(202, {"running": True})


if __name__ == "__main__":
    unittest.main()
