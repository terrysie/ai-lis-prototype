const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DEFAULT_DATABASE_FILE_NAME = 'terry-lis-demo.sqlite';
const CORE_TABLES = [
  'users',
  'roles',
  'samples',
  'test_items',
  'test_results',
  'ai_pre_reviews',
  'result_reviews',
  'critical_values',
  'critical_notifications',
  'instruments',
  'qc_events',
  'reagent_batches',
  'reagent_expiry_alerts',
  'infectious_alerts',
  'system_rules',
  'audit_logs'
];

const projectRoot = path.resolve(__dirname, '..', '..');

const resolveSqlJsWasmPath = () => require.resolve('sql.js/dist/sql-wasm.wasm');

const loadSqlJs = () => initSqlJs({
  locateFile: (fileName) => {
    if (fileName === 'sql-wasm.wasm') {
      return resolveSqlJsWasmPath();
    }

    return fileName;
  }
});

const getDefaultDatabasePath = (options = {}) => {
  const baseDirectory = options.userDataPath || path.join(projectRoot, 'data');
  return path.join(baseDirectory, DEFAULT_DATABASE_FILE_NAME);
};

const getSqlFilePath = (fileName) => path.join(projectRoot, 'database', fileName);

const readSqlFile = (fileName) => fs.readFileSync(getSqlFilePath(fileName), 'utf8');

const writeDatabaseFile = (database, databasePath) => {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const databaseBytes = database.export();
  fs.writeFileSync(databasePath, Buffer.from(databaseBytes));
};

const openDatabase = async (databasePath) => {
  const SQL = await loadSqlJs();
  const databaseBytes = fs.readFileSync(databasePath);
  return new SQL.Database(databaseBytes);
};

const createDatabaseFile = async (databasePath) => {
  const SQL = await loadSqlJs();
  const database = new SQL.Database();

  try {
    database.run('PRAGMA foreign_keys = ON;');
    database.run(readSqlFile('schema.sql'));
    database.run(readSqlFile('seed.sql'));
    writeDatabaseFile(database, databasePath);
  } finally {
    database.close();
  }
};

const initializeDatabase = async (options = {}) => {
  const databasePath = options.databasePath || getDefaultDatabasePath(options);
  const existed = fs.existsSync(databasePath);

  if (!existed) {
    await createDatabaseFile(databasePath);
  }

  return {
    databasePath,
    created: !existed
  };
};

const resetDatabase = async (options = {}) => {
  const databasePath = options.databasePath || getDefaultDatabasePath(options);

  if (fs.existsSync(databasePath)) {
    fs.rmSync(databasePath, { force: true });
  }

  await createDatabaseFile(databasePath);

  return {
    databasePath,
    created: true,
    reset: true
  };
};

const getTableCount = (database, tableName) => {
  const statement = database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`);

  try {
    statement.step();
    const row = statement.getAsObject();
    return Number(row.count);
  } finally {
    statement.free();
  }
};

const checkDatabase = async (options = {}) => {
  const databasePath = options.databasePath || getDefaultDatabasePath(options);

  if (!fs.existsSync(databasePath)) {
    return {
      databasePath,
      exists: false,
      tableCounts: {}
    };
  }

  const database = await openDatabase(databasePath);

  try {
    const tableCounts = CORE_TABLES.reduce((counts, tableName) => {
      counts[tableName] = getTableCount(database, tableName);
      return counts;
    }, {});

    return {
      databasePath,
      exists: true,
      tableCounts
    };
  } finally {
    database.close();
  }
};

module.exports = {
  CORE_TABLES,
  DEFAULT_DATABASE_FILE_NAME,
  checkDatabase,
  getDefaultDatabasePath,
  initializeDatabase,
  resetDatabase
};
