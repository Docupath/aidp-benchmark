# Usage:
#   python3 -I http_zip.py list <url> <out_listing.json>
#   python3 -I http_zip.py extract <url> <out_dir> <member_prefix> [max_members]
# Reads a remote zip with HTTP Range requests, so only the central directory and the chosen members
# are transferred (the rest of the archive, e.g. PDFs and images, is never downloaded).
import sys, io, json, os, zipfile, urllib.request
BLOCK = 4 * 1024 * 1024
class HttpFile(io.RawIOBase):
    def __init__(self, url):
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=60) as r:
            self.url = r.geturl(); self.size = int(r.headers["Content-Length"])
        self.pos = 0; self.cache_start = -1; self.cache = b""; self.bytes_fetched = 0; self.requests = 0
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.size + off); return self.pos
    def _fetch(self, start, end):
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={start}-{end}"})
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
        self.bytes_fetched += len(data); self.requests += 1
        return data
    def read(self, n=-1):
        if n is None or n < 0: n = self.size - self.pos
        if n == 0 or self.pos >= self.size: return b""
        end = min(self.pos + n, self.size)
        if not (self.cache_start <= self.pos and end <= self.cache_start + len(self.cache)):
            fetch_end = min(max(end, self.pos + BLOCK), self.size) - 1
            self.cache = self._fetch(self.pos, fetch_end); self.cache_start = self.pos
        off = self.pos - self.cache_start
        out = self.cache[off: off + (end - self.pos)]
        self.pos += len(out); return out
    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)
mode, url = sys.argv[1], sys.argv[2]
hf = HttpFile(url)
z = zipfile.ZipFile(hf)
infos = z.infolist()
if mode == "list":
    lst = [{"name": i.filename, "size": i.file_size, "compressed": i.compress_size, "offset": i.header_offset} for i in infos]
    json.dump({"url": url, "archive_bytes": hf.size, "members": len(lst), "list": lst}, open(sys.argv[3], "w"), indent=0)
    print(json.dumps({"archive_bytes": hf.size, "members": len(lst), "bytes_fetched": hf.bytes_fetched, "requests": hf.requests}))
else:
    out_dir, prefix = sys.argv[3], sys.argv[4]
    maxn = int(sys.argv[5]) if len(sys.argv) > 5 else None
    sel = sorted([i for i in infos if i.filename.startswith(prefix) and not i.is_dir()], key=lambda i: i.header_offset)
    if maxn: sel = sel[:maxn]
    for i in sel:
        dest = os.path.join(out_dir, i.filename)
        if not os.path.abspath(dest).startswith(os.path.abspath(out_dir)): continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as fo: fo.write(z.read(i))
    print(json.dumps({"extracted": len(sel), "bytes_fetched": hf.bytes_fetched, "requests": hf.requests, "archive_bytes": hf.size}))
