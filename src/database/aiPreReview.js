const fs = require('fs');
const path = require('path');
const { getDefaultDatabasePath, initializeDatabase } = require('./initDatabase');

const LEVEL_GROUPS = {
  autoRelease: ['a', 'a_class', 'auto_release', 'low_risk', '低风险', 'a 类', 'a类', '自动放行'],
  quickReview: ['b', 'b_class', 'quick_review', 'medium_risk', '中风险', 'b 类', 'b类', '快速复核'],
  focusReview: ['c', 'c_class', 'focus_review', 'high_risk', '高风险', 'c 类', 'c类', '重点复核']
};

const openDatabase = async (options = {}) => {
  const { databasePath } = await initializeDatabase(options);
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', file)
  });

  if (!fs.existsSync(databasePath)) {
    throw new Error(`数据库文件不存在：${databasePath}`);
  }

  return {
    database: new SQL.Database(fs.readFileSync(databasePath)),
    databasePath
  };
};

const getRows = (database, sql, params = {}) => {
  const statement = database.prepare(sql);
  const rows = [];

  try {
    statement.bind(params);

    while (statement.step()) {
      rows.push(statement.getAsObject());
    }

    return rows;
  } finally {
    statement.free();
  }
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const isLevelInGroup = (level, group) => {
  const normalizedLevel = normalizeText(level);
  return LEVEL_GROUPS[group].some((candidate) => normalizeText(candidate) === normalizedLevel);
};

const parseJsonList = (value) => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((item) => {
      if (typeof item === 'string') {
        return item;
      }

      if (item && typeof item === 'object') {
        return item.rule || item.item || JSON.stringify(item);
      }

      return String(item);
    });
  } catch (error) {
    return [];
  }
};

const hasJsonListItems = (value) => parseJsonList(value).length > 0;

const toReviewDto = (row) => ({
  id: Number(row.id),
  sampleId: Number(row.sample_id),
  sampleNo: row.sample_no,
  patientCode: row.patient_code,
  department: row.department,
  testGroup: row.test_group,
  resultId: row.result_id === null ? null : Number(row.result_id),
  itemName: row.item_name || null,
  resultValue: row.result_value || row.result_text || null,
  unit: row.unit || null,
  abnormalFlag: row.abnormal_flag || null,
  criticalFlag: row.critical_flag || null,
  aiLevel: row.ai_level,
  riskTags: parseJsonList(row.risk_tags_json),
  hitRules: parseJsonList(row.hit_rules_json),
  conclusion: row.conclusion || '',
  suggestedAction: row.suggested_action || '',
  manualOverride: row.manual_override || null,
  createdAt: row.created_at
});

const getAiPreReviewData = async (options = {}) => {
  const { database } = await openDatabase(options);

  try {
    database.run('PRAGMA foreign_keys = ON;');

    const rows = getRows(database, `
      SELECT
        apr.id,
        apr.sample_id,
        apr.result_id,
        apr.ai_level,
        apr.risk_tags_json,
        apr.hit_rules_json,
        apr.conclusion,
        apr.suggested_action,
        apr.manual_override,
        apr.created_at,
        s.sample_no,
        s.patient_code,
        s.department,
        s.test_group,
        tr.result_value,
        tr.result_text,
        tr.unit,
        tr.abnormal_flag,
        tr.critical_flag,
        ti.item_name
      FROM ai_pre_reviews apr
      INNER JOIN samples s ON s.id = apr.sample_id
      LEFT JOIN test_results tr ON tr.id = apr.result_id
      LEFT JOIN test_items ti ON ti.id = tr.test_item_id
      ORDER BY datetime(apr.created_at) DESC, apr.id DESC;
    `);

    return {
      stats: {
        total: rows.length,
        autoRelease: rows.filter((row) => isLevelInGroup(row.ai_level, 'autoRelease')).length,
        quickReview: rows.filter((row) => isLevelInGroup(row.ai_level, 'quickReview')).length,
        focusReview: rows.filter((row) => isLevelInGroup(row.ai_level, 'focusReview')).length,
        riskAlerts: rows.filter((row) => hasJsonListItems(row.risk_tags_json) || hasJsonListItems(row.hit_rules_json)).length
      },
      reviews: rows.map(toReviewDto),
      databasePath: getDefaultDatabasePath(options)
    };
  } finally {
    database.close();
  }
};

module.exports = {
  getAiPreReviewData
};
