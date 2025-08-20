# Placeholder MCP stdio driver. To be wired when MCP server is fully implemented.
# This structure supports JSON-RPC over stdio once the server is operational.

import json, subprocess, threading, queue
from typing import Any, Dict, Optional

class McpStdioClient:
    def __init__(self, cmd: list[str]):
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
        self._q = queue.Queue()
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()
        self._id = 0

    def _read_loop(self):
        if not self.proc.stdout:
            return
        for line in self.proc.stdout:
            try:
                obj = json.loads(line)
            except Exception:
                continue
            self._q.put(obj)

    def call(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        self._id += 1
        msg = {"jsonrpc":"2.0","id": self._id, "method": method, "params": params}
        if not self.proc.stdin:
            raise RuntimeError("proc stdin not available")
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()
        try:
            resp = self._q.get(timeout=10)
        except queue.Empty:
            raise TimeoutError("MCP stdio timeout")
        return resp

    def close(self):
        try:
            if self.proc:
                self.proc.terminate()
        except Exception:
            pass
