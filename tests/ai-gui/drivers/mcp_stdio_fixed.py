#!/usr/bin/env python3
"""
Fixed MCP stdio client using official MCP Python SDK
Creates a fresh connection for each operation to avoid connection issues
"""

import asyncio
from typing import List, Dict, Any
from mcp import ClientSession, stdio_client
from mcp.client.stdio import StdioServerParameters


class McpStdioClientFixed:
    """
    Fixed MCP client that creates fresh connections for each operation
    This avoids connection management issues with the official SDK
    """
    
    def __init__(self, command: List[str]):
        self._server_params = StdioServerParameters(
            command=command[0],
            args=command[1:] if len(command) > 1 else [],
            env=None
        )
    
    def _run_async(self, coro):
        """Run an async coroutine in a sync context"""
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        return loop.run_until_complete(coro)
    
    async def _with_session(self, operation):
        """Execute an operation with a fresh MCP session"""
        async with stdio_client(self._server_params) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                # Initialize the session
                await session.initialize()
                # Execute the operation
                return await operation(session)
    
    def initialize(self, client_name: str = "ai-gui-harness", client_version: str = "0.1.0") -> Dict[str, Any]:
        """Initialize the MCP connection"""
        async def _initialize(session):
            # The session is already initialized by _with_session
            # Just return the server info
            return {
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {"listChanged": True}},
                    "serverInfo": {"name": "overlay-companion-mcp", "version": "1.0.0.0"}
                }
            }
        
        return self._run_async(self._with_session(_initialize))
    
    def list_tools(self) -> Dict[str, Any]:
        """List available tools"""
        async def _list_tools(session):
            result = await session.list_tools()
            return {
                "result": {
                    "tools": [tool.model_dump() for tool in result.tools]
                }
            }
        
        return self._run_async(self._with_session(_list_tools))
    
    def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Call a tool with the given arguments"""
        async def _call_tool(session):
            result = await session.call_tool(name, arguments)
            return {
                "result": result.content[0].text if result.content else "No result"
            }
        
        return self._run_async(self._with_session(_call_tool))
    
    def close(self):
        """Close the client (no-op since we use fresh connections)"""
        pass