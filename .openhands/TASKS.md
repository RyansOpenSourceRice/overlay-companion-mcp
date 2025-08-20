# Task List

1. 🔄 Investigate current multi-monitor support
Check if current implementation supports multiple monitors or if this needs to be added to future roadmap
2. ⏳ Evaluate HTTP transport implementation impact
Assess if switching from STDIO to HTTP would destroy existing work or can be added alongside
3. ⏳ Document HTTP transport requirements in specification
Update specification files to document HTTP transport needs and implementation approach
4. ⏳ Implement missing MCP tools: re_anchor_element and get_display_info
HIGH PRIORITY: These tools are documented in spec but not implemented. Core system proven working, now add missing functionality to complete specification.
5. ⏳ Add multi-monitor support to future roadmap
Document multi-monitor requirements and implementation plan for future development
6. ⏳ Update MCP_SPECIFICATION.md to match actual implementation
Update spec to reflect 13 actual tools and note that 2 tools need implementation
7. ⏳ Wire scenario-based testing from YAML files
Connect tests/ai-gui/scenarios/basic.yaml to feed test parameters and create comprehensive test scenarios.
8. ⏳ Document the working raw JSON client approach
Create documentation explaining why raw JSON client works vs official SDK, and provide usage examples.
9. ⏳ Optimize client for persistent connections
Current client uses fresh processes for each request. Consider implementing persistent connection mode for better performance.
10. ⏳ Clean up temporary test files
Remove debug and test files that are no longer needed

