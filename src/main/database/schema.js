const { PersistenceError } = require('./errors');

const LATEST_SCHEMA_VERSION = 1;

const MIGRATIONS = [
  {
    version: 1,
    name: 'initial-relational-schema',
    sql: `
      CREATE TABLE settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        tracking_enabled INTEGER NOT NULL DEFAULT 1 CHECK (tracking_enabled IN (0, 1)),
        poll_interval_seconds INTEGER NOT NULL DEFAULT 1 CHECK (poll_interval_seconds BETWEEN 1 AND 60),
        idle_timeout_minutes INTEGER NOT NULL DEFAULT 5 CHECK (idle_timeout_minutes BETWEEN 0 AND 1440),
        language TEXT NOT NULL DEFAULT 'ru' CHECK (language IN ('ru', 'en')),
        hourly_rate_cents INTEGER NOT NULL DEFAULT 0 CHECK (hourly_rate_cents BETWEEN 0 AND 100000000000),
        launch_at_startup INTEGER NOT NULL DEFAULT 0 CHECK (launch_at_startup IN (0, 1)),
        updated_at_ms INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE applications (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
        process_name TEXT,
        normalized_process_name TEXT,
        executable_path TEXT,
        project_mode TEXT NOT NULL CHECK (project_mode IN ('file', 'title-segment', 'tracked-file', 'app', 'manual')),
        title_segment_from_end INTEGER NOT NULL DEFAULT 2 CHECK (title_segment_from_end BETWEEN 1 AND 100),
        is_manual INTEGER NOT NULL DEFAULT 0 CHECK (is_manual IN (0, 1)),
        manual_project_name TEXT,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        CHECK ((is_manual = 1 AND project_mode = 'manual' AND process_name IS NULL AND normalized_process_name IS NULL)
          OR (is_manual = 0 AND project_mode <> 'manual' AND process_name IS NOT NULL AND normalized_process_name IS NOT NULL))
      ) STRICT;
      CREATE UNIQUE INDEX applications_process_unique ON applications(normalized_process_name) WHERE is_manual = 0;

      CREATE TABLE application_extensions (
        application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
        extension TEXT NOT NULL CHECK (length(extension) BETWEEN 1 AND 32),
        PRIMARY KEY (application_id, extension)
      ) WITHOUT ROWID;

      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 260),
        kind TEXT NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal', 'unassigned', 'manual')),
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        UNIQUE (application_id, name)
      ) STRICT;
      CREATE UNIQUE INDEX projects_unassigned_unique ON projects(application_id) WHERE kind = 'unassigned';
      CREATE INDEX projects_application_idx ON projects(application_id);

      CREATE TABLE tracked_files (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
        path TEXT NOT NULL CHECK (length(path) BETWEEN 1 AND 32767),
        normalized_path TEXT NOT NULL CHECK (length(normalized_path) BETWEEN 1 AND 32767),
        status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'available', 'missing', 'unreachable', 'permission-denied')),
        last_error_code TEXT,
        last_observed_mtime_ms INTEGER,
        activated_at_ms INTEGER,
        last_checked_at_ms INTEGER,
        created_at_ms INTEGER NOT NULL,
        UNIQUE (application_id, normalized_path)
      ) STRICT;
      CREATE INDEX tracked_files_application_idx ON tracked_files(application_id);

      CREATE TABLE project_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
        is_container INTEGER NOT NULL DEFAULT 1 CHECK (is_container = 1),
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE group_members (
        group_id TEXT NOT NULL REFERENCES project_groups(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
        PRIMARY KEY (group_id, project_id)
      ) WITHOUT ROWID;
      CREATE INDEX group_members_group_idx ON group_members(group_id);

      CREATE TABLE project_links (
        id TEXT PRIMARY KEY,
        source_application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
        target_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        UNIQUE (source_application_id, target_project_id)
      ) STRICT;
      CREATE UNIQUE INDEX project_links_one_enabled_source ON project_links(source_application_id) WHERE enabled = 1;
      CREATE INDEX project_links_target_idx ON project_links(target_project_id);

      CREATE TABLE tracking_intervals (
        id TEXT PRIMARY KEY,
        sample_id TEXT NOT NULL UNIQUE,
        application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        start_wall_ms INTEGER NOT NULL,
        end_wall_ms INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
        monitor_generation INTEGER NOT NULL CHECK (monitor_generation >= 0),
        created_at_ms INTEGER NOT NULL,
        CHECK (end_wall_ms >= start_wall_ms)
      ) STRICT;
      CREATE INDEX tracking_intervals_application_end_idx ON tracking_intervals(application_id, end_wall_ms DESC);
      CREATE INDEX tracking_intervals_project_end_idx ON tracking_intervals(project_id, end_wall_ms DESC);

      CREATE TABLE link_allocations (
        interval_id TEXT NOT NULL REFERENCES tracking_intervals(id) ON DELETE CASCADE,
        link_id TEXT NOT NULL REFERENCES project_links(id) ON DELETE CASCADE,
        target_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
        PRIMARY KEY (interval_id, link_id)
      ) WITHOUT ROWID;
      CREATE INDEX link_allocations_target_idx ON link_allocations(target_project_id);

      CREATE TABLE application_totals (
        application_id TEXT PRIMARY KEY REFERENCES applications(id) ON DELETE CASCADE,
        duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
        last_used_ms INTEGER
      ) STRICT;

      CREATE TABLE project_totals (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        own_duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (own_duration_ms >= 0),
        linked_duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (linked_duration_ms >= 0),
        last_used_ms INTEGER
      ) STRICT;

      CREATE TABLE health_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subsystem TEXT NOT NULL CHECK (subsystem IN ('database', 'monitor', 'tracking', 'backup', 'recovery')),
        state TEXT NOT NULL CHECK (length(state) BETWEEN 1 AND 64),
        reason_code TEXT,
        created_at_ms INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX health_events_subsystem_created_idx ON health_events(subsystem, created_at_ms DESC);

      CREATE TABLE audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation TEXT NOT NULL CHECK (length(operation) BETWEEN 1 AND 64),
        status TEXT NOT NULL CHECK (status IN ('committed', 'failed')),
        affected_count INTEGER NOT NULL DEFAULT 0 CHECK (affected_count >= 0),
        created_at_ms INTEGER NOT NULL
      ) STRICT;

      CREATE TRIGGER applications_totals_insert AFTER INSERT ON applications BEGIN
        INSERT INTO application_totals(application_id) VALUES (NEW.id);
      END;
      CREATE TRIGGER projects_totals_insert AFTER INSERT ON projects BEGIN
        INSERT INTO project_totals(project_id) VALUES (NEW.id);
      END;
      CREATE TRIGGER links_validate_insert BEFORE INSERT ON project_links BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM applications WHERE id = NEW.source_application_id AND is_manual = 0 AND project_mode = 'app'
        ) THEN RAISE(ABORT, 'invalid link source') END;
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM projects WHERE id = NEW.target_project_id AND application_id = NEW.source_application_id
        ) THEN RAISE(ABORT, 'self link is not allowed') END;
      END;
      CREATE TRIGGER links_validate_update BEFORE UPDATE OF source_application_id, target_project_id ON project_links BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM applications WHERE id = NEW.source_application_id AND is_manual = 0 AND project_mode = 'app'
        ) THEN RAISE(ABORT, 'invalid link source') END;
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM projects WHERE id = NEW.target_project_id AND application_id = NEW.source_application_id
        ) THEN RAISE(ABORT, 'self link is not allowed') END;
      END;
      CREATE TRIGGER allocations_validate_insert BEFORE INSERT ON link_allocations BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM project_links l JOIN tracking_intervals i ON i.id = NEW.interval_id
          WHERE l.id = NEW.link_id AND l.target_project_id = NEW.target_project_id
            AND l.source_application_id = i.application_id AND i.duration_ms = NEW.duration_ms
        ) THEN RAISE(ABORT, 'invalid link allocation') END;
      END;
      CREATE TRIGGER allocations_validate_update BEFORE UPDATE ON link_allocations BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM project_links l JOIN tracking_intervals i ON i.id = NEW.interval_id
          WHERE l.id = NEW.link_id AND l.target_project_id = NEW.target_project_id
            AND l.source_application_id = i.application_id AND i.duration_ms = NEW.duration_ms
        ) THEN RAISE(ABORT, 'invalid link allocation') END;
      END;

      CREATE TRIGGER intervals_totals_insert AFTER INSERT ON tracking_intervals BEGIN
        UPDATE application_totals
          SET duration_ms = duration_ms + NEW.duration_ms,
              last_used_ms = CASE WHEN last_used_ms IS NULL OR NEW.end_wall_ms > last_used_ms THEN NEW.end_wall_ms ELSE last_used_ms END
          WHERE application_id = NEW.application_id;
        UPDATE project_totals
          SET own_duration_ms = own_duration_ms + NEW.duration_ms,
              last_used_ms = CASE WHEN last_used_ms IS NULL OR NEW.end_wall_ms > last_used_ms THEN NEW.end_wall_ms ELSE last_used_ms END
          WHERE project_id = NEW.project_id;
      END;
      CREATE TRIGGER intervals_totals_delete AFTER DELETE ON tracking_intervals BEGIN
        UPDATE application_totals
          SET duration_ms = MAX(0, duration_ms - OLD.duration_ms),
              last_used_ms = (SELECT MAX(end_wall_ms) FROM tracking_intervals WHERE application_id = OLD.application_id)
          WHERE application_id = OLD.application_id;
        UPDATE project_totals
          SET own_duration_ms = MAX(0, own_duration_ms - OLD.duration_ms),
              last_used_ms = MAX(
                COALESCE((SELECT MAX(end_wall_ms) FROM tracking_intervals WHERE project_id = OLD.project_id), 0),
                COALESCE((SELECT MAX(t.end_wall_ms) FROM link_allocations a JOIN tracking_intervals t ON t.id = a.interval_id WHERE a.target_project_id = OLD.project_id), 0)
              )
          WHERE project_id = OLD.project_id;
      END;
      CREATE TRIGGER allocations_totals_insert AFTER INSERT ON link_allocations BEGIN
        UPDATE project_totals
          SET linked_duration_ms = linked_duration_ms + NEW.duration_ms,
              last_used_ms = CASE
                WHEN last_used_ms IS NULL OR (SELECT end_wall_ms FROM tracking_intervals WHERE id = NEW.interval_id) > last_used_ms
                THEN (SELECT end_wall_ms FROM tracking_intervals WHERE id = NEW.interval_id)
                ELSE last_used_ms END
          WHERE project_id = NEW.target_project_id;
      END;
      CREATE TRIGGER allocations_totals_delete AFTER DELETE ON link_allocations BEGIN
        UPDATE project_totals
          SET linked_duration_ms = MAX(0, linked_duration_ms - OLD.duration_ms),
              last_used_ms = MAX(
                COALESCE((SELECT MAX(end_wall_ms) FROM tracking_intervals WHERE project_id = OLD.target_project_id), 0),
                COALESCE((SELECT MAX(t.end_wall_ms) FROM link_allocations a JOIN tracking_intervals t ON t.id = a.interval_id WHERE a.target_project_id = OLD.target_project_id), 0)
              )
          WHERE project_id = OLD.target_project_id;
      END;
    `,
  },
];

