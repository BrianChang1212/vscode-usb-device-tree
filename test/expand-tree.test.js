const test = require('node:test');
const assert = require('node:assert/strict');

const { expandVisibleTree } = require('../source/expand-tree');

test('expands every branch in the supplied visible tree and leaves leaf nodes alone', async () => {
  const root = {
    id: 'controller',
    children: [
      { id: 'hub', children: [{ id: 'device', children: [] }] },
      { id: 'empty-port', children: [] },
    ],
  };
  const revealed = [];
  const treeView = {
    async reveal(node, options) {
      revealed.push({ node, options });
    },
  };

  await expandVisibleTree(treeView, [root]);

  assert.deepEqual(revealed.map(({ node }) => node.id), ['controller', 'hub']);
  assert.ok(revealed.every(({ options }) => options.expand === true
    && options.focus === false && options.select === false));
});

test('limits expansion to the currently visible filtered nodes', async () => {
  const visibleResult = { id: 'match-path', children: [{ id: 'match', children: [] }] };
  const hiddenSibling = { id: 'hidden-sibling', children: [{ id: 'hidden-device', children: [] }] };
  const revealed = [];
  const treeView = { async reveal(node) { revealed.push(node.id); } };

  await expandVisibleTree(treeView, [visibleResult]);

  assert.deepEqual(revealed, ['match-path']);
  assert.equal(revealed.includes(hiddenSibling.id), false);
});

test('expands branches beyond the three-level recursive reveal limit', async () => {
  let root = { id: 'level-0', children: [] };
  const branches = [root];
  let parent = root;
  for (let level = 1; level <= 8; level += 1) {
    const child = { id: `level-${level}`, children: [] };
    parent.children.push(child);
    if (level < 8) branches.push(child);
    parent = child;
  }
  const revealed = [];
  const treeView = { async reveal(node, options) { revealed.push([node.id, options.expand]); } };

  await expandVisibleTree(treeView, [root]);

  assert.deepEqual(revealed, branches.map((node) => [node.id, true]));
});
