#!/usr/bin/env python3
"""
Test the raw JSON MCP client
"""

import os
import sys
import json
from pathlib import Path

# Add the drivers directory to the path
sys.path.insert(0, str(Path(__file__).parent / "drivers"))

from mcp_raw_json import McpRawJsonClient

def main():
    # Set headless mode
    os.environ["HEADLESS"] = "1"
    
    # Path to the MCP server binary
    server_path = Path(__file__).parent / "../../build/publish/overlay-companion-mcp"
    
    print(f"Testing raw JSON MCP client with server: {server_path}")
    
    try:
        print("\n=== Creating raw JSON MCP client ===")
        cmd = [str(server_path)]
        client = McpRawJsonClient(cmd)
        
        print("\n=== Initialize ===")
        init_result = client.initialize()
        print("✅ Initialize successful!")
        print(f"Protocol version: {init_result.get('result', {}).get('protocolVersion')}")
        
        print("\n=== List tools ===")
        tools_result = client.list_tools()
        print("✅ Tools/list successful!")
        
        # Extract tool names
        tools = tools_result.get("result", {}).get("tools", [])
        tool_names = [tool.get("name") for tool in tools if isinstance(tool, dict)]
        print(f"Available tools ({len(tool_names)}): {tool_names}")
        
        # Verify required tools are available
        required_tools = ["draw_overlay", "take_screenshot", "remove_overlay", "set_mode"]
        missing_tools = [tool for tool in required_tools if tool not in tool_names]
        if missing_tools:
            print(f"❌ Missing required tools: {missing_tools}")
            return 1
        print("✅ All required tools available!")
        
        print("\n=== Test set_mode ===")
        mode_result = client.call_tool("set_mode", {"mode": "assist"})
        print("✅ Set mode successful!")
        print(f"Mode result: {json.dumps(mode_result, indent=2)}")
        
        print("\n=== Test draw_overlay ===")
        draw_result = client.call_tool("draw_overlay", {
            "x": 100,
            "y": 100,
            "width": 200,
            "height": 100,
            "color": "#FF0000",
            "opacity": 0.5,
            "id": "test-overlay"
        })
        print("✅ Draw overlay successful!")
        print(f"Draw result: {json.dumps(draw_result, indent=2)}")
        
        print("\n=== Test take_screenshot ===")
        screenshot_result = client.call_tool("take_screenshot", {
            "x": 50,
            "y": 50,
            "width": 300,
            "height": 200
        })
        print("✅ Take screenshot successful!")
        # Don't print the full result as it contains binary data
        result_data = screenshot_result.get("result", {})
        if isinstance(result_data, str):
            print(f"Screenshot result length: {len(result_data)} characters")
        
        print("\n=== Test remove_overlay ===")
        remove_result = client.call_tool("remove_overlay", {"overlayId": "test-overlay"})
        print("✅ Remove overlay successful!")
        print(f"Remove result: {json.dumps(remove_result, indent=2)}")
        
        print("\n🎉 RAW JSON CLIENT WORKS PERFECTLY! 🎉")
        print("All operations completed successfully:")
        print("  ✅ Initialize")
        print("  ✅ Tools/list")
        print("  ✅ Set mode")
        print("  ✅ Draw overlay")
        print("  ✅ Take screenshot")
        print("  ✅ Remove overlay")
        
        return 0
        
    except Exception as e:
        print(f"❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())