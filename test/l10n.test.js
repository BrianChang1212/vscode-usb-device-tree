const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { format, englishT, htmlLang } = require('../source/l10n');

const root = path.resolve(__dirname, '..');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

// Collect the first argument of every t( / l10n.t( call; non-literal first arguments are reported.
function scanSource() {
  const messages = new Set();
  const problems = [];
  const sourceDir = path.join(root, 'source');
  // l10n.js is the translation entry point; it forwards a variable to vscode.l10n.t and owns no messages.
  for (const name of fs.readdirSync(sourceDir).filter((file) => file.endsWith('.js') && file !== 'l10n.js')) {
    const text = fs.readFileSync(path.join(sourceDir, name), 'utf8');
    const call = /(?:(?<![\w$.])t|\bl10n\.t)\(/g;
    let match;
    while ((match = call.exec(text))) {
      let index = match.index + match[0].length;
      while (/\s/.test(text[index])) index++;
      const quote = text[index];
      if (quote !== "'" && quote !== '"') {
        problems.push(`${name}: non-literal t() argument near "${text.slice(match.index, match.index + 40)}"`);
        continue;
      }
      let end = index + 1;
      while (end < text.length && text[end] !== quote) end += text[end] === '\\' ? 2 : 1;
      messages.add(vm.runInNewContext(text.slice(index, end + 1)));
    }
  }
  return { messages, problems };
}

const placeholders = (message) => [...message.matchAll(/\{(\d+)\}/g)].map((match) => match[1]).sort().join(',');

test('every translatable source literal has a zh-tw translation and the bundle has no leftovers', () => {
  const { messages, problems } = scanSource();
  assert.deepEqual(problems, []);
  assert.ok(messages.size > 40, `expected many translatable messages, found ${messages.size}`);
  const bundle = readJson('l10n/bundle.l10n.zh-tw.json');
  const missing = [...messages].filter((message) => !(message in bundle));
  const extra = Object.keys(bundle).filter((message) => !messages.has(message));
  assert.deepEqual(missing, [], 'missing zh-tw translations');
  assert.deepEqual(extra, [], 'unused zh-tw bundle entries');
  for (const [english, chinese] of Object.entries(bundle)) {
    assert.ok(chinese.trim(), `empty translation for ${english}`);
    assert.equal(placeholders(chinese), placeholders(english), `placeholder mismatch for ${english}`);
    assert.doesNotMatch(english, /[\u3400-\u9fff]/, `English source contains Chinese: ${english}`);
  }
  assert.equal(fs.existsSync(path.join(root, 'l10n', 'bundle.l10n.json')), false, 'English bundle must not exist');
});

test('package.json %key% references match package.nls.json and package.nls.zh-tw.json exactly', () => {
  const manifest = readJson('package.json');
  assert.equal(manifest.l10n, './l10n');
  const keys = new Set();
  const visit = (value) => {
    if (typeof value === 'string') { const found = value.match(/^%([^%]+)%$/); if (found) keys.add(found[1]); }
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(manifest);
  const english = readJson('package.nls.json');
  const chinese = readJson('package.nls.zh-tw.json');
  assert.deepEqual(Object.keys(english).sort(), [...keys].sort());
  assert.deepEqual(Object.keys(chinese).sort(), [...keys].sort());
  for (const key of keys) {
    assert.ok(english[key].trim() && chinese[key].trim(), `empty nls value for ${key}`);
    assert.doesNotMatch(english[key], /[\u3400-\u9fff]/, `English nls contains Chinese for ${key}`);
  }
  const titles = manifest.contributes.commands.map((command) => command.title);
  assert.ok(titles.every((title) => /^%command\..+\.title%$/.test(title)), 'all command titles use nls keys');
  const descriptions = Object.values(manifest.contributes.configuration.properties).map((property) => property.description);
  assert.ok(descriptions.every((description) => /^%config\..+\.description%$/.test(description)), 'all setting descriptions use nls keys');
  assert.match(manifest.contributes.views.usbDeviceTree[0].name, /^%view\..+\.name%$/);
  // Only the extension name stays English; the container and view names follow the display language.
  assert.equal(manifest.contributes.viewsContainers.activitybar[0].title, '%viewsContainer.usbDeviceTree.title%');
  assert.notEqual(chinese['viewsContainer.usbDeviceTree.title'], english['viewsContainer.usbDeviceTree.title']);
  assert.notEqual(chinese['view.devices.name'], english['view.devices.name']);
});

test('the VSIX file allowlist includes the l10n bundle and nls files', () => {
  const manifest = readJson('package.json');
  for (const entry of ['l10n/', 'package.nls.json', 'package.nls.zh-tw.json']) {
    assert.ok(manifest.files.includes(entry), `files must include ${entry}`);
  }
  assert.match(fs.readFileSync(path.join(root, 'scripts', 'verify-vsix.ps1'), 'utf8'), /l10n\/bundle\.l10n\.zh-tw\.json/);
});

test('the translation helpers format positional arguments and html lang', () => {
  assert.equal(format('{0} of {1} {2}', [1, 'two']), '1 of two {2}');
  assert.equal(englishT('Port {0}: {1}', 2, 'Radio'), 'Port 2: Radio');
  assert.equal(htmlLang('zh-tw'), 'zh-Hant');
  assert.equal(htmlLang('zh-TW'), 'zh-Hant');
  assert.equal(htmlLang('zh-cn'), 'en');
  assert.equal(htmlLang(undefined), 'en');
});

test('the webview script keeps an identical copy of the placeholder formatter', () => {
  const script = fs.readFileSync(path.join(root, 'resources', 'tree.js'), 'utf8');
  const squash = (text) => text.replace(/\s+/g, ' ');
  assert.ok(squash(script).includes(squash(format.toString())), 'resources/tree.js must embed source/l10n.js format() verbatim');
});
