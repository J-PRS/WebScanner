import http.server
import socketserver
import os
import socket
import time
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import webbrowser
import json


def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception as e:
        print(f"Warning: Could not get local IP address: {e}")
        return "127.0.0.1"


class HotReloadHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/":
            self.path = "/index.html"
        return http.server.SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self):
        if self.path == "/debug":
            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data)
                print(f"\nDebug message received:")
                print(json.dumps(data, indent=2))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"OK")
            except json.JSONDecodeError:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"Invalid JSON")
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode())
            return

        self.send_response(405)
        self.end_headers()
        self.wfile.write(b"Method Not Allowed")

    def end_headers(self):
        # Add headers to support hot reloading
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        http.server.SimpleHTTPRequestHandler.end_headers(self)


class ChangeHandler(FileSystemEventHandler):
    def __init__(self, server):
        self.server = server
        self.last_reload = 0
        self.reload_delay = 0.5  # seconds

    def on_modified(self, event):
        if time.time() - self.last_reload < self.reload_delay:
            return

        if event.is_directory:
            return

        if event.src_path.endswith((".html", ".js", ".css")):
            print(f"\nFile changed: {event.src_path}")
            print("Reloading browser...")
            self.server.shutdown()
            self.server.server_close()
            self.last_reload = time.time()
            start_server()


def start_server():
    PORT = find_free_port()
    LOCAL_IP = get_local_ip()

    Handler = HotReloadHandler
    Handler.extensions_map.update(
        {
            "": "application/octet-stream",
            ".js": "application/javascript",
            ".css": "text/css",
            ".html": "text/html",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".gif": "image/gif",
            ".svg": "image/svg+xml",
        }
    )

    print(f"Starting server on port {PORT}...")
    print(f"Open your browser and go to:")
    print(f"  http://localhost:{PORT} (on this computer)")
    print(f"  http://{LOCAL_IP}:{PORT} (on other devices on the same network)")
    print(
        "\nHot reloading enabled. Browser will refresh automatically when you save changes."
    )

    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        # Set up file watching
        observer = Observer()
        event_handler = ChangeHandler(httpd)
        observer.schedule(event_handler, ".", recursive=True)
        observer.start()

        try:
            # Open browser automatically
            webbrowser.open(f"http://localhost:{PORT}")
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")
            observer.stop()
            observer.join()
        finally:
            httpd.server_close()


if __name__ == "__main__":
    start_server()
