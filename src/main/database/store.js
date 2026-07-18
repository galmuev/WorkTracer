const crypto = require('node:crypto');
const path = require('node:path');
const { DATABASE, TRACKING } = require('../config');
const { ValidationError, classifySqliteError } = require('./errors');

const UNASSIGNED_NAME = '__worktracker_unassigned__';
const UNASSIGNED_DISPLAY_NAME = 'Без отдельного файла';
const PROJECT_MODES = new Set(['file', 'title-segment', 'tracked-file', 'app']);

function id() { return crypto.randomUUID(); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function nowIso(ms) { return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null; }
function normalizeProcessName(value) { return String(value || '').toLowerCase().replace(/\.exe$/i, '').trim(); }
function normalizePath(value) {
  const resolved = path.resolve(String(value || '').trim());
  return process.platform === 'win32' ? path.normalize(resolved).toLowerCase() : path.normalize(resolved);
}
function parseExtensions(value) {
  const source = Array.isArray(value) ? value.join(',') : String(value || '');
  const result = [...new Set(source.split(/[\s,;]+/).map((item) => item.replace(/^\./, '').toLowerCase().trim()).filter(Boolean))];
  if (result.length > 64 || result.some((item) => item.length > 32 || !/^[\p{L}\p{N}_+-]+$/u.test(item))) throw new ValidationError('Некорректный список расширений.');
  return result;
}
function boundedString(value, label, maximum, { allowEmpty = false } = {}) {
  const result = String(value ?? '').trim();
  if ((!allowEmpty && !result) || result.length > maximum) throw new ValidationError(`${label}: допустимая длина ${allowEmpty ? `до ${maximum}` : `от 1 до ${maximum}`} символов.`);
  return result;
}
function assertId(value, label = 'ID') {
  const result = boundedString(value, label, 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) throw new ValidationError(`${label} имеет недопустимый формат.`);
  return result;
}
function sqliteInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new ValidationError(`${label} должен быть безопасным целым числом.`);
  return number;
}

class WorkTrackerStore {
  constructor({ db, logger = null, now = () => Date.now() }) {
    this.db = db;
    this.logger = logger;
    this.now = now;
    this.backupManager = null;
    this.healthState = {
      status: 'clean', dirty: false, pendingOperations: 0, lastSuccessfulCommitMs: null, lastError: null,
    };
    this.statements = this.#prepareStatements();
  }

  #prepareStatements() {
    return {
      settings: this.db.prepare('SELECT * FROM settings WHERE id = 1'),
      applicationByProcess: this.db.prepare('SELECT * FROM applications WHERE normalized_process_name = ? AND is_manual = 0'),
      applicationById: this.db.prepare('SELECT * FROM applications WHERE id = ?'),
      projectByMember: this.db.prepare('SELECT p.* FROM projects p WHERE p.application_id = ? AND p.name = ?'),
      projectById: this.db.prepare('SELECT * FROM projects WHERE id = ?'),
      groupForProject: this.db.prepare('SELECT g.* FROM project_groups g JOIN group_members m ON m.group_id = g.id WHERE m.project_id = ?'),
      groupAnchor: this.db.prepare("SELECT p.*, a.id AS anchor_application_id FROM group_members m JOIN projects p ON p.id = m.project_id JOIN applications a ON a.id = p.application_id WHERE m.group_id = ? AND a.is_manual = 1 LIMIT 1"),
      activeLink: this.db.prepare('SELECT l.*, p.application_id AS target_application_id, p.name AS target_name FROM project_links l JOIN projects p ON p.id = l.target_project_id WHERE l.source_application_id = ? AND l.enabled = 1 LIMIT 1'),
      trackedFiles: this.db.prepare('SELECT * FROM tracked_files WHERE application_id = ? ORDER BY created_at_ms'),
      insertInterval: this.db.prepare('INSERT OR IGNORE INTO tracking_intervals(id, sample_id, application_id, project_id, start_wall_ms, end_wall_ms, duration_ms, monitor_generation, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      insertAllocation: this.db.prepare('INSERT INTO link_allocations(interval_id, link_id, target_project_id, duration_ms) VALUES (?, ?, ?, ?)'),
      insertHealth: this.db.prepare('INSERT INTO health_events(subsystem, state, reason_code, created_at_ms) VALUES (?, ?, ?, ?)'),
      trimHealth: this.db.prepare('DELETE FROM health_events WHERE id NOT IN (SELECT id FROM health_events ORDER BY id DESC LIMIT 1000)'),
    };
  }

  setBackupManager(manager) { this.backupManager = manager; }

