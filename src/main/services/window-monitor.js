const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { TRACKING } = require('../config');

const MAX_LINE_LENGTH = 64 * 1024;

class WindowMonitor {
  constructor({
    scriptPath,
    pollIntervalMs,
    onSample,
    onState = (_state) => {},
    logger,
    spawnProcess = spawn,
    monotonicNow = () => performance.now(),
    timers = { setTimeout, clearTimeout, setInterval, clearInterval },
  }) {
    this.scriptPath = scriptPath;
    this.pollIntervalMs = pollIntervalMs;
    this.onSample = onSample;
    this.onState = onState;
    this.logger = logger;
    this.spawnProcess = spawnProcess;
    this.monotonicNow = monotonicNow;
    this.timers = timers;
    this.state = 'stopped';
    this.reason = null;
    this.child = null;
    this.generation = 0;
    this.sequence = 0;
    this.lastHeartbeatMonoMs = null;
    this.watchdogTimer = null;
    this.restartTimer = null;
    this.restartResolve = null;
    this.restartPromise = null;
    this.restartAttempts = [];
    this.stopping = false;
  }

  #transition(state, reason = null) {
    if (this.state === state && this.reason === reason) return;
    this.state = state;
    this.reason = reason;
    const health = this.health();
    this.logger?.[state === 'failed' || state === 'unresponsive' ? 'error' : state === 'degraded' ? 'warn' : 'info']('monitor.state', { state, reason });
    this.onState(health);
  }

  health() {
    return {
      state: this.state,
      reason: this.reason,
      generation: this.generation,
      lastHeartbeatAgeMs: this.lastHeartbeatMonoMs === null ? null : Math.max(0, Math.round(this.monotonicNow() - this.lastHeartbeatMonoMs)),
      restartAttempts: this.restartAttempts.length,
    };
  }

  start() {
    if (this.child || this.state === 'starting' || this.restartPromise || this.stopping) return false;
    this.#launch();
    return true;
  }

  #launch() {
    if (this.stopping) return;
    this.generation += 1;
    const generation = this.generation;
    this.sequence = 0;
    this.lastHeartbeatMonoMs = this.monotonicNow();
    this.#transition('starting');
    const child = this.spawnProcess('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath,
      '-IntervalMilliseconds', String(this.pollIntervalMs()),
    ], { windowsHide: true });
    this.child = child;
    let pending = '';
    let stderr = '';
    let malformedCount = 0;
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      if (child !== this.child || generation !== this.generation) return;
      pending += chunk;
      if (pending.length > MAX_LINE_LENGTH) {
        pending = '';
        malformedCount += 1;
      }
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const sample = JSON.parse(line);
          if (!sample || typeof sample !== 'object'
            || typeof sample.processName !== 'string' || sample.processName.length > 260
            || typeof sample.title !== 'string' || sample.title.length > 4096
            || !Number.isFinite(sample.idleSeconds) || sample.idleSeconds < 0 || sample.idleSeconds > 31_536_000) {
            throw new Error('invalid monitor protocol payload');
          }
          malformedCount = 0;
          this.lastHeartbeatMonoMs = this.monotonicNow();
          this.sequence += 1;
          this.#transition('healthy');
          Promise.resolve(this.onSample(sample, { generation, sequence: this.sequence })).catch((error) => {
            this.logger?.error('monitor.sample-handler-failed', { category: error?.category, code: error?.code, reason: 'handler-error' });
            this.#transition('degraded', 'sample-handler-error');
          });
        } catch {
          malformedCount += 1;
          if (malformedCount >= 3) void this.#requestRestart('malformed-output');
        }
      }
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-1024); });
    child.once('error', (error) => {
      if (child !== this.child || generation !== this.generation) return;
      void this.#requestRestart(`spawn-${/** @type {NodeJS.ErrnoException} */ (error).code || 'error'}`);
    });
    child.once('exit', (code, signal) => {
      if (child !== this.child || generation !== this.generation || this.stopping || this.restartPromise) return;
      const reason = stderr.trim() ? 'stderr' : signal ? `signal-${signal}` : `exit-${code}`;
      void this.#requestRestart(reason);
    });
    this.#startWatchdog(generation);
  }

  #startWatchdog(generation) {
    if (this.watchdogTimer) this.timers.clearInterval(this.watchdogTimer);
    const interval = Math.max(500, this.pollIntervalMs());
    this.watchdogTimer = this.timers.setInterval(() => {
      if (generation !== this.generation || this.stopping || !this.child) return;
      const timeout = Math.max(3000, this.pollIntervalMs() * 3);
      if (this.monotonicNow() - this.lastHeartbeatMonoMs > timeout) {
        this.#transition('unresponsive', 'heartbeat-timeout');
        void this.#requestRestart('heartbeat-timeout');
      }
    }, interval);
  }

  async #terminate(child) {
    if (!child) return;
    child.stdout?.removeAllListeners('data');
    child.stderr?.removeAllListeners('data');
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; this.timers.clearTimeout(timer); resolve(); } };
      const timer = this.timers.setTimeout(finish, 1500);
      child.once('exit', finish);
      try { if (!child.killed) child.kill(); } catch { finish(); }
    });
    child.removeAllListeners();
  }

  async #requestRestart(reason) {
    if (this.stopping || this.restartPromise) return;
    const now = this.monotonicNow();
    this.restartAttempts = this.restartAttempts.filter((item) => now - item < TRACKING.monitorRestartWindowMs);
    if (this.restartAttempts.length >= TRACKING.monitorMaximumRestarts) {
      this.#transition('failed', 'restart-limit');
      await this.#terminate(this.child);
      this.child = null;
      return;
    }
    this.restartAttempts.push(now);
    const delay = Math.min(TRACKING.monitorMaximumBackoffMs, 1000 * (2 ** Math.min(this.restartAttempts.length - 1, 5)));
    const child = this.child;
    this.child = null;
    this.generation += 1;
    if (this.watchdogTimer) this.timers.clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
    this.#transition('restarting', reason);
    this.restartPromise = (async () => {
      await this.#terminate(child);
      if (this.stopping) return;
      await new Promise((resolve) => {
        this.restartResolve = resolve;
        this.restartTimer = this.timers.setTimeout(() => {
          this.restartResolve = null;
          resolve();
        }, delay);
      });
      this.restartTimer = null;
      if (!this.stopping) this.#launch();
    })().finally(() => { this.restartPromise = null; });
    await this.restartPromise;
  }

  async restart(reason = 'configuration-change') {
    if (this.state === 'stopped') return this.start();
    await this.#requestRestart(reason);
    return true;
  }

  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    this.#transition('shutting-down');
    this.generation += 1;
    if (this.watchdogTimer) this.timers.clearInterval(this.watchdogTimer);
    if (this.restartTimer) this.timers.clearTimeout(this.restartTimer);
    this.restartResolve?.();
    this.restartResolve = null;
    this.watchdogTimer = null;
    this.restartTimer = null;
    const child = this.child;
    this.child = null;
    await this.#terminate(child);
    this.stopping = false;
    this.#transition('stopped');
  }
}

module.exports = { WindowMonitor };
