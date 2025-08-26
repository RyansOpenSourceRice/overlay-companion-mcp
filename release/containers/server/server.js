#!/usr/bin/env node

/**
 * Overlay Companion MCP - Management Server
 * 
 * This server provides:
 * - Web interface with Guacamole integration
 * - MCP WebSocket bridge for overlay broadcasting
 * - Static file serving for frontend assets
 * - Health monitoring and status endpoints
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs').promises;
const { createProxyMiddleware } = require('http-proxy-middleware');

// Configuration
const config = {
  projectName: process.env.PROJECT_NAME || 'overlay-companion-mcp',
  bindAddress: process.env.BIND_ADDRESS || '0.0.0.0',
  httpPort: parseInt(process.env.HTTP_PORT) || 8080,
  wsPort: parseInt(process.env.WS_PORT) || 8081,
  guacamoleUrl: process.env.GUACAMOLE_URL || 'http://localhost:8080',
  mcpWsEnabled: process.env.MCP_WS_ENABLED === 'true',
  nodeEnv: process.env.NODE_ENV || 'development'
};

// Logging utility
const log = {
  info: (msg, ...args) => console.log(`[INFO] ${new Date().toISOString()} ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[WARN] ${new Date().toISOString()} ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`, ...args),
  debug: (msg, ...args) => {
    if (config.nodeEnv === 'development') {
      console.debug(`[DEBUG] ${new Date().toISOString()} ${msg}`, ...args);
    }
  }
};

// Express app setup
const app = express();
const server = http.createServer(app);

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Request logging
app.use((req, res, next) => {
  log.debug(`${req.method} ${req.path}`, { 
    ip: req.ip, 
    userAgent: req.get('User-Agent') 
  });
  next();
});

// WebSocket server for MCP overlay broadcasting
let wss = null;
const overlayClients = new Set();

if (config.mcpWsEnabled) {
  wss = new WebSocket.Server({ 
    server,
    path: '/ws',
    clientTracking: true
  });
  
  wss.on('connection', (ws, req) => {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    overlayClients.add(ws);
    
    log.info(`WebSocket client connected: ${clientId}`, {
      ip: req.socket.remoteAddress,
      userAgent: req.headers['user-agent']
    });
    
    // Send welcome message
    ws.send(JSON.stringify({
      type: 'welcome',
      clientId,
      timestamp: new Date().toISOString(),
      message: 'Connected to Overlay Companion MCP WebSocket'
    }));
    
    // Handle messages from client
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        log.debug(`WebSocket message from ${clientId}:`, message);
        
        // Handle different message types
        switch (message.type) {
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
            break;
            
          case 'overlay_command':
            // Broadcast overlay command to all clients
            broadcastOverlay(message.payload, clientId);
            break;
            
          case 'viewport_update':
            // Handle viewport configuration updates
            handleViewportUpdate(message.payload, clientId);
            break;
            
          default:
            log.warn(`Unknown message type from ${clientId}:`, message.type);
        }
      } catch (error) {
        log.error(`Error processing WebSocket message from ${clientId}:`, error);
      }
    });
    
    // Handle client disconnect
    ws.on('close', (code, reason) => {
      overlayClients.delete(ws);
      log.info(`WebSocket client disconnected: ${clientId}`, { code, reason: reason.toString() });
    });
    
    // Handle errors
    ws.on('error', (error) => {
      log.error(`WebSocket error for ${clientId}:`, error);
      overlayClients.delete(ws);
    });
  });
  
  log.info(`WebSocket server enabled on path /ws`);
}

// Broadcast overlay command to all connected clients
function broadcastOverlay(payload, excludeClientId = null) {
  const message = JSON.stringify({
    type: 'overlay_broadcast',
    payload,
    timestamp: new Date().toISOString()
  });
  
  let broadcastCount = 0;
  overlayClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      broadcastCount++;
    }
  });
  
  log.debug(`Broadcasted overlay command to ${broadcastCount} clients`, payload);
}

// Handle viewport updates
function handleViewportUpdate(payload, clientId) {
  log.debug(`Viewport update from ${clientId}:`, payload);
  // Store viewport configuration for session management
  // This could be persisted to a database in production
}

// Health check endpoint
app.get('/health', (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    config: {
      projectName: config.projectName,
      httpPort: config.httpPort,
      wsPort: config.wsPort,
      mcpWsEnabled: config.mcpWsEnabled
    },
    services: {
      webServer: 'running',
      websocket: config.mcpWsEnabled ? 'enabled' : 'disabled',
      connectedClients: overlayClients.size
    }
  };
  
  res.json(health);
});

// MCP configuration endpoint for Cherry Studio integration
app.get('/mcp-config', (req, res) => {
  const hostHeader = req.get('host') || `${config.bindAddress}:${config.httpPort}`;
  const protocol = req.secure ? 'https' : 'http';
  const wsProtocol = req.secure ? 'wss' : 'ws';
  
  const mcpConfig = {
    mcp_version: '1.0',
    session_id: `${config.projectName}-${Date.now()}`,
    mcp_ws_url: `${wsProtocol}://${hostHeader}/ws`,
    mcp_http_url: `${protocol}://${hostHeader}/mcp`,
    auth: {
      type: 'session',
      token: `dev-token-${Date.now()}`
    },
    desktop: {
      target: 'fedora-silverblue',
      viewport: {
        w: 1920,
        h: 1080,
        devicePixelRatio: 1.0
      }
    },
    capabilities: {
      overlay_system: true,
      multi_monitor: true,
      click_through: true,
      websocket_streaming: config.mcpWsEnabled
    },
    notes: 'Single-user dev package. Copy this JSON into Cherry Studio MCP slot.'
  };
  
  res.json(mcpConfig);
});

// Serve static files (web frontend)
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: config.nodeEnv === 'production' ? '1d' : '0',
  etag: true,
  lastModified: true
}));

// Catch-all route for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start server
server.listen(config.httpPort, config.bindAddress, () => {
  log.info(`🚀 Overlay Companion MCP Management Server started`);
  log.info(`📍 HTTP server: http://${config.bindAddress}:${config.httpPort}`);
  log.info(`🔌 WebSocket: ${config.mcpWsEnabled ? 'enabled' : 'disabled'} on /ws`);
  log.info(`🌍 Environment: ${config.nodeEnv}`);
  log.info(`📊 Health check: http://${config.bindAddress}:${config.httpPort}/health`);
});