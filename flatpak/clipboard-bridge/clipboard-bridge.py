#!/usr/bin/env python3
"""
Overlay Companion MCP - Clipboard Bridge Service

A Flatpak service that provides HTTP API access to the VM's clipboard,
enabling clipboard synchronization between the host MCP server and VM.

This service runs inside the VM and exposes clipboard read/write operations
via a simple REST API that the host MCP server can call.
"""

import asyncio
import logging
import os
import subprocess
import sys
import threading
from datetime import datetime
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import argparse

# Configure logging
log_dir = Path.home() / ".local/share/overlay-companion"
log_dir.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(log_dir / "clipboard-bridge.log"),
    ],
)
logger = logging.getLogger(__name__)

# Configuration
HOST = os.getenv("CLIPBOARD_BRIDGE_HOST", "0.0.0.0")
PORT = int(os.getenv("CLIPBOARD_BRIDGE_PORT", "8765"))
API_KEY = os.getenv("CLIPBOARD_BRIDGE_API_KEY", "overlay-companion-mcp")


# Pydantic models
class ClipboardContent(BaseModel):
    content: str
    content_type: str = "text/plain"


class ClipboardResponse(BaseModel):
    success: bool
    content: Optional[str] = None
    content_type: Optional[str] = None
    timestamp: str
    message: Optional[str] = None


# FastAPI app
app = FastAPI(
    title="Overlay Companion MCP - Clipboard Bridge",
    description="VM clipboard access API for host MCP server integration",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS middleware for cross-origin requests from host
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to specific hosts
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)


