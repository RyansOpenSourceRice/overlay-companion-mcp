#!/usr/bin/env python3
"""
Comprehensive GUI Testing for Overlay Companion MCP
Tests visual overlays, screenshots, mouse clicks, and keyboard input
"""

import base64
import json
import time
from pathlib import Path

import requests

# Configuration
MCP_SERVER_URL = "http://localhost:3000/mcp"
TEST_RESULTS_DIR = Path("/workspace/gui_test_results")
TEST_RESULTS_DIR.mkdir(exist_ok=True)


class Colors:
    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    RESET = "\033[0m"


def log(message, color=Colors.RESET):
    print(f"{color}{message}{Colors.RESET}")


def send_mcp_request(method, params=None):
    """Send an MCP request via SSE"""
    payload = {
        "jsonrpc": "2.0",
        "id": int(time.time() * 1000),
        "method": method,
        "params": params or {},
    }

    try:
        response = requests.post(
            MCP_SERVER_URL,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=10,
        )

        if response.status_code == 200:
            return response.json()
        else:
            log(f"HTTP Error {response.status_code}: {response.text}", Colors.RED)
            return None
    except Exception as e:
        log(f"Request failed: {e}", Colors.RED)
        return None


def test_display_info():
    """Test 1: Get display information"""
    log("\n" + "=" * 60, Colors.BLUE)
    log("TEST 1: Get Display Information", Colors.BLUE)
    log("=" * 60, Colors.BLUE)

    result = send_mcp_request(
        "tools/call", {"name": "get_display_info", "arguments": {}}
    )

    if result and "result" in result:
        content = result["result"]["content"]
        if content:
            display_info = json.loads(content[0]["text"])
            log("✅ Display Info Retrieved:", Colors.GREEN)
            log(
                f"   Resolution: {display_info.get('width')}x{display_info.get('height')}",
                Colors.GREEN,
            )
            log(f"   Display: {display_info.get('display')}", Colors.GREEN)
            return True, display_info

    log("❌ Failed to get display info", Colors.RED)
    return False, None


def test_create_text_overlay():
    """Test 2: Create a text overlay"""
    log("\n" + "=" * 60, Colors.BLUE)
    log("TEST 2: Create Text Overlay", Colors.BLUE)
    log("=" * 60, Colors.BLUE)

    result = send_mcp_request(
        "tools/call",
        {
            "name": "create_overlay",
            "arguments": {
                "id": "test_text_overlay",
                "x": 100,
                "y": 100,
                "width": 400,
                "height": 100,
                "content": "<div style='background: rgba(0,0,255,0.8); color: white; padding: 20px; font-size: 24px; border-radius: 10px;'>🎯 MCP GUI Test - Text Overlay</div>",
                "zIndex": 1000,
            },
        },
    )

    if result and "result" in result:
        log("✅ Text overlay created successfully", Colors.GREEN)
        log("   ID: test_text_overlay", Colors.GREEN)
        log("   Position: (100, 100)", Colors.GREEN)
        log("   Size: 400x100", Colors.GREEN)
        return True

    log("❌ Failed to create text overlay", Colors.RED)
    return False


def test_create_image_overlay():
    """Test 3: Create an image overlay with SVG"""
    log("\n" + "=" * 60, Colors.BLUE)
    log("TEST 3: Create Image Overlay (SVG)", Colors.BLUE)
    log("=" * 60, Colors.BLUE)

    svg_content = """
    <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
        <circle cx="100" cy="100" r="80" fill="red" opacity="0.7"/>
        <text x="100" y="110" text-anchor="middle" fill="white" font-size="20">TEST</text>
    </svg>
    """

    result = send_mcp_request(
        "tools/call",
        {
            "name": "create_overlay",
            "arguments": {
                "id": "test_image_overlay",
                "x": 600,
                "y": 100,
                "width": 200,
                "height": 200,
                "content": svg_content,
                "zIndex": 1001,
            },
        },
    )

    if result and "result" in result:
        log("✅ Image overlay created successfully", Colors.GREEN)
        log("   ID: test_image_overlay", Colors.GREEN)
        log("   Position: (600, 100)", Colors.GREEN)
        log("   Type: SVG Circle", Colors.GREEN)
        return True

    log("❌ Failed to create image overlay", Colors.RED)
    return False


