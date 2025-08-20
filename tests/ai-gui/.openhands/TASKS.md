# Task List

1. ✅ Investigate current multi-monitor support
COMPLETED: Found TODO comments in ScreenCaptureService.cs - multi-monitor planned but not implemented. Added to roadmap as HIGH priority.
2. ✅ Evaluate HTTP transport implementation impact
COMPLETED: HTTP bridge exists but needs native HTTP transport. Won't destroy existing work - can add alongside STDIO. ModelContextProtocol.AspNetCore package already included.
3. ✅ Document HTTP transport requirements in specification
COMPLETED: Updated MCP_SPECIFICATION.md with HTTP transport status and roadmap. Created comprehensive ROADMAP.md with implementation priorities.
4. ✅ Add multi-monitor support to future roadmap
COMPLETED: Added multi-monitor as HIGH priority in ROADMAP.md and updated specification to reflect current limitations and planned features.
5. ⏳ Implement missing MCP tools: re_anchor_element and get_display_info
HIGH PRIORITY: These tools are documented in spec but not implemented. get_display_info overlaps with multi-monitor support.
6. ⏳ Implement native HTTP transport using ModelContextProtocol.AspNetCore
HIGH PRIORITY: Replace HTTP bridge with native HTTP transport for multi-client support, streaming, and web integration.
7. 🔄 Update MCP_SPECIFICATION.md to match actual implementation
Updated HTTP transport and multi-monitor sections. Still need to update tool count and missing tools documentation.
8. ⏳ Wire scenario-based testing from YAML files
Connect tests/ai-gui/scenarios/basic.yaml to feed test parameters and create comprehensive test scenarios.
9. ⏳ Document the working raw JSON client approach
Create documentation explaining why raw JSON client works vs official SDK, and provide usage examples.
10. ⏳ Clean up temporary test files
Remove debug and test files that are no longer needed

