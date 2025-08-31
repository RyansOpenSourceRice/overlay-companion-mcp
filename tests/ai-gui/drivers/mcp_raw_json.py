#!/usr/bin/env python3
"""
Raw JSON MCP client that works with the .NET MCP server
Based on the successful debug_server.py approach
"""

import json
import subprocess
import time
from typing import Any, Dict, List, Optional


class McpRawJsonClient:
    """
    Raw JSON MCP client that communicates directly with stdio
    This approach works reliably with the .NET MCP server
    """

    def __init__(self, command: List[str], env: Optional[Dict[str, str]] = None):
        self._command = command
        self._env = env
        self._process: Optional[subprocess.Popen] = None
        self._request_id = 0

    def _get_next_id(self) -> int:
        """Get next request ID"""
        self._request_id += 1
        return self._request_id

    def _start_process(self) -> subprocess.Popen:
        """Start the MCP server process"""
        return subprocess.Popen(
            self._command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=0,
            env=self._env,
        )

    def _send_request(
        self, method: str, params: Dict[str, Any] = None, timeout: float = 5.0
    ) -> Dict[str, Any]:
        """Send a request and get response"""
        if params is None:
            params = {}

        # Create a fresh process for each request (this is what works)
        process = self._start_process()

        try:
            # Wait a moment for server to start
            time.sleep(0.5)

            # Send request
            request = {
                "jsonrpc": "2.0",
                "id": self._get_next_id(),
                "method": method,
                "params": params,
            }

            request_json = json.dumps(request) + "\n"
            process.stdin.write(request_json)
            process.stdin.flush()

            # Read response with timeout
            start_time = time.time()
            while time.time() - start_time < timeout:
                if process.poll() is not None:
                    # Process has exited
                    break

                # Try to read a line
                try:
                    response_line = process.stdout.readline()
                    if response_line:
                        response = json.loads(response_line.strip())
                        return response
                except json.JSONDecodeError:
                    # Invalid JSON, try again
                    continue

                time.sleep(0.1)

            raise Exception(f"No valid response received within {timeout} seconds")

        finally:
            # Cleanup
            try:
                process.terminate()
                process.wait(timeout=2)
            except Exception:
                process.kill()

    def initialize(
        self, client_name: str = "raw-json-client", client_version: str = "1.0.0"
    ) -> Dict[str, Any]:
        """Initialize the MCP connection"""
        params = {
            "protocolVersion": "2024-11-05",
            "clientInfo": {"name": client_name, "version": client_version},
            "capabilities": {},
        }
        return self._send_request("initialize", params)

    def list_tools(self) -> Dict[str, Any]:
        """List available tools"""
        return self._send_request("tools/list")

    def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Call a tool with the given arguments"""
        params = {"name": name, "arguments": arguments}
        # Tool calls may take longer, especially screenshot operations
        return self._send_request("tools/call", params, timeout=10.0)

    def close(self):
        """Close the client (no-op since we use fresh processes)"""
        pass