class ClipboardManager:
    """Manages clipboard operations using various backends"""

    def __init__(self):
        self.backend = self._detect_backend()
        logger.info(f"Using clipboard backend: {self.backend}")

    def _detect_backend(self) -> str:
        """Detect available clipboard backend"""
        # Check for Wayland
        if os.getenv("WAYLAND_DISPLAY"):
            if self._command_exists("wl-copy"):
                return "wayland"

        # Check for X11
        if os.getenv("DISPLAY"):
            if self._command_exists("xclip"):
                return "xclip"
            elif self._command_exists("xsel"):
                return "xsel"

        # Fallback to Python clipboard libraries
        try:
            import gi

            gi.require_version("Gtk", "3.0")
            return "gtk"
        except ImportError:
            pass

        return "none"

    def _command_exists(self, command: str) -> bool:
        """Check if a command exists in PATH"""
        try:
            subprocess.run(["which", command], capture_output=True, check=True)
            return True
        except subprocess.CalledProcessError:
            return False

    async def get_clipboard(self) -> tuple[str, str]:
        """Get clipboard content and type"""
        try:
            if self.backend == "wayland":
                return await self._get_wayland_clipboard()
            elif self.backend == "xclip":
                return await self._get_xclip_clipboard()
            elif self.backend == "xsel":
                return await self._get_xsel_clipboard()
            elif self.backend == "gtk":
                return await self._get_gtk_clipboard()
            else:
                raise Exception("No clipboard backend available")
        except Exception as e:
            logger.error(f"Failed to get clipboard: {e}")
            raise

    async def set_clipboard(
        self, content: str, content_type: str = "text/plain"
    ) -> bool:
        """Set clipboard content"""
        try:
            if self.backend == "wayland":
                return await self._set_wayland_clipboard(content, content_type)
            elif self.backend == "xclip":
                return await self._set_xclip_clipboard(content, content_type)
            elif self.backend == "xsel":
                return await self._set_xsel_clipboard(content, content_type)
            elif self.backend == "gtk":
                return await self._set_gtk_clipboard(content, content_type)
            else:
                raise Exception("No clipboard backend available")
        except Exception as e:
            logger.error(f"Failed to set clipboard: {e}")
            raise

    async def _get_wayland_clipboard(self) -> tuple[str, str]:
        """Get clipboard using wl-paste (Wayland)"""
        process = await asyncio.create_subprocess_exec(
            "wl-paste",
            "--no-newline",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()

        if process.returncode != 0:
            raise Exception(f"wl-paste failed: {stderr.decode()}")

        return stdout.decode("utf-8", errors="replace"), "text/plain"

    async def _set_wayland_clipboard(self, content: str, content_type: str) -> bool:
        """Set clipboard using wl-copy (Wayland)"""
        process = await asyncio.create_subprocess_exec(
            "wl-copy",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate(content.encode("utf-8"))

        if process.returncode != 0:
            raise Exception(f"wl-copy failed: {stderr.decode()}")

        return True

    async def _get_xclip_clipboard(self) -> tuple[str, str]:
        """Get clipboard using xclip (X11)"""
        process = await asyncio.create_subprocess_exec(
            "xclip",
            "-selection",
            "clipboard",
            "-o",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()

        if process.returncode != 0:
            raise Exception(f"xclip failed: {stderr.decode()}")

        return stdout.decode("utf-8", errors="replace"), "text/plain"

    async def _set_xclip_clipboard(self, content: str, content_type: str) -> bool:
        """Set clipboard using xclip (X11)"""
        process = await asyncio.create_subprocess_exec(
            "xclip",
            "-selection",
            "clipboard",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate(content.encode("utf-8"))

        if process.returncode != 0:
            raise Exception(f"xclip failed: {stderr.decode()}")

        return True

    async def _get_xsel_clipboard(self) -> tuple[str, str]:
        """Get clipboard using xsel (X11)"""
        process = await asyncio.create_subprocess_exec(
            "xsel",
            "--clipboard",
            "--output",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()

        if process.returncode != 0:
            raise Exception(f"xsel failed: {stderr.decode()}")

        return stdout.decode("utf-8", errors="replace"), "text/plain"

    async def _set_xsel_clipboard(self, content: str, content_type: str) -> bool:
        """Set clipboard using xsel (X11)"""
        process = await asyncio.create_subprocess_exec(
            "xsel",
            "--clipboard",
            "--input",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate(content.encode("utf-8"))

        if process.returncode != 0:
            raise Exception(f"xsel failed: {stderr.decode()}")

        return True

    async def _get_gtk_clipboard(self) -> tuple[str, str]:
        """Get clipboard using GTK (portal-friendly)"""
        import asyncio
        return await asyncio.to_thread(self._gtk_get_text_blocking)

    async def _set_gtk_clipboard(self, content: str, content_type: str) -> bool:
        """Set clipboard using GTK (portal-friendly)"""
        import asyncio
        return await asyncio.to_thread(self._gtk_set_text_blocking, content)

    def _gtk_get_text_blocking(self) -> tuple[str, str]:
        try:
            import gi
            gi.require_version("Gtk", "3.0")
            from gi.repository import Gtk, Gdk

            # Initialize GTK if needed
            try:
                Gtk.init([])
            except Exception:
                pass

            display = Gdk.Display.get_default()
            if not display:
                raise Exception("No display available for GTK clipboard")

            clipboard = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
            text = clipboard.wait_for_text() or ""
            return text, "text/plain"
        except Exception as e:
            logger.error(f"GTK clipboard read failed: {e}")
            raise

    def _gtk_set_text_blocking(self, content: str) -> bool:
        try:
            import gi
            gi.require_version("Gtk", "3.0")
            from gi.repository import Gtk, Gdk

            try:
                Gtk.init([])
            except Exception:
                pass

            display = Gdk.Display.get_default()
            if not display:
                raise Exception("No display available for GTK clipboard")

            clipboard = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
            clipboard.set_text(content, -1)
            clipboard.store()
            return True
        except Exception as e:
            logger.error(f"GTK clipboard write failed: {e}")
            raise


# Global clipboard manager
clipboard_manager = ClipboardManager()


# Middleware for API key authentication
@app.middleware("http")
async def authenticate_request(request: Request, call_next):
    """Simple API key authentication"""
    if request.url.path in ["/", "/health", "/docs", "/redoc", "/openapi.json"]:
        response = await call_next(request)
        return response

    api_key = request.headers.get("X-API-Key") or request.query_params.get("api_key")
    if api_key != API_KEY:
        return JSONResponse(
            status_code=401, content={"error": "Invalid or missing API key"}
        )

    response = await call_next(request)
    return response


# API Routes
@app.get("/")
async def root():
    """Root endpoint with service information"""
    return {
        "service": "Overlay Companion MCP - Clipboard Bridge",
        "version": "1.0.0",
        "status": "running",
        "backend": clipboard_manager.backend,
        "endpoints": {
            "health": "/health",
            "get_clipboard": "/clipboard",
            "set_clipboard": "/clipboard (POST)",
            "docs": "/docs",
        },
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "backend": clipboard_manager.backend,
    }


@app.get("/clipboard", response_model=ClipboardResponse)
async def get_clipboard():
    """Get current clipboard content"""
    try:
        content, content_type = await clipboard_manager.get_clipboard()
        return ClipboardResponse(
            success=True,
            content=content,
            content_type=content_type,
            timestamp=datetime.now().isoformat(),
            message="Clipboard content retrieved successfully",
        )
    except Exception as e:
        logger.error(f"Failed to get clipboard: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to get clipboard content: {str(e)}"
        )


@app.post("/clipboard", response_model=ClipboardResponse)
async def set_clipboard(clipboard_data: ClipboardContent):
    """Set clipboard content"""
    try:
        success = await clipboard_manager.set_clipboard(
            clipboard_data.content, clipboard_data.content_type
        )

        if success:
            return ClipboardResponse(
                success=True,
                timestamp=datetime.now().isoformat(),
                message="Clipboard content set successfully",
            )
        else:
            raise HTTPException(
                status_code=500, detail="Failed to set clipboard content"
            )
    except Exception as e:
        logger.error(f"Failed to set clipboard: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to set clipboard content: {str(e)}"
        )


@app.delete("/clipboard", response_model=ClipboardResponse)
async def clear_clipboard():
    """Clear clipboard content"""
    try:
        success = await clipboard_manager.set_clipboard("", "text/plain")

        if success:
            return ClipboardResponse(
                success=True,
                timestamp=datetime.now().isoformat(),
                message="Clipboard cleared successfully",
            )
        else:
            raise HTTPException(status_code=500, detail="Failed to clear clipboard")
    except Exception as e:
        logger.error(f"Failed to clear clipboard: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to clear clipboard: {str(e)}"
        )


def main():
    """Main entry point"""
    # Ensure log directory exists
    log_dir = Path.home() / ".local/share/overlay-companion"
    log_dir.mkdir(parents=True, exist_ok=True)


    args = parse_args()
    if args.show_gui:
        try:
            import gi
            gi.require_version("Gtk", "3.0")
            from gi.repository import Gtk

            win = Gtk.Window(title="Clipboard Bridge")
            win.set_default_size(320, 120)
            box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8, margin_top=12, margin_bottom=12, margin_start=12, margin_end=12)

            label = Gtk.Label(label=f"Running on {HOST}:{PORT}\nBackend: {clipboard_manager.backend}")
            label.set_justify(Gtk.Justification.CENTER)
            box.append(label) if hasattr(box, 'append') else box.pack_start(label, True, True, 0)

            btn = Gtk.Button(label="Open API Docs")
            def on_click(_):
                import webbrowser
                webbrowser.open(f"http://127.0.0.1:{PORT}/docs")
            btn.connect("clicked", on_click)
            box.append(btn) if hasattr(box, 'append') else box.pack_start(btn, False, False, 0)

            win.set_child(box) if hasattr(win, 'set_child') else win.add(box)
            win.connect("destroy", Gtk.main_quit)
            win.show_all() if hasattr(win, 'show_all') else win.show()

            # Run API in background and Gtk mainloop in foreground
            loop = asyncio.get_event_loop()
            loop.create_task(asyncio.to_thread(uvicorn.run, app, host=HOST, port=PORT, log_level="info", access_log=True))
            Gtk.main()
            return
        except Exception as e:
            logger.warning(f"GUI not available: {e}")

    logger.info(f"Starting Clipboard Bridge Service on {HOST}:{PORT}")
    logger.info(f"Clipboard backend: {clipboard_manager.backend}")
    logger.info("API Key authentication enabled")

    # Run the server
    uvicorn.run(app, host=HOST, port=PORT, log_level="info", access_log=True)


def parse_args():
    parser = argparse.ArgumentParser(description="Clipboard Bridge Service")
    parser.add_argument("--show-gui", action="store_true", help="Show minimal configuration window")
    return parser.parse_args()


if __name__ == "__main__":
    main()
