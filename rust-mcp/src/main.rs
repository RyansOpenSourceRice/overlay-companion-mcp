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
use serde::Deserialize;
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
pub struct RemoveOverlayParams {
    pub overlay_id: String,
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
