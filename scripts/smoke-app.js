const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const electronPath = require('electron');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'worktracker-electron-smoke-'));
try {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(electronPath, [path.resolve(__dirname, '..'), '--smoke-test', `--user-data-dir=${profile}`], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    env: environment,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `Electron exited with ${result.status}.\n`);
    process.exit(1);
  }
  process.stdout.write('Electron application smoke test passed.\n');
} finally {
  fs.rmSync(profile, { recursive: true, force: true });
}
