# Minimal MCP stdio client with Content-Length framing and optional attachment to an existing process
# Implements basic initialize → tools/list → tools/call flows.

import json, subprocess, threading, queue, io, re, time
from typing import Any, Dict, Optional, List

_CONTENT_LENGTH_RE = re.compile(r"^Content-Length:\s*(\d+)\s*$", re.IGNORECASE)

class McpStdioClient:
    def __init__(self, cmd: Optional[list[str]] = None, proc: Optional[subprocess.Popen] = None):
        if proc is None and cmd is None:
            raise ValueError("either cmd or proc is required")
        self.proc = proc or subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=False, bufsize=0)
        if not (self.proc.stdin and self.proc.stdout):
            raise RuntimeError("stdin/stdout not available for MCP process")
        self._q: "queue.Queue[dict]" = queue.Queue()
        self._pending: Dict[int, Dict[str, Any]] = {}

        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()
        self._id = 0
        # Small warmup to allow server to initialize transport
        time.sleep(0.2)


    def _read_exact(self, n: int) -> bytes:
        buf = b""
        while len(buf) < n:
            chunk = self.proc.stdout.read(n - len(buf))  # type: ignore[arg-type]
            if not chunk:
                break
            buf += chunk
        return buf

    def _read_loop(self):
        stream = self.proc.stdout  # type: ignore[assignment]
        while True:
            # Read headers until blank line (support both CRLF and LF)
            header_buf = b""
            while True:
                ch = stream.read(1)
                if not ch:
                    return
                header_buf += ch
                if header_buf.endswith(b"\r\n\r\n") or header_buf.endswith(b"\n\n"):
                    break
            # Parse headers
            try:
                header_text = header_buf.decode("utf-8", errors="replace")
            except Exception:
                header_text = ""
            content_length = 0
            for line in header_text.splitlines():
                m = _CONTENT_LENGTH_RE.match(line.strip())
                if m:
                    content_length = int(m.group(1))
                    break
            if content_length <= 0:
                # Skip malformed frame
                continue
            body = self._read_exact(content_length)
            if not body:
                continue
            try:
                obj = json.loads(body.decode("utf-8", errors="replace"))
            except Exception:
                continue
            # Route response by id when possible; MCP uses JSON-RPC 2.0
            if isinstance(obj, dict) and "id" in obj:
                self._pending[obj["id"]] = obj
            else:
                self._q.put(obj)

    def _send(self, obj: dict):
        # Give the server a moment to start reading to avoid EPIPE when launching attached process
        time.sleep(0.01)

        data = json.dumps(obj).encode("utf-8")
        headers = (
            b"Content-Type: application/json\r\n"
            + f"Content-Length: {len(data)}\r\n\r\n".encode("ascii")
        )
        frame = headers + data
        self.proc.stdin.write(frame)  # type: ignore[arg-type]
        self.proc.stdin.flush()       # type: ignore[union-attr]

    def request(self, method: str, params: Optional[Dict[str, Any]] = None, timeout: float = 10.0) -> Dict[str, Any]:
        self._id += 1
        msg_id = self._id
        msg = {"jsonrpc": "2.0", "id": msg_id, "method": method, "params": params or {}}
        self._send(msg)
        # Wait for matching id
        start = time.time()
        while time.time() - start < timeout:
            if msg_id in self._pending:
                return self._pending.pop(msg_id)
            try:
                obj = self._q.get(timeout=0.05)
                # If this is a response, store it; otherwise, ignore or log
                if isinstance(obj, dict) and obj.get("id") is not None:
                    self._pending[obj["id"]] = obj
            except queue.Empty:
                pass
        raise TimeoutError(f"MCP stdio timeout waiting for {method}")

    def initialize(self, client_name: str = "ai-gui-harness", client_version: str = "0.1.0") -> Dict[str, Any]:
        return self.request("initialize", {
            "protocolVersion": "2024-11-05",
            "clientInfo": {"name": client_name, "version": client_version},
            "capabilities": {}
        })


    def list_tools(self) -> Dict[str, Any]:
        return self.request("tools/list", {})

    def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        return self.request("tools/call", {"name": name, "arguments": arguments})

    def close(self):
        try:
            if self.proc and self.proc.poll() is None:
                self.proc.terminate()
        except Exception:
            pass
