"""Local-only fixed-command research refresh. Never accepts paths or shell code."""
import json
import hashlib
import importlib.util
import os
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path

RESEARCH = Path(__file__).resolve().parents[2] / "factor-research"
LOCK = threading.Lock()
PROCESS = None
STARTED = None
LOG = None
KIND = None


def status():
    global LOG
    code = PROCESS.poll() if PROCESS is not None else None
    running = PROCESS is not None and code is None
    if not running and LOG is not None:
        LOG.close()
        LOG = None
    error = None
    if code not in (None, 0) and STARTED and KIND != "observations":
        try:
            result = json.loads((RESEARCH / "data/qlib-v1/refresh-result.json").read_text())
            if result.get("started_at", "") >= STARTED and result.get("exit_code") == code:
                error = result.get("error")
        except (OSError, ValueError, TypeError):
            pass
    return {"running": running, "started_at": STARTED, "exit_code": code, "kind": KIND, "error": error,
            "available": (RESEARCH / ".venv-qlib/bin/python").exists() and (RESEARCH / "run_qlib.py").exists()}


def start(observations=False):
    global PROCESS, STARTED, LOG, KIND
    with LOCK:
        current = status()
        if current["running"]:
            return current
        if not current["available"]:
            raise ValueError("请先按 Qlib 文档安装 factor-research/.venv-qlib")
        state = RESEARCH / "data/qlib-v1"
        state.mkdir(parents=True, exist_ok=True)
        LOG = (state / ("observations-refresh.log" if observations else "refresh.log")).open("w")
        has_keys = bool((os.getenv("ALPACA_API_KEY") or os.getenv("APCA_API_KEY_ID"))
                        and (os.getenv("ALPACA_API_SECRET") or os.getenv("APCA_API_SECRET_KEY")))
        provider = "alpaca" if has_keys else "yahoo"
        try:
            script = "run_market_observations.py" if observations else "run_qlib.py"
            PROCESS = subprocess.Popen([str(RESEARCH / ".venv-qlib/bin/python"), str(RESEARCH / script),
                                        "--fetch", provider], cwd=RESEARCH, stdout=LOG, stderr=subprocess.STDOUT,
                                       start_new_session=True)
        except OSError:
            LOG.close()
            LOG = None
            raise
        STARTED = datetime.now(timezone.utc).isoformat()
        KIND = "observations" if observations else "research"
        return {**status(), "provider": provider}


def universe_config():
    path = RESEARCH / "config/qlib-universes.json"
    raw = path.read_bytes()
    catalog = json.loads((RESEARCH / "config/qlib-industry-catalog.json").read_text())
    base = json.loads((RESEARCH / "config/qlib-v1.json").read_text())
    settings = json.loads(raw)
    module = universe_module()
    settings = module.validate_settings(settings, catalog)
    return {"settings": settings, "catalog": catalog, "base_symbols": base["symbols"],
            "preview_symbols": module.resolve(base, settings, catalog)["symbols"],
            "revision": hashlib.sha256(raw).hexdigest()}


def universe_module():
    spec = importlib.util.spec_from_file_location("qlib_universe_config", RESEARCH / "qlib_v1/universe.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def save_universe(document, revision):
    with LOCK:
        if status()["running"]:
            raise ValueError("研究正在运行，请完成后再保存股票池")
        current = universe_config()
        if revision != current["revision"]:
            raise ValueError("配置已被其他页面更新，请重新加载后保存")
        module = universe_module()
        settings = module.validate_settings(document, current["catalog"])
        base = json.loads((RESEARCH / "config/qlib-v1.json").read_text())
        module.resolve(base, settings, current["catalog"])
        path = RESEARCH / "config/qlib-universes.json"
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(settings, ensure_ascii=False, allow_nan=False, indent=2) + "\n")
        temporary.replace(path)
        return universe_config()
