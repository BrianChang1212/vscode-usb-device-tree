(() => {
  const vscode = acquireVsCodeApi();
  const list = document.getElementById('tree-list');
  const search = document.getElementById('tree-search');
  const status = document.getElementById('tree-status');
  const live = document.getElementById('live-state');
  const pause = document.getElementById('pause-action');
  const saved = vscode.getState?.() || {};
  const expanded = new Set(saved.expanded || []);
  let initialized = Boolean(saved.initialized);
  let selectedId = saved.selectedId || '';
  let state = { nodes: [], query: '', message: '', paused: false, hasData: false, strings: {} };
  // Copy of source/l10n.js format(); strings come translated from the extension host (state.strings).
  function format(message, args) {
    return String(message).replace(/\{(\d+)\}/g, (match, index) => (args[index] === undefined ? match : String(args[index])));
  }
  const S = (key) => state.strings?.[key] || '';

  function visibleRows() { return [...list.querySelectorAll('.node-row')]; }
  function saveState() { vscode.setState?.({ expanded: [...expanded], selectedId, initialized }); }

  function renderNode(node, depth) {
    const group = document.createElement('div');
    group.className = 'tree-group';
    const row = document.createElement('div');
    row.className = `node-row ${node.type || ''} ${node.status || ''} ${node.change ? `change-${node.change}` : ''}`;
    row.style.setProperty('--depth', depth);
    row.setAttribute('role', 'treeitem');
    row.tabIndex = selectedId === node.id || (!selectedId && depth === 0 && list.children.length === 0) ? 0 : -1;
    row.dataset.id = node.id;
    row.dataset.type = node.type;
    row.title = node.label;
    if (selectedId === node.id) row.classList.add('selected');
    const hasChildren = node.children.length > 0;
    const open = expanded.has(node.id) || Boolean(state.query.trim());
    if (hasChildren) {
      row.classList.add('branch');
      row.setAttribute('aria-expanded', String(open));
    }
    const disclosure = document.createElement('button');
    disclosure.className = 'disclosure';
    disclosure.type = 'button';
    disclosure.tabIndex = -1;
    disclosure.textContent = open ? '⌄' : '›';
    disclosure.setAttribute('aria-label', format(open ? S('collapseNode') : S('expandNode'), [node.label]));
    disclosure.addEventListener('click', (event) => {
      event.stopPropagation();
      if (open) expanded.delete(node.id); else expanded.add(node.id);
      saveState();
      render();
      list.querySelector(`[data-id="${CSS.escape(node.id)}"]`)?.focus();
    });
    const glyph = document.createElement('span');
    glyph.className = 'node-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.className = 'node-copy';
    const label = document.createElement('span');
    label.className = 'node-label';
    label.textContent = node.label;
    copy.append(label);
    if (node.meta) {
      const meta = document.createElement('span');
      meta.className = 'node-meta';
      meta.textContent = node.meta;
      copy.append(meta);
    }
    row.append(disclosure, glyph, copy);
    row.addEventListener('click', () => select(node.id));
    row.addEventListener('focus', () => {
      for (const item of visibleRows()) item.tabIndex = item === row ? 0 : -1;
    });
    row.addEventListener('keydown', onRowKeydown);
    group.append(row);
    if (hasChildren && open) {
      const children = document.createElement('div');
      children.setAttribute('role', 'group');
      for (const child of node.children) children.append(renderNode(child, depth + 1));
      group.append(children);
    }
    return group;
  }

  function select(id) {
    selectedId = id;
    saveState();
    for (const row of visibleRows()) {
      row.classList.toggle('selected', row.dataset.id === id);
      row.tabIndex = row.dataset.id === id ? 0 : -1;
    }
    vscode.postMessage({ type: 'select', id });
  }

  function onRowKeydown(event) {
    const rows = visibleRows();
    const index = rows.indexOf(event.currentTarget);
    const id = event.currentTarget.dataset.id;
    const branch = event.currentTarget.classList.contains('branch');
    let next;
    if (event.key === 'ArrowDown') next = rows[index + 1];
    else if (event.key === 'ArrowUp') next = rows[index - 1];
    else if (event.key === 'Home') next = rows[0];
    else if (event.key === 'End') next = rows[rows.length - 1];
    else if (event.key === 'ArrowRight' && branch) {
      if (expanded.has(id)) next = rows[index + 1];
      else {
        expanded.add(id); saveState(); render();
        next = list.querySelector(`[data-id="${CSS.escape(id)}"]`);
      }
    } else if (event.key === 'ArrowLeft') {
      if (branch && expanded.has(id)) {
        expanded.delete(id); saveState(); render();
        next = list.querySelector(`[data-id="${CSS.escape(id)}"]`);
      } else {
        next = event.currentTarget.parentElement?.parentElement?.closest('.tree-group')?.firstElementChild;
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      select(event.currentTarget.dataset.id);
      event.preventDefault();
      return;
    }
    if (next) { event.preventDefault(); next.focus(); }
  }

  function render() {
    const focusedId = document.activeElement?.classList?.contains('node-row')
      ? document.activeElement.dataset.id : '';
    list.replaceChildren();
    for (const node of state.nodes) list.append(renderNode(node, 0));
    if (!state.nodes.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = state.query.trim() ? S('noMatches') : state.hasData ? S('noNodes') : S('waiting');
      list.append(empty);
    }
    if (state.query !== search.value) search.value = state.query;
    status.textContent = state.message;
    live.textContent = state.running ? S('live') : state.paused ? S('paused') : S('idle');
    live.classList.toggle('running', Boolean(state.running));
    pause.textContent = state.paused ? S('resume') : S('pause');
    if (focusedId) list.querySelector(`[data-id="${CSS.escape(focusedId)}"]`)?.focus();
  }

  search.addEventListener('input', () => vscode.postMessage({ type: 'search', query: search.value }));
  document.querySelector('.tree-actions').addEventListener('click', (event) => {
    const action = event.target.closest('button')?.dataset.action;
    if (action === 'collapse') { expanded.clear(); saveState(); render(); return; }
    if (action === 'expand') {
      vscode.postMessage({ type: 'action', action: 'expand' });
      return;
    }
    if (action) vscode.postMessage({ type: 'action', action });
  });
  window.addEventListener('message', ({ data }) => {
    if (data.type === 'expandAll') {
      const visit = (nodes) => { for (const node of nodes) { if (node.children.length) expanded.add(node.id); visit(node.children); } };
      visit(state.nodes); saveState(); render(); return;
    }
    if (data.type !== 'state') return;
    state = data;
    if (!initialized && state.nodes.length) {
      for (const node of state.nodes) {
        expanded.add(node.id);
        for (const hub of node.children) if (hub.type === 'hub') expanded.add(hub.id);
      }
      initialized = true;
      saveState();
    }
    render();
  });
  vscode.postMessage({ type: 'ready' });
})();
