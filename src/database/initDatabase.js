const fs = require('fs');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DATABASE_DIR = path.join(PROJECT_ROOT, 'data');
const DEFAULT_DATABASE_FILE = 'terry-lis.sqlite';
const SCHEMA_PATH = path.join(PROJECT_ROOT, 'database', 'schema.sql');
const SEED_PATH = path.join(PROJECT_ROOT, 'database', 'seed.sql');
const SQL_WASM_PATH = path.join(PROJECT_ROOT, 'node_modules', 'sql.js', 'dist');

const CORE_TABLES = [
  'users',
  'roles',
  'samples',
  'sample_recollection_tasks',
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

let sqlPromise;

const loadSqlJs = () => {
  if (!sqlPromise) {
    let initSqlJs;

    try {
      initSqlJs = require('sql.js');
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        throw new Error('缺少 sql.js 依赖，请先执行 npm install。');
      }

      throw error;
    }

    sqlPromise = initSqlJs({
      locateFile: (file) => path.join(SQL_WASM_PATH, file)
    });
  }

  return sqlPromise;
};

const getDefaultDatabasePath = (options = {}) => {
  if (options.databasePath) {
    return path.resolve(options.databasePath);
  }

  if (process.env.TERRY_LIS_DB_PATH) {
    return path.resolve(process.env.TERRY_LIS_DB_PATH);
  }

  if (options.electronApp && typeof options.electronApp.getPath === 'function') {
    return path.join(options.electronApp.getPath('userData'), 'data', DEFAULT_DATABASE_FILE);
  }

  return path.join(DEFAULT_DATABASE_DIR, DEFAULT_DATABASE_FILE);
};

const readSqlFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`SQL 文件不存在：${filePath}`);
  }

  return fs.readFileSync(filePath, 'utf8');
};

const ensureDatabaseDirectory = (databasePath) => {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
};

const saveDatabase = (database, databasePath) => {
  const exportedDatabase = database.export();
  fs.writeFileSync(databasePath, Buffer.from(exportedDatabase));
};

const createDatabase = async (databasePath) => {
  const SQL = await loadSqlJs();
  const database = new SQL.Database();

  try {
    database.run('PRAGMA foreign_keys = ON;');
    database.run(readSqlFile(SCHEMA_PATH));
    database.run(readSqlFile(SEED_PATH));
    saveDatabase(database, databasePath);
  } finally {
    database.close();
  }
};

const initializeDatabase = async (options = {}) => {
  const databasePath = getDefaultDatabasePath(options);
  ensureDatabaseDirectory(databasePath);

  if (fs.existsSync(databasePath)) {
    return {
      databasePath,
      created: false,
      message: '数据库文件已存在，跳过 schema 与 seed 导入。'
    };
  }

  await createDatabase(databasePath);

  return {
    databasePath,
    created: true,
    message: '数据库初始化完成。'
  };
};

const resetDatabase = async (options = {}) => {
  const databasePath = getDefaultDatabasePath(options);

  if (fs.existsSync(databasePath)) {
    fs.unlinkSync(databasePath);
  }

  await initializeDatabase({ ...options, databasePath });

  return {
    databasePath,
    reset: true,
    message: '数据库已删除并重新初始化。'
  };
};

const countRows = (database, tableName) => {
  const statement = database.prepare(`SELECT COUNT(*) AS count FROM ${tableName};`);

  try {
    if (!statement.step()) {
      return 0;
    }

    return statement.getAsObject().count;
  } finally {
    statement.free();
  }
};

const checkDatabase = async (options = {}) => {
  const databasePath = getDefaultDatabasePath(options);

  if (!fs.existsSync(databasePath)) {
    throw new Error(`数据库文件不存在：${databasePath}。请先执行 npm run db:init。`);
  }

  const SQL = await loadSqlJs();
  const database = new SQL.Database(fs.readFileSync(databasePath));

  try {
    database.run('PRAGMA foreign_keys = ON;');

    const tableCounts = CORE_TABLES.map((tableName) => ({
      tableName,
      count: countRows(database, tableName)
    }));

    return {
      databasePath,
      tableCounts
    };
  } finally {
    database.close();
  }
};

module.exports = {
  CORE_TABLES,
  getDefaultDatabasePath,
  initializeDatabase,
  resetDatabase,
  checkDatabase
};
