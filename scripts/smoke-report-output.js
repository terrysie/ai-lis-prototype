#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { getDefaultDatabasePath, resetDatabase } = require('../src/database/initDatabase');
const {
  getReportPreviewData,
  generateReportHtml,
  exportReportHtml
} = require('../src/database/reportOutput');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SQL_WASM_PATH = path.join(PROJECT_ROOT, 'node_modules', 'sql.js', 'dist');
const REPORT_OPERATOR = { userId: 2, username: 'chen.review', displayName: 'Smoke Report Operator' };
const REPORT_OUTPUT_DIR = path.join(PROJECT_ROOT, 'data', 'reports');

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

const assertIncludes = (value, expectedPart, message) => {
  if (!String(value || '').includes(expectedPart)) {
    throw new Error(`${message}: expected "${value}" to include "${expectedPart}"`);
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

const getReportableResult = (database) => getRow(database, `
  SELECT
    tr.id AS result_id,
    s.sample_no,
    ti.item_name,
    tr.result_value,
    tr.reference_range,
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

const getReportAuditLog = (database, resultId) => getRow(database, `
  SELECT id, user_id, module_name, operation_type, target_table, target_id, before_json, after_json, remark
  FROM audit_logs
  WHERE target_table = 'test_results'
    AND target_id = :resultId
    AND operation_type = '生成报告HTML'
  ORDER BY id DESC
  LIMIT 1;
`, {
  ':resultId': resultId
});

const createRuntimeReportableResult = async () => withDatabase((database) => {
  const now = '2026-06-12 11:10:00';
  const sampleNo = `REPORT-SMOKE-${Date.now()}`;
  const testItem = getRow(database, `
    SELECT id, item_name, unit, reference_range
    FROM test_items
    WHERE item_code = 'GLU'
    LIMIT 1;
  `);
  const instrument = getRow(database, 'SELECT id FROM instruments ORDER BY id LIMIT 1;');

  assertTruthy(testItem, 'report smoke test item');
  assertTruthy(instrument, 'report smoke instrument');

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
      'P-REPORT-SMOKE',
      'outpatient',
      'Report Smoke Department',
      '生化组',
      '血清',
      '黄帽管',
      '2026-06-12 10:55:00',
      '2026-06-12 11:00:00',
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
      '5.8',
      NULL,
      :unit,
      :referenceRange,
      'normal',
      'none',
      :instrumentId,
      'passed',
      'reviewed',
      '2026-06-12 11:05:00',
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
      'REPORT-SMOKE result approved for report output.',
      'approve',
      '2026-06-12 11:06:00',
      :createdAt
    );
  `, {
    ':sampleId': sampleId,
    ':resultId': resultId,
    ':createdAt': now
  });

  return getReportableResult(database);
}, {
  writable: true
});

const getOrCreateReportableResult = async () => {
  const existing = await withDatabase((database) => getReportableResult(database));

  if (existing) {
    console.log('PASS report output smoke uses existing reviewed result');
    return existing;
  }

  const created = await createRuntimeReportableResult();
  assertTruthy(created, 'report output runtime reportable result');
  console.log('PASS report output smoke creates REPORT-SMOKE result');
  return created;
};

const cleanupExportedFile = (filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};

const main = async () => {
  const { databasePath } = await resetDatabase();
  console.log(`RESET reportOutput: ${databasePath}`);

  const initialAuditCount = await withDatabase((database) => getCount(database, 'audit_logs'));
  assertEqual(initialAuditCount, 5, 'report output initial audit log count');
  const reportable = await getOrCreateReportableResult();
  const resultId = Number(reportable.result_id);

  const preview = await getReportPreviewData(resultId);
  assertEqual(preview.reportData.resultId, resultId, 'getReportPreviewData resultId');
  assertTruthy(preview.reportData.sampleNo, 'getReportPreviewData sampleNo');
  assertTruthy(preview.reportData.itemName, 'getReportPreviewData itemName');
  assertTruthy(preview.reportData.displayResult, 'getReportPreviewData result value');
  assertEqual(preview.reportData.reviewStatus, 'approved', 'getReportPreviewData review status');
  assertEqual(preview.reportData.resultStatus, 'reviewed', 'getReportPreviewData result status');
  console.log('PASS getReportPreviewData reads reviewed result');

  const generated = await generateReportHtml(resultId, REPORT_OPERATOR);
  assertTruthy(typeof generated.html === 'string' && generated.html.includes('<!doctype html>'), 'generateReportHtml html');
  assertIncludes(generated.html, generated.reportData.sampleNo, 'generateReportHtml sample number');
  assertIncludes(generated.html, generated.reportData.itemName, 'generateReportHtml item name');
  assertIncludes(generated.html, generated.reportData.displayResult, 'generateReportHtml result value');
  assertIncludes(generated.html, generated.reportData.referenceRange, 'generateReportHtml reference range');

  await withDatabase((database) => {
    const auditLog = getReportAuditLog(database, resultId);
    assertTruthy(auditLog, 'generateReportHtml audit log');
    assertEqual(auditLog.module_name, '报告输出', 'generateReportHtml audit module');
    assertEqual(Number(auditLog.user_id), REPORT_OPERATOR.userId, 'generateReportHtml audit user');
    assertEqual(getCount(database, 'audit_logs'), initialAuditCount + 1, 'generateReportHtml audit log count');
  });
  console.log('PASS generateReportHtml writes html and audit log');

  const exported = await exportReportHtml(resultId, REPORT_OPERATOR, { reportOutputDir: REPORT_OUTPUT_DIR });
  assertTruthy(exported.filePath, 'exportReportHtml filePath');
  assertTruthy(fs.existsSync(exported.filePath), 'exportReportHtml file exists');
  const exportedHtml = fs.readFileSync(exported.filePath, 'utf8');
  assertIncludes(exportedHtml, '<!doctype html>', 'exportReportHtml file html');
  assertIncludes(exportedHtml, exported.reportData.sampleNo, 'exportReportHtml file sample number');

  await withDatabase((database) => {
    const auditLog = getReportAuditLog(database, resultId);
    assertTruthy(auditLog, 'exportReportHtml audit log');
    assertEqual(Number(auditLog.user_id), REPORT_OPERATOR.userId, 'exportReportHtml audit user');
    assertEqual(getCount(database, 'audit_logs'), initialAuditCount + 2, 'exportReportHtml audit log count');
  });
  console.log('PASS exportReportHtml writes local html file and audit log');
  cleanupExportedFile(exported.filePath);

  const pendingResult = await withDatabase((database) => getPendingResult(database));
  assertTruthy(pendingResult, 'pending result for rejection test');
  await expectReject(
    () => generateReportHtml(Number(pendingResult.result_id), REPORT_OPERATOR),
    'generateReportHtml rejects unapproved result'
  );

  console.log('PASS report output smoke completed');
};

main().catch((error) => {
  console.error('FAIL report output smoke');
  console.error(error);
  process.exit(1);
});
