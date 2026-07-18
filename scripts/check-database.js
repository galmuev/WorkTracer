const { app } = require('electron');
const { databasePaths } = require('../src/main/config');
const { openConnection } = require('../src/main/database/connection');
const { checkInvariants } = require('../src/main/database/invariants');

app.whenReady().then(() => {
  const { databasePath } = databasePaths(app.getPath('userData'));
  const db = openConnection(databasePath, { readonly: true, fileMustExist: true });
  try {
    const result = checkInvariants(db, { throwOnFailure: false });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    app.exit(result.ok ? 0 : 1);
  } finally {
    db.close();
  }
}).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  app.exit(1);
});
