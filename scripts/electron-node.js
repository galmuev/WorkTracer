const { spawnSync } = require('node:child_process');
const electronPath = require('electron');

const result = spawnSync(electronPath, process.argv.slice(2), {
  cwd: process.cwd(),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
