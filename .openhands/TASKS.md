# Task List

1. ✅ Fix Avalonia AppBuilder double initialization error
Added thread-safe initialization check and made HTTP default transport
2. ✅ Deprecate STDIO transport and make HTTP the primary transport
HTTP is now default, STDIO requires --stdio flag, updated logging messages
3. ✅ Update all markdown files to reflect STDIO deprecation
Updated README.md, SPECIFICATION.md, MCP_SPECIFICATION.md, ROADMAP.md with HTTP-first approach
4. ✅ Update usage examples and configuration to use HTTP transport
All configuration examples now show HTTP transport as primary with STDIO as deprecated legacy option
5. ✅ Test the fixed AppImage with HTTP transport
AppImage works perfectly with HTTP transport as default, no more Avalonia errors

