#!/usr/bin/env python3
"""
Debug what take_screenshot actually returns
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
    
    print(f"Debugging take_screenshot with server: {server_path}")
    
    try:
        cmd = [str(server_path)]
        client = McpRawJsonClient(cmd)
        
        print("\n=== Initialize ===")
        init_result = client.initialize()
        print("✅ Initialize successful!")
        
        print("\n=== Take screenshot ===")
        screenshot_result = client.call_tool("take_screenshot", {})
        print("✅ Take screenshot successful!")
        
        print(f"\nScreenshot result structure:")
        print(f"Type: {type(screenshot_result)}")
        print(f"Keys: {list(screenshot_result.keys()) if isinstance(screenshot_result, dict) else 'Not a dict'}")
        
        if isinstance(screenshot_result, dict):
            result = screenshot_result.get("result", {})
            print(f"Result type: {type(result)}")
            print(f"Result keys: {list(result.keys()) if isinstance(result, dict) else 'Not a dict'}")
            
            if isinstance(result, dict):
                content = result.get("content", [])
                print(f"Content type: {type(content)}")
                print(f"Content length: {len(content) if isinstance(content, list) else 'Not a list'}")
                
                if isinstance(content, list) and len(content) > 0:
                    first_content = content[0]
                    print(f"First content type: {type(first_content)}")
                    print(f"First content keys: {list(first_content.keys()) if isinstance(first_content, dict) else 'Not a dict'}")
                    
                    if isinstance(first_content, dict):
                        text = first_content.get("text", "")
                        print(f"Text length: {len(text)}")
                        print(f"Text preview: {text[:100]}...")
        
        return 0
        
    except Exception as e:
        print(f"❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())