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
    pub shape: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct RemoveOverlayParams {
    pub overlay_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ClickAtParams {
    pub x: u32,
    pub y: u32,
    pub button: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct TypeTextParams {
    pub text: String,
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
        Ok(CallToolResult::success(vec![Content::text(
            format!("Overlay drawn at ({}, {}) - Rust", params.x, params.y)
        )]))
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
        Ok(CallToolResult::success(vec![Content::text(
            "Screenshot captured - Rust"
        )]))
    }

    #[tool(description = "Simulate a mouse click at coordinates")]
    pub async fn click_at(
        &self,
        Parameters(ClickAtParams { x, y, button }): Parameters<ClickAtParams>,
    ) -> Result<CallToolResult, McpError> {
        let btn = button.unwrap_or_else(|| "left".to_string());
        Ok(CallToolResult::success(vec![Content::text(
            format!("Clicked at ({}, {}) with {} - Rust", x, y, btn)
        )]))
    }

    #[tool(description = "Simulate keyboard input")]
    pub async fn type_text(
        &self,
        Parameters(TypeTextParams { text }): Parameters<TypeTextParams>,
    ) -> Result<CallToolResult, McpError> {
        Ok(CallToolResult::success(vec![Content::text(
            format!("Typed: {} - Rust", text)
        )]))
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

    // Bind to 0.0.0.0:3000 to match existing container expectations
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], 3000));
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
