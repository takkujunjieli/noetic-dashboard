#!/usr/bin/env python3
"""Stage static Pages assets, excluding private sources, symlinks, docs and scripts."""
import argparse
import json
import shutil
import subprocess
from pathlib import Path

from export_public_dashboard import validate_public_snapshot

ROOT = Path(__file__).resolve().parent.parent
PRIVATE_FILES = {"portfolio.json", "pnl.json", "portfolio_history.json", "transaction_history.json",
                 "trade_journal.json", "risk_stops.json", "completed_theses.json", "thesis_events.json",
                 "robustness.json", "score_ic.json", "rh_networth.json", "monthly_returns.json",
                 "risk_policy.json", "public_aliases.json", "workflow.json", ".px_cache.json"}
STATIC_EXTENSIONS = {".html", ".js", ".mjs", ".css", ".json", ".csv", ".parquet", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico", ".woff", ".woff2", ".ttf"}


def permitted(path):
    if path.name in PRIVATE_FILES or path.name.startswith(("_rh_", "_takku_", "_moomoo_")):
        return False
    if any(part.startswith(".") for part in path.parts):
        return False
    return path.suffix in STATIC_EXTENSIONS and (len(path.parts) == 1 or path.parts[0] in ("assets", "data", "config", "research"))


def build(root=ROOT, output=ROOT / "_site"):
    root, output = Path(root).resolve(), Path(output).resolve()
    if root == output or root.is_relative_to(output):
        raise ValueError("Output cannot contain the source checkout")
    snapshot = root / "data/public-dashboard.json"
    validate_public_snapshot(json.loads(snapshot.read_text()))  # Fail closed before changing the output.
    if output.exists():
        if not (output / ".public-site-build").is_file():
            raise ValueError("Refusing to replace an unrelated output directory")
        shutil.rmtree(output)
    output.mkdir(parents=True)
    (output / ".public-site-build").write_text("anonymous static site\n")
    tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
    # Frontend code has no private data; include new modules when previewing before commit.
    assets = [str(p.relative_to(root)) for p in (root / "assets").rglob("*") if p.is_file()]
    candidates = set(tracked + assets + ["data/public-dashboard.json"])
    copied = []
    for name in sorted(candidates):
        relative = Path(name)
        if not name or not permitted(relative):
            continue
        source = root / relative
        if not source.is_file() or source.is_symlink() or not source.resolve().is_relative_to(root):
            continue
        if relative.parts[0] == "data" and source.suffix == ".json" and name != "data/public-dashboard.json":
            value = json.loads(source.read_text())
            if isinstance(value, dict) and ({"accounts", "transactions", "positions"} & value.keys()):
                raise ValueError("Account/position data cannot enter a public artifact: " + name)
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        if source.suffix == ".html":
            html = target.read_text()
            target.write_text(html.replace("<head>", '<head>\n<meta name="dashboard-mode" content="public">', 1))
        copied.append(name)
    (output / ".nojekyll").touch()
    return copied


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "_site")
    args = parser.parse_args()
    print(f"Public site staged: {len(build(output=args.output))} assets")


if __name__ == "__main__":
    main()
