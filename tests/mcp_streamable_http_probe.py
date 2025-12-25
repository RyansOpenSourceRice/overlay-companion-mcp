#!/usr/bin/env python3
import json

import requests

URL = "http://127.0.0.1:3100/mcp"
HEADERS_BASE = {
    "Content-Type": "application/json",
    "MCP-Protocol-Version": "2025-03-26",
    "Accept": "application/json, text/event-stream",
}


def post_sse(url, payload, session_id=None):
    headers = HEADERS_BASE.copy()
    if session_id:
        headers["MCP-Session-Id"] = session_id
    with requests.post(
        url, json=payload, headers=headers, stream=True, timeout=30
    ) as r:
        r.raise_for_status()
        data_lines = []
        for line in r.iter_lines(decode_unicode=True):
            if not line:
                continue
            if line.startswith("data: "):
                data_lines.append(line[len("data: ") :])
        if not data_lines:
            return None
        # Concatenate payload across lines (usually only one)
        txt = "".join(data_lines)
        try:
            return json.loads(txt)
        except Exception:
            return {"raw": txt}


def main():
    init = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "probe", "version": "0.1"},
        },
    }
    # First request: initialize, and capture session id from response headers
    # Note: requests doesn't expose headers until after sending; we'll make a non-streamed request first to get session id
    r = requests.post(URL, json=init, headers=HEADERS_BASE, timeout=30)
    r.raise_for_status()
    sess = r.headers.get("MCP-Session-Id")
    print("session:", sess)
    # Also parse body as SSE one-shot
    body = r.text
    if body.startswith("data: "):
        try:
            print("init:", json.loads(body[len("data: ") :]))
        except Exception:
            print("init raw:", body)

    # tools/list
    list_req = {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}
    resp = post_sse(URL, list_req, session_id=sess)
    print("tools/list:", json.dumps(resp, indent=2))

    # call a tool
    call_req = {
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {"name": "click_at", "arguments": {"x": 5, "y": 7}},
    }
    call_resp = post_sse(URL, call_req, session_id=sess)
    print("tools/call:", json.dumps(call_resp, indent=2))


if __name__ == "__main__":
    main()
