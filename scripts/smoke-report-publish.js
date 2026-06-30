#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { getDefaultDatabasePath, resetDatabase } = require('../src/database/initDatabase');
const { generateReportHtml } = require('../src/database/reportOutput');
const {
  getReportPublishPreview,
  publishReport
} = require('../src/database/reportPublish');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SQL_WASM_PATH = path.join(PROJECT_ROOT, 'node_modules', 'sql.js', 'dist');
const PUBLISH_OPERATOR = { userId: 2, username: 'chen.review', displayName: 'Smoke Report Publisher' };

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

const withDatabase = async (callback, { writable = false } = {}) => {
  const LoadedSQL = await loadSql();
  const databasePath = getDefaultDatabasePath();

  if (!fs.existsSync(databasePath)) {
    throw new Error(`Smoke database file not found: ${databasePath}`);
  }

  const database = new LoadedSQL.Database(fs.readFileSync(databasePath));

  try {
    database.run('PRAGMA foreign_keys = ON;');
    const result = await callback(database, databasePath);

    if (writable) {
      fs.writeFileSync(databasePath, Buffer.from(database.export()));
    }

    return result;
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

const getLastInsertId = (database) => Number(getRow(database, 'SELECT last_insert_rowid() AS id;').id);

const getPublishableResult = (database) => getRow(database, `
  SELECT
    tr.id AS result_id,
    s.sample_no,
    ti.item_name,
    tr.result_value,
    rr.review_status,
    tr.result_status
  FROM test_results tr
  INNER JOIN samples s ON s.id = tr.sample_id
  INNER JOIN test_items ti ON ti.id = tr.test_item_id
  INNER JOIN result_reviews rr ON rr.result_id = tr.id
  WHERE lower(rr.review_status) = 'approved'
    AND lower(tr.result_status) = 'reviewed'
  ORDER BY tr.id
  LIMIT 1;
`);

const getPendingResult = (database) => getRow(database, `
  SELECT tr.id AS result_id
  FROM test_results tr
  LEFT JOIN result_reviews rr ON rr.result_id = tr.id
  WHERE lower(COALESCE(rr.review_status, tr.result_status, '')) IN ('pending', 'pending_review', 'reviewing')
  ORDER BY tr.id
  LIMIT 1;
`);

const getResult = (database, resultId) => getRow(database, `
  SELECT id, result_status, updated_at
  FROM test_results
  WHERE id = :resultId;
`, {
  ':resultId': resultId
});

const getPublishAuditLog = (database, resultId) => getRow(database, `
  SELECT id, user_id, module_name, operation_type, target_table, target_id, before_json, after_json, remark
  FROM audit_logs
  WHERE target_table = 'test_results'
    AND target_id = :resultId
    AND operation_type = '发布报告'
  ORDER BY id DESC
  LIMIT 1;
`, {
  ':resultId': resultId
});

const parseJson = (value, message) => {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${message}: invalid JSON ${error.message}`);
  }
};

const createRuntimePublishableResult = async () => withDatabase((database) => {
  const now = '2026-06-12 11:40:00';
  const sampleNo = `PUBLISH-SMOKE-${Date.now()}`;
  const testItem = getRow(database, `
    SELECT id, item_name, unit, reference_range
    FROM test_items
    WHERE item_code = 'GLU'
    LIMIT 1;
  `);
  const instrument = getRow(database, 'SELECT id FROM instruments ORDER BY id LIMIT 1;');

  assertTruthy(testItem, 'publish smoke test item');
  assertTruthy(instrument, 'publish smoke instrument');

  database.run(`
    INSERT INTO samples (
      sample_no,
      patient_code,
      source_type,
      department,
      test_group,
      sample_type,
      container_type,
      collected_at,
      received_at,
      status,
      priority,
      reject_reason,
      created_at,
      updated_at
    ) VALUES (
      :sampleNo,
      'P-PUBLISH-SMOKE',
      'outpatient',
      'Publish Smoke Department',
      '生化组',
      '血清',
      '黄帽管',
      '2026-06-12 11:20:00',
      '2026-06-12 11:24:00',
      'reviewing',
      'routine',
      NULL,
      :createdAt,
      :updatedAt
    );
  `, {
    ':sampleNo': sampleNo,
    ':createdAt': now,
    ':updatedAt': now
  });
  const sampleId = getLastInsertId(database);

  database.run(`
    INSERT INTO test_results (
      sample_id,
      test_item_id,
      result_value,
      result_text,
      unit,
      reference_range,
      abnormal_flag,
      critical_flag,
      instrument_id,
      qc_status,
      result_status,
      reported_at,
      created_at,
      updated_at
    ) VALUES (
      :sampleId,
      :testItemId,
      '5.6',
      NULL,
      :unit,
      :referenceRange,
      'normal',
      'none',
      :instrumentId,
      'passed',
      'reviewed',
      '2026-06-12 11:35:00',
      :createdAt,
      :updatedAt
    );
  `, {
    ':sampleId': sampleId,
    ':testItemId': Number(testItem.id),
    ':unit': testItem.unit || 'mmol/L',
    ':referenceRange': testItem.reference_range || '3.9-6.1',
    ':instrumentId': Number(instrument.id),
    ':createdAt': now,
    ':updatedAt': now
  });
  const resultId = getLastInsertId(database);

  database.run(`
    INSERT INTO result_reviews (
      sample_id,
      result_id,
      review_status,
      reviewer_id,
      review_opinion,
      review_action,
      reviewed_at,
      created_at
    ) VALUES (
      :sampleId,
      :resultId,
      'approved',
      2,
      'PUBLISH-SMOKE result approved for report publishing.',
      'approve',
      '2026-06-12 11:36:00',
      :createdAt
    );
  `, {
    ':sampleId': sampleId,
    ':resultId': resultId,
    ':createdAt': now
  });

  return getPublishableResult(database);
}, {
  writable: true
});

const getOrCreatePublishableResult = async () => {
  const existing = await withDatabase((database) => getPublishableResult(database));

  if (existing) {
    console.log('PASS report publish smoke uses existing reviewed result');
    return existing;
  }

  const created = await createRuntimePublishableResult();
  assertTruthy(created, 'report publish runtime publishable result');
  console.log('PASS report publish smoke creates PUBLISH-SMOKE result');
  return created;
};

const main = async () => {
  const { databasePath } = await resetDatabase();
  console.log(`RESET reportPublish: ${databasePath}`);

  const initialAuditCount = await withDatabase((database) => getCount(database, 'audit_logs'));
  assertEqual(initialAuditCount, 5, 'report publish initial audit log count');
  const publishable = await getOrCreatePublishableResult();
  const resultId = Number(publishable.result_id);

  const preview = await getReportPublishPreview(resultId);
  assertEqual(preview.reportData.resultId, resultId, 'getReportPublishPreview resultId');
  assertTruthy(preview.reportData.sampleNo, 'getReportPublishPreview sampleNo');
  assertTruthy(preview.reportData.itemName, 'getReportPublishPreview itemName');
  assertEqual(preview.reportData.resultStatus, 'reviewed', 'getReportPublishPreview result status');
  assertEqual(preview.reportData.reviewStatus, 'approved', 'getReportPublishPreview review status');
  assertEqual(preview.reportData.canPublish, true, 'getReportPublishPreview canPublish');
  console.log('PASS getReportPublishPreview reads publishable result');

  const published = await publishReport(resultId, PUBLISH_OPERATOR);
  assertEqual(published.reportData.resultStatus, 'published', 'publishReport result status');
  assertEqual(published.reportData.published, true, 'publishReport published flag');
  assertTruthy(published.reportData.publishedAt, 'publishReport publishedAt');

  await withDatabase((database) => {
    const result = getResult(database, resultId);
    assertEqual(result.result_status, 'published', 'publishReport database result_status');

    const auditLog = getPublishAuditLog(database, resultId);
    assertTruthy(auditLog, 'publishReport audit log');
    assertEqual(auditLog.module_name, '报告发布', 'publishReport audit module');
    assertEqual(auditLog.operation_type, '发布报告', 'publishReport audit operation');
    assertEqual(auditLog.target_table, 'test_results', 'publishReport audit target table');
    assertEqual(Number(auditLog.target_id), resultId, 'publishReport audit target id');
    assertEqual(Number(auditLog.user_id), PUBLISH_OPERATOR.userId, 'publishReport audit user');
    const afterJson = parseJson(auditLog.after_json, 'publishReport audit after_json');
    assertEqual(afterJson.result_status, 'published', 'publishReport audit result status');
    assertTruthy(afterJson.published_at, 'publishReport audit published_at');
    assertEqual(getCount(database, 'audit_logs'), initialAuditCount + 1, 'publishReport audit log count');
  });
  console.log('PASS publishReport writes published status and audit log');

  await expectReject(
    () => publishReport(resultId, PUBLISH_OPERATOR),
    'publishReport rejects repeated publish'
  );

  const htmlReport = await generateReportHtml(resultId, PUBLISH_OPERATOR);
  assertTruthy(typeof htmlReport.html === 'string' && htmlReport.html.includes('<!doctype html>'), 'generateReportHtml after publish');
  assertEqual(htmlReport.reportData.resultStatus, 'published', 'generateReportHtml published result status');
  console.log('PASS generateReportHtml supports published result');

  const pendingResult = await withDatabase((database) => getPendingResult(database));
  assertTruthy(pendingResult, 'pending result for publish rejection test');
  await expectReject(
    () => publishReport(Number(pendingResult.result_id), PUBLISH_OPERATOR),
    'publishReport rejects unapproved result'
  );

  console.log('PASS report publish smoke completed');
};

main().catch((error) => {
  console.error('FAIL report publish smoke');
  console.error(error);
  process.exit(1);
});
