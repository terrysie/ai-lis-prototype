const fs = require('fs');
const path = require('path');
const { getDefaultDatabasePath, initializeDatabase } = require('./initDatabase');

const PENDING_RESULT_STATUSES = ['pending_review', 'pending', 'reviewing', 'auto_release_candidate', '待审核', '待复核'];
const PENDING_REVIEW_STATUSES = ['pending', 'pending_review', 'reviewing', '待审核', '待复核'];
const REVIEWED_STATUSES = ['approved', 'reviewed', 'released', 'release', '已审核', '已发布', '已放行'];
const NORMAL_FLAGS = ['normal', 'none', '正常', ''];
const CRITICAL_FLAGS = ['true', 'critical', 'critical_high', 'critical_low', '危急值', '是'];

const RESULT_REVIEW_SELECT_COLUMNS = `
  rr.id,
  rr.sample_id,
  rr.result_id,
  rr.review_status,
  rr.reviewer_id,
  rr.review_opinion,
  rr.review_action,
  rr.reviewed_at,
  rr.created_at,
  tr.result_status,
  tr.updated_at AS result_updated_at
`;

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
const isInGroup = (value, group) => group.some((candidate) => normalizeText(candidate) === normalizeText(value));

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

const ensureReviewId = (reviewId, actionText) => {
  const numericReviewId = Number(reviewId);

  if (!Number.isInteger(numericReviewId) || numericReviewId <= 0) {
    throw new Error(`审核记录 ID 无效，无法${actionText}。`);
  }

  return numericReviewId;
};

const isReviewPending = (review) => isInGroup(review?.review_status, PENDING_REVIEW_STATUSES);

const getResultReviewRow = (database, reviewId) => getRow(database, `
  SELECT ${RESULT_REVIEW_SELECT_COLUMNS}
  FROM result_reviews rr
  INNER JOIN test_results tr ON tr.id = rr.result_id
  WHERE rr.id = :reviewId;
`, {
  ':reviewId': reviewId
});

