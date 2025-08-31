# MCP stdio client using the official MCP Python SDK
# Implements basic initialize → tools/list → tools/call flows.

import asyncio
import subprocess
from typing import Any, Dict, List, Optional

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


class McpStdioClient:
    """
    A wrapper around the official MCP Python SDK client that provides
    a synchronous interface compatible with the existing test harness.
    """

    def __init__(
        self, cmd: Optional[List[str]] = None, proc: Optional[subprocess.Popen] = None
    ):
        if proc is None and cmd is None:
            raise ValueError("either cmd or proc is required")

        # If we have an existing process, extract the command from it
        # and let the official SDK manage a new process
        if proc is not None:
            # Close the existing process since we'll create a new one
            if proc.poll() is None:
                try:
                    proc.terminate()
                    proc.wait(timeout=2)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass
            # We need the command to create server parameters
            # For now, assume it's the same command that was used to create the process
            # This should be passed explicitly in a real implementation
            if cmd is None:
                raise ValueError("cmd must be provided when using proc parameter")

        # Create server parameters for the official SDK
        self._server_params = StdioServerParameters(
            command=cmd[0], args=cmd[1:] if len(cmd) > 1 else []
        )

        self._session = None
        self._client_context = None
        self._session_context = None

    async def _ensure_connected(self):
        """Ensure we have an active MCP session"""
        if self._session is not None:
            return

        # Use the official SDK to create and manage the process
        self._client_context = stdio_client(self._server_params)
        read_stream, write_stream = await self._client_context.__aenter__()
        self._session_context = ClientSession(read_stream, write_stream)
        self._session = await self._session_context.__aenter__()

    async def _cleanup(self):
        """Clean up MCP session and connections"""
        if self._session_context:
            try:
                await self._session_context.__aexit__(None, None, None)
            except Exception:
                pass
            self._session_context = None
            self._session = None

        if self._client_context:
            try:
                await self._client_context.__aexit__(None, None, None)
            except Exception:
                pass
            self._client_context = None

    def _run_async(self, coro):
        """Run an async coroutine in a sync context"""
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        return loop.run_until_complete(coro)

    def initialize(
        self, client_name: str = "ai-gui-harness", client_version: str = "0.1.0"
    ) -> Dict[str, Any]:
        """Initialize the MCP connection"""

        async def _initialize():
            await self._ensure_connected()
            result = await self._session.initialize()
            # Convert the result to a dict format compatible with the old client
            return {
                "result": {
                    "protocolVersion": result.protocolVersion,
                    "capabilities": result.capabilities.model_dump()
                    if result.capabilities
                    else {},
                    "serverInfo": result.serverInfo.model_dump()
                    if result.serverInfo
                    else {},
                }
            }

        return self._run_async(_initialize())

    def list_tools(self) -> Dict[str, Any]:
        """List available tools"""

        async def _list_tools():
            await self._ensure_connected()
            result = await self._session.list_tools()
            # Convert to dict format compatible with old client
            return {"result": {"tools": [tool.model_dump() for tool in result.tools]}}

        return self._run_async(_list_tools())

    def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Call a tool with the given arguments"""

        async def _call_tool():
            await self._ensure_connected()
            result = await self._session.call_tool(name, arguments)
            # Convert to dict format compatible with old client
            return {
                "result": {
                    "content": [content.model_dump() for content in result.content],
                    "isError": result.isError if hasattr(result, "isError") else False,
                }
            }

        return self._run_async(_call_tool())

    def close(self):
        """Close the MCP connection"""
        self._run_async(self._cleanup())


# Alternative approach: Create a client that works with command only
class McpStdioClientSimple:
    """
    Simplified MCP client that only works with commands (not existing processes).
    This is the recommended approach for the official MCP SDK.
    """

    def __init__(self, cmd: List[str]):
        self._server_params = StdioServerParameters(
            command=cmd[0], args=cmd[1:] if len(cmd) > 1 else []
        )

        self._session = None
        self._client_context = None
        self._session_context = None

    async def _ensure_connected(self):
        """Ensure we have an active MCP session"""
        if self._session is not None:
            return

        # Use the official SDK to create and manage the process
        self._client_context = stdio_client(self._server_params)
        read_stream, write_stream = await self._client_context.__aenter__()
        self._session_context = ClientSession(read_stream, write_stream)
        self._session = await self._session_context.__aenter__()

    async def _cleanup(self):
        """Clean up MCP session and connections"""
        if self._session_context:
            try:
                await self._session_context.__aexit__(None, None, None)
            except Exception:
                pass
            self._session_context = None
            self._session = None

        if self._client_context:
            try:
                await self._client_context.__aexit__(None, None, None)
            except Exception:
                pass
            self._client_context = None

    def _run_async(self, coro):
        """Run an async coroutine in a sync context"""
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        return loop.run_until_complete(coro)

    def initialize(
        self, client_name: str = "ai-gui-harness", client_version: str = "0.1.0"
    ) -> Dict[str, Any]:
        """Initialize the MCP connection"""

        async def _initialize():
            await self._ensure_connected()
            result = await self._session.initialize()
            # Convert the result to a dict format compatible with the old client
            return {
                "result": {
                    "protocolVersion": result.protocolVersion,
                    "capabilities": result.capabilities.model_dump()
                    if result.capabilities
                    else {},
                    "serverInfo": result.serverInfo.model_dump()
                    if result.serverInfo
                    else {},
                }
            }

        return self._run_async(_initialize())

    def list_tools(self) -> Dict[str, Any]:
        """List available tools"""

        async def _list_tools():
            await self._ensure_connected()
            result = await self._session.list_tools()
            # Convert to dict format compatible with old client
            return {"result": {"tools": [tool.model_dump() for tool in result.tools]}}

        return self._run_async(_list_tools())

    def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Call a tool with the given arguments"""

        async def _call_tool():
            await self._ensure_connected()
            result = await self._session.call_tool(name, arguments)
            # Convert to dict format compatible with old client
            return {
                "result": {
                    "content": [content.model_dump() for content in result.content],
                    "isError": result.isError if hasattr(result, "isError") else False,
                }
            }

        return self._run_async(_call_tool())

    def close(self):
        """Close the MCP connection"""
        self._run_async(self._cleanup())
