<div align="center">

<img src="media/icon.png" alt="Scratchpad logo: four coloured scratch marks" width="112" height="112">

# Scratchpad

**A notepad in your VS Code sidebar for the prompts, URLs and file paths you keep reusing.**
Paste it once, click to copy it forever. Claude Code can add to it and query it by date.

![VS Code 1.85+](https://img.shields.io/badge/VS%20Code-1.85%2B-007ACC?logo=visualstudiocode&logoColor=white)
![License MIT](https://img.shields.io/badge/license-MIT-green)

<img src="docs/screenshot.png" alt="Scratchpad sidebar showing a pinned note and three cards" width="330">

</div>

## What it does

| | |
|---|---|
| **Quick add** | Paste or type in the box at the top and press Enter. Shift+Enter starts a new line. The type (prompt, URL, path, note) is detected for you. |
| **Click to copy** | Click any card to copy it. A prompt with `<placeholders>` asks for each value first; Esc leaves a placeholder as it is. |
| **Cards, not rows** | Long text wraps to three lines with Show more. Each card shows its type and when you added it. |
| **Pin, edit, delete** | Pinned cards sit at the top. Delete has a six-second Undo. Click a card's type label to change its type. |
| **Search and filter** | Live search plus type chips with counts. Chips with nothing in them are hidden. |
| **Open** | URL cards open in your browser. Path cards open the file, or reveal the folder. |
| **Add from anywhere** | Right-click a file in the Explorer to add its path. Right-click selected text in the editor to add it. |

## Install

```
npx @vscode/vsce package --no-dependencies
code --install-extension scratchpad-vscode-0.2.1.vsix
```

Then run **Developer: Reload Window** and click the Scratchpad icon in the activity bar.

## Where your notes live

One plain-text file: `~/.claude/pad/notes.jsonl`. Change it with the `scratchpad.file` setting.
Each line is one JSON event (create, edit or delete), so the file only ever grows and a note is never half-written.
The panel watches the file and refreshes within a second of any change, including changes made by other tools.

Settings:

| Setting | Default | What it does |
|---|---|---|
| `scratchpad.file` | empty (uses the path above) | Notes file location. |
| `scratchpad.fillPlaceholders` | `true` | Ask for a value for each `<placeholder>` when copying a prompt. |

## Use with Claude Code (optional)

Copy `claude-skill/pad` to `~/.claude/skills/pad` and replace `<path-to-this-repo>` in it with this repo's path.
Claude then reads and writes the same file through `src/cli.js`:

| You say | Claude runs |
|---|---|
| "Add this to the pad" | `add` with your exact text |
| "List the file paths I added yesterday" | `list --on yesterday --kind path` |
| "What prompts did I tag article?" | `list --kind prompt --tag article` |
| "Anything from the last 3 days?" | `list --since 3d` |

## Development

```
npm test
```

The tests cover the note store (kind detection, folding edits and deletes, date queries) and drive the extension against a stubbed `vscode` module, including the messages the panel sends. There are no runtime dependencies.

## Licence

MIT
