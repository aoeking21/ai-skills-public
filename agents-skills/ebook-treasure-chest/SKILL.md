---
name: ebook-treasure-chest
description: "Use the local ebook-treasure-chest catalog when the user asks to find books, authors, reading material, topic-related books, ebook formats, or explicitly mentions 电子书宝库. Search the local 24k+ catalog first. Treat it as a discovery/index source, not as full-text book content. For full-text analysis, use lawful/user-owned text sources."
---

# ebook-treasure-chest

This skill integrates the local repository at:

`~/Applications/ebook-treasure-chest`

and the desktop launcher:

`~/Desktop/电子书宝库.app`

## Automatic routing

Use this skill automatically when the task asks for:
- books about a topic
- a specific title or author
- ebook availability in the local catalog
- reading recommendations that benefit from checking the local catalog
- searches explicitly referring to 电子书宝库 / ebook-treasure-chest

For automated work, query the local JSON index directly. Do not launch the GUI unless the user asks to browse visually or opening the app is useful.

## Search command

```bash
ebook-treasure search "QUERY" --limit 10
```

JSON output:

```bash
ebook-treasure search "QUERY" --limit 10 --json
```

Open the local app:

```bash
ebook-treasure open
```

Status:

```bash
ebook-treasure status
```

## Knowledge boundary

The repository contains book metadata and links, not the full text of all books. Do not infer book contents from catalog metadata alone. When a user needs chapter-level or full-text knowledge, identify the book with this skill, then use a lawful public source or a user-owned/uploaded copy for substantive analysis.
