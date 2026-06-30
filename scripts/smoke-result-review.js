#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { getDefaultDatabasePath, resetDatabase } = require('../src/database/initDatabase');
const {
  approveResultReview,
  rejectResultReview
} = require('../src/database/resultReview');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SQL_WASM_PATH = path.join(PROJECT_ROOT, 'node_modules', 'sql.js', 'dist');
const REVIEW_OPERATOR = { userId: 2, username: 'chen.review', displayName: 'Smoke Result Reviewer' };
const REJECT_REASON = 'smoke result review reject reason';

let SQL;

const loadSql = async () => {
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: (file) => path.join(SQL_WASM_PATH, file)
    });
  }

  return SQL;
};

const assertEqual = (actual, expected, message) => {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
};

const assertTruthy = (value, message) => {
  if (!value) {
    throw new Error(`${message}: expected truthy value`);
  }
};

const expectReject = async (action, passMessage) => {
  try {
    await action();
  } catch (_error) {
    console.log(`PASS ${passMessage}`);
    return;
  }

  throw new Error(`${passMessage}: expected operation to fail`);
};

const withDatabase = async (callback) => {
  const LoadedSQL = await loadSql();
  const databasePath = getDefaultDatabasePath();

  if (!fs.existsSync(databasePath)) {
    throw new Error(`Smoke database file not found: ${databasePath}`);
  }

  const database = new LoadedSQL.Database(fs.readFileSync(databasePath));

  try {
    database.run('PRAGMA foreign_keys = ON;');
    return callback(database);
  } finally {
    database.close();
  }
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

const getCount = (database, tableName) => Number(getRow(database, `SELECT COUNT(*) AS count FROM ${tableName};`).count);

const getPendingReview = async () => withDatabase((database) => {
  const review = getRow(database, `
    SELECT rr.id, rr.result_id
    FROM result_reviews rr
    WHERE lower(rr.review_status) IN ('pending', 'pending_review', 'reviewing')
    ORDER BY rr.id
    LIMIT 1;
  `);

  if (!review) {
    throw new Error('No pending result review found in seed data');
  }

  return {
    id: Number(review.id),
    resultId: Number(review.result_id)
  };
});

const getReview = (database, reviewId) => getRow(database, `
  SELECT
    rr.id,
    rr.result_id,
    rr.review_status,
    rr.reviewer_id,
    rr.review_opinion,
    rr.review_action,
    rr.reviewed_at,
    tr.result_status
  FROM result_reviews rr
  INNER JOIN test_results tr ON tr.id = rr.result_id
  WHERE rr.id = :reviewId;
`, {
  ':reviewId': reviewId
});

const getAuditLog = (database, reviewId, operationType) => getRow(database, `
  SELECT id, user_id, module_name, operation_type, target_table, target_id, before_json, after_json, remark
  FROM audit_logs
  WHERE target_table = 'result_reviews'
    AND target_id = :reviewId
    AND operation_type = :operationType
  ORDER BY id DESC
  LIMIT 1;
`, {
  ':reviewId': reviewId,
  ':operationType': operationType
});

const resetForCase = async (caseName) => {
  const { databasePath } = await resetDatabase();
  console.log(`RESET ${caseName}: ${databasePath}`);
};

const runApproveSmoke = async () => {
  await resetForCase('approveResultReview');
  const pendingReview = await getPendingReview();

  await withDatabase((database) => {
    assertEqual(getCount(database, 'audit_logs'), 5, 'approveResultReview initial audit log count');
  });

  await approveResultReview(pendingReview.id, REVIEW_OPERATOR);

  await withDatabase((database) => {
    const review = getReview(database, pendingReview.id);
    assertEqual(review.review_status, 'approved', 'approveResultReview review_status');
    assertEqual(Number(review.reviewer_id), REVIEW_OPERATOR.userId, 'approveResultReview reviewer_id');
    assertTruthy(review.reviewed_at, 'approveResultReview reviewed_at');
    assertEqual(review.review_opinion, '审核通过。', 'approveResultReview review_opinion');
    assertEqual(review.review_action, 'approve', 'approveResultReview review_action');
    assertEqual(review.result_status, 'reviewed', 'approveResultReview result_status');
    console.log('PASS approveResultReview updates result review and test result');

    const auditLog = getAuditLog(database, pendingReview.id, '审核通过');
    assertTruthy(auditLog, 'approveResultReview audit log');
    assertEqual(auditLog.module_name, '结果审核', 'approveResultReview audit module');
    assertEqual(Number(auditLog.user_id), REVIEW_OPERATOR.userId, 'approveResultReview audit user');
    assertEqual(getCount(database, 'audit_logs'), 6, 'approveResultReview audit log count');
    console.log('PASS approveResultReview writes audit log');
  });

  await expectReject(
    () => approveResultReview(pendingReview.id, REVIEW_OPERATOR),
    'approveResultReview rejects repeated approval'
  );
};

const runRejectSmoke = async () => {
  await resetForCase('rejectResultReview');
  const pendingReview = await getPendingReview();

  await rejectResultReview(pendingReview.id, REJECT_REASON, REVIEW_OPERATOR);

  await withDatabase((database) => {
    const review = getReview(database, pendingReview.id);
    assertEqual(review.review_status, 'rejected', 'rejectResultReview review_status');
    assertEqual(Number(review.reviewer_id), REVIEW_OPERATOR.userId, 'rejectResultReview reviewer_id');
    assertTruthy(review.reviewed_at, 'rejectResultReview reviewed_at');
    assertEqual(review.review_opinion, REJECT_REASON, 'rejectResultReview review_opinion');
    assertEqual(review.review_action, 'reject', 'rejectResultReview review_action');
    assertEqual(review.result_status, 'review_rejected', 'rejectResultReview result_status');
    console.log('PASS rejectResultReview updates result review and test result');

    const auditLog = getAuditLog(database, pendingReview.id, '审核驳回');
    assertTruthy(auditLog, 'rejectResultReview audit log');
    assertEqual(auditLog.module_name, '结果审核', 'rejectResultReview audit module');
    assertEqual(Number(auditLog.user_id), REVIEW_OPERATOR.userId, 'rejectResultReview audit user');
    assertEqual(getCount(database, 'audit_logs'), 6, 'rejectResultReview audit log count');
    console.log('PASS rejectResultReview writes audit log');
  });

  await expectReject(
    () => rejectResultReview(pendingReview.id, '', REVIEW_OPERATOR),
    'rejectResultReview requires reason'
  );

  await expectReject(
    () => rejectResultReview(pendingReview.id, 'smoke duplicate reject reason', REVIEW_OPERATOR),
    'rejectResultReview rejects repeated rejection'
  );
};

const main = async () => {
  await resetForCase('missingReviewId');
  await expectReject(
    () => approveResultReview(undefined, REVIEW_OPERATOR),
    'approveResultReview requires reviewId'
  );
  await expectReject(
    () => rejectResultReview(undefined, REJECT_REASON, REVIEW_OPERATOR),
    'rejectResultReview requires reviewId'
  );

  await runApproveSmoke();
  await runRejectSmoke();
  console.log('PASS result review write smoke completed');
};

main().catch((error) => {
  console.error('FAIL result review write smoke');
  console.error(error);
  process.exit(1);
});
