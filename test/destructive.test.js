const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestStore } = require('./helpers');
const { checkInvariants } = require('../src/main/database/invariants');
const { DestructiveService } = require('../src/main/services/destructive-service');

test('deleting tracked-file project cascades its binding and intervals', async () => {
  const fixture = createTestStore();
  try {
    await fixture.store.addApplication({ name: 'Tracked', processName: 'tracked', projectMode: 'tracked-file', extensions: ['dat'] });
    const app = fixture.store.findApplicationByProcess('tracked');
    await fixture.store.addTrackedFile(app.id, 'C:\\work\\file.dat', { status: 'missing', errorCode: 'ENOENT', checkedAtMs: 1 });
    const binding = fixture.store.getTrackedFiles(app.id)[0];
    const project = fixture.db.prepare('SELECT * FROM projects WHERE id = ?').get(binding.projectId);
    await fixture.store.recordInterval({ sampleId: 'tracked-delete', applicationId: app.id, projectId: project.id, startWallMs: 0, endWallMs: 10, durationMs: 10, monitorGeneration: 1 });
    await fixture.store.deleteProject({ appId: app.id, projectName: project.name });
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM tracked_files WHERE id = ?').get(binding.id).count, 0);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM tracking_intervals WHERE sample_id = 'tracked-delete'").get().count, 0);
    assert.equal(checkInvariants(fixture.db).ok, true);
  } finally { fixture.cleanup(); }
});

test('deleting a container removes links to its anchor without orphan rows', async () => {
  const fixture = createTestStore();
  try {
    await fixture.store.addApplication({ name: 'Source', processName: 'source-delete', projectMode: 'app', extensions: [] });
    const source = fixture.store.findApplicationByProcess('source-delete');
    const target = await fixture.store.ensureDetectedProject('blender', 'container-target.blend');
    await fixture.store.addProjectLink(source.id, { appId: 'blender', projectName: target.name });
    const link = fixture.store.activeLinkForApplication(source.id);
    const anchor = fixture.db.prepare('SELECT p.* FROM projects p WHERE p.id = ?').get(link.targetProjectId);
    await fixture.store.deleteProject({ appId: anchor.application_id, projectName: anchor.name });
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM project_links').get().count, 0);
    assert.equal(fixture.db.pragma('foreign_key_check').length, 0);
  } finally { fixture.cleanup(); }
});

test('failed group merge rolls back without changing membership', async () => {
  const fixture = createTestStore();
  try {
    await fixture.store.createEmptyProject('One');
    await fixture.store.createEmptyProject('Two');
    const anchors = fixture.db.prepare(`SELECT p.application_id, p.name FROM projects p JOIN applications a ON a.id = p.application_id
      WHERE a.is_manual = 1 ORDER BY a.created_at_ms`).all();
    const before = fixture.db.prepare('SELECT COUNT(*) AS count FROM group_members').get().count;
    await assert.rejects(fixture.store.mergeProjects(
      { appId: anchors[0].application_id, projectName: anchors[0].name },
      { appId: anchors[1].application_id, projectName: anchors[1].name },
    ), /контейнеров/);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM group_members').get().count, before);
  } finally { fixture.cleanup(); }
});

test('duplicate process name is rejected by a database invariant', async () => {
  const fixture = createTestStore();
  try {
    await assert.rejects(fixture.store.addApplication({ name: 'Duplicate', processName: 'BLENDER.exe', projectMode: 'file' }), (error) => error.category === 'constraint-violation');
  } finally { fixture.cleanup(); }
});

test('backup failure prevents destructive clear from starting', async () => {
  let cleared = false;
  const service = new DestructiveService({
    backupManager: { create: async () => { throw new Error('backup unavailable'); } },
    store: { clearTrackingData: async () => { cleared = true; } },
  });
  await assert.rejects(service.clearTrackingData(), /backup unavailable/);
  assert.equal(cleared, false);
});
