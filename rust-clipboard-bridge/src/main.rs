use std::{env, net::SocketAddr};

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tower_http::cors::{Any, CorsLayer};
use tracing::{error, info};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Clone)]
struct AppState {
    api_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ClipboardContent {
    content: String,
    #[serde(default = "default_content_type")]
    content_type: String,
}

fn default_content_type() -> String { "text/plain".to_string() }

#[derive(Debug, Serialize)]
struct ClipboardResponse {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")] content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] content_type: Option<String>,
    timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")] message: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // logging
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let host = env::var("CLIPBOARD_BRIDGE_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port: u16 = env::var("CLIPBOARD_BRIDGE_PORT").ok().and_then(|s| s.parse().ok()).unwrap_or(8765);
    let api_key = env::var("CLIPBOARD_BRIDGE_API_KEY").unwrap_or_else(|_| "overlay-companion-mcp".to_string());

    let state = AppState { api_key };

    let app = Router::new()
        .route("/", get(root))
        .route("/health", get(health))
        .route("/clipboard", get(get_clipboard).post(set_clipboard).delete(clear_clipboard))
        .with_state(state)
        .layer(CorsLayer::new()
            .allow_methods(Any)
            .allow_headers(Any)
            .allow_origin(Any)
        );

    let addr: SocketAddr = format!("{}:{}", host, port).parse()?;
    info!("Starting Clipboard Bridge on {}", addr);
    axum::serve(tokio::net::TcpListener::bind(addr).await?, app).await?;
    Ok(())
}

async fn root(State(state): State<AppState>) -> impl IntoResponse {
    let backend = detect_backend().await.unwrap_or_else(|e| format!("error:{e}"));
    Json(serde_json::json!({
        "service": "Overlay Companion MCP - Clipboard Bridge",
        "version": "0.1.0",
        "status": "running",
        "backend": backend,
        "endpoints": {"health": "/health", "get_clipboard": "/clipboard", "set_clipboard": "/clipboard (POST)", "docs": null}
    }))
}

async fn health() -> impl IntoResponse {
    let backend = detect_backend().await.unwrap_or_else(|e| format!("error:{e}"));
    Json(serde_json::json!({
        "status": "healthy",
        "timestamp": Utc::now().to_rfc3339(),
        "backend": backend,
    }))
}

#[derive(Deserialize)]
struct ApiKeyQuery { api_key: Option<String> }

async fn authenticate(headers: &HeaderMap, query: &ApiKeyQuery, state: &AppState) -> Result<(), StatusCode> {
    // allow unauthenticated for health & root — handled by caller
    let provided = headers.get("X-API-Key").and_then(|v| v.to_str().ok()).map(|s| s.to_string())
        .or_else(|| query.api_key.clone());
    match provided {
        Some(k) if k == state.api_key => Ok(()),
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}

async fn get_clipboard(State(state): State<AppState>, headers: HeaderMap, Query(query): Query<ApiKeyQuery>) -> impl IntoResponse {
    if let Err(code) = authenticate(&headers, &query, &state).await { return (code, Json(json!({"detail": "unauthorized"}))); }
    match read_clipboard().await {
        Ok((content, content_type)) => (StatusCode::OK, Json(json!(ClipboardResponse { success: true, content: Some(content), content_type: Some(content_type), timestamp: Utc::now().to_rfc3339(), message: Some("Clipboard content retrieved successfully".into()) }))),
        Err(e) => { error!("get_clipboard failed: {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"detail": format!("Failed to get clipboard content: {e}")}))) }
    }
}

async fn set_clipboard(State(state): State<AppState>, headers: HeaderMap, Query(query): Query<ApiKeyQuery>, Json(payload): Json<ClipboardContent>) -> impl IntoResponse {
    if let Err(code) = authenticate(&headers, &query, &state).await { return (code, Json(json!({"detail": "unauthorized"}))); }
    match write_clipboard(&payload.content, &payload.content_type).await {
        Ok(_) => (StatusCode::OK, Json(json!(ClipboardResponse { success: true, content: None, content_type: None, timestamp: Utc::now().to_rfc3339(), message: Some("Clipboard content set successfully".into()) }))),
        Err(e) => { error!("set_clipboard failed: {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"detail": format!("Failed to set clipboard content: {e}")}))) }
    }
}

async fn clear_clipboard(State(state): State<AppState>, headers: HeaderMap, Query(query): Query<ApiKeyQuery>) -> impl IntoResponse {
    if let Err(code) = authenticate(&headers, &query, &state).await { return (code, Json(json!({"detail": "unauthorized"}))); }
    match write_clipboard("", "text/plain").await {
        Ok(_) => (StatusCode::OK, Json(json!(ClipboardResponse { success: true, content: None, content_type: None, timestamp: Utc::now().to_rfc3339(), message: Some("Clipboard cleared successfully".into()) }))),
        Err(e) => { error!("clear_clipboard failed: {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"detail": format!("Failed to clear clipboard: {e}")}))) }
    }
}

#[derive(Debug)]
enum Backend { Wayland, Xclip, Xsel, None }

async fn detect_backend() -> Result<String, String> {
    if env::var("WAYLAND_DISPLAY").is_ok() && which::which("wl-copy").is_ok() { return Ok("wayland".into()); }
    if env::var("DISPLAY").is_ok() {
        if which::which("xclip").is_ok() { return Ok("xclip".into()); }
        if which::which("xsel").is_ok() { return Ok("xsel".into()); }
    }
    Ok("none".into())
}

async fn read_clipboard() -> anyhow::Result<(String, String)> {
    if env::var("WAYLAND_DISPLAY").is_ok() && which::which("wl-paste").is_ok() {
        return run_read_cmd(("wl-paste", &["--no-newline"])) .await.map(|s| (s, "text/plain".into()));
    }
    if env::var("DISPLAY").is_ok() {
        if which::which("xclip").is_ok() { return run_read_cmd(("xclip", &["-selection", "clipboard", "-o"])) .await.map(|s| (s, "text/plain".into())); }
        if which::which("xsel").is_ok() { return run_read_cmd(("xsel", &["--clipboard", "--output"])) .await.map(|s| (s, "text/plain".into())); }
    }
    Err(anyhow::anyhow!("No clipboard backend available"))
}

async fn write_clipboard(content: &str, _content_type: &str) -> anyhow::Result<()> {
    if env::var("WAYLAND_DISPLAY").is_ok() && which::which("wl-copy").is_ok() {
        return run_write_cmd(("wl-copy", &[]), content).await;
    }
    if env::var("DISPLAY").is_ok() {
        if which::which("xclip").is_ok() { return run_write_cmd(("xclip", &["-selection", "clipboard"]), content).await; }
        if which::which("xsel").is_ok() { return run_write_cmd(("xsel", &["--clipboard", "--input"]), content).await; }
    }
    Err(anyhow::anyhow!("No clipboard backend available"))
}

async fn run_read_cmd(cmd: (&str, &[&str])) -> anyhow::Result<String> {
    let mut child = async_process::Command::new(cmd.0)
        .args(cmd.1)
        .stdout(async_process::Stdio::piped())
        .stderr(async_process::Stdio::piped())
        .spawn()?;
    let out = child.output().await?;
    if !out.status.success() { return Err(anyhow::anyhow!(format!("{} failed: {}", cmd.0, String::from_utf8_lossy(&out.stderr)))); }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

async fn run_write_cmd(cmd: (&str, &[&str]), input: &str) -> anyhow::Result<()> {
    use futures_lite::io::AsyncWriteExt;
    let mut child = async_process::Command::new(cmd.0)
        .args(cmd.1)
        .stdin(async_process::Stdio::piped())
        .stdout(async_process::Stdio::piped())
        .stderr(async_process::Stdio::piped())
        .spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(input.as_bytes()).await?;
    }
    let out = child.output().await?;
    if !out.status.success() { return Err(anyhow::anyhow!(format!("{} failed: {}", cmd.0, String::from_utf8_lossy(&out.stderr)))); }
    Ok(())
}
