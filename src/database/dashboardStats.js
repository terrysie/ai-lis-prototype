const fs = require('fs');
const { getDefaultDatabasePath, initializeDatabase } = require('./initDatabase');

const countSingleValue = (database, sql, params = {}) => {
  const statement = database.prepare(sql);

  try {
    statement.bind(params);

    if (!statement.step()) {
      return 0;
    }

    const row = statement.getAsObject();
    return Number(row.count || 0);
  } finally {
    statement.free();
  }
};

const openDatabase = async (options = {}) => {
  const { databasePath } = await initializeDatabase(options);
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({
    locateFile: (file) => require('path').join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', file)
  });

  if (!fs.existsSync(databasePath)) {
    throw new Error(`数据库文件不存在：${databasePath}`);
  }

  return {
    database: new SQL.Database(fs.readFileSync(databasePath)),
    databasePath
  };
};

const getDashboardStats = async (options = {}) => {
  const { database, databasePath } = await openDatabase(options);

  try {
    database.run('PRAGMA foreign_keys = ON;');

    // 原型阶段 seed.sql 使用固定演示日期；如果没有真实今日样本，则回退统计 samples 总数。
    const todaySamples = countSingleValue(database, `
      SELECT CASE
        WHEN SUM(CASE WHEN date(COALESCE(received_at, created_at)) = date('now') THEN 1 ELSE 0 END) > 0
          THEN SUM(CASE WHEN date(COALESCE(received_at, created_at)) = date('now') THEN 1 ELSE 0 END)
        ELSE COUNT(*)
      END AS count
      FROM samples;
    `);

    return {
      todaySamples,
      aiAutoRelease: countSingleValue(database, `
        SELECT COUNT(*) AS count
        FROM ai_pre_reviews
        WHERE lower(ai_level) IN ('a', 'a_class', 'auto_release', 'low_risk');
      `),
      quickReview: countSingleValue(database, `
        SELECT COUNT(*) AS count
        FROM ai_pre_reviews
        WHERE lower(ai_level) IN ('b', 'b_class', 'quick_review', 'medium_risk');
      `),
      focusReview: countSingleValue(database, `
        SELECT COUNT(*) AS count
        FROM ai_pre_reviews
        WHERE lower(ai_level) IN ('c', 'c_class', 'focus_review', 'high_risk');
      `),
      openCriticalValues: countSingleValue(database, `
        SELECT COUNT(*) AS count
        FROM critical_values
        WHERE lower(status) NOT IN ('closed', '已闭环');
      `),
      databasePath: databasePath || getDefaultDatabasePath(options)
    };
  } finally {
    database.close();
  }
};

module.exports = {
  getDashboardStats
};
