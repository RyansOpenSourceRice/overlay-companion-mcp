#!/usr/bin/env python3
"""
Test complete MCP roundtrip: initialize → tools/list → draw_overlay → take_screenshot → remove_overlay
"""

import os
import sys
import json
import time
from pathlib import Path

# Add the drivers directory to the path
sys.path.insert(0, str(Path(__file__).parent / "drivers"))

from mcp_stdio import McpStdioClientSimple

def main():
    # Set headless mode
    os.environ["HEADLESS"] = "1"
    
    # Path to the MCP server binary
    server_path = Path(__file__).parent / "../../build/publish/overlay-companion-mcp"
    
    print(f"Testing complete MCP roundtrip with server: {server_path}")
    
    try:
        print("\n=== 1. Creating MCP client ===")
        cmd = [str(server_path)]
        client = McpStdioClientSimple(cmd)
        
        print("\n=== 2. Initialize ===")
        init_result = client.initialize(client_name="roundtrip-test", client_version="1.0.0")
        print("✅ Initialize successful!")
        
        print("\n=== 3. List tools ===")
        tools_result = client.list_tools()
        print("✅ Tools/list successful!")
        
        # Extract tool names
        tools = tools_result.get("result", {}).get("tools", [])
        tool_names = [tool.get("name") for tool in tools if isinstance(tool, dict)]
        print(f"Available tools: {tool_names}")
        
        # Verify required tools are available
        required_tools = ["draw_overlay", "take_screenshot", "remove_overlay", "set_mode"]
        missing_tools = [tool for tool in required_tools if tool not in tool_names]
        if missing_tools:
            print(f"❌ Missing required tools: {missing_tools}")
            return 1
        print("✅ All required tools available!")
        
        print("\n=== 4. Set mode to assist ===")
        mode_result = client.call_tool("set_mode", {"mode": "assist"})
        print("✅ Set mode successful!")
        print(f"Mode result: {json.dumps(mode_result, indent=2)}")
        
        print("\n=== 5. Draw overlay ===")
        overlay_result = client.call_tool("draw_overlay", {
            "x": 100,
            "y": 100,
            "width": 200,
            "height": 100,
            "color": "#FF0000",
            "opacity": 0.5,
            "id": "test-overlay"
        })
        print("✅ Draw overlay successful!")
        print(f"Overlay result: {json.dumps(overlay_result, indent=2)}")
        
        print("\n=== 6. Take screenshot ===")
        screenshot_result = client.call_tool("take_screenshot", {
            "x": 50,
            "y": 50,
            "width": 300,
            "height": 200
        })
        print("✅ Take screenshot successful!")
        # Don't print the full result as it contains binary data
        result_data = screenshot_result.get("result", {})
        if isinstance(result_data, dict):
            print(f"Screenshot metadata: width={result_data.get('width')}, height={result_data.get('height')}")
        
        print("\n=== 7. Remove overlay ===")
        remove_result = client.call_tool("remove_overlay", {"overlayId": "test-overlay"})
        print("✅ Remove overlay successful!")
        print(f"Remove result: {json.dumps(remove_result, indent=2)}")
        
        print("\n=== 8. Closing client ===")
        client.close()
        
        print("\n🎉 COMPLETE MCP ROUNDTRIP SUCCESSFUL! 🎉")
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