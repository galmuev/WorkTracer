class PersistenceError extends Error {
  constructor(category, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'PersistenceError';
    this.category = category;
    this.code = options.code || null;
    this.retryable = Boolean(options.retryable);
    this.publicMessage = options.publicMessage || message;
  }
}

function classifySqliteError(error, fallbackMessage = 'Database operation failed.') {
  if (error instanceof PersistenceError) return error;
  const code = String(error?.code || '');
  const message = String(error?.message || fallbackMessage);
  if (/SQLITE_(BUSY|LOCKED)/.test(code)) return new PersistenceError('busy/locked', fallbackMessage, { cause: error, code, retryable: true });
  if (/SQLITE_FULL/.test(code)) return new PersistenceError('disk-full', fallbackMessage, { cause: error, code });
  if (/SQLITE_(READONLY|PERM|CANTOPEN)/.test(code)) return new PersistenceError('permission/read-only', fallbackMessage, { cause: error, code });
  if (/SQLITE_(CORRUPT|NOTADB)/.test(code) || /malformed|not a database/i.test(message)) return new PersistenceError('corruption', fallbackMessage, { cause: error, code });
  if (/SQLITE_(CONSTRAINT|MISMATCH|RANGE)/.test(code)) return new PersistenceError('constraint-violation', fallbackMessage, { cause: error, code });
  if (/SQLITE_(IOERR|NOMEM)/.test(code)) return new PersistenceError('disk-io', fallbackMessage, { cause: error, code, retryable: /IOERR_(BLOCKED|LOCK)/.test(code) });
  return new PersistenceError('unknown-fatal', fallbackMessage, { cause: error, code });
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.category = 'validation';
    this.publicMessage = message;
  }
}

module.exports = { PersistenceError, ValidationError, classifySqliteError };
