# Task List

1. 🔄 Test overlay functionality with real display
Priority: Test draw_overlay and remove_overlay with actual display to verify visual functionality works before implementing missing tools.
2. ⏳ Implement proper screenshot verification
Add robust overlay detection in screenshots using image processing to verify overlays are actually drawn.
3. ⏳ Test complete workflow with real display environment
Run full MCP roundtrip in non-headless environment to verify overlay drawing, screenshot capture, and overlay removal work visually.
4. ⏳ Implement missing MCP tools: re_anchor_element and get_display_info
These tools are documented in spec but not implemented. Implement after confirming core functionality works.
5. ⏳ Update MCP_SPECIFICATION.md to match actual implementation
Found discrepancy: Spec documents 14 tools but only 13 are implemented. Update after testing current tools.
6. ⏳ Update SPECIFICATION.md transport information
Specification mentions HTTP as default but stdio transport is what actually works. Need to update transport documentation.
7. ⏳ Wire scenario-based testing from YAML files
Connect tests/ai-gui/scenarios/basic.yaml to feed test parameters and create comprehensive test scenarios.
8. ⏳ Document the working raw JSON client approach
Create documentation explaining why raw JSON client works vs official SDK, and provide usage examples.
9. ⏳ Optimize client for persistent connections
Current client uses fresh processes for each request. Consider implementing persistent connection mode for better performance.
10. ⏳ Enhance error handling and recovery
Add better error handling for network issues, server crashes, and invalid responses in the MCP client.

