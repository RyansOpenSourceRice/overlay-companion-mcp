import os
import subprocess
import time
from pathlib import Path

# Simple CI smoke test to assert the AppImage signals window readiness


def test_appimage_window_ready(tmp_path):
    appimages = list(Path("build").glob("*.AppImage"))
    assert appimages, "No AppImage found in build/"
    app = str(appimages[0])

    ready = tmp_path / "window-ready.txt"
    env = os.environ.copy()
    env["OC_SMOKE_TEST"] = "1"
    env["OC_WINDOW_READY_FILE"] = str(ready)

    # Start AppImage; use xvfb-run to provide a display in CI
    proc = subprocess.Popen(
        ["xvfb-run", "-a", app, "--smoke-test"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    try:
        # Wait up to 30s for ready file
        deadline = time.time() + 30
        while time.time() < deadline:
            if ready.exists():
                return
            time.sleep(1)
        raise AssertionError("Window never signaled ready")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
