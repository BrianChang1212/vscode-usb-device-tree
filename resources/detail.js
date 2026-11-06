(() => {
  const vscode = acquireVsCodeApi();
  window.addEventListener('message', ({ data }) => {
    if (data?.type !== 'detail-update' || typeof data.html !== 'string') return;
    const parsed = new DOMParser().parseFromString(data.html, 'text/html');
    const next = parsed.querySelector('main');
    const main = document.querySelector('main');
    if (!next || !main) return;
    const selected = main.querySelector('input[name="detail-category"]:checked')?.id;
    const focused = document.hasFocus() ? document.activeElement?.id : undefined;
    const scroll = { left: window.scrollX, top: window.scrollY };
    main.replaceChildren(...next.childNodes);
    document.title = parsed.title;
    const radio = selected ? document.getElementById(selected) : undefined;
    if (radio) radio.checked = true;
    if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
    window.scrollTo(scroll);
  });
  vscode.postMessage({ type: 'ready' });
})();
