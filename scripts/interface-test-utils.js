const fs = require('fs');
const path = require('path');
const os = require('os');
const initSqlJs = require('sql.js');
const { resetDatabase } = require('../src/database/initDatabase');

const createTestDatabase = async (name) => {
  const databasePath = path.join(os.tmpdir(), `terry-lis-${name}-${process.pid}-${Date.now()}.sqlite`);
  await resetDatabase({ databasePath });
  return { databasePath };
};
const inspectDatabase = async (databasePath, callback) => {
  const SQL = await initSqlJs({ locateFile: (file) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file) });
  const db = new SQL.Database(fs.readFileSync(databasePath));
  const rows = (sql, params = {}) => { const stmt = db.prepare(sql); const result = []; try { stmt.bind(params); while (stmt.step()) result.push(stmt.getAsObject()); return result; } finally { stmt.free(); } };
  try { return callback({ db, rows, row: (sql, params) => rows(sql, params)[0] || null }); } finally { db.close(); }
};
module.exports = { createTestDatabase, inspectDatabase };
