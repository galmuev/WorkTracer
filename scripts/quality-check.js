const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const excluded = new Set(['node_modules', 'release', 'dist', '.git']);
const failures = [];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (excluded.has(entry.name)) return [];
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : entry.name.endsWith('.js') ? [target] : [];
  });
}

for (const file of walk(root)) {
  try { new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }); }
  catch (error) { failures.push(`${path.relative(root, file)}: ${error.message}`); }
}

function assertSource(relativePath, predicate, message) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  if (!predicate(source)) failures.push(`${relativePath}: ${message}`);
}

const rendererSources = ['renderer.js', 'preload.js'].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
if (/better-sqlite3|\bSELECT\s+.+\s+FROM\b|\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b/i.test(rendererSources)) failures.push('Renderer/preload must not access SQLite or contain SQL.');

const legacySources = ['main.js', ...walk(path.join(root, 'src', 'main'))]
  .map((file) => fs.readFileSync(path.isAbsolute(file) ? file : path.join(root, file), 'utf8')).join('\n');
if (/worktracker-data\.json|writeDataSnapshot|JSON\.stringify\(data|fs\.statSync/.test(legacySources)) failures.push('Legacy JSON snapshot or synchronous tracked-file persistence returned.');

assertSource('src/main/database/connection.js', (source) => source.includes("foreign_keys = ON"), 'foreign keys must be enabled explicitly.');
assertSource('main.js', (source) => source.includes('contextIsolation: true') && source.includes('nodeIntegration: false') && source.includes('sandbox: true'), 'secure BrowserWindow preferences are required.');
assertSource('main.js', (source) => source.includes('setWindowOpenHandler') && source.includes('will-navigate'), 'navigation and new windows must be restricted.');

if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`Quality checks passed for ${walk(root).length} JavaScript files.\n`);
