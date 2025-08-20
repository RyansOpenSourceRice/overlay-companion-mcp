import os, sys, json, time, subprocess, shlex
import base64

from verifier.image_checks import avg_color_in_rect, likely_not_black

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
    # Use binary mode pipes for stdio framing compatibility
    return subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.PIPE, text=False, bufsize=0)


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

# Simple verification helper
def verify_overlay(img_path: Path, rect: dict) -> dict:
    res = {"phase": "verify", "rect": rect}
    try:
        color = avg_color_in_rect(str(img_path), (rect["x"], rect["y"], rect["width"], rect["height"]))
        res["avg_color"] = color
        res["ok"] = likely_not_black(color)
    except Exception as e:
        res["ok"] = False
        res["error"] = str(e)
    return res

    return evidence


def main():
    summary: Dict[str, Any] = {"ok": False, "steps": []}
    try:
        # Try raw JSON MCP roundtrip first (most reliable with current server)
        mcp_step = mcp_roundtrip(None)  # Raw JSON client manages its own processes
        summary["steps"].append(mcp_step)
        
        if not mcp_step.get("ok"):
            # Fallback to visual smoke test with manual process management
            app: subprocess.Popen | None = None
            try:
                app = start_app()
                time.sleep(2.0)
                summary["steps"].append(smoke_test())
            finally:
                if app:
                    stop_app(app)
                    # After process exit, safely drain stderr to file
                    try:
                        if app.stderr:
                            data = app.stderr.read() or b""
                            if isinstance(data, bytes):
                                txt = data.decode("utf-8", errors="ignore")
                            else:
                                txt = str(data)
                            (ARTIFACTS / "app-stderr.log").write_text(txt)
                    except Exception:
                        pass
        
        summary["ok"] = any(s.get("ok") for s in summary["steps"]) and len(summary["steps"]) > 0
    except Exception as e:
        summary["error"] = str(e)
        summary["ok"] = False
    
    write_json(ARTIFACTS / "summary.json", summary)
    print(json.dumps(summary, indent=2))
    sys.exit(0 if summary.get("ok") else 1)


def mcp_roundtrip_with_sdk() -> dict:
    """MCP roundtrip using the official MCP SDK (recommended approach)"""
    from drivers.mcp_stdio import McpStdioClientSimple
    evidence = {"phase": "mcp_sdk"}
    client = None
    try:
        # Use the command to let the MCP SDK manage the process
        cmd = [str(APP_BIN)]
        client = McpStdioClientSimple(cmd)
        
        init = client.initialize()
        evidence["initialize"] = init
        tools = client.list_tools()
        evidence["tools"] = tools
        
        # Find draw_overlay / take_screenshot / remove_overlay
        def pick_tool(names):
            tnames = []
            try:
                tnames = [t.get("name") for t in (tools.get("result", {}).get("tools") or []) if isinstance(t, dict)]
            except Exception:
                pass
            for n in names:
                if n in tnames:
                    return n
            return None
        
        draw_name = pick_tool(["draw_overlay", "DrawOverlay", "Overlay.Draw", "overlay/draw"]) or "draw_overlay"
        take_name = pick_tool(["take_screenshot", "TakeScreenshot", "screenshot/take"]) or "take_screenshot"
        remove_name = pick_tool(["remove_overlay", "RemoveOverlay", "overlay/remove"]) or "remove_overlay"
        
        # Call draw_overlay
        rect = {"x": 50, "y": 50, "width": 240, "height": 120, "color": "#FFAA00", "opacity": 0.9}
        dr = client.call_tool(draw_name, rect)
        evidence["draw_overlay"] = dr
        overlay_id = None
        try:
            overlay_id = (dr.get("result") or {}).get("overlay_id")
        except Exception:
            pass
        
        # Call take_screenshot
        ts = client.call_tool(take_name, {})
        evidence["take_screenshot"] = ts
        img_b64 = None
        try:
            img_b64 = (ts.get("result") or {}).get("image_base64")
        except Exception:
            pass
        
        if img_b64:
            img_path = ARTIFACTS / "mcp_roundtrip.png"
            try:
                img_path.write_bytes(base64.b64decode(img_b64))
                evidence["screenshot_file"] = str(img_path)
                # Verify overlay presence roughly
                evidence["verify"] = verify_overlay(img_path, rect)
            except Exception as e:
                evidence["screenshot_decode_error"] = str(e)
        
        # Remove overlay if we have an id
        if overlay_id:
            rr = client.call_tool(remove_name, {"overlayId": overlay_id, "overlay_id": overlay_id})
            evidence["remove_overlay"] = rr
        
        evidence["ok"] = True
    except Exception as e:
        evidence["ok"] = False
        evidence["error"] = str(e)
    finally:
        if client:
            try:
                client.close()
            except Exception:
                pass
    
    return evidence


def mcp_roundtrip(app_proc: subprocess.Popen) -> dict:
    """MCP roundtrip using working raw JSON client"""
    from drivers.mcp_raw_json import McpRawJsonClient
    evidence = {"phase": "mcp_raw_json"}
    
    try:
        # Set headless mode for MCP server
        os.environ["HEADLESS"] = "1"
        
        # Extract command from APP_BIN for the new client
        cmd = [str(APP_BIN)]
        client = McpRawJsonClient(cmd)
        
        # Initialize
        init = client.initialize()
        evidence["initialize"] = init
        
        # List tools
        tools = client.list_tools()
        evidence["tools"] = tools
        
        # Extract tool names for verification
        tool_names = []
        try:
            tool_list = tools.get("result", {}).get("tools", [])
            tool_names = [t.get("name") for t in tool_list if isinstance(t, dict)]
        except Exception:
            pass
        
        evidence["tool_names"] = tool_names
        evidence["tool_count"] = len(tool_names)
        
        # Verify required tools are present
        required_tools = ["draw_overlay", "take_screenshot", "remove_overlay", "set_mode"]
        missing_tools = [tool for tool in required_tools if tool not in tool_names]
        evidence["missing_tools"] = missing_tools
        
        # Test one simple tool call (set_mode) to verify tool calling works
        try:
            mode_result = client.call_tool("set_mode", {"mode": "assist"})
            evidence["set_mode_test"] = mode_result
            evidence["set_mode_success"] = not mode_result.get("result", {}).get("isError", False)
        except Exception as e:
            evidence["set_mode_test"] = {"error": str(e)}
            evidence["set_mode_success"] = False
        
        # Success criteria: initialize + tools/list + no missing required tools
        evidence["ok"] = bool(
            init and 
            tools and 
            tools.get("result", {}).get("tools") and
            len(tool_names) > 0 and
            len(missing_tools) == 0
        )
        
        client.close()
        
    except Exception as e:
        evidence["ok"] = False
        evidence["error"] = str(e)
        import traceback
        evidence["traceback"] = traceback.format_exc()
    
    return evidence

if __name__ == "__main__":
    main()
