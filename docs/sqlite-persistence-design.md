# SQLite persistence design

## Scope and current architecture

Before this change, `main.js` owned one mutable in-memory object and periodically
serialized the complete object to `worktracker-data.json`. The same object mixed
application configuration, projects, tracked files, groups, links, aggregate
seconds and settings. A single previous JSON file was used as a backup. The
renderer received the complete object over IPC every five seconds.

The old runtime also performed synchronous `statSync` calls for every tracked
file from the Electron main thread. Active-window samples came from one
long-running PowerShell child process. The process was restarted on exit, but it
had no heartbeat watchdog. Durations were measured with `Date.now()` and the
elapsed period was attributed to the newly observed window.

Destructive operations are application removal, project removal, removal of a
project link, ungrouping, clearing tracking data and changing a tracked-file
binding by deleting its project. There was no CI, updater, code-signing
configuration or automated test suite in the repository.

## Entities and source of truth

SQLite is the only source of truth for user working data. No compatibility or
import path exists for the old JSON formats.

- `settings`: singleton validated application settings.
- `applications`: tracked executable metadata and internal manual container
  anchors.
- `projects`: stable project identity. Display names are not foreign keys.
- `tracked_files`: normalized file bindings and the last asynchronously observed
  filesystem state.
- `project_groups` and `group_members`: named containers. A project can be a
  member of at most one container.
- `project_links`: directed allocation from one whole-application tracker to one
  container anchor. At most one link per source is enabled.
- `tracking_intervals`: immutable primary accounting records. Duration is integer
  milliseconds measured by a monotonic clock.
- `link_allocations`: attribution created from an interval through the link that
  was active for that interval.
- `application_totals` and `project_totals`: materialized query indexes maintained
  by database triggers in the same transaction as their source rows.
- `health_events`: bounded diagnostic state transitions without sensitive sample
  payloads.
- `audit_events`: durable records of destructive operations, without paths or
  project names.

## Schema and deletion rules

All relationships use foreign keys. Applications cascade to their projects,
tracked files, intervals, links and aggregates. Projects cascade to their
tracked-file binding, group membership, intervals, allocations and totals.
Deleting a link deletes its historical allocations, matching the pre-release
product semantics where link time disappeared with the link. Deleting a group
does not delete its content projects; it only removes membership rows.

The reserved unassigned state is represented by `projects.kind = 'unassigned'`,
not by a localized display string. There is at most one unassigned project per
application. User project names can therefore equal any translated label without
colliding with internal state.

Frequently used access paths are indexed by normalized process name, project
recency, tracked-file application, group membership, interval application/project
and interval end time. Overview IPC is paginated; raw intervals are never sent to
the renderer.

## Transactions and persistence health

Every accepted write runs through one store boundary. Persistence transitions
through `clean`, `dirty`, `transaction-active`, `degraded`, `read-only`,
`recovery-required` or `fatal`. Dirty is set before a transaction and cleared
only after a confirmed commit. A failed transaction is rolled back and leaves a
visible degraded state. SQLite `busy_timeout` handles short lock contention;
only operations known to have rolled back may be retried, with a bounded retry
count.

Compound operations are single transactions: application/project deletion,
group merge, group rename including its anchor, link activation, interval plus
link allocation, and clearing working data. No filesystem or PowerShell wait is
held inside a database transaction.

`PRAGMA foreign_keys=ON`, WAL, `busy_timeout=5000` and `synchronous=FULL` are
applied to the writable connection. FULL is selected because local time records
are small writes and durability is more important than maximum insert throughput.
The schema uses `user_version`; unknown newer versions fail safely.

## Accounting semantics

The interval between two samples belongs to the previously observed activity.
The monotonic clock measures duration; wall time is retained only for display.
On the first sample, after enable/resume, after suspend/resume or after a monitor
generation change, no interval is inferred. A gap larger than the configured
maximum is discarded and recorded as degraded health rather than being credited
without evidence. Duplicate sample IDs are ignored by a unique constraint.

Default polling is one second, which gives at most one sampling interval of
transition uncertainty. User-selected longer polling explicitly increases this
bound. Accumulated durations are integer milliseconds. Renderer compatibility
conversion to seconds occurs only at the IPC presentation boundary.

Source application totals count physical tracked intervals. A link is directed
and additionally attributes the same duration to its target. Global physical time
must use application/interval totals; project presentation totals may include
linked attribution and must not be interpreted as de-duplicated physical time.
Active, not-yet-confirmed time is not included in durable totals.

