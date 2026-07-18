const { PersistenceError } = require('./errors');
const { validateSchema, quickCheck } = require('./schema');

function checkInvariants(db, { throwOnFailure = true } = {}) {
  const failures = [];
  try { quickCheck(db); } catch (error) { failures.push({ invariant: 'quick-check', detail: error.message }); }
  try { validateSchema(db); } catch (error) { failures.push({ invariant: 'schema', detail: error.message }); }

  const foreignKeys = db.pragma('foreign_key_check');
  if (foreignKeys.length) failures.push({ invariant: 'foreign-keys', count: foreignKeys.length });

  const duplicateEnabledLinks = db.prepare(`SELECT source_application_id, COUNT(*) AS count FROM project_links
    WHERE enabled = 1 GROUP BY source_application_id HAVING COUNT(*) > 1`).all();
  if (duplicateEnabledLinks.length) failures.push({ invariant: 'one-enabled-link-per-source', count: duplicateEnabledLinks.length });

  const invalidContainers = db.prepare(`SELECT g.id,
    SUM(CASE WHEN a.is_manual = 1 THEN 1 ELSE 0 END) AS anchors
    FROM project_groups g LEFT JOIN group_members gm ON gm.group_id = g.id
    LEFT JOIN projects p ON p.id = gm.project_id LEFT JOIN applications a ON a.id = p.application_id
    GROUP BY g.id HAVING anchors <> 1`).all();
  if (invalidContainers.length) failures.push({ invariant: 'one-anchor-per-container', count: invalidContainers.length });

  const applicationAggregateMismatch = db.prepare(`SELECT a.id FROM applications a
    JOIN application_totals at ON at.application_id = a.id
    LEFT JOIN tracking_intervals ti ON ti.application_id = a.id
    GROUP BY a.id HAVING at.duration_ms <> COALESCE(SUM(ti.duration_ms), 0)`).all();
  if (applicationAggregateMismatch.length) failures.push({ invariant: 'application-aggregate', count: applicationAggregateMismatch.length });

  const projectAggregateMismatch = db.prepare(`SELECT p.id FROM projects p
    JOIN project_totals pt ON pt.project_id = p.id
    LEFT JOIN (SELECT project_id, SUM(duration_ms) AS duration_ms FROM tracking_intervals GROUP BY project_id) own ON own.project_id = p.id
    LEFT JOIN (SELECT target_project_id, SUM(duration_ms) AS duration_ms FROM link_allocations GROUP BY target_project_id) linked ON linked.target_project_id = p.id
    WHERE pt.own_duration_ms <> COALESCE(own.duration_ms, 0)
       OR pt.linked_duration_ms <> COALESCE(linked.duration_ms, 0)`).all();
  if (projectAggregateMismatch.length) failures.push({ invariant: 'project-aggregate', count: projectAggregateMismatch.length });

  const invalidLinkSources = db.prepare(`SELECT l.id FROM project_links l JOIN applications a ON a.id = l.source_application_id
    WHERE a.is_manual = 1 OR a.project_mode <> 'app'`).all();
  if (invalidLinkSources.length) failures.push({ invariant: 'valid-link-source', count: invalidLinkSources.length });

  const result = { ok: failures.length === 0, failures };
  if (!result.ok && throwOnFailure) throw new PersistenceError('corruption', 'Database invariant validation failed.', { publicMessage: 'Проверка целостности базы данных завершилась с ошибкой.' });
  return result;
}

module.exports = { checkInvariants };
