const fs = require('fs');
const path = require('path');
const { getDefaultDatabasePath, initializeDatabase } = require('./initDatabase');

const PUBLISHABLE_RESULT_STATUS = 'reviewed';
const PUBLISHED_RESULT_STATUS = 'published';

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

const getRow = (database, sql, params = {}) => getRows(database, sql, params)[0] || null;

const saveDatabase = (database, databasePath) => {
  const exportedDatabase = database.export();
  fs.writeFileSync(databasePath, Buffer.from(exportedDatabase));
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const padDatePart = (value) => String(value).padStart(2, '0');

const getCurrentTimestamp = () => {
  const now = new Date();

  return [
    `${now.getFullYear()}-${padDatePart(now.getMonth() + 1)}-${padDatePart(now.getDate())}`,
    `${padDatePart(now.getHours())}:${padDatePart(now.getMinutes())}:${padDatePart(now.getSeconds())}`
  ].join(' ');
};

const getOperatorUserId = (operator = {}) => {
  const userId = Number(operator.userId ?? operator.id);
  return Number.isFinite(userId) && userId > 0 ? userId : null;
};

const getOperatorName = (operator = {}) => {
  const operatorName = operator.displayName || operator.username || operator.name || operator.operatorName;
  return String(operatorName || operator.userId || operator.id || 'unknown').trim() || 'unknown';
};

const ensureResultId = (resultId, actionText) => {
  const numericResultId = Number(resultId);

  if (!Number.isInteger(numericResultId) || numericResultId <= 0) {
    throw new Error(`检验结果 ID 无效，无法${actionText}。`);
  }

  return numericResultId;
};

const getReportPublishRow = (database, resultId) => getRow(database, `
  SELECT
    tr.id AS result_id,
    tr.sample_id,
    tr.result_value,
    tr.result_text,
    COALESCE(tr.unit, ti.unit) AS unit,
    COALESCE(tr.reference_range, ti.reference_range) AS reference_range,
    tr.abnormal_flag,
    tr.critical_flag,
    tr.qc_status,
    tr.result_status,
    tr.reported_at,
    tr.created_at AS result_created_at,
    tr.updated_at AS result_updated_at,
    s.sample_no,
    s.patient_code,
    s.department,
    s.sample_type,
    s.status AS sample_status,
    ti.item_name,
    rr.id AS review_id,
    rr.review_status,
    rr.review_opinion,
    rr.review_action,
    rr.reviewed_at,
    rr.reviewer_id,
    u.username AS reviewer_username,
    u.display_name AS reviewer_name
  FROM test_results tr
  INNER JOIN samples s ON s.id = tr.sample_id
  INNER JOIN test_items ti ON ti.id = tr.test_item_id
  LEFT JOIN result_reviews rr ON rr.id = (
    SELECT rr2.id
    FROM result_reviews rr2
    WHERE rr2.result_id = tr.id
    ORDER BY
      CASE WHEN lower(COALESCE(rr2.review_status, '')) = 'approved' THEN 0 ELSE 1 END,
      datetime(COALESCE(rr2.reviewed_at, rr2.created_at)) DESC,
      rr2.id DESC
    LIMIT 1
  )
  LEFT JOIN users u ON u.id = rr.reviewer_id
  WHERE tr.id = :resultId;
`, {
  ':resultId': resultId
});

const toReportPublishDto = (row) => {
  const normalizedResultStatus = normalizeText(row.result_status);
  const reviewApproved = normalizeText(row.review_status) === 'approved';
  const published = normalizedResultStatus === PUBLISHED_RESULT_STATUS;
  const canPublish = reviewApproved && normalizedResultStatus === PUBLISHABLE_RESULT_STATUS;

  return {
    resultId: Number(row.result_id),
    sampleId: Number(row.sample_id),
    sampleNo: row.sample_no,
    patientCode: row.patient_code,
    department: row.department || null,
    sampleType: row.sample_type || null,
    itemName: row.item_name,
    resultValue: row.result_value || null,
    resultText: row.result_text || null,
    displayResult: row.result_text || row.result_value || null,
    unit: row.unit || null,
    referenceRange: row.reference_range || null,
    abnormalFlag: row.abnormal_flag || null,
    criticalFlag: row.critical_flag || null,
    qcStatus: row.qc_status || null,
    reviewId: row.review_id === null || row.review_id === undefined ? null : Number(row.review_id),
    reviewStatus: row.review_status || null,
    reviewOpinion: row.review_opinion || null,
    reviewAction: row.review_action || null,
    reviewedAt: row.reviewed_at || null,
    reviewerId: row.reviewer_id === null || row.reviewer_id === undefined ? null : Number(row.reviewer_id),
    reviewerName: row.reviewer_name || null,
    reviewerUsername: row.reviewer_username || null,
    resultStatus: row.result_status || null,
    reportedAt: row.reported_at || null,
    resultCreatedAt: row.result_created_at || null,
    resultUpdatedAt: row.result_updated_at || null,
    published,
    canPublish
  };
};

const validatePublishPreviewRow = (row, resultId) => {
  if (!row) {
    throw new Error(`检验结果不存在，无法读取报告发布预览：${resultId}`);
  }

  if (normalizeText(row.review_status) !== 'approved') {
    throw new Error(`检验结果 ${resultId} 尚未审核通过，无法进入报告发布。`);
  }

  const normalizedResultStatus = normalizeText(row.result_status);
  if (![PUBLISHABLE_RESULT_STATUS, PUBLISHED_RESULT_STATUS].includes(normalizedResultStatus)) {
    throw new Error(`检验结果 ${resultId} 当前结果状态为 ${row.result_status || '--'}，必须为 reviewed 或 published 才能进入报告发布。`);
  }
};

const getReportPublishPreview = async (resultId, options = {}) => {
  const numericResultId = ensureResultId(resultId, '读取报告发布预览');
  const { database, databasePath } = await openDatabase(options);

  try {
    database.run('PRAGMA foreign_keys = ON;');
    const row = getReportPublishRow(database, numericResultId);
    validatePublishPreviewRow(row, numericResultId);

    return {
      reportData: toReportPublishDto(row),
      databasePath: databasePath || getDefaultDatabasePath(options)
    };
  } finally {
    database.close();
  }
};

const insertPublishAuditLog = (database, {
  userId,
  resultId,
  beforeJson,
  afterJson,
  remark,
  createdAt
}) => {
  database.run(`
    INSERT INTO audit_logs (
      user_id,
      module_name,
      operation_type,
      target_table,
      target_id,
      before_json,
      after_json,
      remark,
      created_at
    ) VALUES (
      :userId,
      '报告发布',
      '发布报告',
      'test_results',
      :targetId,
      :beforeJson,
      :afterJson,
      :remark,
      :createdAt
    );
  `, {
    ':userId': userId,
    ':targetId': resultId,
    ':beforeJson': JSON.stringify(beforeJson),
    ':afterJson': JSON.stringify(afterJson),
    ':remark': remark,
    ':createdAt': createdAt
  });

  return Number(getRow(database, 'SELECT last_insert_rowid() AS id;').id);
};

const publishReport = async (resultId, operator = {}, options = {}) => {
  const numericResultId = ensureResultId(resultId, '正式发布报告');
  const { database, databasePath } = await openDatabase(options);
  let transactionStarted = false;

  try {
    database.run('PRAGMA foreign_keys = ON;');
    database.run('BEGIN TRANSACTION;');
    transactionStarted = true;

    const beforeRow = getReportPublishRow(database, numericResultId);

    if (!beforeRow) {
      throw new Error(`检验结果不存在，无法正式发布报告：${numericResultId}`);
    }

    if (normalizeText(beforeRow.review_status) !== 'approved') {
      throw new Error(`检验结果 ${numericResultId} 尚未审核通过，无法正式发布报告。`);
    }

    const normalizedResultStatus = normalizeText(beforeRow.result_status);
    if (normalizedResultStatus === PUBLISHED_RESULT_STATUS) {
      throw new Error(`检验结果 ${numericResultId} 已正式发布，不能重复发布。`);
    }

    if (normalizedResultStatus !== PUBLISHABLE_RESULT_STATUS) {
      throw new Error(`检验结果 ${numericResultId} 当前结果状态为 ${beforeRow.result_status || '--'}，必须为 reviewed 才能正式发布。`);
    }

    const now = getCurrentTimestamp();
    const operatorUserId = getOperatorUserId(operator);
    const operatorName = getOperatorName(operator);

    database.run(`
      UPDATE test_results
      SET
        result_status = 'published',
        updated_at = :updatedAt
      WHERE id = :resultId;
    `, {
      ':updatedAt': now,
      ':resultId': numericResultId
    });

    const afterRow = getReportPublishRow(database, numericResultId);
    const auditLogId = insertPublishAuditLog(database, {
      userId: operatorUserId,
      resultId: numericResultId,
      beforeJson: {
        result_id: Number(beforeRow.result_id),
        sample_id: Number(beforeRow.sample_id),
        sample_no: beforeRow.sample_no,
        review_status: beforeRow.review_status,
        result_status: beforeRow.result_status
      },
      afterJson: {
        result_id: Number(afterRow.result_id),
        sample_id: Number(afterRow.sample_id),
        sample_no: afterRow.sample_no,
        result_status: PUBLISHED_RESULT_STATUS,
        published_at: now
      },
      remark: `正式发布检验报告；操作者：${operatorName}`,
      createdAt: now
    });

    database.run('COMMIT;');
    transactionStarted = false;
    saveDatabase(database, databasePath);

    return {
      reportData: {
        ...toReportPublishDto(afterRow),
        publishedAt: now
      },
      auditLogId,
      auditLog: {
        id: auditLogId,
        moduleName: '报告发布',
        operationType: '发布报告',
        targetTable: 'test_results',
        targetId: numericResultId
      },
      databasePath
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        database.run('ROLLBACK;');
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
    }

    throw error;
  } finally {
    database.close();
  }
};

module.exports = {
  getReportPublishPreview,
  publishReport
};
