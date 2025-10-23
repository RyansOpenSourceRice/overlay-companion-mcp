#!/usr/bin/env python3
"""
Comprehensive GUI Testing for Overlay Companion MCP using STDIO
Tests visual overlays, screenshots, mouse clicks, and keyboard input
"""

import json
import subprocess
import time
import base64
from pathlib import Path
import os

# Configuration
MCP_BINARY = "/workspace/overlay-companion-mcp/src/bin/Release/net8.0/linux-x64/overlay-companion-mcp"
TEST_RESULTS_DIR = Path("/workspace/gui_test_results")
TEST_RESULTS_DIR.mkdir(exist_ok=True)

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    RESET = '\033[0m'

def log(message, color=Colors.RESET):
    print(f"{color}{message}{Colors.RESET}")

class MCPClient:
    """Simple MCP client using STDIO"""
    
    def __init__(self):
        self.request_id = 0
        self.process = None
        
    def start(self):
        """Start the MCP server process"""
        env = os.environ.copy()
        env['DISPLAY'] = ':99'  # Use virtual display
        
        self.process = subprocess.Popen(
            [MCP_BINARY],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=0,
            env=env
        )
        
        # Wait for server to start
        time.sleep(2)
        
        # Initialize
        response = self.send_request("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "gui-test-client",
                "version": "1.0.0"
            }
        })
        
        if response and "result" in response:
            log("✅ MCP server initialized", Colors.GREEN)
            return True
        else:
            log(f"❌ Failed to initialize: {response}", Colors.RED)
            return False
    
    def send_request(self, method, params=None, timeout=10.0):
        """Send a request and get response"""
        if not self.process:
            log("❌ Process not started", Colors.RED)
            return None
            
        self.request_id += 1
        request = {
            "jsonrpc": "2.0",
            "id": self.request_id,
            "method": method,
            "params": params or {}
        }
        
        try:
            # Send request
            request_json = json.dumps(request) + "\n"
            self.process.stdin.write(request_json)
            self.process.stdin.flush()
            
            # Read response with timeout
            start_time = time.time()
            while time.time() - start_time < timeout:
                if self.process.poll() is not None:
                    stderr = self.process.stderr.read()
                    log(f"❌ Process exited: {stderr}", Colors.RED)
                    return None
                
                # Try to read a line
                response_line = self.process.stdout.readline()
                if response_line:
                    try:
                        response = json.loads(response_line.strip())
                        return response
                    except json.JSONDecodeError as e:
                        log(f"⚠️  Invalid JSON: {response_line[:100]}", Colors.YELLOW)
                        continue
                
                time.sleep(0.1)
            
            log(f"❌ Timeout waiting for response to {method}", Colors.RED)
            return None
            
        except Exception as e:
            log(f"❌ Request failed: {e}", Colors.RED)
            return None
    
    def call_tool(self, tool_name, arguments):
        """Call an MCP tool"""
        return self.send_request("tools/call", {
            "name": tool_name,
            "arguments": arguments
        })
    
    def stop(self):
        """Stop the MCP server"""
        if self.process:
            try:
                self.process.terminate()
                self.process.wait(timeout=5)
            except:
                self.process.kill()

def test_display_info(client):
    """Test 1: Get display information"""
    log("\n" + "="*60, Colors.BLUE)
    log("TEST 1: Get Display Information", Colors.BLUE)
    log("="*60, Colors.BLUE)
    
    result = client.call_tool("get_display_info", {})
    
    if result and "result" in result:
        content = result["result"].get("content", [])
        if content:
            display_info = json.loads(content[0]["text"])
            log(f"✅ Display Info Retrieved:", Colors.GREEN)
            log(f"   Resolution: {display_info.get('width')}x{display_info.get('height')}", Colors.GREEN)
            log(f"   Display: {display_info.get('display')}", Colors.GREEN)
            return True, display_info
    
    log(f"❌ Failed to get display info: {result}", Colors.RED)
    return False, None

