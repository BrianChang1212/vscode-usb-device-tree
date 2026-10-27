// Guide CSS (ui-style-and-l10n.md §1.3). Only --base differs per surface. Everything after the
// "components" marker must reference guide variables only (enforced by test/style-assertions.js).
// The detail panel inlines guideCss('editor'); resources/tree.css is a static file (CSP style-src is
// the webview source only) that must start with guideCss('sideBar') verbatim (enforced by tests).
const BASE = {
  sideBar: 'var(--vscode-sideBar-background, var(--vscode-editor-background))',
  editor: 'var(--vscode-editor-background)',
};

function guideCss(surface) {
  return `
:root {
  --base: ${BASE[surface]};
  --surface: var(--vscode-editorWidget-background, var(--base));
  --raised: var(--vscode-list-hoverBackground, var(--surface));
  --line: var(--vscode-panel-border, var(--vscode-widget-border, #80808059));
  --text: var(--vscode-foreground);
  --muted: var(--vscode-descriptionForeground);
  --danger: var(--vscode-errorForeground);
  --warn: var(--vscode-editorWarning-foreground);
  --accent: #89e829;
  --accent-fg: #080d0a;
  --focus: var(--accent);
  --glow: 0 0 14px #89e82966;
  --grid: radial-gradient(ellipse at 95% 0%, #16402344, transparent 37%),
          linear-gradient(#75e73e08 1px, transparent 1px),
          linear-gradient(90deg, #75e73e08 1px, transparent 1px);
  --font: var(--vscode-font-family, 'Segoe UI', sans-serif);
  --mono: var(--vscode-editor-font-family, Consolas, monospace);
}
body.vscode-light { --accent: #3a7d0a; --accent-fg: #ffffff; --glow: none; --grid: none; }
body.vscode-high-contrast, body.vscode-high-contrast-light {
  --accent: var(--vscode-contrastActiveBorder, var(--vscode-focusBorder));
  --accent-fg: var(--vscode-editor-background);
  --focus: var(--vscode-focusBorder);
  --glow: none; --grid: none;
}
/* components */
* { box-sizing: border-box; }
body { margin: 0; color: var(--text); font: 13px/1.55 var(--font);
  background: var(--grid), var(--base); background-size: auto, 32px 32px, 32px 32px, auto; }
body.vscode-light, body.vscode-high-contrast, body.vscode-high-contrast-light { background: var(--base); }
.eyebrow { margin: 0 0 4px; color: var(--accent); font: 700 10px/1.2 var(--mono); letter-spacing: .16em; text-transform: uppercase; }
h1 { margin: 0; font: 700 20px/1.15 var(--mono); letter-spacing: .035em; text-shadow: var(--glow); }
h1::before { content: ""; display: inline-block; width: 6px; height: .85em; margin-right: 9px; background: var(--accent); box-shadow: var(--glow); }
h2 { margin: 0 0 8px; color: var(--muted); font-size: 10px; font-weight: 700; letter-spacing: .15em; text-transform: uppercase; }
button { min-height: 30px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 4px;
  background: var(--raised); color: var(--text); font: inherit; font-weight: 600; cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--accent); }
button:disabled { opacity: .5; cursor: not-allowed; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
button.danger { background: transparent; border-color: var(--danger); color: var(--danger); }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.card { position: relative; padding: 12px 14px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.card::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: var(--accent); opacity: .6; }
.metric { padding: 9px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.metric span { display: block; color: var(--muted); font-size: 10px; font-weight: 700; letter-spacing: .04em; }
.metric strong { display: block; color: var(--accent); font: 700 19px/1.2 var(--mono); font-variant-numeric: tabular-nums; text-shadow: var(--glow); }
.status { margin: 12px 0; padding: 4px 0 4px 8px; border-left: 2px solid var(--accent); color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.status.error { border-color: var(--danger); color: var(--danger); }
.tag { display: inline-block; padding: 1px 6px; border: 1px solid var(--line); border-radius: 3px; color: var(--muted); font-size: 11px; }
.tag.ok { border-color: var(--accent); color: var(--accent); }
.tag.warn { border-color: var(--warn); color: var(--warn); }
.tag.danger { border-color: var(--danger); color: var(--danger); }
.empty { padding: 16px 10px; border: 1px dashed var(--line); border-radius: 6px; color: var(--muted); }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;
}

module.exports = { guideCss };
