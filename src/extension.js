'use strict';
const fs = require('fs');
const vscode = require('vscode');
const store = require('./store');

const ICONS = { prompt: 'comment-discussion', url: 'link', path: 'file', note: 'note' };
const GROUPS = { prompt: 'Prompts', url: 'URLs', path: 'File paths', note: 'Notes' };

function activate(ctx) {
  const cfg = () => vscode.workspace.getConfiguration('scratchpad');
  const getFile = () => cfg().get('file') || store.defaultFile();
  let filter = '';
  let watched = null;
  const changed = new vscode.EventEmitter();

  const entries = () => store.query(store.load(getFile()), { q: filter });
  const byId = (id) => store.findById(store.load(getFile()), id);
  const idOf = (arg) => (typeof arg === 'string' ? arg : arg && arg.entryId);

  function refresh() {
    const total = store.load(getFile()).length;
    vscode.commands.executeCommand('setContext', 'scratchpad.filtered', !!filter);
    vscode.commands.executeCommand('setContext', 'scratchpad.empty', total === 0);
    changed.fire();
  }

  function watch() {
    if (watched) fs.unwatchFile(watched);
    watched = getFile();
    fs.watchFile(watched, { interval: 1000 }, refresh);
  }

  const provider = {
    onDidChangeTreeData: changed.event,
    getTreeItem: (el) => el,
    getChildren(el) {
      if (el) return el.children;
      const all = entries();
      return store.KINDS.filter((k) => all.some((e) => e.kind === k)).map((k) => {
        const g = new vscode.TreeItem(GROUPS[k], vscode.TreeItemCollapsibleState.Expanded);
        g.iconPath = new vscode.ThemeIcon(ICONS[k]);
        g.description = String(all.filter((e) => e.kind === k).length);
        g.children = all.filter((e) => e.kind === k).map(entryItem);
        return g;
      });
    },
  };

  function entryItem(e) {
    const flat = (e.title || e.text.split(/\r?\n/).find((l) => l.trim()) || '').trim();
    const item = new vscode.TreeItem(
      flat.length > 90 ? flat.slice(0, 89) + '…' : flat,
      vscode.TreeItemCollapsibleState.None,
    );
    item.entryId = e.id;
    item.contextValue = 'padEntry';
    item.description = store.relative(e.ts) + (e.tags && e.tags.length ? '  #' + e.tags.join(' #') : '');
    item.tooltip = new vscode.MarkdownString().appendCodeblock(e.text.slice(0, 2000), 'text');
    item.command = { command: 'scratchpad.copy', title: 'Copy', arguments: [e.id] };
    return item;
  }

  async function fillPlaceholders(e) {
    if (e.kind !== 'prompt' || !cfg().get('fillPlaceholders')) return e.text;
    const names = [...new Set([...e.text.matchAll(/<([A-Za-z][\w.-]*)>/g)].map((m) => m[1]))];
    let text = e.text;
    for (const n of names) {
      const v = await vscode.window.showInputBox({
        title: `Fill <${n}>`,
        prompt: 'Enter to fill, Esc to leave it as <' + n + '>',
      });
      if (v !== undefined && v !== '') text = text.split(`<${n}>`).join(v);
    }
    return text;
  }

  async function copyText(text, e) {
    await vscode.env.clipboard.writeText(text);
    vscode.window.setStatusBarMessage(`$(check) Copied ${e.kind}`, 2500);
  }

  async function pickKind(text) {
    const guess = store.detectKind(text);
    const order = [guess, ...store.KINDS.filter((k) => k !== guess)];
    const pick = await vscode.window.showQuickPick(
      order.map((k) => ({ label: k, description: k === guess ? 'detected' : '', k })),
      { title: 'Add as', placeHolder: text.split(/\r?\n/)[0].slice(0, 80) },
    );
    return pick && pick.k;
  }

  async function addText(text) {
    if (!text || !text.trim()) {
      vscode.window.showWarningMessage('Scratchpad: nothing to add.');
      return;
    }
    const kind = await pickKind(text);
    if (!kind) return;
    store.add(getFile(), { text, kind });
    refresh();
    vscode.window.setStatusBarMessage(`$(check) Added ${kind}`, 2500);
  }

  const fwd = (p) => p.replace(/\\/g, '/');
  const reg = (id, fn) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('scratchpad.copy', async (arg) => {
    const e = byId(idOf(arg));
    if (e) await copyText(await fillPlaceholders(e), e);
  });
  reg('scratchpad.copyRaw', async (arg) => {
    const e = byId(idOf(arg));
    if (e) await copyText(e.text, e);
  });
  reg('scratchpad.addFromClipboard', async () => addText(await vscode.env.clipboard.readText()));
  reg('scratchpad.addFromSelection', async () => {
    const ed = vscode.window.activeTextEditor;
    if (ed) await addText(ed.document.getText(ed.selection));
  });
  reg('scratchpad.addNote', async () => {
    const v = await vscode.window.showInputBox({ title: 'Add to Scratchpad', prompt: 'One line. For multi-line text, copy it and use "Add from Clipboard".' });
    if (v !== undefined) await addText(v);
  });
  reg('scratchpad.addPath', async (uri, uris) => {
    const list = (uris && uris.length ? uris : uri ? [uri] : [])
      .map((u) => fwd(u.fsPath));
    if (!list.length && vscode.window.activeTextEditor) list.push(fwd(vscode.window.activeTextEditor.document.uri.fsPath));
    if (!list.length) return;
    store.add(getFile(), { text: list.join('\n'), kind: 'path' });
    refresh();
    vscode.window.setStatusBarMessage(`$(check) Added ${list.length} path${list.length > 1 ? 's' : ''}`, 2500);
  });
  reg('scratchpad.delete', async (arg) => {
    const e = byId(idOf(arg));
    if (!e) return;
    store.remove(getFile(), e.id);
    refresh();
    const undo = await vscode.window.showInformationMessage('Scratchpad: deleted.', 'Undo');
    if (undo) { store.restore(getFile(), e); refresh(); }
  });
  reg('scratchpad.filter', async () => {
    const v = await vscode.window.showInputBox({ title: 'Filter Scratchpad', value: filter, prompt: 'Matches text, title and tags' });
    if (v !== undefined) { filter = v.trim(); refresh(); }
  });
  reg('scratchpad.clearFilter', () => { filter = ''; refresh(); });
  reg('scratchpad.refresh', refresh);
  reg('scratchpad.openFile', () => vscode.window.showTextDocument(vscode.Uri.file(getFile())));

  ctx.subscriptions.push(
    vscode.window.createTreeView('scratchpad.list', { treeDataProvider: provider }),
    vscode.workspace.onDidChangeConfiguration((ev) => {
      if (ev.affectsConfiguration('scratchpad')) { watch(); refresh(); }
    }),
    { dispose: () => { if (watched) fs.unwatchFile(watched); } },
  );
  watch();
  refresh();
}

function deactivate() {}

module.exports = { activate, deactivate };
