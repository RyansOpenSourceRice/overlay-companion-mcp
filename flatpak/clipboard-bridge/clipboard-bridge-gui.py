#!/usr/bin/env python3
import json
import os
import subprocess
import threading
import urllib.error
import urllib.request

try:
    import gi
    gi.require_version("Gtk", "3.0")
    from gi.repository import GLib, Gtk  # noqa: E402
    HAVE_GTK = True
except Exception:
    HAVE_GTK = False
    GLib = None
    Gtk = None

APP_NAME = "Overlay Companion Clipboard Bridge"
DEFAULT_HOST = os.getenv("CLIPBOARD_BRIDGE_HOST", "0.0.0.0")
DEFAULT_PORT = int(os.getenv("CLIPBOARD_BRIDGE_PORT", "8765"))
DEFAULT_API_KEY = os.getenv("CLIPBOARD_BRIDGE_API_KEY", "overlay-companion-mcp")
DEFAULT_BASE_URL = f"http://127.0.0.1:{DEFAULT_PORT}"

if not HAVE_GTK:
    # Fallback: run the bridge headless if GTK unavailable
    def main():
        print("GTK not available; starting clipboard-bridge headless...")
        env = os.environ.copy()
        env["CLIPBOARD_BRIDGE_HOST"] = env.get("CLIPBOARD_BRIDGE_HOST", DEFAULT_HOST)
        env["CLIPBOARD_BRIDGE_PORT"] = str(DEFAULT_PORT)
        env["CLIPBOARD_BRIDGE_API_KEY"] = DEFAULT_API_KEY
        subprocess.call(["clipboard-bridge"], env=env)


class BridgeGUI(Gtk.Window):
    def __init__(self):
        super().__init__(title=APP_NAME)
        self.set_border_width(10)
        self.set_default_size(380, 160)

        self.proc = None

        grid = Gtk.Grid(column_spacing=8, row_spacing=8)
        self.add(grid)

        # API Key
        lbl_api = Gtk.Label(label="API Key:")
        lbl_api.set_xalign(0)
        self.entry_api = Gtk.Entry()
        self.entry_api.set_visibility(False)
        self.entry_api.set_placeholder_text("Enter API key")
        self.entry_api.set_text(DEFAULT_API_KEY)

        # Base URL
        lbl_url = Gtk.Label(label="Base URL:")
        lbl_url.set_xalign(0)
        self.entry_url = Gtk.Entry()
        self.entry_url.set_placeholder_text("http://127.0.0.1:8765")
        self.entry_url.set_text(DEFAULT_BASE_URL)

        # Start/Stop toggle
        self.toggle_btn = Gtk.ToggleButton(label="Start")
        self.toggle_btn.connect("toggled", self.on_toggle)

        # Test button
        self.test_btn = Gtk.Button(label="Test")
        self.test_btn.connect("clicked", self.on_test)

        # Status label
        self.status_lbl = Gtk.Label(label="Status: stopped")
        self.status_lbl.set_xalign(0)

        # Layout
        grid.attach(lbl_api, 0, 0, 1, 1)
        grid.attach(self.entry_api, 1, 0, 2, 1)

        grid.attach(lbl_url, 0, 1, 1, 1)
        grid.attach(self.entry_url, 1, 1, 2, 1)

        grid.attach(self.toggle_btn, 1, 2, 1, 1)
        grid.attach(self.test_btn, 2, 2, 1, 1)

        grid.attach(self.status_lbl, 0, 3, 3, 1)

        self.connect("destroy", self.on_destroy)

    def on_toggle(self, button):
        if button.get_active():
            self.start_service()
        else:
            self.stop_service()

    def start_service(self):
        if self.proc and self.proc.poll() is None:
            return
        env = os.environ.copy()
        # Keep host binding configurable; Base URL uses 127.0.0.1 by default for testing
        env["CLIPBOARD_BRIDGE_HOST"] = env.get("CLIPBOARD_BRIDGE_HOST", DEFAULT_HOST)
        # Derive port from base URL if user edited it
        try:
            port = int(self.entry_url.get_text().split(":")[-1])
        except Exception:
            port = DEFAULT_PORT
        env["CLIPBOARD_BRIDGE_PORT"] = str(port)
        env["CLIPBOARD_BRIDGE_API_KEY"] = self.entry_api.get_text()
        try:
            self.proc = subprocess.Popen(["clipboard-bridge"], env=env)
            self.update_status("running")
            self.toggle_btn.set_label("Stop")
        except Exception as e:
            self.update_status(f"failed to start: {e}")
            self.toggle_btn.set_active(False)

    def stop_service(self):
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self.proc.kill()
            except Exception:
                pass
        self.proc = None
        self.update_status("stopped")
        self.toggle_btn.set_label("Start")

    def on_test(self, _):
        base = self.entry_url.get_text().rstrip("/")
        url = f"{base}/health"

        def task():
            try:
                req = urllib.request.Request(url)
                with urllib.request.urlopen(req, timeout=3) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                GLib.idle_add(
                    self.update_status, f"healthy ({data.get('backend', 'n/a')})"
                )
            except urllib.error.URLError as e:
                GLib.idle_add(self.update_status, f"unreachable: {e}")
            except Exception as e:
                GLib.idle_add(self.update_status, f"error: {e}")

        threading.Thread(target=task, daemon=True).start()

    def update_status(self, text):
        self.status_lbl.set_text(f"Status: {text}")

    def on_destroy(self, *_):
        self.stop_service()
        Gtk.main_quit()


if __name__ == "__main__":
    win = BridgeGUI()
    win.show_all()
    Gtk.main()
