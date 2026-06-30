const fs = require('fs');
const path = require('path');
const { getDefaultDatabasePath, initializeDatabase } = require('./initDatabase');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_REPORT_DIR = path.join(PROJECT_ROOT, 'data', 'reports');

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

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const sanitizeFileNamePart = (value) => String(value || 'unknown')
  .trim()
  .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
  .replace(/\s+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '') || 'unknown';

const getReportOutputDir = (options = {}) => (
  options.reportOutputDir
    ? path.resolve(options.reportOutputDir)
    : DEFAULT_REPORT_DIR
);

const getReportResultRow = (database, resultId) => getRow(database, `
  SELECT
    tr.id AS result_id,
    tr.sample_id,
    tr.test_item_id,
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
    s.source_type,
    s.department,
    s.test_group,
    s.sample_type,
    s.container_type,
    s.collected_at,
    s.received_at,
    s.status AS sample_status,
    ti.item_code,
    ti.item_name,
    i.instrument_code,
    i.instrument_name,
    rr.id AS review_id,
    rr.review_status,
    rr.reviewer_id,
    rr.review_opinion,
    rr.review_action,
    rr.reviewed_at,
    rr.created_at AS review_created_at,
    u.username AS reviewer_username,
    u.display_name AS reviewer_name
  FROM test_results tr
  INNER JOIN samples s ON s.id = tr.sample_id
  INNER JOIN test_items ti ON ti.id = tr.test_item_id
  LEFT JOIN instruments i ON i.id = tr.instrument_id
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

const toReportPreviewDto = (row) => ({
  resultId: Number(row.result_id),
  sampleId: Number(row.sample_id),
  sampleNo: row.sample_no,
  patientCode: row.patient_code,
  sourceType: row.source_type || null,
  department: row.department || null,
  testGroup: row.test_group || null,
  sampleType: row.sample_type || null,
  containerType: row.container_type || null,
  collectedAt: row.collected_at || null,
  receivedAt: row.received_at || null,
  sampleStatus: row.sample_status || null,
  itemCode: row.item_code || null,
  itemName: row.item_name,
  resultValue: row.result_value || null,
  resultText: row.result_text || null,
  displayResult: row.result_text || row.result_value || null,
  unit: row.unit || null,
  referenceRange: row.reference_range || null,
  abnormalFlag: row.abnormal_flag || null,
  criticalFlag: row.critical_flag || null,
  qcStatus: row.qc_status || null,
  resultStatus: row.result_status || null,
  reportedAt: row.reported_at || null,
  resultCreatedAt: row.result_created_at || null,
  resultUpdatedAt: row.result_updated_at || null,
  instrumentCode: row.instrument_code || null,
  instrumentName: row.instrument_name || null,
  reviewId: row.review_id === null || row.review_id === undefined ? null : Number(row.review_id),
  reviewStatus: row.review_status || null,
  reviewerId: row.reviewer_id === null || row.reviewer_id === undefined ? null : Number(row.reviewer_id),
  reviewerUsername: row.reviewer_username || null,
  reviewerName: row.reviewer_name || null,
  reviewOpinion: row.review_opinion || null,
  reviewAction: row.review_action || null,
  reviewedAt: row.reviewed_at || null,
  reviewCreatedAt: row.review_created_at || null
});

const getReportPreviewData = async (resultId, options = {}) => {
  const numericResultId = ensureResultId(resultId, '生成报告预览');
  const { database, databasePath } = await openDatabase(options);

  try {
    database.run('PRAGMA foreign_keys = ON;');
    const row = getReportResultRow(database, numericResultId);

    if (!row) {
      throw new Error(`检验结果不存在，无法生成报告预览：${numericResultId}`);
    }

    if (normalizeText(row.review_status) !== 'approved') {
      throw new Error(`检验结果 ${numericResultId} 尚未审核通过，无法生成报告。`);
    }

    if (!['reviewed', 'published'].includes(normalizeText(row.result_status))) {
      throw new Error(`检验结果 ${numericResultId} 当前结果状态为 ${row.result_status || '--'}，必须为 reviewed 或 published 才能生成报告。`);
    }

    return {
      reportData: toReportPreviewDto(row),
      databasePath: databasePath || getDefaultDatabasePath(options)
    };
  } finally {
    database.close();
  }
};

const buildReportHtml = (reportData) => {
  const rows = [
    ['样本编号', reportData.sampleNo],
    ['患者编号', reportData.patientCode],
    ['科室', reportData.department],
    ['标本类型', reportData.sampleType],
    ['容器类型', reportData.containerType],
    ['检验项目', reportData.itemName],
    ['结果值', reportData.displayResult],
    ['单位', reportData.unit],
    ['参考范围', reportData.referenceRange],
    ['异常标记', reportData.abnormalFlag],
    ['危急值标记', reportData.criticalFlag],
    ['质控状态', reportData.qcStatus],
    ['审核状态', reportData.reviewStatus],
    ['审核意见', reportData.reviewOpinion],
    ['审核人', reportData.reviewerName || reportData.reviewerUsername],
    ['审核时间', reportData.reviewedAt],
    ['报告生成时间', reportData.generatedAt]
  ];

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>TERRY-LIS 检验报告 - ${escapeHtml(reportData.sampleNo)}</title>
  <style>
    body { font-family: "Microsoft YaHei", Arial, sans-serif; color: #1f2933; margin: 32px; }
    .report { max-width: 840px; margin: 0 auto; border: 1px solid #d6dde8; padding: 28px; }
    h1 { margin: 0 0 8px; font-size: 24px; text-align: center; }
    .subtitle { text-align: center; color: #607086; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; }
    th, td { border: 1px solid #d6dde8; padding: 10px 12px; text-align: left; font-size: 14px; }
    th { width: 28%; background: #f4f7fb; color: #334155; }
    .footer { margin-top: 24px; display: flex; justify-content: space-between; color: #607086; font-size: 13px; }
    @media print { body { margin: 0; } .report { border: none; } }
  </style>
</head>
<body>
  <main class="report">
    <h1>TERRY-LIS 检验报告</h1>
    <div class="subtitle">可打印 HTML 报告预览</div>
    <table>
      <tbody>
        ${rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value || '--')}</td></tr>`).join('\n        ')}
      </tbody>
    </table>
    <div class="footer">
      <span>报告格式：HTML</span>
      <span>操作员：${escapeHtml(reportData.generatedBy || '--')}</span>
    </div>
  </main>