const REQUIRED_TABLES = [
  'settings', 'applications', 'application_extensions', 'projects', 'tracked_files',
  'project_groups', 'group_members', 'project_links', 'tracking_intervals',
  'link_allocations', 'application_totals', 'project_totals', 'health_events', 'audit_events',
];

const REQUIRED_INDEXES = [
  'applications_process_unique', 'projects_unassigned_unique', 'projects_application_idx', 'tracked_files_application_idx',
  'group_members_group_idx', 'project_links_one_enabled_source', 'project_links_target_idx',
  'tracking_intervals_application_end_idx', 'tracking_intervals_project_end_idx',
  'link_allocations_target_idx', 'health_events_subsystem_created_idx',
];

const REQUIRED_TRIGGERS = [
  'applications_totals_insert', 'projects_totals_insert', 'links_validate_insert',
  'links_validate_update', 'allocations_validate_insert', 'allocations_validate_update',
  'intervals_totals_insert', 'intervals_totals_delete', 'allocations_totals_insert',
  'allocations_totals_delete',
];

const REQUIRED_COLUMNS = {
  settings: ['id', 'tracking_enabled', 'poll_interval_seconds', 'idle_timeout_minutes', 'language', 'hourly_rate_cents', 'launch_at_startup', 'updated_at_ms'],
  applications: ['id', 'name', 'process_name', 'normalized_process_name', 'executable_path', 'project_mode', 'title_segment_from_end', 'is_manual', 'manual_project_name', 'created_at_ms', 'updated_at_ms'],
  application_extensions: ['application_id', 'extension'],
  projects: ['id', 'application_id', 'name', 'kind', 'created_at_ms', 'updated_at_ms'],
  tracked_files: ['id', 'application_id', 'project_id', 'path', 'normalized_path', 'status', 'last_error_code', 'last_observed_mtime_ms', 'activated_at_ms', 'last_checked_at_ms', 'created_at_ms'],
  project_groups: ['id', 'name', 'is_container', 'created_at_ms', 'updated_at_ms'],
  group_members: ['group_id', 'project_id'],
  project_links: ['id', 'source_application_id', 'target_project_id', 'enabled', 'created_at_ms', 'updated_at_ms'],
  tracking_intervals: ['id', 'sample_id', 'application_id', 'project_id', 'start_wall_ms', 'end_wall_ms', 'duration_ms', 'monitor_generation', 'created_at_ms'],
  link_allocations: ['interval_id', 'link_id', 'target_project_id', 'duration_ms'],
  application_totals: ['application_id', 'duration_ms', 'last_used_ms'],
  project_totals: ['project_id', 'own_duration_ms', 'linked_duration_ms', 'last_used_ms'],
  health_events: ['id', 'subsystem', 'state', 'reason_code', 'created_at_ms'],
  audit_events: ['id', 'operation', 'status', 'affected_count', 'created_at_ms'],
};

