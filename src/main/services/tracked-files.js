const fs = require('node:fs');
const { TRACKING } = require('../config');

function coarseErrorCode(error) {
  const code = String(error?.code || 'UNKNOWN');
  if (code === 'ENOENT' || code === 'ENOTDIR') return { status: 'missing', errorCode: code };
  if (code === 'EACCES' || code === 'EPERM') return { status: 'permission-denied', errorCode: code };
  return { status: 'unreachable', errorCode: code.slice(0, 32) };
}

class AsyncFileProbe {
  constructor({ concurrency = TRACKING.fileProbeConcurrency, timeoutMs = TRACKING.fileProbeTimeoutMs, stat = fs.promises.stat } = {}) {
    this.concurrency = concurrency;
    this.timeoutMs = timeoutMs;
    this.stat = stat;
    this.active = 0;
    this.queue = [];
    this.pendingByPath = new Map();
    this.closed = false;
  }

  probe(filePath) {
    if (this.closed) return Promise.resolve({ status: 'unreachable', errorCode: 'CANCELLED', timedOut: false });
    if (this.pendingByPath.has(filePath)) return this.#withTimeout(this.pendingByPath.get(filePath));
    const operation = new Promise((resolve) => {
      this.queue.push({ filePath, resolve });
      this.#drain();
    });
    this.pendingByPath.set(filePath, operation);
    operation.finally(() => this.pendingByPath.delete(filePath));
    return this.#withTimeout(operation);
  }

  async #withTimeout(operation) {
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ status: 'unreachable', errorCode: 'TIMEOUT', timedOut: true }), this.timeoutMs);
    });
    try { return await Promise.race([operation, timeout]); }
    finally { clearTimeout(timer); }
  }

  #drain() {
    while (!this.closed && this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      this.active += 1;
      Promise.resolve()
        .then(() => this.stat(job.filePath))
        .then((stats) => stats.isFile()
          ? { status: 'available', errorCode: null, mtimeMs: Math.trunc(stats.mtimeMs), timedOut: false }
          : { status: 'missing', errorCode: 'NOT_FILE', timedOut: false })
        .catch((error) => ({ ...coarseErrorCode(error), timedOut: false }))
        .then(job.resolve)
        .finally(() => { this.active -= 1; this.#drain(); });
    }
  }

  async probeMany(files) {
    return Promise.all(files.map(async (file) => ({ file, observation: await this.probe(file.path) })));
  }

  close() {
    this.closed = true;
    for (const job of this.queue.splice(0)) job.resolve({ status: 'unreachable', errorCode: 'CANCELLED', timedOut: false });
  }
}

class TrackedFileResolver {
  constructor({ store, probe = new AsyncFileProbe(), clock }) {
    this.store = store;
    this.probe = probe;
    this.clock = clock;
  }

  async resolve(applicationId) {
    const files = this.store.getTrackedFiles(applicationId);
    if (!files.length) return this.store.getActiveTrackedProject(applicationId);
    const checkedAtMs = Math.trunc(this.clock.wallNowMs());
    const results = await this.probe.probeMany(files);
    const changedCandidates = results
      .filter(({ file, observation }) => observation.status === 'available'
        && file.lastObservedMtimeMs !== null
        && observation.mtimeMs !== file.lastObservedMtimeMs)
      .sort((left, right) => right.observation.mtimeMs - left.observation.mtimeMs);
    const activatedId = changedCandidates[0]?.file.id || null;
    const observations = results.map(({ file, observation }) => ({
      id: file.id,
      status: observation.status,
      errorCode: observation.errorCode,
      mtimeMs: observation.status === 'available' ? observation.mtimeMs : null,
      changed: file.id === activatedId,
      checkedAtMs,
    }));
    await this.store.updateTrackedFileObservations(observations);
    return this.store.getActiveTrackedProject(applicationId);
  }

  async inspect(filePath) {
    const checkedAtMs = Math.trunc(this.clock.wallNowMs());
    const observation = await this.probe.probe(filePath);
    return { ...observation, checkedAtMs };
  }

  close() { this.probe.close(); }
}

module.exports = { AsyncFileProbe, TrackedFileResolver, coarseErrorCode };
