const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestStore } = require('./helpers');
const { FakeClock } = require('../src/main/services/clock');
const { TrackingEngine } = require('../src/main/services/tracking-engine');
const { checkInvariants } = require('../src/main/database/invariants');

function createEngine(store, clock) {
  return new TrackingEngine({
    store,
    clock,
    trackedFileResolver: { resolve: async () => { throw new Error('not expected'); } },
  });
}

test('first sample opens observation and next sample records previous activity', async () => {
  const fixture = createTestStore();
  const clock = new FakeClock({ wallMs: 1_700_000_000_000, monotonicMs: 100 });
  const engine = createEngine(fixture.store, clock);
  try {
    await engine.handleSample({ processName: 'blender', title: 'scene.blend - Blender', idleSeconds: 0 }, { generation: 1, sequence: 1 });
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM tracking_intervals').get().count, 0);
    clock.advance(1000);
    await engine.handleSample({ processName: 'photoshop', title: 'art.psd - Photoshop', idleSeconds: 0 }, { generation: 1, sequence: 2 });
    const interval = fixture.db.prepare('SELECT * FROM tracking_intervals').get();
    assert.equal(interval.application_id, 'blender');
    assert.equal(interval.duration_ms, 1000);
    assert.equal(fixture.db.prepare("SELECT duration_ms FROM application_totals WHERE application_id = 'blender'").get().duration_ms, 1000);
  } finally { fixture.cleanup(); }
});

test('duplicate sample ID is idempotent', async () => {
  const fixture = createTestStore();
  try {
    const project = await fixture.store.ensureDetectedProject('blender', 'duplicate.blend');
    const interval = { sampleId: 'same', applicationId: 'blender', projectId: project.id, startWallMs: 1000, endWallMs: 2000, durationMs: 1000, monitorGeneration: 1 };
    assert.equal((await fixture.store.recordInterval(interval)).inserted, true);
    assert.equal((await fixture.store.recordInterval(interval)).inserted, false);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM tracking_intervals').get().count, 1);
  } finally { fixture.cleanup(); }
});

test('wall-clock rollback never creates negative duration', async () => {
  const fixture = createTestStore();
  const clock = new FakeClock({ wallMs: 10_000, monotonicMs: 0 });
  const engine = createEngine(fixture.store, clock);
  try {
    await engine.handleSample({ processName: 'blender', title: 'rollback.blend - Blender', idleSeconds: 0 }, { generation: 2, sequence: 1 });
    clock.advance(1000, -5000);
    await engine.handleSample({ processName: 'blender', title: 'rollback.blend - Blender', idleSeconds: 0 }, { generation: 2, sequence: 2 });
    const interval = fixture.db.prepare('SELECT * FROM tracking_intervals').get();
    assert.equal(interval.duration_ms, 1000);
    assert.equal(interval.end_wall_ms - interval.start_wall_ms, 1000);
  } finally { fixture.cleanup(); }
});

test('large sample gap is discarded instead of creating unbounded crash time', async () => {
  const fixture = createTestStore();
  const clock = new FakeClock({ wallMs: 1000, monotonicMs: 0 });
  const health = [];
  const engine = new TrackingEngine({ store: fixture.store, clock, trackedFileResolver: {}, onHealth: (event) => health.push(event) });
  try {
    await engine.handleSample({ processName: 'blender', title: 'gap.blend - Blender', idleSeconds: 0 }, { generation: 3, sequence: 1 });
    clock.advance(20_000);
    await engine.handleSample({ processName: 'blender', title: 'gap.blend - Blender', idleSeconds: 0 }, { generation: 3, sequence: 2 });
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM tracking_intervals').get().count, 0);
    assert.ok(health.some((event) => event.reason === 'sample-gap'));
  } finally { fixture.cleanup(); }
});

