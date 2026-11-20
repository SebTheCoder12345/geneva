"""Local dev server for web/ with caching disabled. Usage: python tools/serve.py [port]"""
import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1] / "web"


class NoCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".glb": "model/gltf-binary", ".bin": "application/octet-stream"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    handler = functools.partial(NoCache, directory=str(ROOT))
    http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
