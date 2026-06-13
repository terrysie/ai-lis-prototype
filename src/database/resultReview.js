const fs = require('fs');
const path = require('path');
const { getDefaultDatabasePath, initializeDatabase } = require('./initDatabase');

const PENDING_RESULT_STATUSES = ['pending_review', 'pending', 'reviewing', 'auto_release_candidate', '待审核', '待复核'];
const PENDING_REVIEW_STATUSES = ['pending', 'pending_review', 'reviewing', '待审核', '待复核'];
const REVIEWED_STATUSES = ['approved', 'reviewed', 'released', 'release', '已审核', '已发布', '已放行'];
const NORMAL_FLAGS = ['normal', 'none', '正常', ''];
const CRITICAL_FLAGS = ['true', 'critical', 'critical_high', 'critical_low', '危急值', '是'];

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
const isInGroup = (value, group) => group.some((candidate) => normalizeText(candidate) === normalizeText(value));

const toReviewDto = (row) => ({
  id: Number(row.id),
  sampleId: Number(row.sample_id),
  sampleNo: row.sample_no,
  patientCode: row.patient_code,
  department: row.department,
  testGroup: row.test_group,
  resultId: Number(row.result_id),
  itemName: row.item_name,
  resultValue: row.result_value,
  resultText: row.result_text || null,
  unit: row.unit || null,
  referenceRange: row.reference_range || null,
  abnormalFlag: row.abnormal_flag || null,
  criticalFlag: row.critical_flag || null,
  qcStatus: row.qc_status || null,
  resultStatus: row.result_status || null,
  aiLevel: row.ai_level || null,
  aiConclusion: row.ai_conclusion || null,
  aiSuggestedAction: row.ai_suggested_action || null,
  reviewStatus: row.review_status || null,
  reviewerId: row.reviewer_id === null ? null : Number(row.reviewer_id),
  reviewerName: row.reviewer_name || null,
  reviewOpinion: row.review_opinion || null,
  reviewAction: row.review_action || null,
  reviewedAt: row.reviewed_at || null,
  reportedAt: row.reported_at || null,
  createdAt: row.created_at
});

const getResultReviewData = async (options = {}) => {
  const { database, databasePath } = await openDatabase(options);

  try {
    database.run('PRAGMA foreign_keys = ON;');

    const rows = getRows(database, `
      SELECT
        COALESCE(rr.id, tr.id) AS id,
        tr.sample_id,
        s.sample_no,
        s.patient_code,
        s.department,
        s.test_group,
        tr.id AS result_id,
        ti.item_name,
        tr.result_value,
        tr.result_text,
        COALESCE(tr.unit, ti.unit) AS unit,
        COALESCE(tr.reference_range, ti.reference_range) AS reference_range,
        tr.abnormal_flag,
        tr.critical_flag,
        tr.qc_status,
        tr.result_status,
        apr.ai_level,
        apr.conclusion AS ai_conclusion,
        apr.suggested_action AS ai_suggested_action,
        rr.review_status,
        rr.reviewer_id,
        u.display_name AS reviewer_name,
        rr.review_opinion,
        rr.review_action,
        rr.reviewed_at,
        tr.reported_at,
        COALESCE(rr.created_at, tr.created_at) AS created_at
      FROM test_results tr
      INNER JOIN samples s ON s.id = tr.sample_id
      INNER JOIN test_items ti ON ti.id = tr.test_item_id
      LEFT JOIN ai_pre_reviews apr ON apr.result_id = tr.id
      LEFT JOIN result_reviews rr ON rr.result_id = tr.id
      LEFT JOIN users u ON u.id = rr.reviewer_id
      ORDER BY
        CASE
          WHEN lower(COALESCE(tr.critical_flag, '')) IN ('critical', 'critical_high', 'critical_low', 'true') THEN 1
          WHEN lower(COALESCE(rr.review_status, tr.result_status, '')) IN ('pending', 'pending_review', 'reviewing') THEN 2
          ELSE 3
        END,
        datetime(COALESCE(rr.created_at, tr.created_at)) DESC,
        tr.id DESC;
    `);

    const reviews = rows.map(toReviewDto);

    return {
      stats: {
        totalResults: reviews.length,
        pendingReview: reviews.filter((review) => isInGroup(review.resultStatus, PENDING_RESULT_STATUSES) || isInGroup(review.reviewStatus, PENDING_REVIEW_STATUSES)).length,
        reviewed: reviews.filter((review) => isInGroup(review.reviewStatus, REVIEWED_STATUSES) || isInGroup(review.resultStatus, REVIEWED_STATUSES)).length,
        abnormalResults: reviews.filter((review) => !isInGroup(review.abnormalFlag, NORMAL_FLAGS)).length,
        criticalResults: reviews.filter((review) => isInGroup(review.criticalFlag, CRITICAL_FLAGS)).length
      },
      reviews,
      databasePath: databasePath || getDefaultDatabasePath(options)
    };
  } finally {
    database.close();
  }
};

module.exports = {
  getResultReviewData
};
