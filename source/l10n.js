// Translation entry point (ui-style-and-l10n.md §2.3). Pure helpers only: no require('vscode') here,
// so modules that do not depend on vscode can still be tested in Node.

// Replaces {0}, {1}, ... with positional arguments; unknown placeholders stay as-is.
// resources/tree.js embeds this function verbatim (enforced by test/l10n.test.js).
function format(message, args) {
  return String(message).replace(/\{(\d+)\}/g, (match, index) => (args[index] === undefined ? match : String(args[index])));
}

// Default English translator for callers without vscode.
const englishT = (message, ...args) => format(message, args);

// Extension-layer translator: vscode.l10n.t when available (falls back to English for old test fakes).
function translator(vscode) {
  return vscode?.l10n?.t ? (message, ...args) => vscode.l10n.t(message, ...args) : englishT;
}

function htmlLang(language) {
  return String(language || '').toLowerCase() === 'zh-tw' ? 'zh-Hant' : 'en';
}

module.exports = { format, englishT, translator, htmlLang };
