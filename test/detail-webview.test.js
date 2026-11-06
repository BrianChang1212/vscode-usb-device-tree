const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('detail updates retain selected category, focus and scroll without focusing an inactive document', () => {
  let listener, focused = true, selected, focuses = 0, content = '', title = '', scroll;
  const radios = new Map();
  const radio = id => ({ id, checked: false, focus(options) {
    assert.equal(options.preventScroll, true); focuses++;
  } });
  const main = {
    querySelector() { return selected; },
    replaceChildren(...children) {
      content = children.join('');
      radios.set('tab-pnp', radio('tab-pnp'));
    },
  };
  selected = radio('tab-pnp'); selected.checked = true;
  const document = { activeElement: selected, hasFocus: () => focused,
    querySelector: () => main, getElementById: id => radios.get(id),
    set title(value) { title = value; } };
  const sent = [];
  const context = { document, acquireVsCodeApi: () => ({ postMessage: message => sent.push(message) }),
    DOMParser: class { parseFromString(html) {
      return { title: 'Updated device', querySelector: () => ({ childNodes: [html] }) };
    } },
    window: { scrollX: 4, scrollY: 120, addEventListener(_event, handler) { listener = handler; },
      scrollTo(value) { scroll = value; } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../resources/detail.js'), 'utf8'), context);
  assert.equal(sent[0].type, 'ready');
  listener({ data: { type: 'detail-update', html: 'latest device details' } });
  assert.equal(content, 'latest device details'); assert.equal(title, 'Updated device');
  assert.equal(radios.get('tab-pnp').checked, true); assert.equal(focuses, 1);
  assert.equal(scroll.left, 4); assert.equal(scroll.top, 120);
  focused = false;
  listener({ data: { type: 'detail-update', html: 'newer details' } });
  assert.equal(content, 'newer details'); assert.equal(focuses, 1);
  listener({ data: { type: 'unexpected', html: 'ignored' } });
  assert.equal(content, 'newer details');
});
