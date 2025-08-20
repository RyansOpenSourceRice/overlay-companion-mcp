#!/usr/bin/env python3
"""
Simple test that just does initialize and tools/list to verify basic MCP functionality
"""

import os
import sys
import json
from pathlib import Path

# Add the drivers directory to the path
sys.path.insert(0, str(Path(__file__).parent / "drivers"))

from mcp_raw_json import McpRawJsonClient

def simple_mcp_test():
    """Simple MCP test that just does initialize and tools/list"""
    # Set headless mode
    os.environ["HEADLESS"] = "1"
    
    evidence = {"phase": "mcp_simple_test"}
    
    try:
        # Path to the MCP server binary
        server_path = Path(__file__).parent / "../../build/publish/overlay-companion-mcp"
        cmd = [str(server_path)]
        client = McpRawJsonClient(cmd)
        
        # Initialize
        init = client.initialize()
        evidence["initialize"] = init
        
        # List tools
        tools = client.list_tools()
        evidence["tools"] = tools
        
        # Check if we got the expected tools
        tool_names = []
        try:
            tool_list = tools.get("result", {}).get("tools", [])
            tool_names = [t.get("name") for t in tool_list if isinstance(t, dict)]
        except Exception:
            pass
        
        evidence["tool_names"] = tool_names
        evidence["tool_count"] = len(tool_names)
        
        # Success if we got initialize response and tools list
        evidence["ok"] = bool(
            init and 
            tools and 
            tools.get("result", {}).get("tools") and
            len(tool_names) > 0
        )
        
        client.close()
        
    except Exception as e:
        evidence["ok"] = False
        evidence["error"] = str(e)
        import traceback
        evidence["traceback"] = traceback.format_exc()
    
    return evidence

def main():
    result = simple_mcp_test()
    print(json.dumps(result, indent=2))
    
    if result.get("ok"):
        print("\n🎉 SUCCESS: Basic MCP functionality working!")
        print(f"✅ Initialize: {bool(result.get('initialize'))}")
        print(f"✅ Tools/list: {result.get('tool_count', 0)} tools found")
        print(f"✅ Tool names: {result.get('tool_names', [])}")
        return 0
    else:
        print(f"\n❌ FAILED: {result.get('error', 'Unknown error')}")
        return 1

if __name__ == "__main__":
    sys.exit(main())