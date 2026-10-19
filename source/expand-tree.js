async function expandVisibleTree(treeView, nodes) {
  for (const node of nodes || []) {
    if (!Array.isArray(node.children) || node.children.length === 0) continue;
    await treeView.reveal(node, { expand: true, focus: false, select: false });
    await expandVisibleTree(treeView, node.children);
  }
}

module.exports = { expandVisibleTree };
