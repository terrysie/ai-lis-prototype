#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { getDefaultDatabasePath, resetDatabase } = require('../src/database/initDatabase');
const {
  getReagentExpiryAlertsData,
  handleReagentExpiryAlert
} = require('../src/database/qcDashboard');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SQL_WASM_PATH = path.join(PROJECT_ROOT, 'node_modules', 'sql.js', 'dist');
const REAGENT_OPERATOR = { userId: 1, username: 'admin', displayName: 'Smoke Reagent Expiry Operator' };
const HANDLING_NOTE = 'REAGENT-EXPIRY-SMOKE handling action';

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

const getHandleableReagentExpiryAlert = (database) => getRow(database, `
  SELECT
    id,
    reagent_batch_id,
    days_left,
    risk_level,
    suggested_action,
    alert_status,
    updated_at
  FROM reagent_expiry_alerts
  WHERE lower(alert_status) IN ('open', 'handling')
  ORDER BY id ASC
  LIMIT 1;
`);

const getReagentExpiryAlert = (database, alertId) => getRow(database, `
  SELECT
    id,
    reagent_batch_id,
    days_left,
    risk_level,
    suggested_action,
    alert_status,
    updated_at
  FROM reagent_expiry_alerts
  WHERE id = :alertId;
`, {
  ':alertId': alertId
});

const getReagentExpiryAuditLog = (database, alertId) => getRow(database, `
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
  WHERE target_table = 'reagent_expiry_alerts'
    AND target_id = :alertId
    AND operation_type = '处理试剂近效期预警'
  ORDER BY id DESC
  LIMIT 1;
`, {
  ':alertId': alertId
});

const main = async () => {
  const { databasePath } = await resetDatabase();
  console.log(`RESET reagentExpiryAlerts: ${databasePath}`);

  const initialAuditCount = await withDatabase((database) => getCount(database, 'audit_logs'));
  assertEqual(initialAuditCount, 5, 'reagent expiry alerts initial audit log count');

  const data = await getReagentExpiryAlertsData();
  assertTruthy(Array.isArray(data.reagentExpiryAlerts) && data.reagentExpiryAlerts.length > 0, 'getReagentExpiryAlertsData alerts');
  console.log('PASS getReagentExpiryAlertsData reads reagent expiry alerts');

  const alert = await withDatabase((database) => getHandleableReagentExpiryAlert(database));
  assertTruthy(alert, 'reagent expiry handleable seed alert');
  const alertId = Number(alert.id);

  const result = await handleReagentExpiryAlert(alertId, { handlingNote: HANDLING_NOTE }, REAGENT_OPERATOR);
  assertEqual(result.alert.alertId, alertId, 'handleReagentExpiryAlert result alert id');
  assertTruthy(result.auditLogId, 'handleReagentExpiryAlert auditLogId');

  await withDatabase((database) => {
    const handledAlert = getReagentExpiryAlert(database, alertId);
    assertTruthy(handledAlert, 'handleReagentExpiryAlert handled alert row');
    assertEqual(handledAlert.alert_status, 'handled', 'handleReagentExpiryAlert alert_status');
    assertIncludes(handledAlert.suggested_action, 'REAGENT-EXPIRY-SMOKE', 'handleReagentExpiryAlert suggested_action');
    assertTruthy(handledAlert.updated_at, 'handleReagentExpiryAlert updated_at');

    const auditLog = getReagentExpiryAuditLog(database, alertId);
    assertTruthy(auditLog, 'handleReagentExpiryAlert audit log');
    assertEqual(auditLog.module_name, '试剂管理', 'handleReagentExpiryAlert audit module');
    assertEqual(auditLog.operation_type, '处理试剂近效期预警', 'handleReagentExpiryAlert audit operation');
    assertEqual(auditLog.target_table, 'reagent_expiry_alerts', 'handleReagentExpiryAlert audit target table');
    assertEqual(Number(auditLog.target_id), alertId, 'handleReagentExpiryAlert audit target id');

    const beforeJson = parseJson(auditLog.before_json, 'handleReagentExpiryAlert before_json');
    const afterJson = parseJson(auditLog.after_json, 'handleReagentExpiryAlert after_json');
    assertEqual(Number(beforeJson.id), alertId, 'handleReagentExpiryAlert before_json id');
    assertEqual(Number(afterJson.id), alertId, 'handleReagentExpiryAlert after_json id');
    assertEqual(afterJson.alert_status, 'handled', 'handleReagentExpiryAlert after_json status');
    assertIncludes(afterJson.suggested_action, 'REAGENT-EXPIRY-SMOKE', 'handleReagentExpiryAlert after_json suggested_action');
    assertEqual(getCount(database, 'audit_logs'), initialAuditCount + 1, 'handleReagentExpiryAlert audit log count');
  });
  console.log('PASS handleReagentExpiryAlert writes alert handling and audit log');

  await expectReject(
    () => handleReagentExpiryAlert(undefined, { handlingNote: HANDLING_NOTE }, REAGENT_OPERATOR),
    'handleReagentExpiryAlert rejects invalid alertId'
  );

  await expectReject(
    () => handleReagentExpiryAlert(alertId, { handlingNote: '' }, REAGENT_OPERATOR),
    'handleReagentExpiryAlert requires handling note'
  );

  await expectReject(
    () => handleReagentExpiryAlert(alertId, { handlingNote: 'REAGENT-EXPIRY-SMOKE duplicate handling' }, REAGENT_OPERATOR),
    'handleReagentExpiryAlert rejects repeated handling'
  );

  console.log('PASS reagent expiry alerts smoke completed');
};

main().catch((error) => {
  console.error('FAIL reagent expiry alerts smoke');
  console.error(error);
  process.exit(1);
});
