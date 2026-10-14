function createAutoRefreshPauseState() {
  let paused = false;

  return {
    get paused() {
      return paused;
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
  };
}

module.exports = { createAutoRefreshPauseState };
