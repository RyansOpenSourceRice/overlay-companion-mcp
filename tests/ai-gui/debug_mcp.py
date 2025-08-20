#!/usr/bin/env python3
"""
Debug script to test MCP connection step by step
"""

import os
import sys
import json
import asyncio
import subprocess
from pathlib import Path

# Add the drivers directory to the path
sys.path.insert(0, str(Path(__file__).parent / "drivers"))

from mcp_stdio import McpStdioClientSimple

def main():
    # Set headless mode
    os.environ["HEADLESS"] = "1"
    
    # Path to the MCP server binary
    server_path = Path(__file__).parent / "../../build/publish/overlay-companion-mcp"
    
    print(f"Testing MCP server at: {server_path}")
    print(f"Server exists: {server_path.exists()}")
    print(f"Server executable: {os.access(server_path, os.X_OK)}")
    
    if not server_path.exists():
        print("ERROR: Server binary not found!")
        return 1
    
    try:
        print("\n=== Creating MCP client ===")
        cmd = [str(server_path)]
        client = McpStdioClientSimple(cmd)
        
        print("\n=== Testing initialize ===")
        init_result = client.initialize(client_name="debug-test", client_version="1.0.0")
        print("Initialize successful!")
        print("Result:", json.dumps(init_result, indent=2))
        
        print("\n=== Testing tools/list ===")
        try:
            tools_result = client.list_tools()
            print("Tools/list successful!")
            print("Result:", json.dumps(tools_result, indent=2))
            
            # Extract tool names
            tools = tools_result.get("result", {}).get("tools", [])
            tool_names = [tool.get("name") for tool in tools if isinstance(tool, dict)]
            print(f"Available tools: {tool_names}")
            
            # Test a simple tool call if draw_overlay is available
            if "draw_overlay" in tool_names:
                print("\n=== Testing draw_overlay tool ===")
                draw_result = client.call_tool("draw_overlay", {
                    "x": 100,
                    "y": 100, 
                    "width": 200,
                    "height": 100,
                    "color": "#FF0000",
                    "opacity": 0.5
                })
                print("Draw overlay successful!")
                print("Result:", json.dumps(draw_result, indent=2))
            
        except Exception as e:
            print(f"Tools/list failed: {e}")
            import traceback
            traceback.print_exc()
        
        print("\n=== Closing client ===")
        client.close()
        print("Test completed!")
        return 0
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())