def test_batch_overlays():
    """Test 4: Create multiple overlays at once"""
    log("\n" + "=" * 60, Colors.BLUE)
    log("TEST 4: Batch Create Overlays", Colors.BLUE)
    log("=" * 60, Colors.BLUE)

    overlays = []
    for i in range(5):
        overlays.append(
            {
                "id": f"batch_overlay_{i}",
                "x": 100 + (i * 120),
                "y": 300,
                "width": 100,
                "height": 100,
                "content": f"<div style='background: rgba({50*i}, {100+30*i}, {200-30*i}, 0.8); color: white; padding: 10px; text-align: center; font-size: 16px; border-radius: 5px;'>Box {i+1}</div>",
                "zIndex": 1002 + i,
            }
        )

    result = send_mcp_request(
        "tools/call", {"name": "batch_overlay", "arguments": {"overlays": overlays}}
    )

    if result and "result" in result:
        log(f"✅ Created {len(overlays)} overlays in batch", Colors.GREEN)
        for i in range(len(overlays)):
            log(f"   - batch_overlay_{i} at ({100 + i*120}, 300)", Colors.GREEN)
        return True

    log("❌ Failed to create batch overlays", Colors.RED)
    return False


def test_draw_overlay():
    """Test 5: Draw shapes on overlay"""
    log("\n" + "=" * 60, Colors.BLUE)
    log("TEST 5: Draw Shapes on Overlay", Colors.BLUE)
    log("=" * 60, Colors.BLUE)

    # First create a canvas overlay
    canvas_result = send_mcp_request(
        "tools/call",
        {
            "name": "create_overlay",
            "arguments": {
                "id": "draw_canvas",
                "x": 100,
                "y": 500,
                "width": 600,
                "height": 400,
                "content": "<canvas id='test_canvas' width='600' height='400' style='background: rgba(255,255,255,0.9); border: 2px solid black;'></canvas>",
                "zIndex": 2000,
            },
        },
    )

    if not canvas_result or "result" not in canvas_result:
        log("❌ Failed to create canvas overlay", Colors.RED)
        return False

    time.sleep(1)

    # Now draw on it
    draw_commands = [
        {"type": "rect", "x": 50, "y": 50, "width": 100, "height": 100, "color": "red"},
        {"type": "circle", "x": 250, "y": 100, "radius": 50, "color": "blue"},
        {
            "type": "line",
            "x1": 350,
            "y1": 50,
            "x2": 450,
            "y2": 150,
            "color": "green",
            "width": 5,
        },
        {
            "type": "text",
            "x": 50,
            "y": 250,
            "text": "GUI Test Drawing",
            "color": "black",
            "size": 24,
        },
    ]

    result = send_mcp_request(
        "tools/call",
        {
            "name": "draw_overlay",
            "arguments": {"overlayId": "draw_canvas", "commands": draw_commands},
        },
    )

    if result and "result" in result:
        log("✅ Drew shapes on canvas overlay", Colors.GREEN)
        log(f"   - {len(draw_commands)} drawing commands executed", Colors.GREEN)
        return True

    log("❌ Failed to draw on overlay", Colors.RED)
    return False


def test_take_screenshot():
    """Test 6: Take a screenshot"""
    log("\n" + "=" * 60, Colors.BLUE)
    log("TEST 6: Take Screenshot", Colors.BLUE)
    log("=" * 60, Colors.BLUE)

    result = send_mcp_request(
        "tools/call", {"name": "take_screenshot", "arguments": {}}
    )

    if result and "result" in result:
        content = result["result"]["content"]
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

    log("❌ Failed to capture screenshot", Colors.RED)
    return False, None


def test_mouse_click():
    """Test 7: Simulate mouse click"""
    log("\n" + "=" * 60, Colors.BLUE)
    log("TEST 7: Simulate Mouse Click", Colors.BLUE)
    log("=" * 60, Colors.BLUE)

    # Click at the center of the first text overlay
    result = send_mcp_request(
        "tools/call",
        {"name": "click_at", "arguments": {"x": 300, "y": 150, "button": "left"}},
    )

    if result and "result" in result:
        log("✅ Mouse click simulated successfully", Colors.GREEN)
        log("   Position: (300, 150)", Colors.GREEN)
        log("   Button: left", Colors.GREEN)
        return True

    log("❌ Failed to simulate mouse click", Colors.RED)
    return False


def test_keyboard_input():
    """Test 8: Simulate keyboard input"""
    log("\n" + "=" * 60, Colors.BLUE)
    log("TEST 8: Simulate Keyboard Input", Colors.BLUE)
    log("=" * 60, Colors.BLUE)

    result = send_mcp_request(
        "tools/call",
        {"name": "type_text", "arguments": {"text": "Hello from MCP GUI Test!"}},
    )

    if result and "result" in result:
        log("✅ Keyboard input simulated successfully", Colors.GREEN)
        log("   Text: 'Hello from MCP GUI Test!'", Colors.GREEN)
        return True

    log("❌ Failed to simulate keyboard input", Colors.RED)
    return False


