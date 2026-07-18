const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { WindowMonitor } = require('../src/main/services/window-monitor');

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.killed = false;
  }
  kill() {
    this.killed = true;
    this.emit('exit', 0, 'SIGTERM');
    return true;
  }
}

class FakeTimers {
  constructor() { this.nextId = 1; this.intervals = new Map(); this.timeouts = new Map(); }
  setInterval(callback) { const id = this.nextId++; this.intervals.set(id, callback); return id; }
  clearInterval(id) { this.intervals.delete(id); }
  setTimeout(callback) { const id = this.nextId++; this.timeouts.set(id, callback); return id; }
  clearTimeout(id) { this.timeouts.delete(id); }
  runIntervals() { for (const callback of [...this.intervals.values()]) callback(); }
  runTimeouts() { const callbacks = [...this.timeouts.values()]; this.timeouts.clear(); for (const callback of callbacks) callback(); }
}

function tick() { return new Promise((resolve) => setImmediate(resolve)); }

test('monitor starts once, accepts heartbeat and shuts down cleanly', async () => {
  const child = new FakeChild();
  const samples = [];
  const states = [];
  const timers = new FakeTimers();
  const monitor = new WindowMonitor({
    scriptPath: 'monitor.ps1', pollIntervalMs: () => 1000,
    spawnProcess: () => child, timers,
    onSample: (sample, metadata) => samples.push({ sample, metadata }),
    onState: (state) => states.push(state.state),
  });
  assert.equal(monitor.start(), true);
  assert.equal(monitor.start(), false);
  child.stdout.write('{"title":"A","processName":"app","idleSeconds":0}\n');
  await tick();
  assert.equal(samples.length, 1);
  assert.equal(monitor.health().state, 'healthy');
  await monitor.stop();
  assert.equal(child.killed, true);
  assert.equal(monitor.health().state, 'stopped');
  assert.ok(states.includes('shutting-down'));
});

test('watchdog detects missing heartbeat and restarts after termination', async () => {
  const children = [];
  const states = [];
  const timers = new FakeTimers();
  let monotonic = 0;
  const monitor = new WindowMonitor({
    scriptPath: 'monitor.ps1', pollIntervalMs: () => 1000, timers,
    monotonicNow: () => monotonic,
    spawnProcess: () => { const child = new FakeChild(); children.push(child); return child; },
    onSample: () => {}, onState: (health) => states.push(health.state),
  });
  monitor.start();
  monotonic = 4001;
  timers.runIntervals();
  await tick();
  timers.runTimeouts();
  await tick();
  assert.equal(children.length, 2);
  assert.equal(children[0].killed, true);
  assert.ok(states.includes('unresponsive'));
  assert.ok(states.includes('restarting'));
  await monitor.stop();
});

test('three malformed lines trigger bounded restart path', async () => {
  const children = [];
  const timers = new FakeTimers();
  const monitor = new WindowMonitor({
    scriptPath: 'monitor.ps1', pollIntervalMs: () => 1000, timers,
    spawnProcess: () => { const child = new FakeChild(); children.push(child); return child; },
    onSample: () => {},
  });
  monitor.start();
  children[0].stdout.write('bad\nbad\nbad\n');
  await tick();
  timers.runTimeouts();
  await tick();
  assert.equal(children.length, 2);
  await monitor.stop();
});

test('late output from an old generation is ignored', async () => {
  const children = [];
  const samples = [];
  const timers = new FakeTimers();
  const monitor = new WindowMonitor({
    scriptPath: 'monitor.ps1', pollIntervalMs: () => 1000, timers,
    spawnProcess: () => { const child = new FakeChild(); children.push(child); return child; },
    onSample: (sample) => samples.push(sample),
  });
  monitor.start();
  const old = children[0];
  const restart = monitor.restart('test');
  await tick();
  timers.runTimeouts();
  await restart;
  old.stdout.write('{"title":"Old","processName":"old","idleSeconds":0}\n');
  children[1].stdout.write('{"title":"New","processName":"new","idleSeconds":0}\n');
  await tick();
  assert.deepEqual(samples.map((sample) => sample.processName), ['new']);
  await monitor.stop();
});

test('restart loop is capped and transitions to failed', async () => {
  const children = [];
  const timers = new FakeTimers();
  let monotonic = 0;
  const monitor = new WindowMonitor({
    scriptPath: 'monitor.ps1', pollIntervalMs: () => 1000, timers,
    monotonicNow: () => monotonic,
    spawnProcess: () => { const child = new FakeChild(); children.push(child); return child; },
    onSample: () => {},
  });
  monitor.start();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    monotonic += 100;
    children[children.length - 1].emit('exit', 1, null);
    await tick();
    timers.runTimeouts();
    await tick();
  }
  children[children.length - 1].emit('exit', 1, null);
  await tick();
  assert.equal(monitor.health().state, 'failed');
  assert.equal(children.length, 9);
  assert.equal(children.every((child) => child.stdout.listenerCount('data') === 0), true);
});

test('stop resolves a pending restart backoff and leaves no duplicate worker slot', async () => {
  const children = [];
  const timers = new FakeTimers();
  const monitor = new WindowMonitor({
    scriptPath: 'monitor.ps1', pollIntervalMs: () => 1000, timers,
    spawnProcess: () => { const child = new FakeChild(); children.push(child); return child; },
    onSample: () => {},
  });
  monitor.start();
  children[0].emit('exit', 1, null);
  await tick();
  await monitor.stop();
  await tick();
  assert.equal(monitor.health().state, 'stopped');
  assert.equal(children.length, 1);
  assert.equal(timers.timeouts.size, 0);
});
