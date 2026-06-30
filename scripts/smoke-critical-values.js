#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { getDefaultDatabasePath, resetDatabase } = require('../src/database/initDatabase');
const {
  notifyCriticalValue,
  acknowledgeCriticalValue,
  completeCriticalValue
} = require('../src/database/criticalValues');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SQL_WASM_PATH = path.join(PROJECT_ROOT, 'node_modules', 'sql.js', 'dist');
const CRITICAL_OPERATOR = { userId: 4, username: 'wang.qc', displayName: 'Smoke Critical Values Operator' };
const NOTIFY_REMARK = 'smoke critical notify remark';
const COMPLETION_RESOLUTION = 'smoke critical completion resolution';

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

const resetForCase = async (caseName) => {
  const { databasePath } = await resetDatabase();
  console.log(`RESET ${caseName}: ${databasePath}`);
};

const getPendingNotification = async () => withDatabase((database) => {
  const notification = getRow(database, `
    SELECT
      cn.id,
      cn.critical_value_id
    FROM critical_notifications cn
    INNER JOIN critical_values cv ON cv.id = cn.critical_value_id
    WHERE lower(cn.confirm_status) IN ('pending', 'pending_confirm')
      AND cv.closed_at IS NULL
      AND lower(cv.status) NOT IN ('closed', 'completed')
    ORDER BY cn.id DESC
    LIMIT 1;
  `);

  if (!notification) {
    throw new Error('No pending critical notification found in seed data');
  }

  return {
    id: Number(notification.id),
    criticalValueId: Number(notification.critical_value_id)
  };
});

const getNotification = (database, notificationId) => getRow(database, `
  SELECT
    cn.id,
    cn.critical_value_id,
    cn.notify_method,
    cn.notify_target,
    cn.notified_by,
    cn.notified_at,
    cn.confirm_status,
    cn.confirmed_at,
    cn.remark,
    cv.status AS critical_value_status,
    cv.closed_at AS critical_value_closed_at
  FROM critical_notifications cn
  INNER JOIN critical_values cv ON cv.id = cn.critical_value_id
  WHERE cn.id = :notificationId;
`, {
  ':notificationId': notificationId
});

const getAuditLog = (database, notificationId, operationType) => getRow(database, `
  SELECT id, user_id, module_name, operation_type, target_table, target_id, before_json, after_json, remark
  FROM audit_logs
  WHERE target_table = 'critical_notifications'
    AND target_id = :notificationId
    AND operation_type = :operationType
  ORDER BY id DESC
  LIMIT 1;
`, {
  ':notificationId': notificationId,
  ':operationType': operationType
});

