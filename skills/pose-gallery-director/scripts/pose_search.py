#!/usr/bin/env python3
"""Search the ai-pose-gallery catalog by Chinese keyword.

Stdlib only. No image or catalog data is vendored with this skill.
On first use the small catalog JSON files (pose, costume, portrait)
are downloaded from the upstream Chinese mirror and cached locally.
Images are fetched one at a time, only after the user picks a match.

Catalog source: https://github.com/anhao/ai-pose-gallery-zh
Original Japanese library: Gia (@giaaibusi), https://ai-pose-gallery.pages.dev/

Usage:
  python3 pose_search.py 坐姿
  python3 pose_search.py 回眸 --kind pose --limit 10
  python3 pose_search.py 连衣裙 --kind costume --limit 5
  python3 pose_search.py 短发 --kind portrait --limit 5
  python3 pose_search.py 坐姿 --fetch --out ./pose-picks/
  python3 pose_search.py 坐姿 --include-adult   # only when the user explicitly asks for adult poses
  python3 pose_search.py 坐姿 --repo ~/workspace/ai-pose-gallery-zh   # use a local sparse checkout instead of downloading
  python3 pose_search.py 坐姿 --refresh   # re-download the catalog JSON files

Output: one JSON object per match on stdout.
"""
import argparse
import json
import os
import sys
import urllib.request

RAW = "https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/main/"
FILES = {
    "pose": "data/pose-zh.json",
    "costume": "data/costume-zh.json",
    "portrait": "data/portrait-zh.json",
}
# Adult pose systems, hidden by default (the upstream repo default is SFW mode).
ADULT_SYSTEMS = ("性感系", "双人缠绵")
DEFAULT_CACHE = os.path.expanduser("~/.cache/pose-gallery-director")


def download(url, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "pose-gallery-director"})
    with urllib.request.urlopen(req, timeout=60) as r, open(path, "wb") as f:
        f.write(r.read())
    return path


def catalog_path(kind, repo, cache, refresh):
    if repo:
        path = os.path.join(os.path.expanduser(repo), FILES[kind])
        if not os.path.exists(path):
            raise SystemExit(f"catalog not found in local repo: {path}")
        return path
    path = os.path.join(cache, FILES[kind])
    if refresh or not os.path.exists(path):
        download(RAW + FILES[kind], path)
    return path


def load(kind, repo, cache, refresh):
    with open(catalog_path(kind, repo, cache, refresh), encoding="utf-8") as f:
        return json.load(f)


def is_adult_pose(item):
    return any(s in item.get("体系", "") for s in ADULT_SYSTEMS)


def search(query, kind, limit, include_adult, repo, cache, refresh):
    rows = load(kind, repo, cache, refresh)
    hits = []
    for item in rows:
        if kind == "pose" and not include_adult and is_adult_pose(item):
            continue
        if query and query not in item.get("检索", ""):
            continue
        hits.append(item)
        if len(hits) >= limit:
            break
    return hits


def describe(kind, item):
    if kind == "pose":
        return {
            "kind": kind,
            "id": item["id"],
            "name": item["姿势名称"],
            "system": item["体系"],
            "category": item["分类"],
            "angle": item["角度"],
            "thumb": RAW + item["缩略图"],
            "original": RAW + item["原图"],
        }
    if kind == "costume":
        return {
            "kind": kind,
            "id": item["id"],
            "name": item["服装名称"],
            "category": item["分类"],
            "tags": item.get("标签", []),
            "thumb": RAW + item["缩略图"],
            "original": RAW + item["原图"],
        }
    return {
        "kind": kind,
        "id": item["id"],
        "name": item["标题"],
        "section": item["分区"],
        "hair": item["发长"] + " " + item["发型名称"],
        "thumb": RAW + item["缩略图"],
        "original": RAW + item["原图"],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("query", nargs="?", default="")
    ap.add_argument("--kind", choices=["pose", "costume", "portrait", "all"], default="pose")
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--include-adult", action="store_true")
    ap.add_argument("--fetch", action="store_true")
    ap.add_argument("--out", default="./pose-picks")
    ap.add_argument("--repo", default="")
    ap.add_argument("--cache-dir", default=DEFAULT_CACHE)
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    kinds = ["pose", "costume", "portrait"] if args.kind == "all" else [args.kind]
    for kind in kinds:
        for item in search(args.query, kind, args.limit, args.include_adult,
                           args.repo, args.cache_dir, args.refresh):
            d = describe(kind, item)
            if args.fetch:
                d["local_file"] = download(d["original"],
                                           os.path.join(args.out, d["original"].rsplit("/", 1)[-1]))
            print(json.dumps(d, ensure_ascii=False))


if __name__ == "__main__":
    main()