def test_create_text_overlay(client):
    """Test 2: Create a text overlay"""
    log("\n" + "="*60, Colors.BLUE)
    log("TEST 2: Create Text Overlay", Colors.BLUE)
    log("="*60, Colors.BLUE)
    
    result = client.call_tool("create_overlay", {
        "id": "test_text_overlay",
        "x": 100,
        "y": 100,
        "width": 400,
        "height": 100,
        "content": "<div style='background: rgba(0,0,255,0.8); color: white; padding: 20px; font-size: 24px; border-radius: 10px;'>🎯 MCP GUI Test - Text Overlay</div>",
        "zIndex": 1000
    })
    
    if result and "result" in result:
        log("✅ Text overlay created successfully", Colors.GREEN)
        log("   ID: test_text_overlay", Colors.GREEN)
        log("   Position: (100, 100)", Colors.GREEN)
        log("   Size: 400x100", Colors.GREEN)
        return True
    
    log(f"❌ Failed to create text overlay: {result}", Colors.RED)
    return False

def test_take_screenshot(client):
    """Test 3: Take a screenshot"""
    log("\n" + "="*60, Colors.BLUE)
    log("TEST 3: Take Screenshot", Colors.BLUE)
    log("="*60, Colors.BLUE)
    
    result = client.call_tool("take_screenshot", {})
    
    if result and "result" in result:
        content = result["result"].get("content", [])
        if content and len(content) > 0:
            # Save screenshot
            screenshot_data = content[0].get("data", "")
            if screenshot_data:
                screenshot_path = TEST_RESULTS_DIR / "test_screenshot.png"
                with open(screenshot_path, "wb") as f:
                    f.write(base64.b64decode(screenshot_data))
                
                log("✅ Screenshot captured successfully", Colors.GREEN)
                log(f"   Saved to: {screenshot_path}", Colors.GREEN)
                log(f"   Size: {len(screenshot_data)} bytes (base64)", Colors.GREEN)
                return True, screenshot_path
    
    log(f"❌ Failed to capture screenshot: {result}", Colors.RED)
    return False, None

def test_mouse_click(client):
    """Test 4: Simulate mouse click"""
    log("\n" + "="*60, Colors.BLUE)
    log("TEST 4: Simulate Mouse Click", Colors.BLUE)
    log("="*60, Colors.BLUE)
    
    result = client.call_tool("click_at", {
        "x": 300,
        "y": 150,
        "button": "left"
    })
    
    if result and "result" in result:
        log("✅ Mouse click simulated successfully", Colors.GREEN)
        log("   Position: (300, 150)", Colors.GREEN)
        log("   Button: left", Colors.GREEN)
        return True
    
    log(f"❌ Failed to simulate mouse click: {result}", Colors.RED)
    return False

def test_keyboard_input(client):
    """Test 5: Simulate keyboard input"""
    log("\n" + "="*60, Colors.BLUE)
    log("TEST 5: Simulate Keyboard Input", Colors.BLUE)
    log("="*60, Colors.BLUE)
    
    result = client.call_tool("type_text", {
        "text": "Hello from MCP GUI Test!"
    })
    
    if result and "result" in result:
        log("✅ Keyboard input simulated successfully", Colors.GREEN)
        log("   Text: 'Hello from MCP GUI Test!'", Colors.GREEN)
        return True
    
    log(f"❌ Failed to simulate keyboard input: {result}", Colors.RED)
    return False

def test_clipboard_operations(client):
    """Test 6: Clipboard operations"""
    log("\n" + "="*60, Colors.BLUE)
    log("TEST 6: Clipboard Operations", Colors.BLUE)
    log("="*60, Colors.BLUE)
    
    # Set clipboard
    test_text = "MCP GUI Test Clipboard Content 🎯"
    set_result = client.call_tool("set_clipboard", {
        "content": test_text
    })
    
    if not set_result or "result" not in set_result:
        log(f"❌ Failed to set clipboard: {set_result}", Colors.RED)
        return False
    
    log("✅ Clipboard set successfully", Colors.GREEN)
    
    time.sleep(1)
    
    # Get clipboard
    get_result = client.call_tool("get_clipboard", {})
    
    if get_result and "result" in get_result:
        content = get_result["result"].get("content", [])
        if content:
            clipboard_text = json.loads(content[0]["text"])
            if clipboard_text.get("content") == test_text:
                log("✅ Clipboard retrieved successfully", Colors.GREEN)
                log(f"   Content matches: '{test_text}'", Colors.GREEN)
                return True
            else:
                log(f"❌ Clipboard content mismatch", Colors.RED)
                log(f"   Expected: '{test_text}'", Colors.RED)
                log(f"   Got: '{clipboard_text.get('content')}'", Colors.RED)
    
    log(f"❌ Failed to get clipboard: {get_result}", Colors.RED)
    return False

