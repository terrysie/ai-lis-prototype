#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { getDefaultDatabasePath, resetDatabase } = require('../src/database/initDatabase');
const {
  confirmSampleReception,
  getSampleReceptionHistory
} = require('../src/database/sampleReception');
const { approveResultReview } = require('../src/database/resultReview');
const {
  notifyCriticalValue,
  acknowledgeCriticalValue,
  completeCriticalValue
} = require('../src/database/criticalValues');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SQL_WASM_PATH = path.join(PROJECT_ROOT, 'node_modules', 'sql.js', 'dist');
const SAMPLE_OPERATOR = { userId: 3, username: 'li.receive', displayName: 'E2E Sample Receiver' };
const REVIEW_OPERATOR = { userId: 2, username: 'chen.review', displayName: 'E2E Result Reviewer' };
const CRITICAL_OPERATOR = { userId: 4, username: 'wang.qc', displayName: 'E2E Critical Values Operator' };
const E2E_NOTIFY_REMARK = 'e2e critical notify remark';
const E2E_COMPLETION_RESOLUTION = 'e2e critical completion resolution';

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

const assertAtLeast = (actual, minimum, message) => {
  if (actual < minimum) {
    throw new Error(`${message}: expected at least ${minimum}, got ${actual}`);
  }
};

