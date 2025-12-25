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


def post(url, method, params=None, session=None):
    s = session or requests.Session()
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params or {},
    }
    headers = {"Content-Type": "application/json", "MCP-Protocol-Version": "2025-03-26"}
    r = s.post(url, json=payload, headers=headers, timeout=10)
    r.raise_for_status()
    return r.json()


def main():
    # Start Rust server on 3001
    rust_proc = subprocess.Popen([RUST_BIN], env={**dict(),}, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    time.sleep(1.5)

    try:
        rust_url = f"http://localhost:{RUST_PORT}/mcp"
        cs_url = f"http://localhost:{CS_PORT}/mcp"

        # Initialize both
        r_init = post(rust_url, "initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "cmp", "version": "0.1"}})
        c_init = post(cs_url, "initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "cmp", "version": "0.1"}})

        # List tools and compare names
        r_tools = post(rust_url, "tools/list")
        c_tools = post(cs_url, "tools/list")
        r_names = sorted([t.get("name") for t in r_tools.get("result", {}).get("tools", [])])
        c_names = sorted([t.get("name") for t in c_tools.get("result", {}).get("tools", [])])
        print("Rust tools:", r_names)
        print("C# tools:", c_names)

        # Call a common tool
        r_call = post(rust_url, "tools/call", {"name": "click_at", "arguments": {"x": 1, "y": 1}})
        c_call = post(cs_url, "tools/call", {"name": "click_at", "arguments": {"x": 1, "y": 1}})
        print("Rust call result keys:", list(r_call.keys()))
        print("C# call result keys:", list(c_call.keys()))
        print("OK")

    finally:
        rust_proc.terminate()
        try:
            rust_proc.wait(timeout=2)
        except Exception:
            rust_proc.kill()


if __name__ == "__main__":
    main()
