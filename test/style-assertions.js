const assert = require('node:assert/strict');

const GUIDE_VARIABLES = ['--base', '--surface', '--raised', '--line', '--text', '--muted', '--danger', '--warn',
  '--accent', '--accent-fg', '--focus', '--glow', '--grid', '--font', '--mono'];

// Asserts webview CSS follows ui-style-and-l10n.md §1: guide variables, theme overrides, no hex in components.
function assertGuideCss(css, surface) {
  const [definitions, components] = css.split('/* components */');
  assert.ok(components, 'CSS must separate guide definitions from components with /* components */');
  for (const name of GUIDE_VARIABLES) assert.match(definitions, new RegExp(`${name}:`), `missing ${name}`);
  assert.match(definitions, surface === 'sideBar'
    ? /--base: var\(--vscode-sideBar-background, var\(--vscode-editor-background\)\)/
    : /--base: var\(--vscode-editor-background\)/);
  assert.match(definitions, /--accent: #89e829/);
  assert.match(definitions, /body\.vscode-light \{[^}]*--accent: #3a7d0a[^}]*--glow: none[^}]*--grid: none/);
  assert.match(definitions, /body\.vscode-high-contrast, body\.vscode-high-contrast-light \{[^}]*--glow: none; --grid: none/);
  assert.doesNotMatch(css, /--(?:bg|green|panel|panel-hover|red)\b/, 'legacy variable names must be renamed');
  assert.doesNotMatch(components, /#[0-9a-f]{3,8}\b/i, 'components must not hard-code hex colors');
  assert.doesNotMatch(components, /--vscode-/, 'components must use guide variables, not --vscode-*');
  assert.doesNotMatch(components, /aria-label=/, 'CSS must not select on translated text');
}

// Connected and disconnected states must use guide-derived colors so they stay readable in every theme.
function assertStateColors(css, selectors) {
  for (const [selector, variable] of selectors) {
    const rule = css.split('}').find((block) => block.includes(selector + '{') || block.includes(selector + ' {'));
    assert.ok(rule, `missing rule ${selector}`);
    assert.match(rule, new RegExp(`var\\(${variable}\\)`), `${selector} must use ${variable}`);
  }
}

module.exports = { assertGuideCss, assertStateColors };
