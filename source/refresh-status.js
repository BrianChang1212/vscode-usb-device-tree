const { englishT } = require('./l10n');

function isAutomaticRefresh(options) {
  return options?.automatic === true;
}

function nodeDescription(node, stale, t = englishT) {
  if (stale) return !node.parentId ? t('Last successful data') : undefined;
  if (node.error === 'controllerQueryTimedOut') return t('Current query timed out');
  if (node.error === 'controllerQueryFailed') return t('Current query failed');
  return undefined;
}

function viewStatus(options = {}) {
  const { searchEmpty = false, stale = false, staleReason,
    partialFailures = 0, autoRefreshRunning = false, intervalSeconds = 5,
    visible = false, enabled = true } = options;
  const t = options.t || englishT;
  if (searchEmpty) return t('No USB nodes match the search.');
  if (stale) return staleReason || t('Refresh failed; showing the last successful data.');
  if (partialFailures === 1) return t('Other controllers updated; 1 controller query failed.');
  if (partialFailures) return t('Other controllers updated; {0} controller queries failed.', partialFailures);
  if (autoRefreshRunning) return t('Auto refresh every {0} seconds; pause it from the toolbar.', intervalSeconds);
  if (visible && !enabled) return t('Auto refresh is paused; refresh manually from the toolbar.');
  return undefined;
}

module.exports = { isAutomaticRefresh, nodeDescription, viewStatus };
