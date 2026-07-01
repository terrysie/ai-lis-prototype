#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { getDefaultDatabasePath, resetDatabase } = require('../src/database/initDatabase');
const {
  getInfectiousAlertsData,
  handleInfectiousAlert
} = require('../src/database/aiPreReview');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SQL_WASM_PATH = path.join(PROJECT_ROOT, 'node_modules', 'sql.js', 'dist');
const INFECTIOUS_OPERATOR = { userId: 1, username: 'admin', displayName: 'Smoke Infectious Alert Operator' };
const HANDLING_NOTE = 'INFECTIOUS-ALERT-SMOKE handling action';

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

const parseJson = (value, message) => {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${message}: invalid JSON ${error.message}`);
  }
};

const getHandleableInfectiousAlert = (database) => getRow(database, `
  SELECT
    id,
    sample_id,
    result_id,
    disease_item,
    positive_condition,
    review_status,
    notify_status,
    infection_control_status,
    report_hint_status,
    updated_at
  FROM infectious_alerts
  WHERE lower(review_status) NOT IN ('closed', 'resolved', 'handled', 'completed', 'ignored')
    AND lower(notify_status) NOT IN ('closed', 'resolved', 'handled', 'completed', 'ignored')
    AND lower(infection_control_status) NOT IN ('closed', 'resolved', 'handled', 'completed', 'ignored')
  ORDER BY id ASC
  LIMIT 1;
`);

const getInfectiousAlert = (database, alertId) => getRow(database, `
  SELECT
    id,
    sample_id,
    result_id,
    disease_item,
    positive_condition,
    review_status,
    notify_status,
    infection_control_status,
    report_hint_status,
    updated_at
  FROM infectious_alerts
  WHERE id = :alertId;
`, {
  ':alertId': alertId
});

const getInfectiousAuditLog = (database, alertId) => getRow(database, `
  SELECT
    id,
    user_id,
    module_name,
    operation_type,
    target_table,
    target_id,
    before_json,
    after_json,
    remark
  FROM audit_logs
  WHERE target_table = 'infectious_alerts'
    AND target_id = :alertId
    AND operation_type = '处理传染病阳性预警'
  ORDER BY id DESC
  LIMIT 1;
`, {
  ':alertId': alertId
});

const main = async () => {
  const { databasePath } = await resetDatabase();
  console.log(`RESET infectiousAlerts: ${databasePath}`);

  const initialAuditCount = await withDatabase((database) => getCount(database, 'audit_logs'));
  assertEqual(initialAuditCount, 5, 'infectious alerts initial audit log count');

  const data = await getInfectiousAlertsData();
  assertTruthy(Array.isArray(data.infectiousAlerts) && data.infectiousAlerts.length > 0, 'getInfectiousAlertsData alerts');
  console.log('PASS getInfectiousAlertsData reads infectious alerts');

  const alert = await withDatabase((database) => getHandleableInfectiousAlert(database));
  assertTruthy(alert, 'infectious handleable seed alert');
  const alertId = Number(alert.id);

  const result = await handleInfectiousAlert(alertId, { handlingNote: HANDLING_NOTE }, INFECTIOUS_OPERATOR);
  assertEqual(result.alert.alertId, alertId, 'handleInfectiousAlert result alert id');
  assertTruthy(result.auditLogId, 'handleInfectiousAlert auditLogId');

  await withDatabase((database) => {
    const handledAlert = getInfectiousAlert(database, alertId);
    assertTruthy(handledAlert, 'handleInfectiousAlert handled alert row');
    assertEqual(handledAlert.review_status, 'handled', 'handleInfectiousAlert review_status');
    assertEqual(handledAlert.notify_status, 'notified', 'handleInfectiousAlert notify_status');
    assertEqual(handledAlert.infection_control_status, 'handled', 'handleInfectiousAlert infection_control_status');
    assertEqual(handledAlert.report_hint_status, 'handled', 'handleInfectiousAlert report_hint_status');
    assertTruthy(handledAlert.updated_at, 'handleInfectiousAlert updated_at');

    const auditLog = getInfectiousAuditLog(database, alertId);
    assertTruthy(auditLog, 'handleInfectiousAlert audit log');
    assertEqual(auditLog.module_name, '传染病预警', 'handleInfectiousAlert audit module');
    assertEqual(auditLog.operation_type, '处理传染病阳性预警', 'handleInfectiousAlert audit operation');
    assertEqual(auditLog.target_table, 'infectious_alerts', 'handleInfectiousAlert audit target table');
    assertEqual(Number(auditLog.target_id), alertId, 'handleInfectiousAlert audit target id');

    const beforeJson = parseJson(auditLog.before_json, 'handleInfectiousAlert before_json');
    const afterJson = parseJson(auditLog.after_json, 'handleInfectiousAlert after_json');
    assertEqual(Number(beforeJson.id), alertId, 'handleInfectiousAlert before_json id');
    assertEqual(Number(afterJson.id), alertId, 'handleInfectiousAlert after_json id');
    assertEqual(afterJson.review_status, 'handled', 'handleInfectiousAlert after_json review_status');
    assertIncludes(afterJson.handling_note, 'INFECTIOUS-ALERT-SMOKE', 'handleInfectiousAlert after_json handling note');
    assertTruthy(afterJson.handled_at, 'handleInfectiousAlert after_json handled_at');
    assertEqual(getCount(database, 'audit_logs'), initialAuditCount + 1, 'handleInfectiousAlert audit log count');
  });
  console.log('PASS handleInfectiousAlert writes alert handling and audit log');

  await expectReject(
    () => handleInfectiousAlert(undefined, { handlingNote: HANDLING_NOTE }, INFECTIOUS_OPERATOR),
    'handleInfectiousAlert rejects invalid alertId'
  );

  await expectReject(
    () => handleInfectiousAlert(alertId, { handlingNote: '' }, INFECTIOUS_OPERATOR),
    'handleInfectiousAlert requires handling note'
  );

  await expectReject(
    () => handleInfectiousAlert(alertId, { handlingNote: 'INFECTIOUS-ALERT-SMOKE duplicate handling' }, INFECTIOUS_OPERATOR),
    'handleInfectiousAlert rejects repeated handling'
  );

  console.log('PASS infectious alerts smoke completed');
};

main().catch((error) => {
  console.error('FAIL infectious alerts smoke');
  console.error(error);
  process.exit(1);
});
