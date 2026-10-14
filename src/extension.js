'use strict';
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const vscode = require('vscode');
const store = require('./store');

const URL_RE = /https?:\/\/[^\s<>"')]+/;

function activate(ctx) {
  const cfg = () => vscode.workspace.getConfiguration('scratchpad');
  const getFile = () => cfg().get('file') || store.defaultFile();
  const byId = (id) => store.findById(store.load(getFile()), id);
  const fwd = (p) => p.replace(/\\/g, '/');
  const deleted = new Map();
  let view = null;
  let watched = null;

  function push() {
    if (!view) return;
    const now = new Date();
    const rows = store.load(getFile()).map((e) => ({ ...e, rel: store.relative(e.ts, now) }));
    view.webview.postMessage({ type: 'state', entries: rows });
  }

  function watch() {
    if (watched) fs.unwatchFile(watched);
    watched = getFile();
    fs.watchFile(watched, { interval: 1000 }, push);
  }

  async function fillPlaceholders(e) {
    if (e.kind !== 'prompt' || !cfg().get('fillPlaceholders')) return e.text;
    const names = [...new Set([...e.text.matchAll(/<([A-Za-z][\w.-]*)>/g)].map((m) => m[1]))];
    let text = e.text;
    for (const n of names) {
      const v = await vscode.window.showInputBox({
        title: `Fill <${n}>`,
        prompt: `Enter to fill, Esc to leave it as <${n}>`,
      });
      if (v !== undefined && v !== '') text = text.split(`<${n}>`).join(v);
    }
    return text;
  }

  function addText(text, kind) {
    if (!text || !text.trim()) {
      vscode.window.showWarningMessage('Scratchpad: nothing to add.');
      return null;
    }
    const e = store.add(getFile(), { text, kind });
    push();
    vscode.window.setStatusBarMessage(`$(check) Added ${e.kind}`, 2500);
    return e;
  }

  async function openEntry(e) {
    if (e.kind === 'path' && !e.text.includes('\n')) {
      const p = e.text.trim().replace(/^~(?=[\\/])/, os.homedir());
      let st;
      try { st = fs.statSync(p); } catch (_) {
        vscode.window.showWarningMessage('Scratchpad: path not found: ' + p);
        return;
      }
      if (st.isDirectory()) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(p));
      else await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(p));
      return;
    }
    const m = URL_RE.exec(e.text);
    if (m) await vscode.env.openExternal(vscode.Uri.parse(m[0].replace(/[.,;:]+$/, '')));
  }

  async function onMessage(m) {
    const file = getFile();
    const post = (x) => view && view.webview.postMessage(x);
    switch (m.type) {
      case 'ready': push(); break;
      case 'add': addText(m.text, m.kind); break;
      case 'copy': {
        const e = byId(m.id);
        if (!e) break;
        await vscode.env.clipboard.writeText(await fillPlaceholders(e));
        post({ type: 'copied', id: e.id });
        break;
      }
      case 'open': { const e = byId(m.id); if (e) await openEntry(e); break; }
      case 'pin': {
        const e = byId(m.id);
        if (e) { store.edit(file, e.id, { pinned: !e.pinned }); push(); }
        break;
      }
      case 'setKind':
        if (store.KINDS.includes(m.kind) && byId(m.id)) { store.edit(file, m.id, { kind: m.kind }); push(); }
        break;
      case 'edit':
        if (byId(m.id) && String(m.text).trim()) { store.edit(file, m.id, { text: String(m.text).replace(/\s+$/, '') }); push(); }
        break;
      case 'del': {
        const e = byId(m.id);
        if (!e) break;
        deleted.set(e.id, e);
        store.remove(file, e.id);
        push();
        post({ type: 'toast', text: 'Deleted', undoId: e.id });
        break;
      }
      case 'restore': {
        const e = deleted.get(m.id);
        if (e) { store.restore(file, e); deleted.delete(m.id); push(); }
        break;
      }
      default: break;
    }
  }

  const provider = {
    resolveWebviewView(v) {
      view = v;
      const media = vscode.Uri.joinPath(ctx.extensionUri, 'media');
      v.webview.options = { enableScripts: true, localResourceRoots: [media] };
      const nonce = crypto.randomBytes(16).toString('hex');
      const uri = (f) => v.webview.asWebviewUri(vscode.Uri.joinPath(media, f));
      v.webview.html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${v.webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${uri('panel.css')}">
<title>Scratchpad</title></head>
<body>
<div class="add">
  <textarea id="add-text" rows="1" placeholder="Paste or type, Enter to add" aria-label="New note"></textarea>
  <div class="add-row">
    <span class="hint">Shift+Enter for a new line</span>
    <select id="add-kind" aria-label="Type"><option value="auto">Auto</option><option value="prompt">Prompt</option><option value="url">URL</option><option value="path">Path</option><option value="note">Note</option></select>
    <button class="btn" id="add-btn">Add</button>
  </div>
</div>
<input class="search" id="search" type="search" placeholder="Search notes" aria-label="Search notes">
<div class="chips" id="chips"></div>
<div id="list"></div>
<div class="toast" id="toast" hidden></div>
<script nonce="${nonce}" src="${uri('panel.js')}"></script>
</body></html>`;
      v.webview.onDidReceiveMessage(onMessage);
      v.onDidChangeVisibility(() => { if (v.visible) push(); });
      v.onDidDispose(() => { view = null; });
    },
  };

  const reg = (id, fn) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg('scratchpad.addFromClipboard', async () => { addText(await vscode.env.clipboard.readText()); });
  reg('scratchpad.addFromSelection', () => {
    const ed = vscode.window.activeTextEditor;
    if (ed) addText(ed.document.getText(ed.selection));
  });
  reg('scratchpad.addPath', (uri, uris) => {
    const list = (uris && uris.length ? uris : uri ? [uri] : []).map((u) => fwd(u.fsPath));
    if (!list.length && vscode.window.activeTextEditor) list.push(fwd(vscode.window.activeTextEditor.document.uri.fsPath));
    if (list.length) addText(list.join('\n'), 'path');
  });
  reg('scratchpad.openFile', () => vscode.window.showTextDocument(vscode.Uri.file(getFile())));

  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider('scratchpad.list', provider, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.workspace.onDidChangeConfiguration((ev) => {
      if (ev.affectsConfiguration('scratchpad')) { watch(); push(); }
    }),
    { dispose: () => { if (watched) fs.unwatchFile(watched); } },
  );
  watch();
}

function deactivate() {}

module.exports = { activate, deactivate };
