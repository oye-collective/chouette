#!/usr/bin/env python3
"""Chouette Native Messaging Host — caching HTTP proxy for HuggingFace model files.

Downloads model files from HuggingFace on first request and caches them at
~/.chouette/models/ so they can be reused across Chrome profiles.
"""

import json
import os
import struct
import sys
import threading
import uuid
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

CACHE_DIR = os.path.join(os.path.expanduser("~"), ".chouette", "models")
TMP_DIR = os.path.join(CACHE_DIR, ".tmp")
UPSTREAM = "https://huggingface.co"
CHUNK_SIZE = 65536

# Per-path locks to prevent duplicate concurrent downloads
_locks: dict[str, threading.Lock] = {}
_locks_lock = threading.Lock()


def _path_lock(path: str) -> threading.Lock:
    with _locks_lock:
        if path not in _locks:
            _locks[path] = threading.Lock()
        return _locks[path]


class ProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # silence request logs

    def do_GET(self):
        if self.path == "/ping":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
            return
        self._serve(head_only=False)

    def do_HEAD(self):
        if self.path == "/ping":
            self.send_response(200)
            self.end_headers()
            return
        self._serve(head_only=True)

    def _serve(self, head_only: bool):
        rel = self.path.lstrip("/")
        if not rel or ".." in rel:
            self.send_error(400)
            return

        cache_path = os.path.join(CACHE_DIR, rel)
        lock = _path_lock(rel)

        with lock:
            if os.path.isfile(cache_path):
                self._serve_cached(cache_path, head_only)
            elif head_only:
                self._proxy_head(rel)
            else:
                self._download_and_serve(rel, cache_path)

    def _serve_cached(self, cache_path: str, head_only: bool):
        size = os.path.getsize(cache_path)

        # Handle Range: bytes=0-0 (used by transformers.js for metadata)
        range_header = self.headers.get("Range")
        if range_header and range_header.startswith("bytes=0-0"):
            self.send_response(206)
            self.send_header("Content-Range", f"bytes 0-0/{size}")
            self.send_header("Content-Length", "1")
            self.end_headers()
            if not head_only:
                with open(cache_path, "rb") as f:
                    self.wfile.write(f.read(1))
            return

        self.send_response(200)
        self.send_header("Content-Length", str(size))
        self.send_header("Content-Type", self._guess_type(cache_path))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        if not head_only:
            with open(cache_path, "rb") as f:
                while True:
                    chunk = f.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    self.wfile.write(chunk)

    def _proxy_head(self, rel: str):
        url = f"{UPSTREAM}/{rel}"
        try:
            req = Request(url, method="HEAD")
            with urlopen(req) as resp:
                self.send_response(resp.status)
                cl = resp.getheader("Content-Length")
                if cl:
                    self.send_header("Content-Length", cl)
                ct = resp.getheader("Content-Type")
                if ct:
                    self.send_header("Content-Type", ct)
                self.send_header("Accept-Ranges", "bytes")
                self.end_headers()
        except (URLError, HTTPError) as e:
            code = e.code if isinstance(e, HTTPError) else 502
            self.send_error(code)

    def _download_and_serve(self, rel: str, cache_path: str):
        url = f"{UPSTREAM}/{rel}"
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        os.makedirs(TMP_DIR, exist_ok=True)
        tmp_path = os.path.join(TMP_DIR, uuid.uuid4().hex)

        try:
            # Forward Range header if present
            req = Request(url)
            range_header = self.headers.get("Range")
            if range_header:
                req.add_header("Range", range_header)

            with urlopen(req) as resp:
                status = resp.status
                cl = resp.getheader("Content-Length")
                ct = resp.getheader("Content-Type", "application/octet-stream")
                cr = resp.getheader("Content-Range")

                self.send_response(status)
                if cl:
                    self.send_header("Content-Length", cl)
                self.send_header("Content-Type", ct)
                if cr:
                    self.send_header("Content-Range", cr)
                self.send_header("Accept-Ranges", "bytes")
                self.end_headers()

                # Only cache full (non-range) 200 responses
                is_full = status == 200 and not range_header

                tmp_file = open(tmp_path, "wb") if is_full else None
                try:
                    while True:
                        chunk = resp.read(CHUNK_SIZE)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        if tmp_file:
                            tmp_file.write(chunk)
                finally:
                    if tmp_file:
                        tmp_file.close()

                if is_full:
                    os.rename(tmp_path, cache_path)

        except (URLError, HTTPError) as e:
            code = e.code if isinstance(e, HTTPError) else 502
            self.send_error(code)
        finally:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass

    @staticmethod
    def _guess_type(path: str) -> str:
        ext = os.path.splitext(path)[1].lower()
        return {
            ".json": "application/json",
            ".onnx": "application/octet-stream",
            ".onnx_data": "application/octet-stream",
            ".txt": "text/plain",
            ".model": "application/octet-stream",
        }.get(ext, "application/octet-stream")


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


# --- Native Messaging Protocol ---

def read_message():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    length = struct.unpack("<I", raw)[0]
    data = sys.stdin.buffer.read(length)
    return json.loads(data.decode("utf-8"))


def send_message(msg):
    encoded = json.dumps(msg).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def main():
    os.makedirs(CACHE_DIR, exist_ok=True)
    os.makedirs(TMP_DIR, exist_ok=True)

    server = None
    port = None

    while True:
        msg = read_message()
        if msg is None:
            break

        action = msg.get("action")

        if action == "start_proxy":
            if server is None:
                try:
                    server = ThreadedHTTPServer(("127.0.0.1", 0), ProxyHandler)
                    port = server.server_address[1]
                    thread = threading.Thread(target=server.serve_forever)
                    thread.daemon = True
                    thread.start()
                except Exception as e:
                    send_message({"action": "error", "message": str(e)})
                    continue
            send_message({"action": "proxy_started", "port": port})

        elif action == "ping":
            send_message({"action": "pong"})

        else:
            send_message({"action": "error", "message": f"Unknown action: {action}"})


if __name__ == "__main__":
    main()
