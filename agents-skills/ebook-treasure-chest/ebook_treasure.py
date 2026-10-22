#!/usr/bin/env python3
import argparse, json, os, subprocess, sys
from pathlib import Path

ROOT = Path.home() / "Applications" / "ebook-treasure-chest"
DATA = ROOT / "docs" / "books.json"
APP = Path.home() / "Desktop" / "电子书宝库.app"

def load_books():
    with DATA.open("r", encoding="utf-8") as f:
        return json.load(f)

def norm(s):
    return str(s or "").casefold().strip()

def score(book, terms):
    title = norm(book.get("title"))
    author = norm(book.get("author"))
    category = norm(book.get("category"))
    blob = " ".join([title, author, category])
    total = 0
    for t in terms:
        if t in title:
            total += 12
            if title == t:
                total += 20
        if t in author:
            total += 8
        if t in category:
            total += 5
        if t in blob:
            total += 1
    return total

def cmd_search(args):
    books = load_books()
    terms = [norm(x) for x in args.query.split() if norm(x)]
    if not terms:
        print("empty query", file=sys.stderr)
        return 2
    ranked = []
    for i, book in enumerate(books):
        s = score(book, terms)
        if s:
            ranked.append((s, i, book))
    ranked.sort(key=lambda x: (-x[0], x[1]))
    results = [x[2] for x in ranked[:args.limit]]
    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        print(f"matches={len(ranked)} showing={len(results)}")
        for n, b in enumerate(results, 1):
            fmts = ",".join(b.get("formats") or [])
            print(f"{n}. {b.get('title','')} | {b.get('author','')} | {b.get('category','')} | {fmts}")
            print(f"   {b.get('link','')}")
    return 0

def cmd_status(_args):
    ok = DATA.is_file() and APP.exists()
    count = None
    if DATA.is_file():
        try:
            count = len(load_books())
        except Exception:
            pass
    print(json.dumps({
        "ok": ok,
        "root": str(ROOT),
        "data": str(DATA),
        "app": str(APP),
        "book_count": count
    }, ensure_ascii=False))
    return 0 if ok else 1

def cmd_open(_args):
    if not APP.exists():
        print(f"missing app: {APP}", file=sys.stderr)
        return 1
    return subprocess.call(["/usr/bin/open", str(APP)])

def main():
    p = argparse.ArgumentParser(prog="ebook-treasure")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("search")
    s.add_argument("query")
    s.add_argument("--limit", type=int, default=10)
    s.add_argument("--json", action="store_true")
    s.set_defaults(func=cmd_search)
    st = sub.add_parser("status")
    st.set_defaults(func=cmd_status)
    op = sub.add_parser("open")
    op.set_defaults(func=cmd_open)
    args = p.parse_args()
    raise SystemExit(args.func(args))

if __name__ == "__main__":
    main()
