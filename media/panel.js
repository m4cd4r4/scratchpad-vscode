(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const KINDS = ['prompt', 'url', 'path', 'note'];
  const LABEL = { prompt: 'Prompt', url: 'URL', path: 'Path', note: 'Note' };
  const CHIPS = [['all', 'All'], ['prompt', 'Prompts'], ['url', 'URLs'], ['path', 'Paths'], ['note', 'Notes']];
  const ICON = {
    copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M3 10.5V4.5A1.5 1.5 0 0 1 4.5 3h6"/>',
    pin: '<path d="M4.5 2.5h7v11L8 10.5l-3.5 3z"/>',
    edit: '<path d="M3 13l.6-3.2L10.8 2.6l2.6 2.6-7.2 7.2z"/>',
    del: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>',
  };

  let entries = [];
  const saved = vscode.getState() || {};
  const ui = { kind: saved.kind || 'all', q: saved.q || '', expanded: {}, editing: null, draft: '' };
  let toastTimer = null;

  const $ = (id) => document.getElementById(id);
  const addBox = $('add-text');
  const addKind = $('add-kind');
  const search = $('search');
  search.value = ui.q;

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid) el.append(kid);
    return el;
  }

  function icon(name) {
    const b = document.createElement('span');
    b.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true">' + ICON[name] + '</svg>';
    return b.firstChild;
  }

  function iconBtn(name, label, onclick, on) {
    return h('button', { class: 'ic' + (on ? ' on' : ''), title: label, 'aria-label': label, onclick }, icon(name));
  }

  const post = (m) => vscode.postMessage(m);
  const persist = () => vscode.setState({ kind: ui.kind, q: ui.q });

  function firstUrl(e) {
    const m = /https?:\/\/[^\s<>"')]+/.exec(e.text);
    return m ? m[0] : null;
  }

  function isLong(e) {
    return e.text.length > 150 || e.text.split('\n').length > 3;
  }

  function visible() {
    const q = ui.q.trim().toLowerCase();
    return entries.filter((e) => {
      if (ui.kind !== 'all' && e.kind !== ui.kind) return false;
      if (!q) return true;
      return (e.text + ' ' + (e.title || '') + ' ' + (e.tags || []).join(' ')).toLowerCase().includes(q);
    });
  }

  function renderChips() {
    const wrap = $('chips');
    const shown = [];
    for (const [k, label] of CHIPS) {
      const n = k === 'all' ? entries.length : entries.filter((e) => e.kind === k).length;
      if (n === 0 && k !== 'all' && ui.kind !== k) continue;
      shown.push([k, label, n]);
    }
    wrap.replaceChildren(...shown.map(([k, label, n]) => {
      return h('button', {
        class: 'chip', 'aria-pressed': String(ui.kind === k),
        onclick: () => { ui.kind = k; persist(); render(); },
      }, label, h('span', { class: 'n', text: String(n) }));
    }));
  }

  function card(e) {
    if (ui.editing === e.id) return editCard(e);
    const url = firstUrl(e);
    const open = e.kind === 'path' ? !e.text.includes('\n') : !!url;
    const clamped = isLong(e) && !ui.expanded[e.id];
    const body = h('div', { class: 'body' + (clamped ? ' clamp' : ''), title: 'Click to copy', onclick: () => post({ type: 'copy', id: e.id }) });
    body.textContent = e.text;
    const foot = [];
    if (isLong(e)) {
      foot.push(h('button', {
        class: 'link', text: ui.expanded[e.id] ? 'Show less' : 'Show more',
        onclick: () => { ui.expanded[e.id] = !ui.expanded[e.id]; render(); },
      }));
    }
    if (open) foot.push(h('button', { class: 'link', text: 'Open', onclick: () => post({ type: 'open', id: e.id }) }));
    return h('article', { class: 'card k-' + e.kind + (e.pinned ? ' pinned' : ''), 'data-id': e.id },
      h('header', {},
        h('button', {
          class: 'badge', text: LABEL[e.kind], title: 'Click to change type',
          onclick: () => post({ type: 'setKind', id: e.id, kind: KINDS[(KINDS.indexOf(e.kind) + 1) % KINDS.length] }),
        }),
        h('span', { class: 'date', text: e.rel }),
        h('span', { class: 'sp' }),
        h('span', { class: 'acts' },
          iconBtn('copy', 'Copy', () => post({ type: 'copy', id: e.id })),
          iconBtn('pin', e.pinned ? 'Unpin' : 'Pin to top', () => post({ type: 'pin', id: e.id }), e.pinned),
          iconBtn('edit', 'Edit', () => { ui.editing = e.id; ui.draft = e.text; render(); }),
          iconBtn('del', 'Delete', () => post({ type: 'del', id: e.id })),
        ),
      ),
      e.title ? h('div', { class: 'title', text: e.title }) : null,
      body,
      e.tags && e.tags.length ? h('div', { class: 'tags', text: '#' + e.tags.join(' #') }) : null,
      foot.length ? h('div', { class: 'foot' }, foot) : null,
    );
  }

  function editCard(e) {
    const ta = h('textarea', { 'aria-label': 'Edit note' });
    ta.value = ui.draft;
    ta.addEventListener('input', () => { ui.draft = ta.value; });
    const save = () => {
      const text = ta.value.trim();
      ui.editing = null;
      if (text && text !== e.text) post({ type: 'edit', id: e.id, text });
      render();
    };
    const cancel = () => { ui.editing = null; render(); };
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') cancel();
      else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); save(); }
    });
    setTimeout(() => ta.focus(), 0);
    return h('article', { class: 'card edit k-' + e.kind },
      ta,
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', text: 'Cancel', onclick: cancel }),
        h('button', { class: 'btn', text: 'Save', title: 'Ctrl+Enter', onclick: save }),
      ),
    );
  }

  function render() {
    renderChips();
    const list = $('list');
    const rows = visible();
    if (!entries.length) {
      list.replaceChildren(h('div', { class: 'empty' }, h('b', { text: 'Nothing here yet' }), 'Paste a prompt, URL or file path above and press Enter.'));
      return;
    }
    if (!rows.length) {
      list.replaceChildren(h('div', { class: 'empty' }, h('b', { text: 'No matches' }), 'Try another word or clear the type filter.'));
      return;
    }
    const pinned = rows.filter((e) => e.pinned);
    const rest = rows.filter((e) => !e.pinned);
    const out = [];
    if (pinned.length) {
      out.push(h('div', { class: 'label', text: 'Pinned' }), ...pinned.map(card));
      if (rest.length) out.push(h('div', { class: 'label', text: 'Recent' }));
    }
    out.push(...rest.map(card));
    list.replaceChildren(...out);
  }

  function showToast(text, undoId) {
    const t = $('toast');
    const kids = [h('span', { text })];
    if (undoId) kids.push(h('button', { class: 'btn ghost', text: 'Undo', onclick: () => { post({ type: 'restore', id: undoId }); t.hidden = true; } }));
    t.replaceChildren(...kids);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
  }

  function flash(id) {
    const el = document.querySelector('[data-id="' + id + '"]');
    if (!el) return;
    el.classList.add('flash');
    const tag = h('span', { class: 'copied', text: 'Copied' });
    el.append(tag);
    setTimeout(() => { el.classList.remove('flash'); tag.remove(); }, 1100);
  }

  function submitAdd() {
    const text = addBox.value;
    if (!text.trim()) return;
    post({ type: 'add', text, kind: addKind.value === 'auto' ? undefined : addKind.value });
    addBox.value = '';
    addKind.value = 'auto';
    grow();
  }

  function grow() {
    addBox.style.height = 'auto';
    addBox.style.height = Math.min(addBox.scrollHeight, 160) + 'px';
    addBox.style.overflowY = addBox.scrollHeight > 160 ? 'auto' : 'hidden';
  }

  addBox.addEventListener('input', grow);
  addBox.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); submitAdd(); }
  });
  $('add-btn').addEventListener('click', submitAdd);
  search.addEventListener('input', () => { ui.q = search.value; persist(); render(); });
  search.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && search.value) { search.value = ''; ui.q = ''; persist(); render(); }
  });

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.type === 'state') {
      entries = m.entries;
      if (ui.editing && !entries.some((e) => e.id === ui.editing)) ui.editing = null;
      render();
    } else if (m.type === 'copied') flash(m.id);
    else if (m.type === 'toast') showToast(m.text, m.undoId);
  });

  render();
  post({ type: 'ready' });
})();