</body>
</html>`;
};

const insertReportAuditLog = (database, {
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
      '报告输出',
      '生成报告HTML',
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
    ':beforeJson': beforeJson ? JSON.stringify(beforeJson) : null,
    ':afterJson': JSON.stringify(afterJson),
    ':remark': remark,
    ':createdAt': createdAt
  });

  return Number(getRow(database, 'SELECT last_insert_rowid() AS id;').id);
};

const generateReportHtml = async (resultId, operator = {}, options = {}) => {
  const numericResultId = ensureResultId(resultId, '生成报告 HTML');
  const preview = await getReportPreviewData(numericResultId, options);
  const generatedAt = getCurrentTimestamp();
  const operatorUserId = getOperatorUserId(operator);
  const operatorName = getOperatorName(operator);
  const reportData = {
    ...preview.reportData,
    generatedAt,
    generatedBy: operatorName,
    format: 'html'
  };
  const html = buildReportHtml(reportData);
  const { database, databasePath } = await openDatabase(options);
  let transactionStarted = false;

  try {
    database.run('PRAGMA foreign_keys = ON;');
    database.run('BEGIN TRANSACTION;');
    transactionStarted = true;

    const auditLogId = insertReportAuditLog(database, {
      userId: operatorUserId,
      resultId: numericResultId,
      beforeJson: {
        result_id: reportData.resultId,
        sample_id: reportData.sampleId,
        sample_no: reportData.sampleNo,
        review_status: reportData.reviewStatus,
        result_status: reportData.resultStatus
      },
      afterJson: {
        result_id: reportData.resultId,
        sample_id: reportData.sampleId,
        sample_no: reportData.sampleNo,
        generated_at: generatedAt,
        format: 'html'
      },
      remark: '生成可打印 HTML 报告',
      createdAt: generatedAt
    });

    database.run('COMMIT;');
    transactionStarted = false;
    saveDatabase(database, databasePath);

    return {
      reportData,
      html,
      auditLogId,
      auditLog: {
        id: auditLogId,
        moduleName: '报告输出',
        operationType: '生成报告HTML',
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

const exportReportHtml = async (resultId, operator = {}, options = {}) => {
  const generatedReport = await generateReportHtml(resultId, operator, options);
  const reportOutputDir = getReportOutputDir(options);
  const fileName = `report-${sanitizeFileNamePart(generatedReport.reportData.sampleNo)}-${generatedReport.reportData.resultId}.html`;
  const filePath = path.join(reportOutputDir, fileName);

  fs.mkdirSync(reportOutputDir, { recursive: true });
  fs.writeFileSync(filePath, generatedReport.html, 'utf8');

  return {
    ...generatedReport,
    filePath
  };
};

module.exports = {
  getReportPreviewData,
  generateReportHtml,
  exportReportHtml
};