const writeResultReviewAuditLog = (database, {
  userId,
  operationType,
  reviewId,
  beforeReview,
  afterReview,
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
      '结果审核',
      :operationType,
      'result_reviews',
      :targetId,
      :beforeJson,
      :afterJson,
      :remark,
      :createdAt
    );
  `, {
    ':userId': userId,
    ':operationType': operationType,
    ':targetId': reviewId,
    ':beforeJson': JSON.stringify(beforeReview),
    ':afterJson': JSON.stringify(afterReview),
    ':remark': remark,
    ':createdAt': createdAt
  });
};

const toReviewDto = (row) => ({
  id: Number(row.id),
  reviewId: row.review_id === null || row.review_id === undefined ? null : Number(row.review_id),
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
        rr.id AS review_id,
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

const approveResultReview = async (reviewId, operator = {}, options = {}) => {
  const numericReviewId = ensureReviewId(reviewId, '审核通过');
  const { database, databasePath } = await openDatabase(options);
  let transactionStarted = false;

  try {
    database.run('PRAGMA foreign_keys = ON;');
    database.run('BEGIN TRANSACTION;');
    transactionStarted = true;

    const beforeReview = getResultReviewRow(database, numericReviewId);

    if (!beforeReview) {
      throw new Error(`审核记录不存在，无法审核通过：${numericReviewId}`);
    }

    if (!isReviewPending(beforeReview)) {
      throw new Error(`审核记录 ${numericReviewId} 当前状态为 ${beforeReview.review_status}，不能重复审核通过。`);
    }

    const now = getCurrentTimestamp();
    const operatorUserId = getOperatorUserId(operator);
    const operatorName = getOperatorName(operator);
    const reviewOpinion = '审核通过。';

    database.run(`
      UPDATE result_reviews
      SET
        review_status = 'approved',
        reviewer_id = :reviewerId,
        review_opinion = :reviewOpinion,
        review_action = 'approve',
        reviewed_at = :reviewedAt
      WHERE id = :reviewId;
    `, {
      ':reviewerId': operatorUserId,
      ':reviewOpinion': reviewOpinion,
      ':reviewedAt': now,
      ':reviewId': numericReviewId
    });

    database.run(`
      UPDATE test_results
      SET
        result_status = 'reviewed',
        updated_at = :updatedAt
      WHERE id = :resultId;
    `, {
      ':updatedAt': now,
      ':resultId': beforeReview.result_id
    });

    const afterReview = getResultReviewRow(database, numericReviewId);
    writeResultReviewAuditLog(database, {
      userId: operatorUserId,
      operationType: '审核通过',
      reviewId: numericReviewId,
      beforeReview,
      afterReview,
      remark: `审核通过：reviewId=${numericReviewId}；操作者：${operatorName}；意见：${reviewOpinion}`,
      createdAt: now
    });

    database.run('COMMIT;');
    transactionStarted = false;
    saveDatabase(database, databasePath);

    return {
      review: toReviewDto({
        ...afterReview,
        sample_no: null,
        patient_code: null,
        department: null,
        test_group: null,
        item_name: null,
        result_value: null,
        result_text: null,
        unit: null,
        reference_range: null,
        abnormal_flag: null,
        critical_flag: null,
        qc_status: null,
        result_status: afterReview.result_status,
        ai_level: null,
        ai_conclusion: null,
        ai_suggested_action: null,
        reviewer_name: null,
        reported_at: null
      }),
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

const rejectResultReview = async (reviewId, reason, operator = {}, options = {}) => {
  const numericReviewId = ensureReviewId(reviewId, '审核驳回');
  const rejectReason = String(reason || '').trim();

  if (!rejectReason) {
    throw new Error('审核驳回原因不能为空。');
  }

  const { database, databasePath } = await openDatabase(options);
  let transactionStarted = false;

  try {
    database.run('PRAGMA foreign_keys = ON;');
    database.run('BEGIN TRANSACTION;');
    transactionStarted = true;

    const beforeReview = getResultReviewRow(database, numericReviewId);

    if (!beforeReview) {
      throw new Error(`审核记录不存在，无法审核驳回：${numericReviewId}`);
    }

    if (!isReviewPending(beforeReview)) {
      throw new Error(`审核记录 ${numericReviewId} 当前状态为 ${beforeReview.review_status}，不能重复审核驳回。`);
    }

    const now = getCurrentTimestamp();
    const operatorUserId = getOperatorUserId(operator);
    const operatorName = getOperatorName(operator);

    database.run(`
      UPDATE result_reviews
      SET
        review_status = 'rejected',
        reviewer_id = :reviewerId,
        review_opinion = :reviewOpinion,
        review_action = 'reject',
        reviewed_at = :reviewedAt
      WHERE id = :reviewId;
    `, {
      ':reviewerId': operatorUserId,
      ':reviewOpinion': rejectReason,
      ':reviewedAt': now,
      ':reviewId': numericReviewId
    });

    database.run(`
      UPDATE test_results
      SET
        result_status = 'review_rejected',
        updated_at = :updatedAt
      WHERE id = :resultId;
    `, {
      ':updatedAt': now,
      ':resultId': beforeReview.result_id
    });

    const afterReview = getResultReviewRow(database, numericReviewId);
    writeResultReviewAuditLog(database, {
      userId: operatorUserId,
      operationType: '审核驳回',
      reviewId: numericReviewId,
      beforeReview,
      afterReview,
      remark: `审核驳回：reviewId=${numericReviewId}；操作者：${operatorName}；原因：${rejectReason}`,
      createdAt: now
    });

    database.run('COMMIT;');
    transactionStarted = false;
    saveDatabase(database, databasePath);

    return {
      review: toReviewDto({
        ...afterReview,
        sample_no: null,
        patient_code: null,
        department: null,
        test_group: null,
        item_name: null,
        result_value: null,
        result_text: null,
        unit: null,
        reference_range: null,
        abnormal_flag: null,
        critical_flag: null,
        qc_status: null,
        result_status: afterReview.result_status,
        ai_level: null,
        ai_conclusion: null,
        ai_suggested_action: null,
        reviewer_name: null,
        reported_at: null
      }),
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
  getResultReviewData,
  approveResultReview,
  rejectResultReview
};
