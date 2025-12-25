[![Sheld.io: Prefunctional Development](https://img.shields.io/badge/Sheld.io-Prefunctional%20Development-blueviolet?style=flat-square)](https://sheld.io)

# Setup Troubleshooting Guide

This guide helps resolve common issues with the Overlay Companion MCP setup process.

## Common Issues and Solutions

### Issue: "missing files: infra/kasmvnc-compose.yml"

**Symptoms:**
- Setup script fails with `CRITICAL:podman_compose:missing files: ['infra/kasmvnc-compose.yml']`
- Error occurs after "Building containers from source..." message

**Root Cause:**
The setup script couldn't properly copy repository files to the configuration directory.

**Solution:**
This issue has been fixed in the latest version of `host-setup-kasmvnc.sh`. The script now:
- Automatically detects if you're running from a downloaded directory vs git clone
- Intelligently copies all necessary files to the config directory
- Validates that critical files are present before proceeding
- Provides clear error messages if files are missing

**If you still encounter this issue:**

1. **Use debug mode** to see what's happening:
   ```bash
   ./host-setup-kasmvnc.sh --debug
   ```

2. **Verify you have all files**:
   ```bash
   ls -la infra/kasmvnc-compose.yml
   ```

3. **Clean start** (remove any corrupted config):
   ```bash
   rm -rf ~/.config/overlay-companion-mcp
   ./host-setup-kasmvnc.sh
   ```

### Issue: Git repository errors

**Symptoms:**
- "fatal: not a git repository" warnings
- "Failed to update repository" messages

**Root Cause:**
You downloaded the repository as a ZIP file instead of using git clone.

**Solution:**
This is now handled automatically. The script detects non-git directories and copies files directly instead of trying git operations.

### Issue: Port conflicts

**Symptoms:**
- "Port 8080 is already in use" messages
- Services fail to start

**Solution:**
The script automatically detects port conflicts and offers alternatives:
```bash
# Specify a custom port
OVERLAY_COMPANION_PORT=8081 ./host-setup-kasmvnc.sh

# Or use the interactive selection when prompted
```

## Debug Mode

For troubleshooting setup issues, use debug mode:

```bash
./host-setup-kasmvnc.sh --debug
```

This provides verbose output showing:
- File paths being used
- Copy operations in progress
- Directory contents at each step
- Detailed error information

## Getting Help

If you continue to experience issues:

1. **Check the logs**:
   ```bash
   tail -f /tmp/overlay-companion-mcp-kasmvnc-setup.log
   ```

2. **Verify system requirements**:
   - Podman installed and running
   - podman-compose available
   - Sufficient disk space
   - Network connectivity

3. **Clean installation**:
   ```bash
   # Remove any existing setup
   rm -rf ~/.config/overlay-companion-mcp
   
   # Start fresh
   ./host-setup-kasmvnc.sh --debug
   ```

## Recent Fixes

**Version: Latest (2024-08-30)**
- ✅ Fixed repository detection for downloaded directories
- ✅ Added intelligent file copying with validation
- ✅ Improved error messages with specific file paths
- ✅ Added debug mode for troubleshooting
- ✅ Enhanced validation before container operations
- ✅ Better handling of corrupted config directories

These fixes resolve the most common setup failures and ensure a smooth experience for future users.