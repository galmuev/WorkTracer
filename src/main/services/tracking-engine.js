const { TRACKING } = require('../config');
const { UNASSIGNED_NAME, UNASSIGNED_DISPLAY_NAME, normalizeProcessName } = require('../database/store');

function cleanProjectName(value) { return String(value || '').trim().replace(/^[●•*]\s*/, '').trim(); }

function extractProject(title, application) {
  const cleanTitle = String(title || '').trim();
  const titleParts = cleanTitle.split(/\s+(?:-|—|\|)\s+/).map(cleanProjectName).filter(Boolean);
  if (application.projectMode === 'app') return application.name;
  if (application.projectMode === 'title-segment') {
    const fromEnd = Math.max(1, Number(application.titleSegmentFromEnd) || 2);
    const selected = titleParts[titleParts.length - fromEnd];
    if (selected) return selected;
  }
  for (const extension of application.extensions || []) {
    const escaped = extension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = cleanTitle.match(new RegExp(`(?:^|[\\\\/])?([^\\\\/|*?<>:\"]+?\\.${escaped})(?=\\s*(?:[-—|]|$))`, 'i'));
    if (match) return cleanProjectName(match[1]);
  }
  const firstPart = titleParts[0];
  if (firstPart && normalizeProcessName(firstPart) !== normalizeProcessName(application.name)) return firstPart;
  return UNASSIGNED_DISPLAY_NAME;
}

class TrackingEngine {
  constructor({ store, clock, trackedFileResolver, onActivity = (_activity) => {}, onHealth = (_health) => {}, onInterval = (_interval) => {} }) {
    this.store = store;
    this.clock = clock;
    this.trackedFileResolver = trackedFileResolver;
    this.onActivity = onActivity;
    this.onHealth = onHealth;
    this.onInterval = onInterval;
    this.previous = null;
    this.currentActivity = null;
  }

  reset(reason = 'reset') {
    this.previous = null;
    this.currentActivity = null;
    this.onActivity(null);
    this.onHealth({ state: 'reset', reason });
  }

  async handleSample(sample, metadata) {
    const monotonicMs = this.clock.monotonicNowMs();
    const wallMs = Math.trunc(this.clock.wallNowMs());
    if (this.previous && this.previous.generation === metadata.generation) {
      const elapsedMs = Math.max(0, Math.round(monotonicMs - this.previous.monotonicMs));
      const pollMs = this.store.getSettings().pollIntervalSeconds * 1000;
      const maximumGapMs = pollMs * TRACKING.maximumGapMultiplier + TRACKING.maximumGapExtraMs;
      if (elapsedMs <= maximumGapMs && this.previous.activity && elapsedMs > 0) {
        const recorded = await this.store.recordInterval({
          sampleId: `${metadata.generation}:${metadata.sequence}`,
          applicationId: this.previous.activity.applicationId,
          projectId: this.previous.activity.projectId,
          startWallMs: wallMs - elapsedMs,
          endWallMs: wallMs,
          durationMs: elapsedMs,
          monitorGeneration: metadata.generation,
          link: this.previous.activity.link,
        });
        if (recorded.inserted) this.onInterval({
          appId: this.previous.activity.applicationId,
          projectName: this.previous.activity.projectName === UNASSIGNED_NAME ? UNASSIGNED_DISPLAY_NAME : this.previous.activity.projectName,
          durationMs: elapsedMs,
          endWallMs: wallMs,
          link: this.previous.activity.link,
        });
      } else if (elapsedMs > maximumGapMs) {
        this.onHealth({ state: 'degraded', reason: 'sample-gap', gapMs: elapsedMs });
      }
    }

    const activity = await this.#resolveActivity(sample);
    this.previous = { monotonicMs, wallMs, generation: metadata.generation, activity };
    this.currentActivity = activity ? {
      appId: activity.applicationId,
      appName: activity.applicationName,
      projectName: activity.projectName === UNASSIGNED_NAME ? UNASSIGNED_DISPLAY_NAME : activity.projectName,
      windowTitle: String(sample?.title || '').slice(0, 2048),
      linkedTarget: activity.link ? { appId: activity.link.targetApplicationId, projectName: activity.link.targetName } : null,
      since: this.currentActivity?.appId === activity.applicationId && this.currentActivity?.projectName === activity.projectName
        ? this.currentActivity.since : new Date(wallMs).toISOString(),
    } : null;
    this.onActivity(this.currentActivity);
    return this.currentActivity;
  }

  async #resolveActivity(sample) {
    if (!this.store.isTrackingEnabled() || !sample?.processName) return null;
    const settings = this.store.getSettings();
    const idleLimitSeconds = settings.idleTimeoutMinutes * 60;
    if (idleLimitSeconds > 0 && Number(sample.idleSeconds) >= idleLimitSeconds) return null;
    const application = this.store.findApplicationByProcess(sample.processName);
    if (!application) return null;
    let project;
    if (application.projectMode === 'tracked-file') {
      project = await this.trackedFileResolver.resolve(application.id);
    } else {
      const name = extractProject(sample.title, application);
      project = this.store.findProject(application.id, name);
      if (!project) project = await this.store.ensureDetectedProject(application.id, name === UNASSIGNED_DISPLAY_NAME ? UNASSIGNED_NAME : name, name === UNASSIGNED_DISPLAY_NAME ? 'unassigned' : 'normal');
    }
    const link = application.projectMode === 'app' ? this.store.activeLinkForApplication(application.id) : null;
    return {
      applicationId: application.id, applicationName: application.name,
      projectId: project.id, projectName: project.name, link,
    };
  }

  async flush(metadata = { generation: 0, sequence: `shutdown-${Date.now()}` }) {
    if (!this.previous?.activity) return;
    const monotonicMs = this.clock.monotonicNowMs();
    const wallMs = Math.trunc(this.clock.wallNowMs());
    const elapsedMs = Math.max(0, Math.round(monotonicMs - this.previous.monotonicMs));
    const maximumGapMs = this.store.getSettings().pollIntervalSeconds * 1000 * TRACKING.maximumGapMultiplier + TRACKING.maximumGapExtraMs;
    if (elapsedMs > 0 && elapsedMs <= maximumGapMs) {
      await this.store.recordInterval({
        sampleId: `${metadata.generation}:${metadata.sequence}`,
        applicationId: this.previous.activity.applicationId,
        projectId: this.previous.activity.projectId,
        startWallMs: wallMs - elapsedMs,
        endWallMs: wallMs,
        durationMs: elapsedMs,
        monitorGeneration: Math.max(0, Number(metadata.generation) || 0),
        link: this.previous.activity.link,
      });
    }
    this.reset('flush');
  }
}

module.exports = { TrackingEngine, extractProject, cleanProjectName };