## Tracked files and network paths

The file picker permits UNC paths, so they remain supported. Paths are normalized
lexically and case-folded on Windows, without requiring `realpath`; this avoids
blocking creation when a network location is offline. Metadata probes use
asynchronous filesystem calls behind a bounded-concurrency, deduplicating service.
A timeout returns `unreachable`, but does not delete the binding or clear its last
known active project. Closing the app cancels queued work. OS filesystem calls
cannot always be forcibly cancelled once dispatched, so timed-out work retains a
worker slot until it actually settles.

Any `mtime` change, including rollback or recreation, is a change. The database
stores the last observation and the activation wall time. Permission and network
errors are stored as coarse status/error codes, not full sensitive messages.

## Backup and recovery

The database lives in Electron `userData`, never in the installation directory.
Backups use the `better-sqlite3` online backup API so WAL state is included
consistently. A backup is opened read-only and must pass `quick_check`, schema
version and schema validation before it is accepted.

Policy defaults:

- create a backup at least every 15 minutes after committed changes;
- create one before migrations and before destructive application/project/clear
  operations;
- retain the ten newest valid generations plus one generation for each of the
  previous seven calendar days;
- target RPO is 15 minutes; RTO is bounded by checking the retained local
  generations, newest first.

On corruption, recovery closes the connection, preserves the database, WAL and
SHM under unique forensic names, and writes a diagnostic report. Backups are
validated newest first and restoration uses a temporary destination followed by
an atomic rename. A restored database is re-opened and revalidated. If no backup
is valid, the application enters `recovery-required`; it never silently creates
an empty replacement for an existing corrupt database. An incompatible newer
schema is fatal and is not treated as corruption.

## PowerShell health state

The monitor state machine is `stopped -> starting -> healthy`, with transitions
through `degraded`, `unresponsive`, `restarting`, `failed` and `shutting-down`.
Every valid JSON line is a heartbeat. Missing heartbeats for three polling
intervals triggers termination and bounded exponential-backoff restart. A
generation token rejects late output. Restart attempts are capped in a rolling
window and old child termination is awaited or timed out before replacement.
Health transitions are logged and published independently from database health.

## Clear-data semantics

“Clear data” preserves user settings and non-manual application tracking
configuration. Before the operation, a validated backup is required. One
transaction deletes intervals, allocations, links, tracked files, groups, manual
container applications and all projects, then recreates only required
whole-application projects. Aggregate tables are cleared by cascades/triggers.
An audit row is written in the same transaction. Backups and diagnostic logs are
not deleted.

## Invariants

- foreign-key check is empty;
- interval duration is non-negative and wall end is not before wall start;
- sample IDs are unique;
- aggregate duration equals the sum of primary intervals/allocations;
- one enabled link exists at most per source application;
- a link source is a non-manual application in `app` mode;
- a project belongs to at most one group;
- a container has exactly one manual anchor;
- unavailable files remain configured;
- all schema objects and required indexes exist at the declared schema version;
- one logical monitor owns at most one live child generation.

## Threat model

The renderer is an untrusted IPC boundary. It receives no database handle or SQL.
Payloads, sizes, IDs, modes and paths are validated in main, and IPC calls are
accepted only from the packaged local document. Navigation and new windows are
denied. SQL is centralized and parameterized.

A local OS account owner can modify profile files; this design detects corruption
and constraint violations but does not claim cryptographic secrecy from that
owner. Malicious project names are treated as data. Tracked paths may point at
symlinks, junctions or UNC locations, but are only statted and never executed.
PowerShell receives only fixed arguments, not user-built commands. Backups are
untrusted until validated.

Code signing, secure update publication, CI secrets and artifact-signature
verification are not present. They remain production blockers to be supplied by
release infrastructure; no placeholder is represented as real security.

## Assumptions and open decisions

- Existing pre-release JSON data is deliberately ignored and never imported.
- Deleting a link removes its attributed history, matching the old UI.
- Deleting a project removes its intervals after a mandatory pre-operation backup.
- Application configuration is treated as a setting and survives Clear data.
- Default one-second polling is selected to meet the requested short-session
  accuracy target; users can trade accuracy for overhead.
- UI pagination is incremental rather than virtualized. It bounds initial IPC and
  DOM work, but a dedicated virtual list would still be preferable at 100,000
  visible rows.
