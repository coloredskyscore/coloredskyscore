#!/usr/bin/env python3
"""Write one short-link page per rated chain: coloredskyscore.com/<slug>/.

Each page carries its own link-preview tags (so a post on X unfurls with the
chain's name) and forwards the visitor to the chain view inside index.html
(/#chain=<slug>). The pages hold no scores, so they never go stale when a
rating changes. Run from the repo root after adding a chain to board.json:

    python3 tools/make_chain_pages.py

Only chains listed in data/board.json get a page; existing pages are
overwritten with the same template.
"""
import html
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://coloredskyscore.com"

TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{name} ({cashtag}) ratings · coloredsky score</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{site}/{slug}/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="coloredsky score">
<meta property="og:title" content="{name} ({cashtag}) · coloredsky score">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{site}/{slug}/">
<meta property="og:image" content="{site}/og_image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@thecoloredsky">
<meta name="twitter:title" content="{name} ({cashtag}) · coloredsky score">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{site}/og_image.png">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta http-equiv="refresh" content="0; url=/#chain={slug}">
<script>location.replace('/#chain={slug}');</script>
<style>body{{margin:0;padding:48px 24px;background:#0B1220;color:#F4F1E9;font-family:system-ui,sans-serif}}a{{color:#C2A268}}</style>
</head>
<body>
<p>Opening the {name} rating. <a href="/#chain={slug}">Continue to coloredsky score</a></p>
</body>
</html>
"""


def main():
    with open(os.path.join(ROOT, "data", "board.json"), encoding="utf-8") as f:
        board = json.load(f)
    written = []
    for c in board["chains"]:
        slug = c["slug"]
        if not slug.isalnum() or slug in ("data", "tools"):
            raise SystemExit(f"refusing unsafe slug: {slug!r}")
        name, cashtag = html.escape(c["name"]), html.escape(c["cashtag"])
        desc = html.escape(
            f"{c['name']}'s TradFi and AI readiness ratings, scored on documented "
            "fundamentals. No hype, no price targets."
        )
        page = TEMPLATE.format(name=name, cashtag=cashtag, desc=desc, slug=slug, site=SITE)
        os.makedirs(os.path.join(ROOT, slug), exist_ok=True)
        with open(os.path.join(ROOT, slug, "index.html"), "w", encoding="utf-8") as f:
            f.write(page)
        written.append(slug)
    print(f"wrote {len(written)} chain pages: {', '.join(written)}")


if __name__ == "__main__":
    main()