  initializeDefaults({ launchAtStartup = false } = {}) {
    const now = this.now();
    this.db.transaction(() => {
      this.db.prepare(`INSERT OR IGNORE INTO settings(
        id, tracking_enabled, poll_interval_seconds, idle_timeout_minutes, language,
        hourly_rate_cents, launch_at_startup, updated_at_ms
      ) VALUES (1, 1, ?, 5, 'ru', 0, ?, ?)`)
        .run(TRACKING.defaultPollIntervalSeconds, Number(Boolean(launchAtStartup)), now);
      const count = this.db.prepare('SELECT COUNT(*) AS count FROM applications WHERE is_manual = 0').get().count;
      if (count === 0) {
        this.#insertApplication({ id: 'blender', name: 'Blender', processName: 'blender', extensions: ['blend'], projectMode: 'file', titleSegmentFromEnd: 2 }, now);
        this.#insertApplication({ id: 'photoshop', name: 'Photoshop', processName: 'photoshop', extensions: ['psd', 'psb'], projectMode: 'file', titleSegmentFromEnd: 2 }, now);
        this.#insertApplication({ id: 'unity', name: 'Unity', processName: 'unity', extensions: [], projectMode: 'title-segment', titleSegmentFromEnd: 2 }, now);
      }
    })();
  }

