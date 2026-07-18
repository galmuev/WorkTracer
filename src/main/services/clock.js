const { performance } = require('node:perf_hooks');

class SystemClock {
  wallNowMs() { return Date.now(); }
  monotonicNowMs() { return performance.now(); }
}

class FakeClock {
  constructor({ wallMs = 0, monotonicMs = 0 } = {}) {
    this.wallMs = wallMs;
    this.monotonicMs = monotonicMs;
  }
  wallNowMs() { return this.wallMs; }
  monotonicNowMs() { return this.monotonicMs; }
  advance(ms, wallDelta = ms) { this.monotonicMs += ms; this.wallMs += wallDelta; }
  setWall(ms) { this.wallMs = ms; }
}

module.exports = { SystemClock, FakeClock };