const parseJson = (value, message) => {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${message}: invalid JSON ${error.message}`);
  }
};

const assertAuditLog = (database, notificationId, operationType, expectedAfterStatus) => {
  const auditLog = getAuditLog(database, notificationId, operationType);
  assertTruthy(auditLog, `${operationType} audit log`);
  assertEqual(auditLog.module_name, '危急值中心', `${operationType} audit module`);
  assertEqual(Number(auditLog.user_id), CRITICAL_OPERATOR.userId, `${operationType} audit user`);
  assertEqual(auditLog.target_table, 'critical_notifications', `${operationType} audit target_table`);
  assertEqual(Number(auditLog.target_id), notificationId, `${operationType} audit target_id`);
  const afterJson = parseJson(auditLog.after_json, `${operationType} after_json`);
  assertEqual(afterJson.confirm_status, expectedAfterStatus, `${operationType} audit after_json confirm_status`);
  return auditLog;
};

const runNotifySmoke = async () => {
  await resetForCase('notifyCriticalValue');
  const notification = await getPendingNotification();

  await withDatabase((database) => {
    assertEqual(getCount(database, 'audit_logs'), 5, 'notifyCriticalValue initial audit log count');
  });

  await notifyCriticalValue(notification.id, NOTIFY_REMARK, CRITICAL_OPERATOR);

  await withDatabase((database) => {
    const updated = getNotification(database, notification.id);
    assertEqual(updated.confirm_status, 'notified', 'notifyCriticalValue confirm_status');
    assertEqual(Number(updated.notified_by), CRITICAL_OPERATOR.userId, 'notifyCriticalValue notified_by');
    assertTruthy(updated.notified_at, 'notifyCriticalValue notified_at');
    assertEqual(updated.remark, NOTIFY_REMARK, 'notifyCriticalValue remark');
    assertEqual(updated.critical_value_status, 'notified', 'notifyCriticalValue critical value status');
    console.log('PASS notifyCriticalValue updates notification and critical value');

    assertAuditLog(database, notification.id, '危急值通知', 'notified');
    assertEqual(getCount(database, 'audit_logs'), 6, 'notifyCriticalValue audit log count');
    console.log('PASS notifyCriticalValue writes audit log');
  });

  await expectReject(
    () => notifyCriticalValue(notification.id, 'smoke duplicate notify remark', CRITICAL_OPERATOR),
    'notifyCriticalValue rejects repeated notification'
  );
};

const runAcknowledgeSmoke = async () => {
  await resetForCase('acknowledgeCriticalValue');
  const notification = await getPendingNotification();

  await expectReject(
    () => acknowledgeCriticalValue(notification.id, CRITICAL_OPERATOR),
    'acknowledgeCriticalValue rejects direct acknowledgement before notification'
  );

  await notifyCriticalValue(notification.id, NOTIFY_REMARK, CRITICAL_OPERATOR);
  await acknowledgeCriticalValue(notification.id, CRITICAL_OPERATOR);

  await withDatabase((database) => {
    const updated = getNotification(database, notification.id);
    assertEqual(updated.confirm_status, 'confirmed', 'acknowledgeCriticalValue confirm_status');
    assertTruthy(updated.confirmed_at, 'acknowledgeCriticalValue confirmed_at');
    assertEqual(updated.critical_value_status, 'confirmed', 'acknowledgeCriticalValue critical value status');
    console.log('PASS acknowledgeCriticalValue updates notification and critical value');

    assertAuditLog(database, notification.id, '危急值确认', 'confirmed');
    assertEqual(getCount(database, 'audit_logs'), 7, 'acknowledgeCriticalValue audit log count');
    console.log('PASS acknowledgeCriticalValue writes audit log');
  });

  await expectReject(
    () => acknowledgeCriticalValue(notification.id, CRITICAL_OPERATOR),
    'acknowledgeCriticalValue rejects repeated acknowledgement'
  );
};

const runCompleteSmoke = async () => {
  await resetForCase('completeCriticalValue');
  const notification = await getPendingNotification();

  await notifyCriticalValue(notification.id, NOTIFY_REMARK, CRITICAL_OPERATOR);
  await acknowledgeCriticalValue(notification.id, CRITICAL_OPERATOR);

  await expectReject(
    () => completeCriticalValue(notification.id, '', CRITICAL_OPERATOR),
    'completeCriticalValue requires resolution'
  );

  await completeCriticalValue(notification.id, COMPLETION_RESOLUTION, CRITICAL_OPERATOR);

  await withDatabase((database) => {
    const updated = getNotification(database, notification.id);
    assertEqual(updated.confirm_status, 'completed', 'completeCriticalValue confirm_status');
    assertIncludes(updated.remark, COMPLETION_RESOLUTION, 'completeCriticalValue remark');
    assertEqual(updated.critical_value_status, 'closed', 'completeCriticalValue critical value status');
    assertTruthy(updated.critical_value_closed_at, 'completeCriticalValue critical value closed_at');
    console.log('PASS completeCriticalValue updates notification and closes critical value');

    assertAuditLog(database, notification.id, '危急值完成', 'completed');
    assertEqual(getCount(database, 'audit_logs'), 8, 'completeCriticalValue audit log count');
    console.log('PASS completeCriticalValue writes audit log');
  });

  await expectReject(
    () => completeCriticalValue(notification.id, 'smoke duplicate completion resolution', CRITICAL_OPERATOR),
    'completeCriticalValue rejects repeated completion'
  );
};

const main = async () => {
  await resetForCase('missingNotificationId');
  await expectReject(
    () => notifyCriticalValue(undefined, NOTIFY_REMARK, CRITICAL_OPERATOR),
    'notifyCriticalValue requires notificationId'
  );
  await expectReject(
    () => acknowledgeCriticalValue(undefined, CRITICAL_OPERATOR),
    'acknowledgeCriticalValue requires notificationId'
  );
  await expectReject(
    () => completeCriticalValue(undefined, COMPLETION_RESOLUTION, CRITICAL_OPERATOR),
    'completeCriticalValue requires notificationId'
  );

  await runNotifySmoke();
  await runAcknowledgeSmoke();
  await runCompleteSmoke();
  console.log('PASS critical values write smoke completed');
};

main().catch((error) => {
  console.error('FAIL critical values write smoke');
  console.error(error);
  process.exit(1);
});
