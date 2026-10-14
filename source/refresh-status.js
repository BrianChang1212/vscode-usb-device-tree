function isAutomaticRefresh(options) {
  return options?.automatic === true;
}

function nodeDescription(node, stale) {
  if (stale) return !node.parentId ? 'Last successful data' : undefined;
  if (node.error === 'controllerQueryTimedOut') return 'Current query timed out';
  if (node.error === 'controllerQueryFailed') return 'Current query failed';
  return undefined;
}

function viewStatus({ searchEmpty = false, stale = false, staleReason,
  partialFailures = 0, autoRefreshRunning = false, intervalSeconds = 5,
  visible = false, enabled = true } = {}) {
  if (searchEmpty) return 'No USB nodes match the search.';
  if (stale) return staleReason || 'Refresh failed; showing the last successful data.';
  if (partialFailures) return `Other controllers updated; ${partialFailures} controller ${partialFailures === 1 ? 'query' : 'queries'} failed.`;
  if (autoRefreshRunning) return `Auto refresh every ${intervalSeconds} seconds; pause it from the toolbar.`;
  if (visible && !enabled) return 'Auto refresh is paused; refresh manually from the toolbar.';
  return undefined;
}

module.exports = { isAutomaticRefresh, nodeDescription, viewStatus };