function schemaVersion(db) {
  return Number(db.pragma('user_version', { simple: true }));
}

function runMigrations(db, logger) {
  const current = schemaVersion(db);
  if (current > LATEST_SCHEMA_VERSION) {
    throw new PersistenceError('incompatible-schema', `Database schema ${current} is newer than supported schema ${LATEST_SCHEMA_VERSION}.`);
  }
  for (const migration of MIGRATIONS.filter((item) => item.version > current)) {
    logger?.info('database.migration.start', { schemaVersion: migration.version, operation: migration.name });
    db.transaction(() => {
      db.exec(migration.sql);
      db.pragma(`user_version = ${migration.version}`);
    })();
    logger?.info('database.migration.complete', { schemaVersion: migration.version, operation: migration.name });
  }
}

function validateSchema(db) {
  const version = schemaVersion(db);
  if (version !== LATEST_SCHEMA_VERSION) throw new PersistenceError('incompatible-schema', `Expected schema ${LATEST_SCHEMA_VERSION}, found ${version}.`);
  const objects = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index', 'trigger')").all().map((row) => row.name));
  for (const name of [...REQUIRED_TABLES, ...REQUIRED_INDEXES, ...REQUIRED_TRIGGERS]) {
    if (!objects.has(name)) throw new PersistenceError('corruption', `Required schema object is missing: ${name}.`);
  }
  for (const [table, expectedColumns] of Object.entries(REQUIRED_COLUMNS)) {
    const actualColumns = new Set(db.pragma(`table_info(${table})`).map((column) => column.name));
    for (const column of expectedColumns) {
      if (!actualColumns.has(column)) throw new PersistenceError('corruption', `Required schema column is missing: ${table}.${column}.`);
    }
  }
  const foreignKeys = db.pragma('foreign_keys', { simple: true });
  if (Number(foreignKeys) !== 1) throw new PersistenceError('programmer-error', 'SQLite foreign keys are not enabled.');
  const foreignKeyFailures = db.pragma('foreign_key_check');
  if (foreignKeyFailures.length) throw new PersistenceError('corruption', 'Foreign-key validation failed.');
  return { version, tables: REQUIRED_TABLES.length, indexes: REQUIRED_INDEXES.length };
}

function quickCheck(db) {
  const rows = db.pragma('quick_check');
  if (rows.length !== 1 || rows[0].quick_check !== 'ok') throw new PersistenceError('corruption', 'SQLite quick_check failed.');
  return true;
}

module.exports = { LATEST_SCHEMA_VERSION, MIGRATIONS, runMigrations, validateSchema, quickCheck, schemaVersion, REQUIRED_COLUMNS, REQUIRED_TRIGGERS };
