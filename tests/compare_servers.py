#!/usr/bin/env python3
import json
import subprocess
import time
from pathlib import Path
import requests

# Simple harness to compare basic tool list and a call between C# HTTP MCP and Rust HTTP MCP
# Assumes:
# - C# MCP server reachable at http://localhost:3000/mcp when its container is running
# - Rust MCP server reachable at http://localhost:3001/mcp (we'll run locally on 3001)

RUST_PORT = 3001
CS_PORT = 3000

RUST_BIN = str(Path(__file__).resolve().parents[1] / "rust-mcp" / "target" / "release" / "overlay-companion-mcp")


def _post_json(url, payload, session=None):
    s = session or requests.Session()
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "MCP-Protocol-Version": "2025-03-26",
    }
    r = s.post(url, json=payload, headers=headers, timeout=10)
    r.raise_for_status()
    return r.json()


def _post_streamable(url, payload, session=None):
    s = session or requests.Session()
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-03-26",
    }
    r = s.post(url, json=payload, headers=headers, timeout=10, stream=True)
    r.raise_for_status()
    ctype = r.headers.get("Content-Type", "")
    if ctype.startswith("application/json"):
        return r.json()
    # SSE: read first data: line
    for line in r.iter_lines(decode_unicode=True):
        if not line:
            continue
        if line.startswith("data:"):
            data = line[len("data:"):].strip()
            return json.loads(data)
    raise RuntimeError("No data frame received from streamable HTTP response")


def post(url, method, params=None, session=None, streamable=False):
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params or {},
    }
    if streamable:
        return _post_streamable(url, payload, session=session)
    else:
        return _post_json(url, payload, session=session)


def main():
    # Start Rust server on 3001
    env = dict(**dict())
    env["MCP_HTTP_PORT"] = str(RUST_PORT)
    rust_proc = subprocess.Popen([RUST_BIN], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    time.sleep(1.5)

    try:
        rust_url = f"http://localhost:{RUST_PORT}/mcp"
        cs_url = f"http://localhost:{CS_PORT}/mcp"

        # Initialize both
        r_init = post(rust_url, "initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "cmp", "version": "0.1"}})
        c_init = post(cs_url, "initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "cmp", "version": "0.1"}})

        # List tools and compare names (must include core overlay tools)
        r_tools = post(rust_url, "tools/list")
        c_tools = post(cs_url, "tools/list")
        r_names = sorted([t.get("name") for t in r_tools.get("result", {}).get("tools", [])])
        c_names = sorted([t.get("name") for t in c_tools.get("result", {}).get("tools", [])])
        print("Rust tools:", r_names)
        print("C# tools:", c_names)
        for core in ["draw_overlay", "remove_overlay", "take_screenshot"]:
            assert core in r_names and core in c_names, f"Missing core tool {core} in one of the servers"

        # click_at moved to Control MCP; verify both servers do not expose it here
        r_call = post(rust_url, "tools/call", {"name": "click_at", "arguments": {"x": 1, "y": 1}})
        c_call = post(cs_url, "tools/call", {"name": "click_at", "arguments": {"x": 1, "y": 1}})
        assert r_call.get("error") is not None and c_call.get("error") is not None
        print("OK: click_at not exposed by Overlay MCP in both implementations")

        def first_text(result):
            content = (result or {}).get("result", {}).get("content", [])
            if content and content[0].get("type") == "text":
                return content[0].get("text")
            return None

        # draw_overlay parity: both should return JSON with overlay_id and bounds
        r_draw = post(rust_url, "tools/call", {"name": "draw_overlay", "arguments": {"x": 10, "y": 20, "width": 100, "height": 50, "color": "#FF0000"}})
        c_draw = post(cs_url, "tools/call", {"name": "draw_overlay", "arguments": {"x": 10, "y": 20, "width": 100, "height": 50, "color": "#FF0000"}})
        r_draw_json = json.loads(first_text(r_draw) or "{}")
        c_draw_json = json.loads(first_text(c_draw) or "{}")
        for key in ["overlay_id", "bounds", "color"]:
            assert key in r_draw_json and key in c_draw_json, f"draw_overlay missing key {key}"
        print("OK: draw_overlay returns comparable payloads")

        # take_screenshot parity: JSON shape with width/height present
        r_ss = post(rust_url, "tools/call", {"name": "take_screenshot", "arguments": {}})
        c_ss = post(cs_url, "tools/call", {"name": "take_screenshot", "arguments": {}})
        r_ss_json = json.loads(first_text(r_ss) or "{}")
        c_ss_json = json.loads(first_text(c_ss) or "{}")
        for key in ["width", "height", "viewport_scroll"]:
            assert key in r_ss_json and key in c_ss_json, f"take_screenshot missing key {key}"
        print("OK: take_screenshot returns comparable payloads")

    finally:
        rust_proc.terminate()
        try:
            rust_proc.wait(timeout=2)
        except Exception:
            rust_proc.kill()


if __name__ == "__main__":
    main()
