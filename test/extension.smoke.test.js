'use strict';
// Loads extension.js against a stubbed `vscode` and drives the webview messages the panel would send.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'padx-')), 'notes.jsonl');
process.env.SCRATCHPAD_FILE = file;

const cmds = {};
let clipboard = '';
let inputs = [];
let provider = null;
const posted = [];
let onMsg = null;
const opened = [];

const vscodeStub = {
  Uri: {
    file: (p) => ({ fsPath: p }),
    parse: (s) => ({ s }),
    joinPath: (b, ...p) => ({ fsPath: [b.fsPath, ...p].join('/') }),
  },
  commands: { registerCommand: (id, fn) => { cmds[id] = fn; return { dispose() {} }; }, executeCommand: async () => {} },
  env: {
    clipboard: { writeText: async (t) => { clipboard = t; }, readText: async () => clipboard },
    openExternal: async (u) => { opened.push(u.s); },
  },
  window: {
    setStatusBarMessage() {},
    showWarningMessage() {},
    showInputBox: async () => inputs.shift(),
    registerWebviewViewProvider: (id, p) => { provider = p; return { dispose() {} }; },
    activeTextEditor: undefined,
  },
  workspace: {
    getConfiguration: () => ({ get: (k) => (k === 'fillPlaceholders' ? true : '') }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
  },
};
const orig = Module._load;
Module._load = function (req, ...a) { return req === 'vscode' ? vscodeStub : orig.call(this, req, ...a); };
const ext = require('../src/extension');
Module._load = orig;
const store = require('../src/store');

const lastState = () => [...posted].reverse().find((m) => m.type === 'state');
const send = async (m) => { await onMsg(m); };

const ctx = { subscriptions: [], extensionUri: { fsPath: '/ext' } };
test.after(() => { for (const s of ctx.subscriptions) if (s.dispose) s.dispose(); });
test('activate registers commands and the webview provider; html is CSP-safe', () => {
  ext.activate(ctx);
  const declared = require('../package.json').contributes.commands.map((c) => c.command);
  for (const c of declared) assert.ok(cmds[c], 'missing handler ' + c);
  const view = {
    visible: true,
    webview: {
      options: null, html: '', cspSource: 'CSP',
      asWebviewUri: (u) => 'WV:' + u.fsPath,
      onDidReceiveMessage: (cb) => { onMsg = cb; },
      postMessage: (m) => { posted.push(m); return true; },
    },
    onDidChangeVisibility: () => {}, onDidDispose: () => {},
  };
  provider.resolveWebviewView(view);
  assert.ok(view.webview.options.enableScripts);
  const html = view.webview.html;
  const nonce = /script nonce="([0-9a-f]{32})"/.exec(html)[1];
  assert.ok(html.includes(`script-src 'nonce-${nonce}'`));
  assert.ok(html.includes('WV:/ext/media/panel.js') && html.includes('WV:/ext/media/panel.css'));
  assert.ok(!/<script(?![^>]*nonce)/.test(html), 'inline script without nonce');
  for (const id of ['add-text', 'add-kind', 'add-btn', 'search', 'chips', 'list', 'toast']) assert.ok(html.includes(`id="${id}"`), id);
});

test('add, state, copy with placeholders', async () => {
  await send({ type: 'ready' });
  assert.deepStrictEqual(lastState().entries, []);
  await send({ type: 'add', text: 'Save the plan to C:/x/<slug>.md. Do not commit it.' });
  await send({ type: 'add', text: 'https://example.com', kind: undefined });
  const st = lastState().entries;
  assert.deepStrictEqual(st.map((e) => e.kind).sort(), ['prompt', 'url']);
  assert.ok(st[0].rel);
  const prompt = st.find((e) => e.kind === 'prompt');
  inputs = ['my-article'];
  await send({ type: 'copy', id: prompt.id });
  assert.strictEqual(clipboard, 'Save the plan to C:/x/my-article.md. Do not commit it.');
  assert.deepStrictEqual(posted.at(-1), { type: 'copied', id: prompt.id });
  inputs = [undefined];
  await send({ type: 'copy', id: prompt.id });
  assert.ok(clipboard.includes('<slug>'));
});

test('pin, setKind, edit, open url', async () => {
  const note = (await (async () => { await send({ type: 'add', text: 'SSF menu: https://claude.ai/artifact/abc.' }); return lastState().entries.find((e) => e.text.startsWith('SSF')); })());
  assert.strictEqual(note.kind, 'note');
  await send({ type: 'pin', id: note.id });
  assert.strictEqual(lastState().entries.find((e) => e.id === note.id).pinned, true);
  await send({ type: 'setKind', id: note.id, kind: 'url' });
  assert.strictEqual(lastState().entries.find((e) => e.id === note.id).kind, 'url');
  await send({ type: 'setKind', id: note.id, kind: 'bogus' });
  assert.strictEqual(lastState().entries.find((e) => e.id === note.id).kind, 'url');
  await send({ type: 'edit', id: note.id, text: 'SSF menu v2: https://claude.ai/artifact/abc.  ' });
  assert.strictEqual(lastState().entries.find((e) => e.id === note.id).text, 'SSF menu v2: https://claude.ai/artifact/abc.');
  await send({ type: 'open', id: note.id });
  assert.deepStrictEqual(opened, ['https://claude.ai/artifact/abc']);
});

test('addPath uses forward slashes; delete + undo', async () => {
  await cmds['scratchpad.addPath']({ fsPath: 'C:\\Scratch\\a b\\c.md' }, undefined);
  const p = store.load(file).find((e) => e.kind === 'path');
  assert.strictEqual(p.text, 'C:/Scratch/a b/c.md');
  await send({ type: 'del', id: p.id });
  assert.ok(!lastState().entries.some((e) => e.id === p.id));
  assert.deepStrictEqual(posted.at(-1), { type: 'toast', text: 'Deleted', undoId: p.id });
  await send({ type: 'restore', id: p.id });
  assert.ok(lastState().entries.some((e) => e.id === p.id));
});
