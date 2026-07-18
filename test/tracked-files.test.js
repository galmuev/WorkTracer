const test = require('node:test');
const assert = require('node:assert/strict');
const { AsyncFileProbe, TrackedFileResolver } = require('../src/main/services/tracked-files');

test('file probes are deduplicated', async () => {
  let calls = 0;
  const probe = new AsyncFileProbe({ stat: async () => { calls += 1; return { isFile: () => true, mtimeMs: 42 }; }, timeoutMs: 100 });
  const [left, right] = await Promise.all([probe.probe('same'), probe.probe('same')]);
  assert.equal(calls, 1);
  assert.equal(left.mtimeMs, 42);
  assert.deepEqual(left, right);
  probe.close();
});

test('file probe concurrency is bounded', async () => {
  let active = 0;
  let maximum = 0;
  const releases = [];
  const probe = new AsyncFileProbe({
    concurrency: 2,
    timeoutMs: 1000,
    stat: async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => releases.push(resolve));
      active -= 1;
      return { isFile: () => true, mtimeMs: 1 };
    },
  });
  const pending = ['a', 'b', 'c', 'd'].map((item) => probe.probe(item));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(maximum, 2);
  while (releases.length) {
    releases.splice(0).forEach((release) => release());
    await new Promise((resolve) => setImmediate(resolve));
  }
  await Promise.all(pending);
  probe.close();
});

test('network-like timeout returns unreachable without deleting the underlying job', async () => {
  let release;
  const probe = new AsyncFileProbe({ timeoutMs: 10, stat: () => new Promise((resolve) => { release = resolve; }) });
  const result = await probe.probe('\\\\server\\share\\file');
  assert.equal(result.status, 'unreachable');
  assert.equal(result.errorCode, 'TIMEOUT');
  release({ isFile: () => true, mtimeMs: 1 });
  probe.close();
});

test('permission and missing errors have coarse stable statuses', async () => {
  const permission = new AsyncFileProbe({ stat: async () => { const error = new Error(); error.code = 'EACCES'; throw error; } });
  assert.equal((await permission.probe('private')).status, 'permission-denied');
  permission.close();
  const missing = new AsyncFileProbe({ stat: async () => { const error = new Error(); error.code = 'ENOENT'; throw error; } });
  assert.equal((await missing.probe('missing')).status, 'missing');
  missing.close();
});

test('closing probe cancels queued jobs', async () => {
  let release;
  const probe = new AsyncFileProbe({ concurrency: 1, timeoutMs: 100, stat: () => new Promise((resolve) => { release = resolve; }) });
  const active = probe.probe('active');
  const queued = probe.probe('queued');
  probe.close();
  assert.equal((await queued).errorCode, 'CANCELLED');
  release({ isFile: () => true, mtimeMs: 1 });
  await active;
});

test('mtime rollback is treated as a real file change', async () => {
  let observations;
  const store = {
    getTrackedFiles: () => [{ id: 'file', path: 'C:\\file', lastObservedMtimeMs: 100 }],
    updateTrackedFileObservations: async (items) => { observations = items; },
    getActiveTrackedProject: () => ({ id: 'project', name: 'file' }),
  };
  const resolver = new TrackedFileResolver({
    store,
    clock: { wallNowMs: () => 1000 },
    probe: { probeMany: async (files) => files.map((file) => ({ file, observation: { status: 'available', errorCode: null, mtimeMs: 50 } })), close() {} },
  });
  const project = await resolver.resolve('app');
  assert.equal(observations[0].changed, true);
  assert.equal(project.id, 'project');
});

test('temporary unreachability preserves the configured active project', async () => {
  const active = { id: 'active', name: 'known' };
  let observations;
  const file = { id: 'file', path: '\\\\server\\share\\file', lastObservedMtimeMs: 100 };
  const resolver = new TrackedFileResolver({
    store: {
      getTrackedFiles: () => [file],
      updateTrackedFileObservations: async (items) => { observations = items; },
      getActiveTrackedProject: () => active,
    },
    clock: { wallNowMs: () => 1000 },
    probe: { probeMany: async () => [{ file, observation: { status: 'unreachable', errorCode: 'TIMEOUT' } }], close() {} },
  });
  assert.equal((await resolver.resolve('app')).id, 'active');
  assert.equal(observations[0].changed, false);
});
