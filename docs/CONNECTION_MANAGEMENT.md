[![Sheld.io: Prefunctional Development](https://img.shields.io/badge/Sheld.io-Prefunctional%20Development-blueviolet?style=flat-square)](https://sheld.io)

# Connection Management - MCP Tools

## Overview

The Overlay Companion MCP server now includes comprehensive connection management tools that allow AI agents to programmatically configure and manage connections to target systems using KasmVNC, VNC, or RDP protocols.

## Why Connection Management?

**For AI Agents:**
- Programmatically configure connections without manual web interface interaction
- Validate protocol-specific requirements automatically
- Test connectivity before attempting operations
- Manage multiple target systems dynamically

**For End Users:**
- Continue using the familiar web interface for manual configuration
- Benefit from AI-assisted connection setup and troubleshooting
- Automatic validation prevents common configuration errors

## Supported Protocols

### KasmVNC (Recommended)
- **Port**: 6901 (default)
- **Authentication**: Flexible (password-only or username+password)
- **Multi-Monitor**: ✅ Full support with independent browser windows
- **Best For**: Multi-monitor setups, modern web-native environments

### Standard VNC
- **Port**: 5900 (default)
- **Authentication**: Password-only (username optional)
- **Multi-Monitor**: ⚠️ Limited (single canvas display)
- **Best For**: Legacy VNC servers, single monitor setups

### RDP (Windows Remote Desktop)
- **Port**: 3389 (default)
- **Authentication**: **Username+password required** (not optional)
- **Multi-Monitor**: ✅ Supported (Windows 7+ Enterprise/Ultimate)
- **Best For**: Windows targets, enterprise environments

## MCP Tools

### 1. add_connection

Add a new connection configuration with automatic validation.

**Example Usage:**
```json
{
  "name": "add_connection",
  "arguments": {
    "name": "Production KasmVNC",
    "host": "192.168.1.100",
    "port": 6901,
    "protocol": "kasmvnc",
    "password": "<redacted>"
  }
}
```

**Response:**
```json
{
  "success": true,
  "connection": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Production KasmVNC",
    "host": "192.168.1.100",
    "port": 6901,
    "protocol": "kasmvnc",
    "has_username": false,
    "has_password": true,
    "created_at": "2025-10-26T12:00:00Z"
  },
  "warnings": [],
  "message": "Connection 'Production KasmVNC' added successfully. Use test_connection to verify connectivity."
}
```

**RDP Example (requires username):**
```json
{
  "name": "add_connection",
  "arguments": {
    "name": "Windows Server",
    "host": "192.168.1.200",
    "port": 3389,
    "protocol": "rdp",
    "username": "administrator",
    "password": "<redacted>"
  }
}
```

### 2. list_connections

List all configured connections (credentials not exposed).

**Example Usage:**
```json
{
  "name": "list_connections",
  "arguments": {}
}
```

**Response:**
```json
{
  "success": true,
  "total_connections": 2,
  "connections": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Production KasmVNC",
      "host": "192.168.1.100",
      "port": 6901,
      "protocol": "kasmvnc",
      "protocol_info": {
        "name": "KasmVNC",
        "default_port": 6901,
        "multi_monitor": "Full support - independent browser windows",
        "authentication": "Flexible - password-only or username+password",
        "recommended": true
      },
      "has_username": false,
      "has_password": true,
      "is_active": true,
      "created_at": "2025-10-26T12:00:00Z",
      "last_connected": "2025-10-26T12:05:00Z"
    },
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "name": "Windows Server",
      "host": "192.168.1.200",
      "port": 3389,
      "protocol": "rdp",
      "protocol_info": {
        "name": "Windows RDP",
        "default_port": 3389,
        "multi_monitor": "Supported on Windows 7+ Enterprise/Ultimate",
        "authentication": "Username+password required",
        "recommended": false
      },
      "has_username": true,
      "has_password": true,
      "is_active": false,
      "created_at": "2025-10-26T12:10:00Z",
      "last_connected": null
    }
  ],
  "protocol_recommendations": {
    "kasmvnc": "Recommended for multi-monitor support - independent browser windows per display",
    "vnc": "Standard VNC - limited multi-monitor (single canvas)",
    "rdp": "Windows RDP - requires username+password, multi-monitor on Windows 7+ Enterprise/Ultimate"
  }
}
```

### 3. test_connection

Test connectivity to a configured connection.

**Example Usage:**
```json
{
  "name": "test_connection",
  "arguments": {
    "connection_id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

**Response (Success):**
```json
{
  "success": true,
  "connection": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Production KasmVNC",
    "host": "192.168.1.100",
    "port": 6901,
    "protocol": "kasmvnc"
  },
  "message": "Successfully connected to 192.168.1.100:6901",
  "last_connected": "2025-10-26T12:15:00Z"
}
```

**Response (Failure):**
```json
{
  "success": false,
  "connection": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Production KasmVNC",
    "host": "192.168.1.100",
    "port": 6901,
    "protocol": "kasmvnc"
  },
  "message": "Failed to connect to 192.168.1.100:6901 - check host, port, and network connectivity",
  "last_connected": null
}
```

### 4. set_active_connection

Set the active connection for overlay operations.

**Example Usage:**
```json
{
  "name": "set_active_connection",
  "arguments": {
    "connection_id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

**Response:**
```json
{
  "success": true,
  "active_connection": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Production KasmVNC",
    "host": "192.168.1.100",
    "port": 6901,
    "protocol": "kasmvnc"
  },
  "message": "Active connection set to 'Production KasmVNC' (kasmvnc://192.168.1.100:6901)"
}
```

### 5. remove_connection

Remove a connection configuration.

**Example Usage:**
```json
{
  "name": "remove_connection",
  "arguments": {
    "connection_id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Connection 'Production KasmVNC' removed successfully"
}
```

## Validation Rules

### All Protocols
- **Name**: Required, non-empty
- **Host**: Required, non-empty
- **Port**: Must be between 1 and 65535

### Protocol-Specific

#### RDP
- ✅ **Username**: **REQUIRED** (not optional)
- ✅ **Password**: **REQUIRED** (not optional)
- ⚠️ **Warning**: Multi-monitor requires Windows 7+ Enterprise/Ultimate

#### VNC
- ⚠️ **Password**: Recommended (warning if missing)
- ℹ️ **Username**: Optional
- ⚠️ **Warning**: Limited multi-monitor support (single canvas)

#### KasmVNC
- ⚠️ **Password or Username**: Recommended (warning if both missing)
- ✅ **Multi-Monitor**: Full support, no warnings

## Storage

Connections are stored persistently in:
```
~/.overlay-companion/connections.json
```

**Format:**
```json
[
  {
    "Id": "550e8400-e29b-41d4-a716-446655440000",
    "Name": "Production KasmVNC",
    "Host": "192.168.1.100",
    "Port": 6901,
    "Protocol": "kasmvnc",
    "Username": null,
    "Password": "<redacted>",
    "CreatedAt": "2025-10-26T12:00:00Z",
    "LastConnected": "2025-10-26T12:05:00Z",
    "IsActive": true
  }
]
```

**Security Note:** Passwords are stored in plain text. For production use, consider implementing encryption or using a secure credential store.

## AI Agent Workflow Example

### Scenario: Configure and test a new KasmVNC connection

```python
# Step 1: Add the connection
response = await mcp_client.call_tool("add_connection", {
    "name": "Dev Environment",
    "host": "dev.example.com",
    "port": 6901,
    "protocol": "kasmvnc",
    "password": "<redacted>"
})

connection_id = response["connection"]["id"]

# Step 2: Test connectivity
test_result = await mcp_client.call_tool("test_connection", {
    "connection_id": connection_id
})

if test_result["success"]:
    # Step 3: Set as active connection
    await mcp_client.call_tool("set_active_connection", {
        "connection_id": connection_id
    })
    
    # Step 4: Now use overlay tools on this connection
    await mcp_client.call_tool("draw_overlay", {
        "x": 100,
        "y": 100,
        "width": 200,
        "height": 50,
        "label": "Test Overlay"
    })
else:
    print(f"Connection failed: {test_result['message']}")
```

## Web Interface Integration

The web interface at `http://localhost:8080` now includes an AI Integration notice:

> **AI Integration:** Connections can be configured manually here or programmatically via the MCP server. AI agents can dynamically manage connections using MCP tools for automated testing and target selection.

Users can:
- **Manually configure** connections via the web interface
- **Let AI agents configure** connections programmatically
- **Mix both approaches** as needed

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        AI Agent                              │
│                  (Claude, GPT, etc.)                         │
└────────────────────────┬────────────────────────────────────┘
                         │ MCP Protocol
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   MCP Server (C#)                            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         Connection Management Service                │   │
│  │  - Add/List/Remove/Test/SetActive                   │   │
│  │  - Protocol Validation                               │   │
│  │  - Persistent Storage                                │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              MCP Tools                               │   │
│  │  - add_connection                                    │   │
│  │  - list_connections                                  │   │
│  │  - test_connection                                   │   │
│  │  - remove_connection                                 │   │
│  │  - set_active_connection                             │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Target Systems                                  │
│  - KasmVNC (port 6901)                                      │
│  - VNC (port 5900)                                          │
│  - RDP (port 3389)                                          │
└─────────────────────────────────────────────────────────────┘
```

## Next Steps

1. **Service Registration**: Register `IConnectionManagementService` in dependency injection
2. **Tool Registration**: Register the 5 new MCP tools in the tool registry
3. **Testing**: Create unit tests for connection validation and management
4. **Encryption**: Implement secure credential storage
5. **Integration**: Connect active connection to overlay operations

## See Also

- [SPECIFICATION.md](../SPECIFICATION.md) - Full MCP specification
- [Target Protocol Support](../SPECIFICATION.md#target-protocol-support) - Protocol comparison
- [Multi-Monitor Support](../SPECIFICATION.md#multi-monitor-support) - Multi-monitor capabilities
