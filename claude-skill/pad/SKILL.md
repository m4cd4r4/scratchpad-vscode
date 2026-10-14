---
name: pad
description: Add to and query the user's VS Code Scratchpad (saved prompts, URLs, file paths, quick notes). Use for '/pad', 'add this to the extension', 'add this to the pad', 'save this prompt', 'list the paths I added yesterday', 'what's in my scratchpad'.
---

# /pad: the Scratchpad notes store

The VS Code "Scratchpad" extension (repo `<path-to-this-repo>`) shows one JSONL file, `~/.claude/pad/notes.jsonl`. This skill reads and writes the same file through the CLI, so anything added here appears in the sidebar within a second.

CLI: `node <path-to-this-repo>/src/cli.js <command>` (written `pad` below).

## Add

Kinds: `prompt` (reusable instruction text; `<slug>`-style placeholders get a fill-in box when copied), `url`, `path`, `note`. Omit `--kind` and it detects url and path; **always pass `--kind prompt` for prompts**.

Write the exact text to a file with the Write tool, then add it by file. Never pass text containing backslashes, `$` amounts or quotes as a Bash argument (the shell halves backslashes and eats `$`).

```
pad add --kind prompt --tag article --file <scratchpad-dir>/pad-text.txt
pad add "https://example.com"          # short, plain text only
```

Add exactly what he gave you, character for character. Do not tidy, summarise or rewrite it. Several paths in one message = one `path` note with one path per line. Read the printed id back and say it in one line.

## Query

```
pad list --on yesterday --kind path        # day filter: today | yesterday | YYYY-MM-DD
pad list --since 3d                        # 3d, 12h, yesterday, YYYY-MM-DD
pad list --search "article plan" --full    # --full prints whole text
pad show <id>        # print one note's text
pad rm <id>          # delete (the sidebar offers Undo; the CLI does not)
```

Dates are local time (machine local time). "Yesterday" is yesterday's local calendar day, not the last 24 hours. For "list the file paths added yesterday", run `list --on yesterday --kind path --full` and print one path per line, nothing else.

## Rules

- The pad is the user's notepad, not a memory system. Never add to it on your own.
- Delete only when he names the note; confirm the match with `pad list --search` first if more than one could fit.
- Empty result prints `(none)`: say so plainly, and do not widen the date range unasked.
