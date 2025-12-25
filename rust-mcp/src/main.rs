use anyhow::Result;
use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, Content, ServerCapabilities, ServerInfo},
    transport::stdio,
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
    let service = OverlayCompanionServer::new().serve(stdio()).await
        .inspect_err(|e| {
            println!("Error starting server: {}", e);
        })?;

    println!("Starting Overlay Companion MCP Server (Rust implementation)...");
    println!("This is a prefunctional development version.");

    service.waiting().await?;

    Ok(())
}