const assertTruthy = (value, message) => {
  if (!value) {
    throw new Error(`${message}: expected truthy value`);
  }
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

const findNaturalWorkflowChain = (database) => getRow(database, `
  SELECT
    s.id AS sample_id,
    s.sample_no,
    rr.id AS review_id,
    tr.id AS result_id,
    cv.id AS critical_value_id,
    cn.id AS notification_id
  FROM samples s
  INNER JOIN test_results tr ON tr.sample_id = s.id
  INNER JOIN result_reviews rr ON rr.result_id = tr.id AND rr.sample_id = s.id
  INNER JOIN critical_values cv ON cv.result_id = tr.id AND cv.sample_id = s.id
  INNER JOIN critical_notifications cn ON cn.critical_value_id = cv.id
  WHERE lower(s.status) IN ('pending_receive', 'pending', '待签收')
    AND lower(rr.review_status) IN ('pending', 'pending_review', 'reviewing')
    AND lower(cn.confirm_status) IN ('pending', 'pending_confirm')
    AND cv.closed_at IS NULL
    AND lower(COALESCE(cv.status, '')) NOT IN ('closed', 'completed')
  ORDER BY s.id, rr.id, cn.id
  LIMIT 1;
`);

const getWorkflowChainBySampleNo = (database, sampleNo) => getRow(database, `
  SELECT
    s.id AS sample_id,
    s.sample_no,
    rr.id AS review_id,
    tr.id AS result_id,
    cv.id AS critical_value_id,
    cn.id AS notification_id
  FROM samples s
  INNER JOIN test_results tr ON tr.sample_id = s.id
  INNER JOIN result_reviews rr ON rr.result_id = tr.id AND rr.sample_id = s.id
  INNER JOIN critical_values cv ON cv.result_id = tr.id AND cv.sample_id = s.id
  INNER JOIN critical_notifications cn ON cn.critical_value_id = cv.id
  WHERE s.sample_no = :sampleNo
  ORDER BY cn.id DESC
  LIMIT 1;
`, {
  ':sampleNo': sampleNo
});

const createRuntimeWorkflowChain = async () => withDatabase((database) => {
  const now = '2026-06-12 10:30:00';
  const sampleNo = `E2E-SMOKE-${Date.now()}`;
  const testItem = getRow(database, `
    SELECT id, item_name, unit, reference_range, critical_high
    FROM test_items
    WHERE item_code = 'K'
    LIMIT 1;
  `);
  const instrument = getRow(database, 'SELECT id FROM instruments ORDER BY id LIMIT 1;');

  assertTruthy(testItem, 'e2e runtime test item');
  assertTruthy(instrument, 'e2e runtime instrument');

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
      'P-E2E-SMOKE',
      'emergency',
      'E2E Smoke Department',
      '生化组',
      '血清',
      '黄帽管',
      :collectedAt,
      NULL,
      'pending_receive',
      'stat',
      NULL,
      :createdAt,
      :updatedAt
    );
  `, {
    ':sampleNo': sampleNo,
    ':collectedAt': '2026-06-12 10:20:00',
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
      '6.9',
      NULL,
      :unit,
      :referenceRange,
      'high',
      'critical_high',
      :instrumentId,
      'passed',
      'pending_review',
      :reportedAt,
      :createdAt,
      :updatedAt
    );
  `, {
    ':sampleId': sampleId,
    ':testItemId': Number(testItem.id),
    ':unit': testItem.unit || 'mmol/L',
    ':referenceRange': testItem.reference_range || '3.5-5.5',
    ':instrumentId': Number(instrument.id),
    ':reportedAt': '2026-06-12 10:31:00',
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
      'pending',
      NULL,
      'E2E smoke pending review',
      'hold_and_repeat',
      NULL,
      :createdAt
    );
  `, {
    ':sampleId': sampleId,
    ':resultId': resultId,
    ':createdAt': now
  });

  database.run(`
    INSERT INTO critical_values (
      sample_id,
      result_id,
      item_name,
      result_value,
      unit,
      threshold_text,
      triggered_at,
      status,
      responsible_doctor,
      closed_at,
      created_at,
      updated_at
    ) VALUES (
      :sampleId,
      :resultId,
      :itemName,
      '6.9',
      :unit,
      :thresholdText,
      :triggeredAt,
      'open',
      'E2E Smoke Doctor',
      NULL,
      :createdAt,
      :updatedAt
    );
  `, {
    ':sampleId': sampleId,
    ':resultId': resultId,
    ':itemName': testItem.item_name || '钾',
    ':unit': testItem.unit || 'mmol/L',
    ':thresholdText': `E2E smoke critical high ${testItem.critical_high || '6.2'} mmol/L`,
    ':triggeredAt': '2026-06-12 10:31:30',
    ':createdAt': now,
    ':updatedAt': now
  });
  const criticalValueId = getLastInsertId(database);

  database.run(`
    INSERT INTO critical_notifications (
      critical_value_id,
      notify_method,
      notify_target,
      notified_by,
      notified_at,
      confirm_status,
      confirmed_at,
      remark,
      created_at
    ) VALUES (
      :criticalValueId,
      'system_message',
      'E2E Smoke Clinical Target',
      NULL,
      NULL,
      'pending',
      NULL,
      'E2E smoke pending notification',
      :createdAt
    );
  `, {
    ':criticalValueId': criticalValueId,
    ':createdAt': now
  });

  return getWorkflowChainBySampleNo(database, sampleNo);
}, {
  writable: true
});

const getOrCreateWorkflowChain = async () => {
  const naturalChain = await withDatabase((database) => findNaturalWorkflowChain(database));

  if (naturalChain) {
    console.log('PASS e2e uses seed workflow chain');
    return naturalChain;
  }

  const runtimeChain = await createRuntimeWorkflowChain();
  assertTruthy(runtimeChain, 'e2e runtime workflow chain');
  console.log('PASS e2e constructs runtime workflow chain');
  return runtimeChain;
};

const getSample = (database, sampleId) => getRow(database, `
  SELECT id, sample_no, status, received_at
  FROM samples
  WHERE id = :sampleId;
`, {
  ':sampleId': sampleId
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

const getCriticalNotification = (database, notificationId) => getRow(database, `
  SELECT
    cn.id,
    cn.critical_value_id,
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

const getAuditLog = (database, { targetTable, targetId, operationType }) => getRow(database, `
  SELECT id, user_id, module_name, operation_type, target_table, target_id, before_json, after_json, remark
  FROM audit_logs
  WHERE target_table = :targetTable
    AND target_id = :targetId
    AND operation_type = :operationType
  ORDER BY id DESC
  LIMIT 1;
`, {
  ':targetTable': targetTable,
  ':targetId': targetId,
  ':operationType': operationType
});

const assertAuditLog = async ({ targetTable, targetId, operationType, message }) => withDatabase((database) => {
  const auditLog = getAuditLog(database, { targetTable, targetId, operationType });
  assertTruthy(auditLog, message);
  return auditLog;
});

const assertSampleHistory = async (sampleId) => {
  const history = await getSampleReceptionHistory(sampleId);
  const hasConfirmLog = Array.isArray(history) && history.some((record) => (
    record.operation_type === 'confirm_sample_reception'
    && record.target_table === 'samples'
    && Number(record.target_id) === Number(sampleId)
    && record.after_json?.status === 'reviewing'
  ));

  assertTruthy(hasConfirmLog, 'e2e sample reception history confirm log');
};

const main = async () => {
  const { databasePath } = await resetDatabase();
  const initialAuditCount = await withDatabase((database) => getCount(database, 'audit_logs'));
  assertEqual(initialAuditCount, 5, 'e2e initial audit log count');
  console.log(`PASS e2e reset database: ${databasePath}`);

  const workflow = await getOrCreateWorkflowChain();

  await confirmSampleReception(workflow.sample_id, SAMPLE_OPERATOR);
  await withDatabase((database) => {
    const sample = getSample(database, workflow.sample_id);
    assertEqual(sample.status, 'reviewing', 'e2e sample status');
    assertTruthy(sample.received_at, 'e2e sample received_at');
    const auditLog = getAuditLog(database, {
      targetTable: 'samples',
      targetId: workflow.sample_id,
      operationType: 'confirm_sample_reception'
    });
    assertTruthy(auditLog, 'e2e sample reception audit log');
    assertEqual(getCount(database, 'audit_logs'), initialAuditCount + 1, 'e2e audit count after sample reception');
  });
  console.log('PASS e2e confirms sample reception');

  await assertSampleHistory(workflow.sample_id);
  console.log('PASS e2e reads sample reception history');

  await approveResultReview(workflow.review_id, REVIEW_OPERATOR);
  await withDatabase((database) => {
    const review = getReview(database, workflow.review_id);
    assertEqual(review.review_status, 'approved', 'e2e result review status');
    assertEqual(review.result_status, 'reviewed', 'e2e test result status');
    const auditLog = getAuditLog(database, {
      targetTable: 'result_reviews',
      targetId: workflow.review_id,
      operationType: '审核通过'
    });
    assertTruthy(auditLog, 'e2e result review audit log');
    assertEqual(getCount(database, 'audit_logs'), initialAuditCount + 2, 'e2e audit count after result review');
  });
  console.log('PASS e2e approves result review');

  await notifyCriticalValue(workflow.notification_id, E2E_NOTIFY_REMARK, CRITICAL_OPERATOR);
  await withDatabase((database) => {
    const notification = getCriticalNotification(database, workflow.notification_id);
    assertEqual(notification.confirm_status, 'notified', 'e2e critical notification status after notify');
    assertTruthy(notification.notified_at, 'e2e critical notified_at');
    assertEqual(notification.critical_value_status, 'notified', 'e2e critical value status after notify');
    const auditLog = getAuditLog(database, {
      targetTable: 'critical_notifications',
      targetId: workflow.notification_id,
      operationType: '危急值通知'
    });
    assertTruthy(auditLog, 'e2e critical notify audit log');
    assertEqual(getCount(database, 'audit_logs'), initialAuditCount + 3, 'e2e audit count after critical notify');
  });
  console.log('PASS e2e notifies critical value');

  await acknowledgeCriticalValue(workflow.notification_id, CRITICAL_OPERATOR);
  await withDatabase((database) => {
    const notification = getCriticalNotification(database, workflow.notification_id);
    assertEqual(notification.confirm_status, 'confirmed', 'e2e critical notification status after acknowledgement');
    assertTruthy(notification.confirmed_at, 'e2e critical confirmed_at');
    assertEqual(notification.critical_value_status, 'confirmed', 'e2e critical value status after acknowledgement');
    const auditLog = getAuditLog(database, {
      targetTable: 'critical_notifications',
      targetId: workflow.notification_id,
      operationType: '危急值确认'
    });
    assertTruthy(auditLog, 'e2e critical acknowledgement audit log');
    assertEqual(getCount(database, 'audit_logs'), initialAuditCount + 4, 'e2e audit count after critical acknowledgement');
  });
  console.log('PASS e2e acknowledges critical value');

  await completeCriticalValue(workflow.notification_id, E2E_COMPLETION_RESOLUTION, CRITICAL_OPERATOR);
  await withDatabase((database) => {
    const notification = getCriticalNotification(database, workflow.notification_id);
    assertEqual(notification.confirm_status, 'completed', 'e2e critical notification status after completion');
    assertEqual(notification.critical_value_status, 'closed', 'e2e critical value status after completion');
    assertTruthy(notification.critical_value_closed_at, 'e2e critical value closed_at');
    const auditLog = getAuditLog(database, {
      targetTable: 'critical_notifications',
      targetId: workflow.notification_id,
      operationType: '危急值完成'
    });
    assertTruthy(auditLog, 'e2e critical completion audit log');
    assertEqual(getCount(database, 'audit_logs'), initialAuditCount + 5, 'e2e audit count after critical completion');
  });
  console.log('PASS e2e completes critical value');

  await assertAuditLog({
    targetTable: 'samples',
    targetId: workflow.sample_id,
    operationType: 'confirm_sample_reception',
    message: 'e2e final sample audit log'
  });
  await assertAuditLog({
    targetTable: 'result_reviews',
    targetId: workflow.review_id,
    operationType: '审核通过',
    message: 'e2e final result review audit log'
  });
  await assertAuditLog({
    targetTable: 'critical_notifications',
    targetId: workflow.notification_id,
    operationType: '危急值通知',
    message: 'e2e final critical notify audit log'
  });
  await assertAuditLog({
    targetTable: 'critical_notifications',
    targetId: workflow.notification_id,
    operationType: '危急值确认',
    message: 'e2e final critical acknowledgement audit log'
  });
  await assertAuditLog({
    targetTable: 'critical_notifications',
    targetId: workflow.notification_id,
    operationType: '危急值完成',
    message: 'e2e final critical completion audit log'
  });

  const finalAuditCount = await withDatabase((database) => getCount(database, 'audit_logs'));
  assertAtLeast(finalAuditCount, initialAuditCount + 5, 'e2e final audit log count');
  console.log('PASS e2e writes expected audit logs');
  console.log('PASS e2e workflow smoke completed');
};

main().catch((error) => {
  console.error('FAIL e2e workflow smoke');
  console.error(error);
  process.exit(1);
});
