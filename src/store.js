'use strict';
// Append-only JSONL store shared by the extension and the CLI.
// Line types: create {id,ts,kind,text,title?,tags?}, edit {id,op:'edit',ts,...fields}, delete {id,op:'del',ts}.
// A create line with an id that was deleted restores it (used by Undo).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const KINDS = ['prompt', 'url', 'path', 'note'];

function defaultFile() {
  return process.env.SCRATCHPAD_FILE || path.join(os.homedir(), '.claude', 'pad', 'notes.jsonl');
}

function isPathLine(l) {
  if (/^[A-Za-z]:[\\/]/.test(l)) return true;
  return /^(~|\.{1,2})?[\\/]\S*$/.test(l);
}

function detectKind(text) {
  const t = String(text).trim();
  if (/^https?:\/\/\S+$/i.test(t)) return 'url';
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length && lines.every(isPathLine)) return 'path';
  // Placeholders, multi-line text or a long run of words read as a reusable prompt.
  if (/<[A-Za-z][\w.-]*>/.test(t) || lines.length > 1 || t.length >= 120) return 'prompt';
  return 'note';
}

function newId() {
  return crypto.randomBytes(4).toString('hex');
}

function append(file, line) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let prefix = '';
  try {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    if (size > 0) {
      const b = Buffer.alloc(1);
      fs.readSync(fd, b, 0, 1, size - 1);
      if (b[0] !== 0x0a) prefix = '\n';
    }
    fs.closeSync(fd);
  } catch (_) { /* file does not exist yet */ }
  fs.appendFileSync(file, prefix + JSON.stringify(line) + '\n', 'utf8');
}

function add(file, { text, kind, title, tags, now }) {
  const body = String(text).replace(/\s+$/, '');
  if (!body.trim()) throw new Error('empty note');
  if (kind && !KINDS.includes(kind)) throw new Error('kind must be one of: ' + KINDS.join(', '));
  const entry = {
    id: newId(),
    ts: (now || new Date()).toISOString(),
    kind: kind || detectKind(body),
    text: body,
  };
  if (title) entry.title = title;
  if (tags && tags.length) entry.tags = tags;
  append(file, entry);
  return entry;
}

function remove(file, id, now) {
  append(file, { id, op: 'del', ts: (now || new Date()).toISOString() });
}

function restore(file, entry) {
  const { edited, ...create } = entry;
  append(file, create);
}

function edit(file, id, fields, now) {
  append(file, { id, op: 'edit', ts: (now || new Date()).toISOString(), ...fields });
}

function load(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (_) { return []; }
  const map = new Map();
  for (const l of raw.split('\n')) {
    if (!l.trim()) continue;
    let o;
    try { o = JSON.parse(l); } catch (_) { continue; }
    if (!o || !o.id) continue;
    if (o.op === 'del') map.delete(o.id);
    else if (o.op === 'edit') {
      const cur = map.get(o.id);
      if (cur) { const { op, ts, ...f } = o; map.set(o.id, { ...cur, ...f, edited: ts }); }
    } else if (o.text !== undefined) map.set(o.id, o);
  }
  return [...map.values()].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
}

function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }

// "today" | "yesterday" | YYYY-MM-DD -> [from, to) local day; "Nd"/"Nh" -> [now-N, open end)
function parseWhen(s, now) {
  now = now || new Date();
  const v = String(s).trim().toLowerCase();
  if (v === 'today') { const f = startOfDay(now); return { from: f, to: addDays(f, 1) }; }
  if (v === 'yesterday') { const f = addDays(startOfDay(now), -1); return { from: f, to: addDays(f, 1) }; }
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) { const f = new Date(+m[1], +m[2] - 1, +m[3]); return { from: f, to: addDays(f, 1) }; }
  m = /^(\d+)([dh])$/.exec(v);
  if (m) {
    const ms = +m[1] * (m[2] === 'd' ? 86400000 : 3600000);
    return { from: new Date(now.getTime() - ms), to: null };
  }
  throw new Error('cannot read date "' + s + '" (use today, yesterday, YYYY-MM-DD, 3d, 12h)');
}

function query(entries, { from, to, kind, tag, q } = {}) {
  const needle = q ? String(q).toLowerCase() : '';
  return entries.filter((e) => {
    const t = new Date(e.ts);
    if (from && t < from) return false;
    if (to && t >= to) return false;
    if (kind && e.kind !== kind) return false;
    if (tag && !(e.tags || []).includes(tag)) return false;
    if (needle) {
      const hay = (e.text + '\n' + (e.title || '') + '\n' + (e.tags || []).join(' ')).toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

function findById(entries, idOrPrefix) {
  const hits = entries.filter((e) => e.id === idOrPrefix);
  if (hits.length === 1) return hits[0];
  const pre = entries.filter((e) => e.id.startsWith(idOrPrefix));
  return pre.length === 1 ? pre[0] : null;
}

function pad2(n) { return String(n).padStart(2, '0'); }
function formatLocal(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function relative(iso, now) {
  const d = new Date(iso);
  now = now || new Date();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (days <= 0) return 'today ' + hm;
  if (days === 1) return 'yesterday ' + hm;
  if (days < 7) return days + 'd ago';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

module.exports = {
  KINDS, defaultFile, detectKind, add, remove, restore, edit, load,
  parseWhen, query, findById, formatLocal, relative,
};