def test_remove_overlay(client):
    """Test 7: Remove overlay"""
    log("\n" + "="*60, Colors.BLUE)
    log("TEST 7: Remove Overlay", Colors.BLUE)
    log("="*60, Colors.BLUE)
    
    result = client.call_tool("remove_overlay", {
        "overlayId": "test_text_overlay"
    })
    
    if result and "result" in result:
        content = result["result"].get("content", [])
        if content:
            response = json.loads(content[0]["text"])
            if response.get("removed"):
                log("✅ Overlay removed successfully", Colors.GREEN)
                log("   ID: test_text_overlay", Colors.GREEN)
                return True
    
    log(f"❌ Failed to remove overlay: {result}", Colors.RED)
    return False

def main():
    """Run all GUI tests"""
    log("\n" + "="*80, Colors.BLUE)
    log("OVERLAY COMPANION MCP - COMPREHENSIVE GUI TESTING (STDIO)", Colors.BLUE)
    log("="*80, Colors.BLUE)
    log(f"\nMCP Binary: {MCP_BINARY}", Colors.BLUE)
    log(f"Results Directory: {TEST_RESULTS_DIR}", Colors.BLUE)
    log(f"Display: :99 (Xvfb)", Colors.BLUE)
    log(f"VNC Access: vnc://localhost:5900 (password: vncpass)", Colors.BLUE)
    log(f"Web VNC: http://localhost:6901", Colors.BLUE)
    
    # Create client
    client = MCPClient()
    
    try:
        # Start server
        if not client.start():
            log("\n❌ Failed to start MCP server", Colors.RED)
            return False
        
        tests = [
            ("Display Info", lambda: test_display_info(client)),
            ("Text Overlay", lambda: test_create_text_overlay(client)),
            ("Screenshot", lambda: test_take_screenshot(client)),
            ("Mouse Click", lambda: test_mouse_click(client)),
            ("Keyboard Input", lambda: test_keyboard_input(client)),
            ("Clipboard Ops", lambda: test_clipboard_operations(client)),
            ("Remove Overlay", lambda: test_remove_overlay(client))
        ]
        
        results = []
        
        for test_name, test_func in tests:
            try:
                result = test_func()
                if isinstance(result, tuple):
                    success = result[0]
                else:
                    success = result
                results.append((test_name, success))
                
                # Wait between tests to allow visual inspection
                time.sleep(2)
            except Exception as e:
                log(f"\n❌ Test '{test_name}' crashed: {e}", Colors.RED)
                import traceback
                traceback.print_exc()
                results.append((test_name, False))
        
        # Summary
        log("\n" + "="*80, Colors.BLUE)
        log("TEST SUMMARY", Colors.BLUE)
        log("="*80, Colors.BLUE)
        
        passed = sum(1 for _, success in results if success)
        total = len(results)
        
        for test_name, success in results:
            status = "✅ PASS" if success else "❌ FAIL"
            color = Colors.GREEN if success else Colors.RED
            log(f"{status} - {test_name}", color)
        
        log("\n" + "="*80, Colors.BLUE)
        log(f"Results: {passed}/{total} tests passed ({passed/total*100:.1f}%)", Colors.BLUE)
        
        if passed == total:
            log("🎉 ALL TESTS PASSED!", Colors.GREEN)
            grade = "A+"
        elif passed >= total * 0.9:
            log("✅ Excellent! Most tests passed", Colors.GREEN)
            grade = "A"
        elif passed >= total * 0.7:
            log("⚠️  Good, but some tests failed", Colors.YELLOW)
            grade = "B"
        else:
            log("❌ Many tests failed", Colors.RED)
            grade = "C"
        
        log(f"Overall Grade: {grade}", Colors.BLUE)
        log("="*80, Colors.BLUE)
        
        log("\n📝 To view the visual results:", Colors.BLUE)
        log("   1. Connect to VNC: vnc://localhost:5900 (password: vncpass)", Colors.BLUE)
        log("   2. Or open web VNC: http://localhost:6901", Colors.BLUE)
        log("   3. Check screenshots in: /workspace/gui_test_results/", Colors.BLUE)
        
        return passed == total
        
    finally:
        client.stop()

if __name__ == "__main__":
    try:
        success = main()
        exit(0 if success else 1)
    except KeyboardInterrupt:
        log("\n\n⚠️  Tests interrupted by user", Colors.YELLOW)
        exit(130)
    except Exception as e:
        log(f"\n\n❌ Fatal error: {e}", Colors.RED)
        import traceback
        traceback.print_exc()
        exit(1)
