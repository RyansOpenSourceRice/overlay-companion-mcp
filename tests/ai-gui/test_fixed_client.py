#!/usr/bin/env python3
"""
Test the fixed MCP client
"""

import os
import sys
import json
from pathlib import Path

# Add the drivers directory to the path
sys.path.insert(0, str(Path(__file__).parent / "drivers"))

from mcp_stdio_fixed import McpStdioClientFixed

def main():
    # Set headless mode
    os.environ["HEADLESS"] = "1"
    
    # Path to the MCP server binary
    server_path = Path(__file__).parent / "../../build/publish/overlay-companion-mcp"
    
    print(f"Testing fixed MCP client with server: {server_path}")
    
    try:
        print("\n=== Creating fixed MCP client ===")
        cmd = [str(server_path)]
        client = McpStdioClientFixed(cmd)
        
        print("\n=== Initialize ===")
        init_result = client.initialize()
        print("✅ Initialize successful!")
        print(f"Result: {json.dumps(init_result, indent=2)}")
        
        print("\n=== List tools ===")
        tools_result = client.list_tools()
        print("✅ Tools/list successful!")
        
        # Extract tool names
        tools = tools_result.get("result", {}).get("tools", [])
        tool_names = [tool.get("name") for tool in tools if isinstance(tool, dict)]
        print(f"Available tools ({len(tool_names)}): {tool_names}")
        
        print("\n=== Test draw_overlay ===")
        draw_result = client.call_tool("draw_overlay", {
            "x": 100,
            "y": 100,
            "width": 200,
            "height": 100,
            "color": "#FF0000",
            "opacity": 0.5
        })
        print("✅ Draw overlay successful!")
        print(f"Result: {json.dumps(draw_result, indent=2)}")
        
        print("\n🎉 FIXED CLIENT WORKS! 🎉")
        return 0
        
    except Exception as e:
        print(f"❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())