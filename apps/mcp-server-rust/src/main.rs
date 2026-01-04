use anyhow::Result;
use hyper_util::service::TowerToHyperService;

use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, Content, ServerCapabilities, ServerInfo},
    transport::streamable_http_server::{
        session::local::LocalSessionManager,
        tower::{StreamableHttpServerConfig, StreamableHttpService},
    },
    tool, tool_handler, tool_router, ErrorData as McpError, ServerHandler, ServiceExt,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;


#[derive(Debug, Deserialize, JsonSchema)]
pub struct DrawOverlayParams {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub color: String,
    #[allow(dead_code)]
    pub shape: Option<String>,
    pub id: Option<String>,
    pub opacity: Option<f64>,
    pub monitor_index: Option<i32>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreateOverlayParams {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub color: Option<String>,
    pub label: Option<String>,
    pub opacity: Option<f64>,
    pub click_through: Option<bool>,
    pub monitor_index: Option<i32>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct OverlayInfo {
    pub overlay_id: String,
    pub bounds: serde_json::Value,
    pub color: Option<String>,
    pub opacity: f64,
    pub monitor_index: i32,
    pub label: Option<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct CapabilitiesResponse {
    pub compositor: String,
    pub supports_click_through: bool,
    pub supports_opacity: bool,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ClipboardStatus {
    pub available: bool,
    pub backend: String,
    pub status: String,
}


#[derive(Debug, Deserialize, JsonSchema)]
pub struct RemoveOverlayParams {
    pub overlay_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SetModeParams {
    pub mode: String,
}

#[derive(Clone)]
pub struct OverlayCompanionServer {
    counter: Arc<Mutex<i32>>,
    pub tool_router: ToolRouter<Self>,
}

#[tool_router]
impl OverlayCompanionServer {
    pub fn new() -> Self {
        Self {
            counter: Arc::new(Mutex::new(0)),
            tool_router: Self::tool_router(),
        }
    }

    #[tool(description = "Draw a visual overlay on the screen")]
    pub async fn draw_overlay(
        &self,
        Parameters(params): Parameters<DrawOverlayParams>,
    ) -> Result<CallToolResult, McpError> {
        let id = params.id.unwrap_or_else(|| format!("ovl-{}-{}", params.x, params.y));
        let opacity = params.opacity.unwrap_or(0.5);
        let monitor_index = params.monitor_index.unwrap_or(0);
        let resp = serde_json::json!({
            "overlay_id": id,
            "bounds": {"x": params.x, "y": params.y, "width": params.width, "height": params.height},
            "color": params.color,
            "opacity": opacity,
            "monitor_index": monitor_index,
            "monitor_name": serde_json::Value::Null,
            "monitor_bounds": serde_json::Value::Null
        });
        Ok(CallToolResult::success(vec![Content::text(resp.to_string())]))
    }

    #[tool(description = "Create an overlay element with richer parameters")]
    pub async fn create_overlay(
        &self,
        Parameters(p): Parameters<CreateOverlayParams>,
    ) -> Result<CallToolResult, McpError> {
        let id = format!("ovl-{}-{}", p.x, p.y);
        let info = OverlayInfo {
            overlay_id: id.clone(),
            bounds: serde_json::json!({"x": p.x, "y": p.y, "width": p.width, "height": p.height}),
            color: p.color.clone(),
            opacity: p.opacity.unwrap_or(0.5),
            monitor_index: p.monitor_index.unwrap_or(0),
            label: p.label.clone(),
        };
        Ok(CallToolResult::success(vec![Content::text(serde_json::to_string(&info).unwrap())]))
    }

    #[tool(description = "Get overlay engine capabilities")] 
    pub async fn get_overlay_capabilities(&self) -> Result<CallToolResult, McpError> {
        let compositor = if std::env::var("WAYLAND_DISPLAY").is_ok() { "wayland" } else { "unknown" };
        let caps = CapabilitiesResponse { compositor: compositor.into(), supports_click_through: true, supports_opacity: true };
        Ok(CallToolResult::success(vec![Content::text(serde_json::to_string(&caps).unwrap())]))
    }

    #[tool(description = "Get information about connected displays")] 
    pub async fn get_display_info(&self) -> Result<CallToolResult, McpError> {
        // placeholder: single display fallback
        let resp = serde_json::json!({
            "displays": [{"index": 0, "name": "Display-0", "width": 0, "height": 0, "x": 0, "y": 0, "is_primary": true, "scale": 1.0, "refresh_rate": 60.0}],
            "primary_display": {"index": 0},
            "total_displays": 1,
            "virtual_screen": {"width": 0, "height": 0, "min_x": 0, "min_y": 0},
            "kasmvnc_integration": {"connected": false, "session_status": null, "multi_monitor_support": false, "overlay_support": false}
        });
        Ok(CallToolResult::success(vec![Content::text(resp.to_string())]))
    }

    #[tool(description = "Get clipboard content via clipboard-bridge if available")] 
    pub async fn get_clipboard(&self) -> Result<CallToolResult, McpError> {
        let bridge_url = std::env::var("CLIPBOARD_BRIDGE_URL").unwrap_or_else(|_| "http://localhost:8765".into());
        let url = format!("{}/clipboard?api_key={}", bridge_url, std::env::var("CLIPBOARD_BRIDGE_API_KEY").unwrap_or_else(|_| "overlay-companion-mcp".into()));
        let client = reqwest::Client::new();
        let txt = match client.get(&url).send().await.and_then(|r| r.error_for_status()).and_then(|r| r.text()) .await {
            Ok(t) => t,
            Err(e) => serde_json::json!({"success": false, "error": format!("{}", e)}).to_string(),
        };
        Ok(CallToolResult::success(vec![Content::text(txt)]))
    }

    #[tool(description = "Set clipboard content via clipboard-bridge")] 
    pub async fn set_clipboard(&self, Parameters(p): Parameters<serde_json::Value>) -> Result<CallToolResult, McpError> {
        let bridge_url = std::env::var("CLIPBOARD_BRIDGE_URL").unwrap_or_else(|_| "http://localhost:8765".into());
        let url = format!("{}/clipboard?api_key={}", bridge_url, std::env::var("CLIPBOARD_BRIDGE_API_KEY").unwrap_or_else(|_| "overlay-companion-mcp".into()));
        let content = p.get("content").and_then(|v| v.as_str()).unwrap_or("");
        let content_type = p.get("content_type").and_then(|v| v.as_str()).unwrap_or("text/plain");
        let body = serde_json::json!({"content": content, "content_type": content_type});
        let client = reqwest::Client::new();
        let txt = match client.post(&url).json(&body).send().await.and_then(|r| r.error_for_status()).and_then(|r| r.text()).await {
            Ok(t) => t,
            Err(e) => serde_json::json!({"success": false, "error": format!("{}", e)}).to_string(),
        };
        Ok(CallToolResult::success(vec![Content::text(txt)]))
    }

    #[tool(description = "Get clipboard bridge availability status")] 
    pub async fn get_clipboard_bridge_status(&self) -> Result<CallToolResult, McpError> {
        let bridge_url = std::env::var("CLIPBOARD_BRIDGE_URL").unwrap_or_else(|_| "http://localhost:8765".into());
        let url = format!("{}/health", bridge_url);
        let client = reqwest::Client::new();
        let txt = match client.get(&url).send().await.and_then(|r| r.error_for_status()).and_then(|r| r.text()).await {
            Ok(t) => t,
            Err(e) => serde_json::json!({"status": "unavailable", "error": format!("{}", e)}).to_string(),
        };
        Ok(CallToolResult::success(vec![Content::text(txt)]))
    }

    #[tool(description = "Set the operational mode: sleep or passive_annotation (no active clicking)")] 
    pub async fn set_mode(&self, Parameters(p): Parameters<SetModeParams>) -> Result<CallToolResult, McpError> {
        let mode = p.mode.to_lowercase();
        let allowed = ["sleep", "passive_annotation"]; 
        let ok = allowed.contains(&mode.as_str());
        let resp = serde_json::json!({"ok": ok, "active_mode": if ok { mode } else { "passive_annotation".into() }, "note": "No active clicking in passive_annotation"});
        Ok(CallToolResult::success(vec![Content::text(resp.to_string())]))
    }

    #[tool(description = "Set screenshot frequency (Hz)")] 
    pub async fn set_screenshot_frequency(&self, Parameters(p): Parameters<serde_json::Value>) -> Result<CallToolResult, McpError> {
        let hz = p.get("hz").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let resp = serde_json::json!({"ok": hz >= 0.0, "hz": hz});
        Ok(CallToolResult::success(vec![Content::text(resp.to_string())]))
    }

    #[tool(description = "Re-anchor overlay element (placeholder)")] 
    pub async fn re_anchor_element(&self, Parameters(p): Parameters<serde_json::Value>) -> Result<CallToolResult, McpError> {
        let id = p.get("overlay_id").and_then(|v| v.as_str()).unwrap_or("unknown");
        let resp = serde_json::json!({"ok": true, "overlay_id": id});
        Ok(CallToolResult::success(vec![Content::text(resp.to_string())]))
    }

    #[tool(description = "Session stop (placeholder)")] 
    pub async fn session_stop(&self) -> Result<CallToolResult, McpError> {
        Ok(CallToolResult::success(vec![Content::text("{\"ok\":true,\"message\":\"session stopping\"}".into())]))
    }

    #[tool(description = "Set active connection (note: connections configured via GUI)")] 
    pub async fn set_active_connection(&self, Parameters(p): Parameters<serde_json::Value>) -> Result<CallToolResult, McpError> {
        let id = p.get("connection_id").and_then(|v| v.as_str()).unwrap_or("");
        let resp = serde_json::json!({"ok": !id.is_empty(), "active_connection_id": id});
        Ok(CallToolResult::success(vec![Content::text(resp.to_string())]))
    }

    #[tool(description = "Test connection (placeholder; GUI config)")] 
    pub async fn test_connection(&self, Parameters(p): Parameters<serde_json::Value>) -> Result<CallToolResult, McpError> {
        let id = p.get("connection_id").and_then(|v| v.as_str()).unwrap_or("");
        let resp = serde_json::json!({"success": !id.is_empty(), "message": if id.is_empty(){"invalid id"} else {"ok"}});
        Ok(CallToolResult::success(vec![Content::text(resp.to_string())]))
    }

    #[tool(description = "Unsubscribe from events (no-op stub)")] 
    pub async fn unsubscribe_events(&self, Parameters(p): Parameters<serde_json::Value>) -> Result<CallToolResult, McpError> {
        let id = p.get("subscription_id").and_then(|v| v.as_str()).unwrap_or("");
        let resp = serde_json::json!({"ok": !id.is_empty(), "subscription_id": id});
        Ok(CallToolResult::success(vec![Content::text(resp.to_string())]))
    }


    #[tool(description = "Remove an existing overlay by ID")]
    pub async fn remove_overlay(
        &self,
        Parameters(RemoveOverlayParams { overlay_id }): Parameters<RemoveOverlayParams>,
    ) -> Result<CallToolResult, McpError> {
        Ok(CallToolResult::success(vec![Content::text(
            format!("Overlay {} removed - Rust", overlay_id)
        )]))
    }

    #[tool(description = "Take a screenshot of the current screen")] 
    pub async fn take_screenshot(&self) -> Result<CallToolResult, McpError> {
        let resp = serde_json::json!({
            "image_base64": "",
            "width": 0,
            "height": 0,
            "region": null,
            "monitor_index": 0,
            "display_scale": 1.0,
            "viewport_scroll": {"x": 0, "y": 0}
        });
        Ok(CallToolResult::success(vec![Content::text(resp.to_string())]))
    }

}

#[tool_handler]
impl rmcp::ServerHandler for OverlayCompanionServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            instructions: Some("Overlay Companion MCP Server - Rust implementation".into()),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            ..Default::default()
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Serve over Streamable HTTP for modern MCP transport
    // Serve over Streamable HTTP for modern MCP transport
    let session_manager = std::sync::Arc::new(LocalSessionManager::default());
    let config = StreamableHttpServerConfig::default();
    let http = StreamableHttpService::new(
        || Ok(OverlayCompanionServer::new()),
        session_manager,
        config,
    );

    // Bind to MCP_HTTP_PORT (default 3000)
    let port: u16 = std::env::var("MCP_HTTP_PORT").ok().and_then(|s| s.parse().ok()).unwrap_or(3000);
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    eprintln!("Starting Overlay Companion MCP Server (Rust, Streamable HTTP) on {}...", addr);
    eprintln!("This is a prefunctional development version.");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    let builder = hyper_util::server::conn::auto::Builder::new(hyper_util::rt::TokioExecutor::new());
    loop {
        let (stream, _peer) = listener.accept().await?;
        let io = hyper_util::rt::TokioIo::new(stream);
        let svc = TowerToHyperService::new(http.clone());
        let b = builder.clone();
        tokio::spawn(async move {
            if let Err(e) = b.serve_connection(io, svc).await {
                eprintln!("HTTP connection error: {e}");
            }
        });
    }

    Ok(())
}
