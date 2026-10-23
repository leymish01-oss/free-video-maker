"""Serve public/ locally with cross-origin isolation on /tools/video-maker/ (as site/tools/video-maker/.htaccess does
on Hostinger), so WebAssembly can use threads. python serve_isolated.py <public-dir> <port>"""
import functools, http.server, sys

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        if self.path.startswith("/tools/video-maker/"):
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "credentialless")
        super().end_headers()
    def log_message(self, *a):
        pass

http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[2])), functools.partial(H, directory=sys.argv[1])).serve_forever()
