#!/usr/bin/env python3
"""
Comprehensive GUI Testing for Overlay Companion MCP using Streamable HTTP
Tests visual overlays, screenshots, mouse clicks, and keyboard input

Uses the modern Streamable HTTP transport (replaced SSE in March 2025)
"""

import json
import requests
import time
import base64
from pathlib import Path

# Configuration
MCP_URL = "http://localhost:3000/mcp"  # Streamable HTTP endpoint
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

class MCPStreamableHTTPClient:
    """MCP client using Streamable HTTP transport (2025-03-26 spec)"""
    
    def __init__(self, url):
        self.url = url
        self.request_id = 0
        self.session_id = None
        self.session = requests.Session()
        
    def _get_next_id(self):
        """Get next request ID"""
        self.request_id += 1
        return self.request_id
    
    def _send_request(self, method, params=None):
        """Send a Streamable HTTP request"""
        request = {
            "jsonrpc": "2.0",
            "id": self._get_next_id(),
            "method": method,
            "params": params or {}
        }
        
        headers = {
            "Content-Type": "application/json",
            "MCP-Protocol-Version": "2025-03-26"  # Streamable HTTP version
        }
        
        if self.session_id:
            headers["MCP-Session-Id"] = self.session_id
        
        try:
            response = self.session.post(
                self.url,
                json=request,
                headers=headers,
                timeout=30
            )
            
            # Extract session ID from response headers
            if "MCP-Session-Id" in response.headers and not self.session_id:
                self.session_id = response.headers["MCP-Session-Id"]
                log(f"📝 Session ID: {self.session_id}", Colors.BLUE)
            
            if response.status_code == 200:
                return response.json()
            else:
                log(f"❌ HTTP {response.status_code}: {response.text}", Colors.RED)
                return None
                
        except Exception as e:
            log(f"❌ Request failed: {e}", Colors.RED)
            return None
    
    def initialize(self):
        """Initialize the MCP connection"""
        response = self._send_request("initialize", {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {
                "name": "gui-test-streamable-http",
                "version": "1.0.0"
            }
        })
        
        if response and "result" in response:
            log("✅ MCP server initialized (Streamable HTTP)", Colors.GREEN)
            return True
        else:
            log(f"❌ Failed to initialize: {response}", Colors.RED)
            return False
    
    def call_tool(self, tool_name, arguments):
        """Call an MCP tool"""
        return self._send_request("tools/call", {
            "name": tool_name,
            "arguments": arguments
        })

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
        "id": "test_text_overlay_http",
        "x": 150,
        "y": 150,
        "width": 500,
        "height": 120,
        "content": "<div style='background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; font-size: 28px; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.3);'>🚀 MCP Streamable HTTP Test</div>",
        "zIndex": 1000
    })
    
    if result and "result" in result:
        log("✅ Text overlay created successfully", Colors.GREEN)
        log("   ID: test_text_overlay_http", Colors.GREEN)
        log("   Position: (150, 150)", Colors.GREEN)
        log("   Size: 500x120", Colors.GREEN)
        log("   Transport: Streamable HTTP", Colors.GREEN)
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
            screenshot_json = json.loads(content[0]["text"])
            screenshot_data = screenshot_json.get("image_base64", "")
            
            if screenshot_data:
                screenshot_path = TEST_RESULTS_DIR / "test_screenshot_http.png"
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
        "x": 400,
        "y": 200,
        "button": "left"
    })
    
    if result and "result" in result:
        log("✅ Mouse click simulated successfully", Colors.GREEN)
        log("   Position: (400, 200)", Colors.GREEN)
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
        "text": "Streamable HTTP is the modern MCP transport! 🎉"
    })
    
    if result and "result" in result:
        log("✅ Keyboard input simulated successfully", Colors.GREEN)
        log("   Text: 'Streamable HTTP is the modern MCP transport! 🎉'", Colors.GREEN)
        return True
    
    log(f"❌ Failed to simulate keyboard input: {result}", Colors.RED)
    return False

def test_remove_overlay(client):
    """Test 6: Remove overlay"""
    log("\n" + "="*60, Colors.BLUE)
    log("TEST 6: Remove Overlay", Colors.BLUE)
    log("="*60, Colors.BLUE)
    
    result = client.call_tool("remove_overlay", {
        "overlayId": "test_text_overlay_http"
    })
    
    if result and "result" in result:
        content = result["result"].get("content", [])
        if content and content[0].get("text"):
            response = json.loads(content[0]["text"])
            if response.get("removed"):
                log("✅ Overlay removed successfully", Colors.GREEN)
                log("   ID: test_text_overlay_http", Colors.GREEN)
                return True
    
    log(f"❌ Failed to remove overlay: {result}", Colors.RED)
    return False

def main():
    """Run all GUI tests using Streamable HTTP"""
    log("\n" + "="*80, Colors.BLUE)
    log("OVERLAY COMPANION MCP - GUI TESTING (STREAMABLE HTTP)", Colors.BLUE)
    log("="*80, Colors.BLUE)
    log(f"\nMCP Endpoint: {MCP_URL}", Colors.BLUE)
    log(f"Protocol Version: 2025-03-26 (Streamable HTTP)", Colors.BLUE)
    log(f"Results Directory: {TEST_RESULTS_DIR}", Colors.BLUE)
    log(f"Display: :99 (Xvfb)", Colors.BLUE)
    log(f"VNC Access: vnc://localhost:5900 (password: vncpass)", Colors.BLUE)
    log(f"Web VNC: http://localhost:6901", Colors.BLUE)
    
    # Create client
    client = MCPStreamableHTTPClient(MCP_URL)
    
    # Initialize
    if not client.initialize():
        log("\n❌ Failed to initialize MCP client", Colors.RED)
        return False
    
    tests = [
        ("Display Info", lambda: test_display_info(client)),
        ("Text Overlay", lambda: test_create_text_overlay(client)),
        ("Screenshot", lambda: test_take_screenshot(client)),
        ("Mouse Click", lambda: test_mouse_click(client)),
        ("Keyboard Input", lambda: test_keyboard_input(client)),
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
            
            # Wait between tests
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
    
    log("\n🔧 Transport Information:", Colors.BLUE)
    log("   Protocol: Streamable HTTP (MCP 2025-03-26)", Colors.BLUE)
    log("   Replaced: HTTP+SSE (deprecated March 2025)", Colors.BLUE)
    log("   Benefits: Single endpoint, better resumability, stateless support", Colors.BLUE)
    
    return passed == total

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