  async #write(operation, callback) {
    this.healthState.dirty = true;
    this.healthState.status = 'dirty';
    this.healthState.pendingOperations += 1;
    let lastError;
    try {
      for (let attempt = 0; attempt <= DATABASE.writeRetryCount; attempt += 1) {
        this.healthState.status = 'transaction-active';
        try {
          const result = this.db.transaction(callback)();
          this.healthState.status = 'clean';
          this.healthState.dirty = false;
          this.healthState.lastSuccessfulCommitMs = this.now();
          this.healthState.lastError = null;
          this.backupManager?.markCommitted();
          return result;
        } catch (error) {
          if (error instanceof ValidationError) {
            this.healthState.status = 'clean';
            this.healthState.dirty = false;
            this.healthState.lastError = null;
            throw error;
          }
          const classified = classifySqliteError(error, `Database operation failed: ${operation}.`);
          lastError = classified;
          if (!classified.retryable || attempt >= DATABASE.writeRetryCount) break;
          this.logger?.warn('database.write.retry', { operation, attempt: attempt + 1, category: classified.category, code: classified.code });
          await sleep(25 * (2 ** attempt));
        }
      }
      this.healthState.status = lastError?.category === 'permission/read-only' ? 'read-only' : 'degraded';
      this.healthState.lastError = { category: lastError?.category || 'unknown', code: lastError?.code || null };
      this.logger?.error('database.write.failed', { operation, category: lastError?.category, code: lastError?.code, state: this.healthState.status });
      throw lastError;
    } finally {
      this.healthState.pendingOperations = Math.max(0, this.healthState.pendingOperations - 1);
    }
  }

  #insertApplication(input, now = this.now()) {
    const applicationId = input.id || id();
    const name = boundedString(input.name, 'Название программы', 100);
    const processName = boundedString(input.processName, 'Имя процесса', 260);
    const normalized = normalizeProcessName(processName);
    const projectMode = PROJECT_MODES.has(input.projectMode) ? input.projectMode : 'file';
    const titleSegmentFromEnd = Math.min(100, Math.max(1, Number(input.titleSegmentFromEnd) || 2));
    const executablePath = input.executablePath ? boundedString(input.executablePath, 'Путь к EXE', 32767) : null;
    this.db.prepare(`INSERT INTO applications(
      id, name, process_name, normalized_process_name, executable_path, project_mode,
      title_segment_from_end, is_manual, manual_project_name, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`)
      .run(applicationId, name, processName, normalized, executablePath, projectMode, titleSegmentFromEnd, now, now);
    const insertExtension = this.db.prepare('INSERT INTO application_extensions(application_id, extension) VALUES (?, ?)');
    for (const extension of parseExtensions(input.extensions)) insertExtension.run(applicationId, extension);
    if (projectMode === 'app') this.#ensureProject(applicationId, name, 'normal', now);
    if (projectMode === 'tracked-file') this.#ensureProject(applicationId, UNASSIGNED_NAME, 'unassigned', now);
    return applicationId;
  }

  #ensureProject(applicationId, name, kind = 'normal', now = this.now()) {
    const existing = this.db.prepare('SELECT * FROM projects WHERE application_id = ? AND name = ?').get(applicationId, name);
    if (existing) return existing;
    const projectId = id();
    this.db.prepare('INSERT INTO projects(id, application_id, name, kind, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)')
      .run(projectId, applicationId, name, kind, now, now);
    return this.statements.projectById.get(projectId);
  }

  #resolveMember(member) {
    if (!member || typeof member !== 'object') throw new ValidationError('Некорректный проект.');
    const applicationId = assertId(member.appId, 'ID программы');
    const projectName = boundedString(member.projectName, 'Название проекта', 260);
    const storedName = projectName === UNASSIGNED_DISPLAY_NAME ? UNASSIGNED_NAME : projectName;
    const project = this.statements.projectByMember.get(applicationId, storedName);
    if (!project) throw new ValidationError('Проект не найден.');
    return project;
  }

  getSettings() {
    const row = this.statements.settings.get();
    return {
      pollIntervalSeconds: row.poll_interval_seconds,
      idleTimeoutMinutes: row.idle_timeout_minutes,
      language: row.language,
      hourlyRate: row.hourly_rate_cents / 100,
      launchAtStartup: Boolean(row.launch_at_startup),
    };
  }

  isTrackingEnabled() { return Boolean(this.statements.settings.get().tracking_enabled); }

  findApplicationByProcess(processName) {
    const row = this.statements.applicationByProcess.get(normalizeProcessName(processName));
    return row ? this.#applicationModel(row) : null;
  }

  findApplicationById(applicationId) {
    const row = this.statements.applicationById.get(assertId(applicationId, 'ID программы'));
    return row ? this.#applicationModel(row) : null;
  }

  findProject(applicationId, name) {
    const storedName = name === UNASSIGNED_DISPLAY_NAME ? UNASSIGNED_NAME : String(name || '');
    return this.statements.projectByMember.get(assertId(applicationId), storedName) || null;
  }

  #applicationModel(row) {
    return {
      id: row.id, name: row.name, processName: row.process_name, executablePath: row.executable_path,
      projectMode: row.project_mode, titleSegmentFromEnd: row.title_segment_from_end,
      isManual: Boolean(row.is_manual), manualProjectName: row.manual_project_name,
      extensions: this.db.prepare('SELECT extension FROM application_extensions WHERE application_id = ? ORDER BY extension').all(row.id).map((item) => item.extension),
    };
  }

  getTrackedFiles(applicationId) {
    return this.statements.trackedFiles.all(assertId(applicationId, 'ID программы')).map((row) => ({
      id: row.id, applicationId: row.application_id, projectId: row.project_id, path: row.path,
      normalizedPath: row.normalized_path, status: row.status, lastObservedMtimeMs: row.last_observed_mtime_ms,
      activatedAtMs: row.activated_at_ms, lastCheckedAtMs: row.last_checked_at_ms,
    }));
  }

  getActiveTrackedProject(applicationId) {
    return this.db.prepare(`SELECT p.* FROM tracked_files f JOIN projects p ON p.id = f.project_id
      WHERE f.application_id = ? AND f.activated_at_ms IS NOT NULL
      ORDER BY f.activated_at_ms DESC LIMIT 1`).get(applicationId) || this.#ensureProject(applicationId, UNASSIGNED_NAME, 'unassigned');
  }

  async updateTrackedFileObservations(observations) {
    if (!Array.isArray(observations) || observations.length === 0) return;
    await this.#write('tracked-files.observe', () => {
      const update = this.db.prepare(`UPDATE tracked_files SET status = ?, last_error_code = ?,
        last_observed_mtime_ms = COALESCE(?, last_observed_mtime_ms),
        activated_at_ms = CASE WHEN ? = 1 THEN ? ELSE activated_at_ms END,
        last_checked_at_ms = ? WHERE id = ?`);
      for (const item of observations) {
        update.run(item.status, item.errorCode || null, item.mtimeMs ?? null, Number(Boolean(item.changed)), item.checkedAtMs, item.checkedAtMs, item.id);
      }
    });
  }

  async ensureDetectedProject(applicationId, name, kind = 'normal') {
    const safeName = boundedString(name, 'Название проекта', 260);
    let project;
    await this.#write('project.ensure-detected', () => { project = this.#ensureProject(assertId(applicationId), safeName, kind); });
    return project;
  }

  activeLinkForApplication(applicationId) {
    const row = this.statements.activeLink.get(assertId(applicationId));
    return row ? { id: row.id, targetProjectId: row.target_project_id, targetApplicationId: row.target_application_id, targetName: row.target_name } : null;
  }

  async recordInterval(interval) {
    const durationMs = sqliteInteger(interval.durationMs, 'Длительность');
    if (durationMs < 0) throw new ValidationError('Длительность не может быть отрицательной.');
    const startWallMs = sqliteInteger(interval.startWallMs, 'Начало интервала');
    const endWallMs = sqliteInteger(interval.endWallMs, 'Конец интервала');
    if (endWallMs < startWallMs) throw new ValidationError('Конец интервала не может быть раньше начала.');
    return this.#write('interval.record', () => {
      const intervalId = id();
      const inserted = this.statements.insertInterval.run(
        intervalId, boundedString(interval.sampleId, 'ID выборки', 160), assertId(interval.applicationId),
        assertId(interval.projectId), startWallMs, endWallMs, durationMs,
        sqliteInteger(interval.monitorGeneration, 'Поколение монитора'), this.now(),
      );
      if (inserted.changes === 0) return { inserted: false };
      if (interval.link?.id && interval.link?.targetProjectId) {
        const current = this.db.prepare('SELECT id, target_project_id FROM project_links WHERE id = ? AND enabled = 1').get(interval.link.id);
        if (current && current.target_project_id === interval.link.targetProjectId) {
          this.statements.insertAllocation.run(intervalId, current.id, current.target_project_id, durationMs);
        }
      }
      return { inserted: true, intervalId };
    });
  }

  async setTrackingEnabled(enabled) {
    await this.#write('settings.tracking-enabled', () => {
      this.db.prepare('UPDATE settings SET tracking_enabled = ?, updated_at_ms = ? WHERE id = 1').run(Number(Boolean(enabled)), this.now());
    });
  }

  async addApplication(input) {
    await this.#write('application.add', () => this.#insertApplication(input));
  }

  async updateApplication(applicationId, input) {
    const safeId = assertId(applicationId, 'ID программы');
    await this.#write('application.update', () => {
      const existing = this.statements.applicationById.get(safeId);
      if (!existing || existing.is_manual) throw new ValidationError('Программа не найдена.');
      const name = boundedString(input.name, 'Название программы', 100);
      const processName = boundedString(input.processName, 'Имя процесса', 260);
      const normalized = normalizeProcessName(processName);
      const projectMode = PROJECT_MODES.has(input.projectMode) ? input.projectMode : 'file';
      const titleSegment = Math.min(100, Math.max(1, Number(input.titleSegmentFromEnd) || 2));
      const executablePath = input.executablePath ? boundedString(input.executablePath, 'Путь к EXE', 32767) : existing.executable_path;
      if (existing.project_mode === 'app' && projectMode === 'app' && existing.name !== name) {
        this.db.prepare("UPDATE projects SET name = ?, updated_at_ms = ? WHERE application_id = ? AND kind = 'normal' AND name = ?")
          .run(name, this.now(), safeId, existing.name);
      }
      this.db.prepare(`UPDATE applications SET name = ?, process_name = ?, normalized_process_name = ?, executable_path = ?,
        project_mode = ?, title_segment_from_end = ?, updated_at_ms = ? WHERE id = ?`)
        .run(name, processName, normalized, executablePath, projectMode, titleSegment, this.now(), safeId);
      this.db.prepare('DELETE FROM application_extensions WHERE application_id = ?').run(safeId);
      const insertExtension = this.db.prepare('INSERT INTO application_extensions(application_id, extension) VALUES (?, ?)');
      for (const extension of parseExtensions(input.extensions)) insertExtension.run(safeId, extension);
      if (projectMode === 'app') this.#ensureProject(safeId, name, 'normal');
      if (projectMode === 'tracked-file') this.#ensureProject(safeId, UNASSIGNED_NAME, 'unassigned');
      if (projectMode !== 'app') this.db.prepare('UPDATE project_links SET enabled = 0, updated_at_ms = ? WHERE source_application_id = ?').run(this.now(), safeId);
    });
  }

  async removeApplication(applicationId) {
    const safeId = assertId(applicationId, 'ID программы');
    await this.#write('application.remove', () => {
      const row = this.statements.applicationById.get(safeId);
      if (!row || row.is_manual) throw new ValidationError('Программа не найдена.');
      const affected = this.db.prepare('SELECT COUNT(*) AS count FROM projects WHERE application_id = ?').get(safeId).count;
      this.db.prepare('DELETE FROM applications WHERE id = ?').run(safeId);
      this.db.prepare("INSERT INTO audit_events(operation, status, affected_count, created_at_ms) VALUES ('remove-application', 'committed', ?, ?)").run(affected, this.now());
    });
  }

  async updateSettings(input) {
    const poll = Number(input?.pollIntervalSeconds);
    const idle = Number(input?.idleTimeoutMinutes);
    const rate = Number(input?.hourlyRate);
    const language = String(input?.language || 'ru');
    if (!Number.isInteger(poll) || poll < 1 || poll > 60) throw new ValidationError('Интервал проверки должен быть от 1 до 60 секунд.');
    if (!Number.isInteger(idle) || idle < 0 || idle > 1440) throw new ValidationError('Порог бездействия должен быть от 0 до 1440 минут.');
    if (!Number.isFinite(rate) || rate < 0 || rate > 1000000000) throw new ValidationError('Стоимость часа должна быть от 0 до 1 000 000 000.');
    if (!['ru', 'en'].includes(language)) throw new ValidationError('Выбран неподдерживаемый язык.');
    const launch = input?.launchAtStartup === true || input?.launchAtStartup === 'on' || input?.launchAtStartup === 'true';
    await this.#write('settings.update', () => {
      this.db.prepare(`UPDATE settings SET poll_interval_seconds = ?, idle_timeout_minutes = ?, language = ?,
        hourly_rate_cents = ?, launch_at_startup = ?, updated_at_ms = ? WHERE id = 1`)
        .run(poll, idle, language, Math.round(rate * 100), Number(launch), this.now());
    });
    return { pollIntervalSeconds: poll, idleTimeoutMinutes: idle, hourlyRate: rate, language, launchAtStartup: launch };
  }

  #createContainer(name) {
    const safeName = boundedString(name, 'Название контейнера', 100);
    const now = this.now();
    const applicationId = id();
    const projectId = id();
    const groupId = id();
    this.db.prepare(`INSERT INTO applications(id, name, process_name, normalized_process_name, executable_path, project_mode,
      title_segment_from_end, is_manual, manual_project_name, created_at_ms, updated_at_ms)
      VALUES (?, 'Manual', NULL, NULL, NULL, 'manual', 2, 1, ?, ?, ?)`)
      .run(applicationId, safeName, now, now);
    this.db.prepare("INSERT INTO projects(id, application_id, name, kind, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'manual', ?, ?)")
      .run(projectId, applicationId, safeName, now, now);
    this.db.prepare('INSERT INTO project_groups(id, name, is_container, created_at_ms, updated_at_ms) VALUES (?, ?, 1, ?, ?)')
      .run(groupId, safeName, now, now);
    this.db.prepare('INSERT INTO group_members(group_id, project_id) VALUES (?, ?)').run(groupId, projectId);
    return { groupId, anchorProjectId: projectId, anchorApplicationId: applicationId };
  }

  async createEmptyProject(name) {
    await this.#write('container.create', () => this.#createContainer(name));
  }

  async deleteProject(member) {
    await this.#write('project.remove', () => {
      const project = this.#resolveMember(member);
      const application = this.statements.applicationById.get(project.application_id);
      const affected = this.db.prepare('SELECT COUNT(*) AS count FROM tracking_intervals WHERE project_id = ?').get(project.id).count;
      if (application?.is_manual) {
        const group = this.statements.groupForProject.get(project.id);
        if (group) this.db.prepare('DELETE FROM project_groups WHERE id = ?').run(group.id);
        this.db.prepare('DELETE FROM applications WHERE id = ?').run(application.id);
      } else {
        this.db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
      }
      this.db.prepare("INSERT INTO audit_events(operation, status, affected_count, created_at_ms) VALUES ('remove-project', 'committed', ?, ?)").run(affected, this.now());
    });
  }

  async mergeProjects(sourceMember, targetMember) {
    await this.#write('container.merge', () => {
      const source = this.#resolveMember(sourceMember);
      const target = this.#resolveMember(targetMember);
      if (source.id === target.id) throw new ValidationError('Нельзя объединить проект с самим собой.');
      const sourceGroup = this.statements.groupForProject.get(source.id);
      const targetGroup = this.statements.groupForProject.get(target.id);
      if (sourceGroup && targetGroup && sourceGroup.id === targetGroup.id) return;
      if (sourceGroup && targetGroup) throw new ValidationError('Объединение двух контейнеров не поддерживается.');
      const container = sourceGroup || targetGroup || this.#createContainer('Контейнер');
      const groupId = container.id || container.groupId;
      const insert = this.db.prepare('INSERT OR IGNORE INTO group_members(group_id, project_id) VALUES (?, ?)');
      if (!sourceGroup) insert.run(groupId, source.id);
      if (!targetGroup) insert.run(groupId, target.id);
    });
  }

  async ungroupProject(groupId, member) {
    const safeGroupId = assertId(groupId, 'ID контейнера');
    await this.#write('container.ungroup', () => {
      const project = this.#resolveMember(member);
      const application = this.statements.applicationById.get(project.application_id);
      if (application?.is_manual) throw new ValidationError('Системный элемент контейнера нельзя извлечь.');
      const result = this.db.prepare('DELETE FROM group_members WHERE group_id = ? AND project_id = ?').run(safeGroupId, project.id);
      if (!result.changes) throw new ValidationError('Проект не входит в контейнер.');
    });
  }

  async renameProjectGroup(groupId, name) {
    const safeGroupId = assertId(groupId, 'ID контейнера');
    const safeName = boundedString(name, 'Название контейнера', 100);
    await this.#write('container.rename', () => {
      const group = this.db.prepare('SELECT * FROM project_groups WHERE id = ?').get(safeGroupId);
      if (!group) throw new ValidationError('Контейнер не найден.');
      const anchor = this.statements.groupAnchor.get(safeGroupId);
      if (!anchor) throw new ValidationError('Контейнер повреждён: отсутствует системный элемент.');
      this.db.prepare('UPDATE project_groups SET name = ?, updated_at_ms = ? WHERE id = ?').run(safeName, this.now(), safeGroupId);
      this.db.prepare('UPDATE projects SET name = ?, updated_at_ms = ? WHERE id = ?').run(safeName, this.now(), anchor.id);
      this.db.prepare('UPDATE applications SET manual_project_name = ?, updated_at_ms = ? WHERE id = ?').run(safeName, this.now(), anchor.anchor_application_id);
    });
  }

  async addTrackedFile(applicationId, filePath, initialObservation = null) {
    const safeApplicationId = assertId(applicationId, 'ID программы');
    const originalPath = boundedString(filePath, 'Путь к файлу', 32767);
    const normalized = normalizePath(originalPath);
    await this.#write('tracked-file.add', () => {
      const application = this.statements.applicationById.get(safeApplicationId);
      if (!application) throw new ValidationError('Программа не найдена.');
      if (application.project_mode !== 'tracked-file') throw new ValidationError('Для программы должен быть выбран режим отслеживаемого файла.');
      if (this.db.prepare('SELECT 1 FROM tracked_files WHERE application_id = ? AND normalized_path = ?').get(safeApplicationId, normalized)) return;
      const used = new Set(this.db.prepare('SELECT name FROM projects WHERE application_id = ?').all(safeApplicationId).map((row) => row.name));
      const base = path.basename(originalPath);
      let name = base;
      if (used.has(name)) name = `${base} — ${path.basename(path.dirname(originalPath))}`;
      let suffix = 2;
      const stem = name;
      while (used.has(name)) { name = `${stem} (${suffix})`; suffix += 1; }
      const project = this.#ensureProject(safeApplicationId, name, 'normal');
      this.db.prepare(`INSERT INTO tracked_files(id, application_id, project_id, path, normalized_path, status,
        last_error_code, last_observed_mtime_ms, activated_at_ms, last_checked_at_ms, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
        .run(id(), safeApplicationId, project.id, originalPath, normalized, initialObservation?.status || 'unknown',
          initialObservation?.errorCode || null, initialObservation?.mtimeMs ?? null, initialObservation?.checkedAtMs ?? null, this.now());
      this.#ensureProject(safeApplicationId, UNASSIGNED_NAME, 'unassigned');
    });
  }

  async addProjectLink(sourceApplicationId, targetMember) {
    const sourceId = assertId(sourceApplicationId, 'ID программы');
    await this.#write('link.add', () => {
      const source = this.statements.applicationById.get(sourceId);
      if (!source || source.project_mode !== 'app' || source.is_manual) throw new ValidationError('Линки доступны только для режима «Вся программа».');
      const target = this.#resolveMember(targetMember);
      if (target.application_id === sourceId) throw new ValidationError('Нельзя создать линк программы на саму себя.');
      let group = this.statements.groupForProject.get(target.id);
      if (!group) {
        const created = this.#createContainer('Контейнер');
        this.db.prepare('INSERT INTO group_members(group_id, project_id) VALUES (?, ?)').run(created.groupId, target.id);
        group = { id: created.groupId };
      }
      const anchor = this.statements.groupAnchor.get(group.id);
      if (!anchor) throw new ValidationError('Контейнер повреждён.');
      this.db.prepare('UPDATE project_links SET enabled = 0, updated_at_ms = ? WHERE source_application_id = ?').run(this.now(), sourceId);
      const existing = this.db.prepare('SELECT id FROM project_links WHERE source_application_id = ? AND target_project_id = ?').get(sourceId, anchor.id);
      if (existing) this.db.prepare('UPDATE project_links SET enabled = 1, updated_at_ms = ? WHERE id = ?').run(this.now(), existing.id);
      else this.db.prepare('INSERT INTO project_links(id, source_application_id, target_project_id, enabled, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 1, ?, ?)')
        .run(id(), sourceId, anchor.id, this.now(), this.now());
    });
  }

  async setProjectLinkEnabled(linkId, enabled) {
    const safeId = assertId(linkId, 'ID линка');
    await this.#write('link.toggle', () => {
      const link = this.db.prepare('SELECT * FROM project_links WHERE id = ?').get(safeId);
      if (!link) throw new ValidationError('Линк не найден.');
      if (enabled) this.db.prepare('UPDATE project_links SET enabled = 0, updated_at_ms = ? WHERE source_application_id = ?').run(this.now(), link.source_application_id);
      this.db.prepare('UPDATE project_links SET enabled = ?, updated_at_ms = ? WHERE id = ?').run(Number(Boolean(enabled)), this.now(), safeId);
    });
  }

  async removeProjectLink(linkId) {
    const safeId = assertId(linkId, 'ID линка');
    await this.#write('link.remove', () => {
      if (!this.db.prepare('DELETE FROM project_links WHERE id = ?').run(safeId).changes) throw new ValidationError('Линк не найден.');
    });
  }

  async clearTrackingData() {
    await this.#write('data.clear', () => {
      const count = this.db.prepare('SELECT COUNT(*) AS count FROM tracking_intervals').get().count;
      this.db.prepare('DELETE FROM tracking_intervals').run();
      this.db.prepare('DELETE FROM project_links').run();
      this.db.prepare('DELETE FROM tracked_files').run();
      this.db.prepare('DELETE FROM project_groups').run();
      this.db.prepare('DELETE FROM applications WHERE is_manual = 1').run();
      this.db.prepare('DELETE FROM projects').run();
      const applications = this.db.prepare('SELECT * FROM applications WHERE is_manual = 0').all();
      for (const application of applications) {
        if (application.project_mode === 'app') this.#ensureProject(application.id, application.name, 'normal');
        if (application.project_mode === 'tracked-file') this.#ensureProject(application.id, UNASSIGNED_NAME, 'unassigned');
      }
      this.db.prepare("INSERT INTO audit_events(operation, status, affected_count, created_at_ms) VALUES ('clear-tracking-data', 'committed', ?, ?)").run(count, this.now());
    });
  }

  async recordHealthEvent(subsystem, state, reasonCode = null) {
    if (!['database', 'monitor', 'tracking', 'backup', 'recovery'].includes(subsystem)) throw new ValidationError('Некорректная подсистема health-state.');
    await this.#write('health.record', () => {
      this.statements.insertHealth.run(subsystem, boundedString(state, 'Health state', 64), reasonCode ? boundedString(reasonCode, 'Reason code', 100) : null, this.now());
      this.statements.trimHealth.run();
    });
  }

  getHealth() {
    return {
      ...this.healthState,
      lastSuccessfulCommit: nowIso(this.healthState.lastSuccessfulCommitMs),
      backup: this.backupManager?.health() || null,
    };
  }

  getStatePage(offset = 0, limit = DATABASE.overviewPageSize) {
    const safeOffset = Math.max(0, Math.trunc(Number(offset) || 0));
    const safeLimit = Math.min(DATABASE.maximumPageSize, Math.max(1, Math.trunc(Number(limit) || DATABASE.overviewPageSize)));
    const settingsRow = this.statements.settings.get();
    const applicationRows = this.db.prepare('SELECT * FROM applications ORDER BY is_manual, created_at_ms').all();
    const applications = applicationRows.map((row) => this.#applicationModel(row));
    const statistics = Object.create(null);
    for (const app of applications) {
      const total = this.db.prepare('SELECT duration_ms FROM application_totals WHERE application_id = ?').get(app.id)?.duration_ms || 0;
      statistics[app.id] = { totalSeconds: total / 1000, projects: Object.create(null) };
      app.trackedFiles = [];
    }
    const totalProjects = this.db.prepare(`SELECT COUNT(*) AS count FROM projects p JOIN applications a ON a.id = p.application_id WHERE a.is_manual = 0`).get().count;
    const pageRows = this.db.prepare(`SELECT p.*, pt.own_duration_ms, pt.linked_duration_ms, pt.last_used_ms,
      gm.group_id FROM projects p JOIN applications a ON a.id = p.application_id
      JOIN project_totals pt ON pt.project_id = p.id LEFT JOIN group_members gm ON gm.project_id = p.id
      WHERE a.is_manual = 0 ORDER BY COALESCE(pt.last_used_ms, p.created_at_ms) DESC LIMIT ? OFFSET ?`).all(safeLimit, safeOffset);
    const groupIds = new Set(pageRows.map((row) => row.group_id).filter(Boolean));
    if (safeOffset === 0) {
      for (const row of this.db.prepare(`SELECT g.id FROM project_groups g WHERE NOT EXISTS (
        SELECT 1 FROM group_members gm JOIN projects p ON p.id = gm.project_id JOIN applications a ON a.id = p.application_id
        WHERE gm.group_id = g.id AND a.is_manual = 0) ORDER BY g.created_at_ms DESC LIMIT 100`).all()) groupIds.add(row.id);
    }
    const projectRows = new Map(pageRows.map((row) => [row.id, row]));
    const projectGroups = [];
    let remainingGroupMemberBudget = DATABASE.maximumGroupMembersPerState;
    const groupMemberStatement = this.db.prepare(`SELECT p.*, a.id AS app_id, pt.own_duration_ms, pt.linked_duration_ms, pt.last_used_ms
      FROM group_members gm JOIN projects p ON p.id = gm.project_id JOIN applications a ON a.id = p.application_id
      JOIN project_totals pt ON pt.project_id = p.id WHERE gm.group_id = ?
      ORDER BY a.is_manual DESC, COALESCE(pt.last_used_ms, p.created_at_ms) DESC LIMIT ?`);
    for (const groupId of [...groupIds].slice(0, safeLimit)) {
      const group = this.db.prepare('SELECT * FROM project_groups WHERE id = ?').get(groupId);
      if (!group) continue;
      const memberLimit = Math.min(500, remainingGroupMemberBudget);
      const members = memberLimit > 0 ? groupMemberStatement.all(groupId, memberLimit + 1) : [];
      const truncated = memberLimit === 0 || members.length > memberLimit;
      const visibleMembers = members.slice(0, memberLimit);
      remainingGroupMemberBudget -= visibleMembers.length;
      for (const member of visibleMembers) projectRows.set(member.id, member);
      const totals = this.db.prepare(`SELECT COALESCE(SUM(pt.own_duration_ms + pt.linked_duration_ms), 0) AS duration_ms,
        MAX(pt.last_used_ms) AS last_used_ms FROM group_members gm JOIN project_totals pt ON pt.project_id = gm.project_id WHERE gm.group_id = ?`).get(groupId);
      projectGroups.push({
        id: group.id, name: group.name, isContainer: true, truncated,
        seconds: totals.duration_ms / 1000, lastUsed: nowIso(totals.last_used_ms),
        members: visibleMembers.map((member) => ({ appId: member.application_id || member.app_id, projectName: member.kind === 'unassigned' ? UNASSIGNED_DISPLAY_NAME : member.name })),
      });
    }
    for (const project of projectRows.values()) {
      const name = project.kind === 'unassigned' ? UNASSIGNED_DISPLAY_NAME : project.name;
      statistics[project.application_id].projects[name] = {
        seconds: (project.own_duration_ms || 0) / 1000,
        linkedSeconds: (project.linked_duration_ms || 0) / 1000,
        lastUsed: nowIso(project.last_used_ms),
      };
    }
    const projectLinks = this.db.prepare(`SELECT l.*, tp.name AS target_name, tp.kind AS target_kind,
      tp.application_id AS target_application_id, COALESCE(SUM(la.duration_ms), 0) AS duration_ms,
      MAX(ti.end_wall_ms) AS last_used_ms FROM project_links l JOIN projects tp ON tp.id = l.target_project_id
      LEFT JOIN link_allocations la ON la.link_id = l.id LEFT JOIN tracking_intervals ti ON ti.id = la.interval_id
      GROUP BY l.id ORDER BY l.updated_at_ms DESC LIMIT 1000`).all().map((row) => ({
        id: row.id, sourceAppId: row.source_application_id,
        target: { appId: row.target_application_id, projectName: row.target_kind === 'unassigned' ? UNASSIGNED_DISPLAY_NAME : row.target_name },
        enabled: Boolean(row.enabled), seconds: row.duration_ms / 1000, lastUsed: nowIso(row.last_used_ms),
      }));
    return {
      trackingEnabled: Boolean(settingsRow.tracking_enabled), applications, apps: applications,
      statistics, projectGroups, projectLinks,
      settings: this.getSettings(),
      pagination: { offset: safeOffset, limit: safeLimit, total: totalProjects, hasMore: safeOffset + pageRows.length < totalProjects },
    };
  }

  close() {
    if (this.db.open) this.db.close();
    this.healthState.status = 'closed';
  }
}

module.exports = {
  WorkTrackerStore, UNASSIGNED_NAME, UNASSIGNED_DISPLAY_NAME,
  normalizeProcessName, normalizePath, parseExtensions,
};
