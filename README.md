# Scratchpad

Sidebar notepad for prompts, URLs and file paths. Click an entry to copy it.

- Notes live in `~/.claude/pad/notes.jsonl` (setting `scratchpad.file` to change).
- Add: view toolbar (clipboard, note), editor selection, or right-click a file in the Explorer.
- Prompts with `<placeholders>` ask for a value on copy; Esc leaves it as is.
- Claude Code: the `/pad` skill uses `src/cli.js` on the same file (`add`, `list --on yesterday --kind path`, `show`, `rm`).

Tests: `npm test`.
