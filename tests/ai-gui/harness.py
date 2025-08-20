import os, sys, json, time, subprocess, shlex
from pathlib import Path
from typing import Any, Dict

HERE = Path(__file__).parent.resolve()
ARTIFACTS = Path(os.environ.get("AI_GUI_ARTIFACTS", HERE / "artifacts")).resolve()
ROOT = Path(os.environ.get("AI_GUI_ROOT", HERE / "../.."))
APP_BIN = Path(os.environ.get("AI_GUI_APP_BIN", ROOT / "build/publish/overlay-companion-mcp"))

ARTIFACTS.mkdir(parents=True, exist_ok=True)

# Simple helpers

def run(cmd: str, env: Dict[str,str] | None = None, timeout: int = 60) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, shell=True, check=False, env={**os.environ, **(env or {})}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout)


def capture_screenshot(path: Path) -> bool:
    # Prefer ImageMagick import if available (works with Xvfb)
    if subprocess.call("command -v import >/dev/null", shell=True) == 0:
        cp = run(f"import -window root {shlex.quote(str(path))}")
        return path.exists() and path.stat().st_size > 0
    # Fallback: no reliable pure-Python screenshot in headless without extra libs
    return False


def start_app() -> subprocess.Popen:
    env = os.environ.copy()
    # Ensure GUI is allowed; don't set HEADLESS here
    args = [str(APP_BIN)]
    return subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def stop_app(p: subprocess.Popen):
    try:
        p.terminate()
        try:
            p.wait(timeout=10)
        except subprocess.TimeoutExpired:
            p.kill()
    except Exception:
        pass


def write_json(path: Path, data: Any):
    path.write_text(json.dumps(data, indent=2))


def smoke_test() -> dict:
    evidence = {"phase": "smoke"}
    time.sleep(1.0)
    snap = ARTIFACTS / "smoke_1.png"
    if capture_screenshot(snap):
        evidence["screenshot"] = str(snap)
        evidence["ok"] = True
    else:
        evidence["ok"] = False
        evidence["error"] = "screenshot_failed"
    return evidence


def main():
    summary: Dict[str, Any] = {"ok": False, "steps": []}
    app = None
    try:
        app = start_app()
        time.sleep(2.0)  # give app time to start and render

        # TODO: integrate real MCP stdio client once server is fully wired
        # For now, perform a visual smoke test and capture logs for future parsing
        step1 = smoke_test()
        summary["steps"].append(step1)

        # Collect app stderr to artifacts for debugging
        if app and app.stderr:
            try:
                stderr_out = app.stderr.read()
                (ARTIFACTS / "app-stderr.log").write_text(stderr_out)
            except Exception:
                pass

        summary["ok"] = all(s.get("ok") for s in summary["steps"]) and len(summary["steps"]) > 0
    finally:
        if app:
            stop_app(app)
    write_json(ARTIFACTS / "summary.json", summary)
    print(json.dumps(summary, indent=2))
    sys.exit(0 if summary.get("ok") else 1)

if __name__ == "__main__":
    main()
