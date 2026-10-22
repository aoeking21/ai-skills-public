#!/usr/bin/env python3
from __future__ import annotations
import argparse
import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HOME = Path.home()
APP = HOME / "Desktop/电子书宝库.app"
LAUNCHER = APP / "Contents/MacOS/launcher"
PORTS = range(8765, 8771)

def url_ok(url: str, timeout: float = 0.6) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return 200 <= getattr(r, "status", 200) < 400
    except Exception:
        return False

def find_port():
    for p in PORTS:
        if url_ok(f"http://127.0.0.1:{p}/index.html"):
            return p
    return None
def ensure_app():
    p = find_port()
    if p:
        return p
    if not LAUNCHER.exists():
        raise RuntimeError(f"launcher missing: {LAUNCHER}")
    subprocess.run(
        [str(LAUNCHER), "--headless"],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=8,
    )
    for _ in range(20):
        p = find_port()
        if p:
            return p
        time.sleep(0.15)
    raise RuntimeError("电子书宝库本地服务未能启动")

def load_catalog(port: int):
    url = f"http://127.0.0.1:{port}/books.json"
    with urllib.request.urlopen(url, timeout=8) as r:
        return json.loads(r.read().decode("utf-8"))

def terms(q: str):
    q = q.strip().lower()
    parts = [x for x in re.split(r"[\s,，。;；、/|]+", q) if len(x) >= 2]
    return [q] + [x for x in parts if x != q]
def score(book, qs):
    title = str(book.get("title", "")).lower()
    author = str(book.get("author", "")).lower()
    cat = str(book.get("category", "")).lower()
    lang = str(book.get("language", "")).lower()
    full = " ".join([title, author, cat, lang])
    s = 0
    q0 = qs[0] if qs else ""
    if q0 and title == q0:
        s += 100
    elif q0 and title.startswith(q0):
        s += 40
    for t in qs:
        if t in title:
            s += 24
        if t in author:
            s += 14
        if t in cat:
            s += 8
        if t in full:
            s += 2
    return s

def main():
    ap = argparse.ArgumentParser(description="Query local Ebook Treasure Chest via its app service")
    ap.add_argument("query", nargs="?")
    ap.add_argument("--limit", type=int, default=8)
    ap.add_argument("--health", action="store_true")
    ap.add_argument("--include-links", action="store_true")
    args = ap.parse_args()
    port = ensure_app()
    if args.health:
        print(json.dumps({
            "ok": True,
            "source": "电子书宝库.app",
            "url": f"http://127.0.0.1:{port}/",
        }, ensure_ascii=False))
        return

    if not args.query:
        ap.error("query required unless --health is used")

    catalog = load_catalog(port)
    qs = terms(args.query)
    ranked = []
    for book in catalog:
        s = score(book, qs)
        if s > 0:
            ranked.append((s, book))
    ranked.sort(key=lambda x: (-x[0], str(x[1].get("title", ""))))

    matches = []
    for s, book in ranked[:max(1, min(args.limit, 50))]:
        item = {
            "title": book.get("title"),
            "author": book.get("author"),
            "category": book.get("category"),
            "language": book.get("language"),
            "formats": book.get("formats"),
            "score": s,
        }
        if args.include_links:
            item["catalog_link"] = book.get("link")
        matches.append(item)

    out = {
        "query": args.query,
        "source": "电子书宝库.app/local-index",
        "url": f"http://127.0.0.1:{port}/",
        "catalog_count": len(catalog),
        "match_count": len(ranked),
        "matches": matches,
        "evidence_scope": "catalog metadata only; full-text claims require an accessible lawful full text",
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({
            "ok": False,
            "error": type(e).__name__,
            "message": str(e),
        }, ensure_ascii=False), file=sys.stderr)
        sys.exit(2)
