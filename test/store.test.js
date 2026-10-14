'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const s = require('../src/store');

function tmp() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pad-')), 'sub', 'notes.jsonl');
}

test('detectKind', () => {
  assert.strictEqual(s.detectKind('https://example.com/a?b=1'), 'url');
  assert.strictEqual(s.detectKind('C:/Scratch/m4cd4r4-site/docs/x.md'), 'path');
  assert.strictEqual(s.detectKind('C:\\Program Files\\Brave\\brave.exe'), 'path');
  assert.strictEqual(s.detectKind('~/.claude/rules/x.md'), 'path');
  assert.strictEqual(s.detectKind('C:/a/b.md\nC:/a/c.md'), 'path');
  assert.strictEqual(s.detectKind('/commit now please'), 'note');
  assert.strictEqual(s.detectKind('SSF header menu alignment: https://claude.ai/artifact/GTwSsM8kJCXxdvsVp1mhR7'), 'note');
  assert.strictEqual(s.detectKind('Save the plan to C:/x/<slug>.md'), 'prompt');
  assert.strictEqual(s.detectKind('First line\nsecond line'), 'prompt');
});

test('add creates dirs, load returns newest first', () => {
  const f = tmp();
  s.add(f, { text: 'one', now: new Date('2026-10-12T01:00:00Z') });
  s.add(f, { text: 'two', kind: 'prompt', tags: ['a'], now: new Date('2026-10-13T01:00:00Z') });
  const all = s.load(f);
  assert.deepStrictEqual(all.map((e) => e.text), ['two', 'one']);
  assert.strictEqual(all[0].kind, 'prompt');
  assert.deepStrictEqual(all[0].tags, ['a']);
});

test('rejects empty text and bad kind', () => {
  const f = tmp();
  assert.throws(() => s.add(f, { text: '  \n' }));
  assert.throws(() => s.add(f, { text: 'x', kind: 'nope' }));
});

test('delete, restore, edit fold correctly', () => {
  const f = tmp();
  const a = s.add(f, { text: 'keep' });
  const b = s.add(f, { text: 'drop' });
  s.remove(f, b.id);
  assert.deepStrictEqual(s.load(f).map((e) => e.text), ['keep']);
  s.restore(f, b);
  assert.strictEqual(s.load(f).length, 2);
  s.edit(f, a.id, { text: 'kept' });
  assert.strictEqual(s.load(f).find((e) => e.id === a.id).text, 'kept');
});

test('append survives a missing trailing newline and bad lines', () => {
  const f = tmp();
  s.add(f, { text: 'one' });
  fs.appendFileSync(f, 'not json');
  s.add(f, { text: 'two' });
  assert.deepStrictEqual(s.load(f).map((e) => e.text).sort(), ['one', 'two']);
});

test('parseWhen and query by local day', () => {
  const now = new Date(2026, 9, 14, 11, 30);
  const y = s.parseWhen('yesterday', now);
  assert.strictEqual(y.from.getDate(), 13);
  assert.strictEqual(y.to.getDate(), 14);
  const f = tmp();
  s.add(f, { text: 'old', kind: 'path', now: new Date(2026, 9, 12, 9) });
  s.add(f, { text: 'yday-path', kind: 'path', now: new Date(2026, 9, 13, 23, 59) });
  s.add(f, { text: 'yday-url', kind: 'url', now: new Date(2026, 9, 13, 8) });
  s.add(f, { text: 'today', kind: 'path', now: new Date(2026, 9, 14, 0, 1) });
  const got = s.query(s.load(f), { ...y, kind: 'path' });
  assert.deepStrictEqual(got.map((e) => e.text), ['yday-path']);
  assert.strictEqual(s.parseWhen('3d', now).to, null);
  assert.throws(() => s.parseWhen('lastweek', now));
});

test('search and id prefix', () => {
  const f = tmp();
  const a = s.add(f, { text: 'Article PLAN here' });
  s.add(f, { text: 'other' });
  const all = s.load(f);
  assert.strictEqual(s.query(all, { q: 'article plan' }).length, 1);
  assert.strictEqual(s.findById(all, a.id.slice(0, 8)).id, a.id);
});
