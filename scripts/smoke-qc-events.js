#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { getDefaultDatabasePath, resetDatabase } = require('../src/database/initDatabase');
const { getQcEventsData, handleQcEvent } = require('../src/database/qcDashboard');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SQL_WASM_PATH = path.join(PROJECT_ROOT, 'node_modules', 'sql.js', 'dist');
const QC_OPERATOR = { userId: 1, username: 'admin', displayName: 'Smoke QC Event Operator' };
const HANDLING_NOTE = 'QC-EVENT-SMOKE handling action';

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

const getHandleableQcEvent = (database) => getRow(database, `
  SELECT
    id,
    event_no,
    event_status,
    suggested_action,
    handled_by,
    handled_at,
    updated_at
  FROM qc_events
  WHERE lower(event_status) IN ('open', 'handling')
  ORDER BY id ASC
  LIMIT 1;
`);

const getQcEvent = (database, eventId) => getRow(database, `
  SELECT
    id,
    event_no,
    event_status,
    suggested_action,
    handled_by,
    handled_at,
    updated_at
  FROM qc_events
  WHERE id = :eventId;
`, {
  ':eventId': eventId
});

const getQcEventAuditLog = (database, eventId) => getRow(database, `
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
  WHERE target_table = 'qc_events'
    AND target_id = :eventId
    AND operation_type = '处理质控事件'
  ORDER BY id DESC
  LIMIT 1;
`, {
  ':eventId': eventId
});

const main = async () => {
  const { databasePath } = await resetDatabase();
  console.log(`RESET qcEvents: ${databasePath}`);

  const initialAuditCount = await withDatabase((database) => getCount(database, 'audit_logs'));
  assertEqual(initialAuditCount, 5, 'qc events initial audit log count');

  const qcEventsData = await getQcEventsData();
  assertTruthy(Array.isArray(qcEventsData.qcEvents) && qcEventsData.qcEvents.length > 0, 'getQcEventsData qc events');
  console.log('PASS getQcEventsData reads qc events');

  const event = await withDatabase((database) => getHandleableQcEvent(database));
  assertTruthy(event, 'qc events handleable seed event');
  const eventId = Number(event.id);

  const result = await handleQcEvent(eventId, { handlingNote: HANDLING_NOTE }, QC_OPERATOR);
  assertEqual(result.event.eventId, eventId, 'handleQcEvent result event id');
  assertTruthy(result.auditLogId, 'handleQcEvent auditLogId');

  await withDatabase((database) => {
    const handledEvent = getQcEvent(database, eventId);
    assertTruthy(handledEvent, 'handleQcEvent handled event row');
    assertEqual(handledEvent.event_status, 'closed', 'handleQcEvent event_status');
    assertIncludes(handledEvent.suggested_action, 'QC-EVENT-SMOKE', 'handleQcEvent suggested_action');
    assertEqual(Number(handledEvent.handled_by), QC_OPERATOR.userId, 'handleQcEvent handled_by');
    assertTruthy(handledEvent.handled_at, 'handleQcEvent handled_at');
    assertTruthy(handledEvent.updated_at, 'handleQcEvent updated_at');

    const auditLog = getQcEventAuditLog(database, eventId);
    assertTruthy(auditLog, 'handleQcEvent audit log');
    assertEqual(auditLog.module_name, '质控管理', 'handleQcEvent audit module');
    assertEqual(auditLog.operation_type, '处理质控事件', 'handleQcEvent audit operation');
    assertEqual(auditLog.target_table, 'qc_events', 'handleQcEvent audit target table');
    assertEqual(Number(auditLog.target_id), eventId, 'handleQcEvent audit target id');

    const beforeJson = parseJson(auditLog.before_json, 'handleQcEvent before_json');
    const afterJson = parseJson(auditLog.after_json, 'handleQcEvent after_json');
    assertEqual(Number(beforeJson.id), eventId, 'handleQcEvent before_json id');
    assertEqual(Number(afterJson.id), eventId, 'handleQcEvent after_json id');
    assertEqual(afterJson.event_status, 'closed', 'handleQcEvent after_json status');
    assertIncludes(afterJson.suggested_action, 'QC-EVENT-SMOKE', 'handleQcEvent after_json suggested_action');
    assertEqual(getCount(database, 'audit_logs'), initialAuditCount + 1, 'handleQcEvent audit log count');
  });
  console.log('PASS handleQcEvent writes event handling and audit log');

  await expectReject(
    () => handleQcEvent(undefined, { handlingNote: HANDLING_NOTE }, QC_OPERATOR),
    'handleQcEvent rejects invalid eventId'
  );

  await expectReject(
    () => handleQcEvent(eventId, { handlingNote: '' }, QC_OPERATOR),
    'handleQcEvent requires handling note'
  );

  await expectReject(
    () => handleQcEvent(eventId, { handlingNote: 'QC-EVENT-SMOKE duplicate handling' }, QC_OPERATOR),
    'handleQcEvent rejects repeated handling'
  );

  console.log('PASS qc events smoke completed');
};

main().catch((error) => {
  console.error('FAIL qc events smoke');
  console.error(error);
  process.exit(1);
});