def test_clipboard_operations():
    """Test 9: Clipboard operations"""
    log("\n" + "=" * 60, Colors.BLUE)
    log("TEST 9: Clipboard Operations", Colors.BLUE)
    log("=" * 60, Colors.BLUE)

    # Set clipboard
    test_text = "MCP GUI Test Clipboard Content 🎯"
    set_result = send_mcp_request(
        "tools/call", {"name": "set_clipboard", "arguments": {"content": test_text}}
    )

    if not set_result or "result" not in set_result:
        log("❌ Failed to set clipboard", Colors.RED)
        return False

    log("✅ Clipboard set successfully", Colors.GREEN)

    time.sleep(1)

    # Get clipboard
    get_result = send_mcp_request(
        "tools/call", {"name": "get_clipboard", "arguments": {}}
    )

    if get_result and "result" in get_result:
        content = get_result["result"]["content"]
        if content:
            clipboard_text = json.loads(content[0]["text"])
            if clipboard_text.get("content") == test_text:
                log("✅ Clipboard retrieved successfully", Colors.GREEN)
                log(f"   Content matches: '{test_text}'", Colors.GREEN)
                return True
            else:
                log("❌ Clipboard content mismatch", Colors.RED)
                log(f"   Expected: '{test_text}'", Colors.RED)
                log(f"   Got: '{clipboard_text.get('content')}'", Colors.RED)

    log("❌ Failed to get clipboard", Colors.RED)
    return False


def test_remove_overlays():
    """Test 10: Remove overlays"""
    log("\n" + "=" * 60, Colors.BLUE)
    log("TEST 10: Remove Overlays", Colors.BLUE)
    log("=" * 60, Colors.BLUE)

    overlays_to_remove = [
        "test_text_overlay",
        "test_image_overlay",
        "batch_overlay_0",
        "batch_overlay_1",
        "batch_overlay_2",
        "batch_overlay_3",
        "batch_overlay_4",
        "draw_canvas",
    ]

    success_count = 0
    for overlay_id in overlays_to_remove:
        result = send_mcp_request(
            "tools/call", {"name": "remove_overlay", "arguments": {"id": overlay_id}}
        )

        if result and "result" in result:
            success_count += 1

    if success_count == len(overlays_to_remove):
        log(f"✅ Removed all {success_count} overlays successfully", Colors.GREEN)
        return True
    else:
        log(
            f"⚠️  Removed {success_count}/{len(overlays_to_remove)} overlays",
            Colors.YELLOW,
        )
        return False


def main():
    """Run all GUI tests"""
    log("\n" + "=" * 80, Colors.BLUE)
    log("OVERLAY COMPANION MCP - COMPREHENSIVE GUI TESTING", Colors.BLUE)
    log("=" * 80, Colors.BLUE)
    log(f"\nMCP Server: {MCP_SERVER_URL}", Colors.BLUE)
    log(f"Results Directory: {TEST_RESULTS_DIR}", Colors.BLUE)
    log("VNC Access: vnc://localhost:5900 (password: vncpass)", Colors.BLUE)
    log("Web VNC: http://localhost:6901", Colors.BLUE)

    tests = [
        ("Display Info", test_display_info),
        ("Text Overlay", test_create_text_overlay),
        ("Image Overlay", test_create_image_overlay),
        ("Batch Overlays", test_batch_overlays),
        ("Draw Shapes", test_draw_overlay),
        ("Screenshot", test_take_screenshot),
        ("Mouse Click", test_mouse_click),
        ("Keyboard Input", test_keyboard_input),
        ("Clipboard Ops", test_clipboard_operations),
        ("Remove Overlays", test_remove_overlays),
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
            results.append((test_name, False))

    # Summary
    log("\n" + "=" * 80, Colors.BLUE)
    log("TEST SUMMARY", Colors.BLUE)
    log("=" * 80, Colors.BLUE)

    passed = sum(1 for _, success in results if success)
    total = len(results)

    for test_name, success in results:
        status = "✅ PASS" if success else "❌ FAIL"
        color = Colors.GREEN if success else Colors.RED
        log(f"{status} - {test_name}", color)

    log("\n" + "=" * 80, Colors.BLUE)
    log(
        f"Results: {passed}/{total} tests passed ({passed/total*100:.1f}%)", Colors.BLUE
    )

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
    log("=" * 80, Colors.BLUE)

    log("\n📝 To view the visual results:", Colors.BLUE)
    log("   1. Connect to VNC: vnc://localhost:5900 (password: vncpass)", Colors.BLUE)
    log("   2. Or open web VNC: http://localhost:6901", Colors.BLUE)
    log("   3. Check screenshots in: /workspace/gui_test_results/", Colors.BLUE)

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
