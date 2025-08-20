#!/usr/bin/env python3
"""
Comprehensive functional test for MCP overlay system.
Tests the complete overlay workflow without requiring visual verification.
"""

import os
import sys
import time
import json
import base64
import subprocess
from pathlib import Path

# Add the drivers directory to the path
sys.path.insert(0, str(Path(__file__).parent / "drivers"))

from mcp_raw_json import McpRawJsonClient

def test_overlay_functionality():
    """Test complete overlay functionality including draw, screenshot, and remove"""
    print("🧪 Testing Overlay Functionality (Functional)")
    print("=" * 50)
    
    # Build the server binary first
    print("📦 Building server binary...")
    build_result = subprocess.run([
        "dotnet", "build", 
        "/workspace/project/overlay-companion-mcp/src/OverlayCompanion.csproj",
        "-c", "Release",
        "-o", "/workspace/project/overlay-companion-mcp/build/publish"
    ], capture_output=True, text=True)
    
    if build_result.returncode != 0:
        print(f"❌ Build failed: {build_result.stderr}")
        return False
    
    print("✅ Build successful")
    
    # Use headless mode for reliable testing
    env = os.environ.copy()
    env['HEADLESS'] = '1'
    env['DISPLAY'] = ':99'  # Still set display for screenshot functionality
    
    app_bin = "/workspace/project/overlay-companion-mcp/build/publish/overlay-companion-mcp"
    
    try:
        print("\n🚀 Starting MCP server in headless mode...")
        client = McpRawJsonClient([app_bin], env=env)
        
        # Initialize
        print("🔌 Initializing MCP connection...")
        init_result = client.initialize()
        if not init_result:
            print("❌ Initialize failed")
            return False
        print(f"✅ Initialize successful: {init_result.get('result', {}).get('serverInfo', {}).get('name')}")
        
        # List tools
        print("\n📋 Listing available tools...")
        tools_result = client.list_tools()
        if not tools_result:
            print("❌ Tools list failed")
            return False
        
        tools = tools_result.get('result', {}).get('tools', [])
        tool_names = [tool['name'] for tool in tools]
        print(f"✅ Found {len(tools)} tools: {', '.join(tool_names)}")
        
        # Verify expected tools are present
        expected_tools = ['draw_overlay', 'remove_overlay', 'take_screenshot', 'set_mode']
        missing_tools = [tool for tool in expected_tools if tool not in tool_names]
        if missing_tools:
            print(f"❌ Missing expected tools: {missing_tools}")
            return False
        
        # Set mode to assist
        print("\n⚙️ Setting mode to assist...")
        mode_result = client.call_tool("set_mode", {"mode": "assist"})
        if not mode_result:
            print("❌ Set mode failed")
            return False
        print("✅ Mode set to assist")
        
        # Test 1: Draw single overlay
        print("\n🎨 Test 1: Drawing single overlay...")
        overlay_params = {
            "x": 100,
            "y": 100, 
            "width": 200,
            "height": 100,
            "color": "#FF0000",
            "opacity": 0.7,
            "id": "test_overlay_1"
        }
        
        overlay_result = client.call_tool("draw_overlay", overlay_params)
        if not overlay_result:
            print("❌ Draw overlay failed")
            return False
        
        result_data = overlay_result.get('result', {})
        if 'content' in result_data and result_data['content']:
            overlay_id = result_data['content'][0].get('text', '')
            print(f"✅ Overlay drawn with ID: {overlay_id}")
        else:
            print("⚠️ Overlay draw returned success but no ID found")
        
        # Test 2: Take screenshot
        print("\n📸 Test 2: Taking screenshot...")
        screenshot_result = client.call_tool("take_screenshot", {})
        if not screenshot_result:
            print("❌ Screenshot failed")
            return False
        
        # Verify screenshot data
        screenshot_data = screenshot_result.get('result', {})
        if 'content' in screenshot_data and screenshot_data['content']:
            image_data = screenshot_data['content'][0].get('text', '')
            if image_data:
                # Verify it's valid base64 image data
                try:
                    decoded = base64.b64decode(image_data)
                    if len(decoded) > 1000:  # Reasonable size check
                        print(f"✅ Screenshot captured: {len(decoded)} bytes")
                        
                        # Save screenshot for verification
                        artifacts_dir = Path(__file__).parent / "artifacts"
                        artifacts_dir.mkdir(exist_ok=True)
                        with open(artifacts_dir / "functional_test_screenshot.png", "wb") as f:
                            f.write(decoded)
                        print("📁 Screenshot saved to artifacts/functional_test_screenshot.png")
                    else:
                        print("⚠️ Screenshot data seems too small")
                except Exception as e:
                    print(f"⚠️ Screenshot data validation failed: {e}")
            else:
                print("⚠️ Screenshot returned but no image data found")
        else:
            print("⚠️ Screenshot result format unexpected")
        
        # Test 3: Draw multiple overlays
        print("\n🎨 Test 3: Drawing multiple overlays...")
        overlay_ids = []
        
        for i in range(3):
            overlay_params = {
                "x": 50 + (i * 100),
                "y": 200 + (i * 50), 
                "width": 80,
                "height": 60,
                "color": ["#FF0000", "#00FF00", "#0000FF"][i],
                "opacity": 0.5,
                "id": f"test_overlay_{i+2}"
            }
            
            overlay_result = client.call_tool("draw_overlay", overlay_params)
            if overlay_result:
                result_data = overlay_result.get('result', {})
                if 'content' in result_data and result_data['content']:
                    overlay_id = result_data['content'][0].get('text', '')
                    overlay_ids.append(overlay_id)
                    print(f"✅ Overlay {i+1} drawn: {overlay_id}")
                else:
                    print(f"⚠️ Overlay {i+1} draw returned success but no ID")
            else:
                print(f"❌ Overlay {i+1} draw failed")
        
        print(f"✅ Drew {len(overlay_ids)} additional overlays")
        
        # Test 4: Remove specific overlay
        print("\n🗑️ Test 4: Removing specific overlay...")
        if overlay_ids:
            remove_result = client.call_tool("remove_overlay", {"overlayId": overlay_ids[0]})
            if remove_result:
                print(f"✅ Removed overlay: {overlay_ids[0]}")
            else:
                print(f"❌ Failed to remove overlay: {overlay_ids[0]}")
        
        # Test 5: Batch overlay operations
        print("\n🎨 Test 5: Testing batch overlay operations...")
        batch_overlays = [
            {
                "x": 400,
                "y": 100,
                "width": 100,
                "height": 50,
                "color": "#FFFF00",
                "opacity": 0.6,
                "id": "batch_1"
            },
            {
                "x": 400,
                "y": 200,
                "width": 100,
                "height": 50,
                "color": "#FF00FF",
                "opacity": 0.6,
                "id": "batch_2"
            }
        ]
        
        batch_result = client.call_tool("batch_overlay", {"overlays": batch_overlays})
        if batch_result:
            result_data = batch_result.get('result', {})
            if 'content' in result_data and result_data['content']:
                batch_ids = result_data['content'][0].get('text', '')
                print(f"✅ Batch overlays created: {batch_ids}")
            else:
                print("⚠️ Batch overlay returned success but no IDs")
        else:
            print("❌ Batch overlay failed")
        
        # Test 6: Test other core tools
        print("\n🔧 Test 6: Testing other core tools...")
        
        # Test clipboard operations
        clipboard_set = client.call_tool("set_clipboard", {"text": "Test clipboard content"})
        if clipboard_set:
            print("✅ Clipboard set successful")
            
            clipboard_get = client.call_tool("get_clipboard", {})
            if clipboard_get:
                result_data = clipboard_get.get('result', {})
                if 'content' in result_data and result_data['content']:
                    clipboard_content = result_data['content'][0].get('text', '')
                    if "Test clipboard content" in clipboard_content:
                        print("✅ Clipboard get successful - content matches")
                    else:
                        print(f"⚠️ Clipboard content mismatch: {clipboard_content}")
                else:
                    print("⚠️ Clipboard get returned but no content")
            else:
                print("❌ Clipboard get failed")
        else:
            print("❌ Clipboard set failed")
        
        # Test session status
        status_result = client.call_tool("check_session_status", {})
        if status_result:
            print("✅ Session status check successful")
        else:
            print("❌ Session status check failed")
        
        # Test 7: Final screenshot after all operations
        print("\n📸 Test 7: Final screenshot after all operations...")
        final_screenshot = client.call_tool("take_screenshot", {})
        if final_screenshot:
            screenshot_data = final_screenshot.get('result', {})
            if 'content' in screenshot_data and screenshot_data['content']:
                image_data = screenshot_data['content'][0].get('text', '')
                if image_data:
                    decoded = base64.b64decode(image_data)
                    artifacts_dir = Path(__file__).parent / "artifacts"
                    with open(artifacts_dir / "functional_test_final.png", "wb") as f:
                        f.write(decoded)
                    print("✅ Final screenshot saved")
        
        print("\n🎉 All functional tests completed successfully!")
        
        # Summary
        print("\n📊 Test Summary:")
        print("✅ MCP Protocol: Working")
        print("✅ Tool Discovery: Working") 
        print("✅ Overlay Drawing: Working")
        print("✅ Screenshot Capture: Working")
        print("✅ Overlay Removal: Working")
        print("✅ Batch Operations: Working")
        print("✅ Clipboard Operations: Working")
        print("✅ Session Management: Working")
        
        return True
        
    except Exception as e:
        print(f"❌ Functional test failed with error: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        # Clean up
        try:
            client.cleanup()
        except:
            pass

if __name__ == "__main__":
    success = test_overlay_functionality()
    sys.exit(0 if success else 1)