'use strict';
// Loads extension.js against a stubbed `vscode` and drives the commands the UI would.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'padx-')), 'notes.jsonl');
process.env.SCRATCHPAD_FILE = file;

const cmds = {};
const ctxKeys = {};
let clipboard = '';
let inputs = [];
let quickPick = (items) => items[0];
let trees = {};

class TreeItem { constructor(label, state) { this.label = label; this.collapsibleState = state; } }
class MarkdownString { appendCodeblock(t) { this.v = t; return this; } }
class EventEmitter { constructor() { this.event = () => {}; this.n = 0; } fire() { this.n++; } }
const vscodeStub = {
  TreeItem, MarkdownString, EventEmitter,
  ThemeIcon: class { constructor(id) { this.id = id; } },
  TreeItemCollapsibleState: { None: 0, Expanded: 2 },
  Uri: { file: (p) => ({ fsPath: p }) },
  commands: {
    registerCommand: (id, fn) => { cmds[id] = fn; return { dispose() {} }; },
    executeCommand: (id, k, v) => { if (id === 'setContext') ctxKeys[k] = v; },
  },
  env: { clipboard: { writeText: async (t) => { clipboard = t; }, readText: async () => clipboard } },
  window: {
    setStatusBarMessage() {},
    showWarningMessage() {},
    showInformationMessage: async () => undefined,
    showInputBox: async () => inputs.shift(),
    showQuickPick: async (items) => quickPick(items),
    createTreeView: (id, o) => { trees[id] = o.treeDataProvider; return { dispose() {} }; },
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

test('activate registers every contributed command', () => {
  const ctx = { subscriptions: [] };
  ext.activate(ctx);
  const declared = require('../package.json').contributes.commands.map((c) => c.command);
  for (const c of declared) assert.ok(cmds[c], 'missing handler ' + c);
  assert.strictEqual(ctxKeys['scratchpad.empty'], true);
  for (const s of ctx.subscriptions) if (s.dispose) s.dispose();
});

test('add from clipboard, tree groups, copy fills placeholders', async () => {
  clipboard = 'Save the plan to C:/x/<slug>.md. Do not commit it.';
  quickPick = (items) => items.find((i) => i.k === 'prompt');
  await cmds['scratchpad.addFromClipboard']();
  clipboard = 'https://example.com';
  quickPick = (items) => items[0];
  await cmds['scratchpad.addFromClipboard']();
  assert.strictEqual(ctxKeys['scratchpad.empty'], false);

  const groups = trees['scratchpad.list'].getChildren();
  assert.deepStrictEqual(groups.map((g) => g.label), ['Prompts', 'URLs']);
  const item = trees['scratchpad.list'].getChildren(groups[0])[0];
  inputs = ['my-article'];
  await cmds['scratchpad.copy'](item.command.arguments[0]);
  assert.strictEqual(clipboard, 'Save the plan to C:/x/my-article.md. Do not commit it.');
  inputs = [undefined];
  await cmds['scratchpad.copy'](item.command.arguments[0]);
  assert.ok(clipboard.includes('<slug>'));
  await cmds['scratchpad.copyRaw']({ entryId: item.command.arguments[0] });
  assert.ok(clipboard.includes('<slug>'));
});

test('addPath stores forward-slash paths; delete removes', async () => {
  await cmds['scratchpad.addPath']({ fsPath: 'C:\\Scratch\\a b\\c.md' }, undefined);
  const store = require('../src/store');
  const p = store.load(file).find((e) => e.kind === 'path');
  assert.strictEqual(p.text, 'C:/Scratch/a b/c.md');
  await cmds['scratchpad.delete'](p.id);
  assert.ok(!store.load(file).some((e) => e.id === p.id));
});
