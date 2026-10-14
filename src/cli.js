#!/usr/bin/env node
'use strict';
// CLI used by the /pad skill. Same store as the extension.
const fs = require('fs');
const store = require('./store');

const HELP = `pad - scratchpad notes (file: ${store.defaultFile()})

  add [--kind prompt|url|path|note] [--tag t]... [--title t] (--file <path> | <text>)
  list [--on today|yesterday|YYYY-MM-DD] [--since 3d|12h|yesterday|YYYY-MM-DD]
       [--kind k] [--tag t] [--search q] [--full] [--json]
  show <id>
  rm <id>
`;

function parseArgs(argv) {
  const o = { _: [], tag: [] };
  const flags = new Set(['full', 'json']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (flags.has(k)) o[k] = true;
      else if (k === 'tag') o.tag.push(argv[++i]);
      else o[k] = argv[++i];
    } else o._.push(a);
  }
  return o;
}

function firstLine(e, max) {
  const l = (e.title || e.text.split(/\r?\n/).find((x) => x.trim()) || '').trim();
  const more = !e.title && e.text.includes('\n') ? ' [+]' : '';
  return (l.length > max ? l.slice(0, max - 1) + '…' : l) + more;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const o = parseArgs(rest);
  const file = store.defaultFile();

  if (cmd === 'add') {
    const text = o.file ? fs.readFileSync(o.file, 'utf8') : o._.join(' ');
    const e = store.add(file, { text, kind: o.kind, title: o.title, tags: o.tag });
    console.log(`added ${e.id} [${e.kind}] ${store.formatLocal(e.ts)}`);
  } else if (cmd === 'list') {
    const q = { kind: o.kind, tag: o.tag[0], q: o.search };
    if (o.on) Object.assign(q, store.parseWhen(o.on));
    else if (o.since) q.from = store.parseWhen(o.since).from;
    const rows = store.query(store.load(file), q);
    if (o.json) console.log(JSON.stringify(rows, null, 2));
    else if (!rows.length) console.log('(none)');
    else for (const e of rows) {
      const head = `${e.id}  ${store.formatLocal(e.ts)}  ${e.kind.padEnd(6)}`;
      console.log(o.full ? `${head}\n${e.text}\n` : `${head}  ${firstLine(e, 100)}`);
    }
  } else if (cmd === 'show') {
    const e = store.findById(store.load(file), o._[0] || '');
    if (!e) { console.error('no unique match for id'); process.exit(1); }
    console.log(e.text);
  } else if (cmd === 'rm') {
    const e = store.findById(store.load(file), o._[0] || '');
    if (!e) { console.error('no unique match for id'); process.exit(1); }
    store.remove(file, e.id);
    console.log(`removed ${e.id}: ${firstLine(e, 60)}`);
  } else {
    console.log(HELP);
    process.exit(cmd ? 1 : 0);
  }
}

try { main(); } catch (err) { console.error('pad: ' + err.message); process.exit(1); }