test('directed link allocation is transactionally reflected in target total', async () => {
  const fixture = createTestStore();
  try {
    await fixture.store.addApplication({ name: 'Source', processName: 'source', projectMode: 'app', extensions: [] });
    const source = fixture.store.findApplicationByProcess('source');
    const target = await fixture.store.ensureDetectedProject('blender', 'target.blend');
    await fixture.store.addProjectLink(source.id, { appId: 'blender', projectName: target.name });
    const sourceProject = fixture.store.findProject(source.id, source.name);
    const link = fixture.store.activeLinkForApplication(source.id);
    await fixture.store.recordInterval({
      sampleId: 'linked', applicationId: source.id, projectId: sourceProject.id,
      startWallMs: 1000, endWallMs: 2500, durationMs: 1500, monitorGeneration: 1, link,
    });
    const total = fixture.db.prepare('SELECT linked_duration_ms FROM project_totals WHERE project_id = ?').get(link.targetProjectId);
    assert.equal(total.linked_duration_ms, 1500);
    assert.equal(checkInvariants(fixture.db).ok, true);
  } finally { fixture.cleanup(); }
});

test('database rejects an allocation that does not match link source, target and duration', async () => {
  const fixture = createTestStore();
  try {
    await fixture.store.addApplication({ name: 'Source', processName: 'source-allocation', projectMode: 'app', extensions: [] });
    const source = fixture.store.findApplicationByProcess('source-allocation');
    const target = await fixture.store.ensureDetectedProject('blender', 'allocation-target.blend');
    await fixture.store.addProjectLink(source.id, { appId: 'blender', projectName: target.name });
    const link = fixture.store.activeLinkForApplication(source.id);
    const unrelated = await fixture.store.ensureDetectedProject('photoshop', 'unrelated.psd');
    const recorded = await fixture.store.recordInterval({
      sampleId: 'unrelated-allocation', applicationId: 'photoshop', projectId: unrelated.id,
      startWallMs: 100, endWallMs: 200, durationMs: 100, monitorGeneration: 1,
    });
    assert.throws(() => fixture.db.prepare(`INSERT INTO link_allocations(interval_id, link_id, target_project_id, duration_ms)
      VALUES (?, ?, ?, ?)`).run(recorded.intervalId, link.id, link.targetProjectId, 99), /invalid link allocation/);
  } finally { fixture.cleanup(); }
});

test('deleting source interval recalculates materialized aggregates', async () => {
  const fixture = createTestStore();
  try {
    const project = await fixture.store.ensureDetectedProject('blender', 'delete.blend');
    const recorded = await fixture.store.recordInterval({ sampleId: 'delete', applicationId: 'blender', projectId: project.id, startWallMs: 0, endWallMs: 100, durationMs: 100, monitorGeneration: 1 });
    fixture.db.prepare('DELETE FROM tracking_intervals WHERE id = ?').run(recorded.intervalId);
    assert.equal(fixture.db.prepare('SELECT own_duration_ms FROM project_totals WHERE project_id = ?').get(project.id).own_duration_ms, 0);
    assert.equal(checkInvariants(fixture.db).ok, true);
  } finally { fixture.cleanup(); }
});

test('generated interval sequence preserves aggregate invariant', async () => {
  const fixture = createTestStore();
  try {
    const project = await fixture.store.ensureDetectedProject('blender', 'generated.blend');
    let expected = 0;
    for (let index = 0; index < 100; index += 1) {
      const duration = (index * 37) % 1000;
      expected += duration;
      await fixture.store.recordInterval({ sampleId: `generated-${index}`, applicationId: 'blender', projectId: project.id, startWallMs: index * 2000, endWallMs: index * 2000 + duration, durationMs: duration, monitorGeneration: 1 });
    }
    assert.equal(fixture.db.prepare('SELECT own_duration_ms FROM project_totals WHERE project_id = ?').get(project.id).own_duration_ms, expected);
    assert.equal(checkInvariants(fixture.db).ok, true);
  } finally { fixture.cleanup(); }
});

test('clear data is atomic, removes working data and preserves application settings', async () => {
  const fixture = createTestStore();
  try {
    const project = await fixture.store.ensureDetectedProject('blender', 'clear.blend');
    await fixture.store.recordInterval({ sampleId: 'clear', applicationId: 'blender', projectId: project.id, startWallMs: 0, endWallMs: 100, durationMs: 100, monitorGeneration: 1 });
    await fixture.store.createEmptyProject('Temporary container');
    await fixture.store.clearTrackingData();
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM tracking_intervals').get().count, 0);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM project_groups').get().count, 0);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM applications WHERE is_manual = 0').get().count, 3);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE operation = 'clear-tracking-data'").get().count, 1);
    assert.equal(checkInvariants(fixture.db).ok, true);
  } finally { fixture.cleanup(); }
});
