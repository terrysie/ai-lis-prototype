const fs = require('fs');
const path = require('path');
const { getDefaultDatabasePath, initializeDatabase } = require('./initDatabase');

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

const formatDateTime = (value) => value || '--';

const getInstrumentStatusText = (status) => ({
  online: '正常',
  maintenance: '维护中',
  offline: '离线',
  paused: '暂停使用'
}[String(status || '').toLowerCase()] || status || '--');

const getInstrumentStatusTone = (status) => ({
  online: 'normal',
  maintenance: 'warning',
  offline: 'danger',
  paused: 'danger'
}[String(status || '').toLowerCase()] || 'watch');

const getEventStatusText = (status) => ({
  open: '待确认',
  handling: '处理中',
  closed: '已关闭'
}[String(status || '').toLowerCase()] || status || '--');

const getEventStatusClass = (status) => ({
  open: 'badge-c',
  handling: 'badge-b',
  closed: 'badge-gray'
}[String(status || '').toLowerCase()] || 'badge-info');

const getRiskText = (risk) => ({
  high: '高风险',
  medium: '预警',
  low: '关注'
}[String(risk || '').toLowerCase()] || risk || '--');

const getRiskClass = (risk) => ({
  high: 'badge-c',
  medium: 'badge-b',
  low: 'badge-info'
}[String(risk || '').toLowerCase()] || 'badge-info');

const CLOSED_QC_EVENT_STATUSES = ['closed', 'resolved', 'handled', 'completed', '已关闭', '已处理', '已完成'];
const CLOSED_REAGENT_EXPIRY_ALERT_STATUSES = ['closed', 'resolved', 'handled', 'completed', 'ignored', '已关闭', '已处理', '已完成', '已忽略'];

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

const ensureQcEventId = (eventId) => {
  const numericEventId = Number(eventId);

  if (!Number.isInteger(numericEventId) || numericEventId <= 0) {
    throw new Error('质控事件 ID 无效，无法处理。');
  }

  return numericEventId;
};

const ensureReagentExpiryAlertId = (alertId) => {
  const numericAlertId = Number(alertId);

  if (!Number.isInteger(numericAlertId) || numericAlertId <= 0) {
    throw new Error('试剂近效期预警 ID 无效，无法处理。');
  }

  return numericAlertId;
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const isQcEventClosed = (event) => CLOSED_QC_EVENT_STATUSES.some((status) => normalizeText(status) === normalizeText(event?.event_status));
const isReagentExpiryAlertClosed = (alert) => CLOSED_REAGENT_EXPIRY_ALERT_STATUSES.some((status) => normalizeText(status) === normalizeText(alert?.alert_status));

const normalizeHandlingNote = (handling = {}) => {
  const source = typeof handling === 'string'
    ? handling
    : handling.action ?? handling.resolution ?? handling.handlingNote ?? handling.note;
  const note = String(source ?? '').trim();

  if (!note) {
    throw new Error('质控事件处理措施不能为空。');
  }

  return note;
};

const normalizeReagentExpiryHandlingNote = (handling = {}) => {
  const source = typeof handling === 'string'
    ? handling
    : handling.action ?? handling.resolution ?? handling.handlingNote ?? handling.note;
  const note = String(source ?? '').trim();

  if (!note) {
    throw new Error('试剂近效期预警处理措施不能为空。');
  }

  return note;
};

const getReagentAlertStatusText = (status) => ({
  open: '待处理',
  handling: '处理中',
  handled: '已处理',
  closed: '已关闭',
  resolved: '已处理',
  ignored: '已忽略'
}[String(status || '').toLowerCase()] || status || '--');

const getReagentAlertStatusClass = (status) => ({
  open: 'badge-b',
  handling: 'badge-info',
  handled: 'badge-a',
  closed: 'badge-gray',
  resolved: 'badge-a',
  ignored: 'badge-gray'
}[String(status || '').toLowerCase()] || 'badge-info');

const getQcEventRawRow = (database, eventId) => getRow(database, `
  SELECT
    id,
    instrument_id,
    test_item_id,
    event_no,
    qc_level,
    trigger_rule,
    event_status,
    impact_scope,
    suggested_action,
    handled_by,
    handled_at,
    created_at,
    updated_at
  FROM qc_events
  WHERE id = :eventId;
`, {
  ':eventId': eventId
});

const getReagentExpiryAlertRawRow = (database, alertId) => getRow(database, `
  SELECT
    id,
    reagent_batch_id,
    days_left,
    risk_level,
    suggested_action,
    alert_status,
    created_at,
    updated_at
  FROM reagent_expiry_alerts
  WHERE id = :alertId;
`, {
  ':alertId': alertId
});

const toQcEventDto = (row) => ({
  eventId: Number(row.event_id ?? row.id),
  id: row.event_no,
  eventNo: row.event_no,
  instrument: row.instrument_name || '--',
  project: row.item_name || row.item_code || '--',
  level: row.qc_level || '--',
  rule: row.trigger_rule || '--',
  ruleClass: String(row.trigger_rule || '').includes('警告') ? 'badge-b' : 'badge-a',
  rawStatus: row.event_status,
  status: getEventStatusText(row.event_status),
  statusClass: getEventStatusClass(row.event_status),
  impact: row.impact_scope || '--',
  action: row.suggested_action || '--',
  handledBy: row.handled_by === null || row.handled_by === undefined ? null : Number(row.handled_by),
  handledAt: row.handled_at || null,
  createdAt: row.created_at || null,
  updatedAt: row.updated_at || null,
  ai: {
    conclusion: `${row.instrument_name || '相关仪器'} · ${row.item_name || '相关项目'} 当前状态为${getEventStatusText(row.event_status)}。`,
    rules: [row.trigger_rule || '未记录触发规则', row.impact_scope || '无影响范围记录'],
    action: row.suggested_action || '请按实验室质控制度处理。'
  }
});

const toReagentExpiryAlertDto = (row) => ({
  alertId: Number(row.alert_id ?? row.id),
  reagentBatchId: row.reagent_batch_id === null || row.reagent_batch_id === undefined ? null : Number(row.reagent_batch_id),
  name: row.reagent_name || '--',
  lot: row.batch_no || '--',
  project: row.item_name || row.item_code || '--',
  instrument: row.instrument_code || row.instrument_name || '--',
  start: formatDateTime(row.enabled_at),
  expiry: row.expires_at || '--',
  days: Number(row.days_left || 0),
  risk: getRiskText(row.risk_level),
  riskClass: getRiskClass(row.risk_level),
  rawRiskLevel: row.risk_level,
  rawStatus: row.alert_status,
  status: getReagentAlertStatusText(row.alert_status),
  statusClass: getReagentAlertStatusClass(row.alert_status),
  action: row.suggested_action || '--',
  createdAt: row.created_at || null,
  updatedAt: row.updated_at || null
});

const getQcEventRows = (database) => getRows(database, `
  SELECT
    qe.id AS event_id,
    qe.event_no,
    qe.qc_level,
    qe.trigger_rule,
    qe.event_status,
    qe.impact_scope,
    qe.suggested_action,
    qe.handled_by,
    qe.handled_at,
    qe.created_at,
    qe.updated_at,
    i.instrument_name,
    ti.item_name,
    ti.item_code
  FROM qc_events qe
  LEFT JOIN instruments i ON i.id = qe.instrument_id
  LEFT JOIN test_items ti ON ti.id = qe.test_item_id
  ORDER BY datetime(qe.created_at) DESC, qe.id DESC;
`);

const getReagentExpiryAlertRows = (database) => getRows(database, `
  SELECT
    rea.id AS alert_id,
    rea.reagent_batch_id,
    rea.days_left,
    rea.risk_level,
    rea.suggested_action,
    rea.alert_status,
    rea.created_at,
    rea.updated_at,
    rb.reagent_name,
    rb.batch_no,
    rb.enabled_at,
    rb.expires_at,
    ti.item_name,
    ti.item_code,
    i.instrument_name,
    i.instrument_code
  FROM reagent_expiry_alerts rea
  LEFT JOIN reagent_batches rb ON rb.id = rea.reagent_batch_id
  LEFT JOIN test_items ti ON ti.id = rb.test_item_id
  LEFT JOIN instruments i ON i.id = rb.instrument_id
  ORDER BY CASE rea.risk_level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, rea.days_left, rea.id;
`);

const writeQcEventAuditLog = (database, {
  userId,
  operationType,
  eventId,
  beforeRow,
  afterRow,
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
      '质控管理',
      :operationType,
      'qc_events',
      :eventId,
      :beforeJson,
      :afterJson,
      :remark,
      :createdAt
    );
  `, {
    ':userId': userId,
    ':operationType': operationType,
    ':eventId': eventId,
    ':beforeJson': JSON.stringify(beforeRow),
    ':afterJson': JSON.stringify(afterRow),
    ':remark': remark,
    ':createdAt': createdAt
  });
};

const writeReagentExpiryAlertAuditLog = (database, {
  userId,
  operationType,
  alertId,
  beforeRow,
  afterRow,
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
      '试剂管理',
      :operationType,
      'reagent_expiry_alerts',
      :alertId,
      :beforeJson,
      :afterJson,
      :remark,
      :createdAt
    );
  `, {
    ':userId': userId,
    ':operationType': operationType,
    ':alertId': alertId,
    ':beforeJson': JSON.stringify(beforeRow),
    ':afterJson': JSON.stringify(afterRow),
    ':remark': remark,
    ':createdAt': createdAt
  });
};

const getQcDashboardData = async (options = {}) => {
  const { database, databasePath } = await openDatabase(options);

  try {
    database.run('PRAGMA foreign_keys = ON;');

    const instruments = getRows(database, `
      SELECT
        i.id,
        i.instrument_code,
        i.instrument_name,
        i.department_group,
        i.status,
        i.last_calibrated_at,
        i.last_qc_at,
        GROUP_CONCAT(DISTINCT ti.item_name) AS projects,
        SUM(CASE WHEN qe.event_status IN ('open', 'handling') THEN 1 ELSE 0 END) AS active_events
      FROM instruments i
      LEFT JOIN test_items ti ON ti.id IN (
        SELECT tr.test_item_id FROM test_results tr WHERE tr.instrument_id = i.id
        UNION
        SELECT qe2.test_item_id FROM qc_events qe2 WHERE qe2.instrument_id = i.id
        UNION
        SELECT rb2.test_item_id FROM reagent_batches rb2 WHERE rb2.instrument_id = i.id
      )
      LEFT JOIN qc_events qe ON qe.instrument_id = i.id
      GROUP BY i.id
      ORDER BY i.id;
    `).map((row) => ({
      id: Number(row.id),
      name: row.instrument_name,
      code: row.instrument_code,
      group: row.department_group || '--',
      status: getInstrumentStatusText(row.status),
      statusTone: getInstrumentStatusTone(row.status),
      qc: Number(row.active_events || 0) > 0 ? '存在待处理质控事件' : '今日质控通过',
      qcClass: Number(row.active_events || 0) > 0 ? 'badge-b' : 'badge-a',
      projects: row.projects || '--',
      calibratedAt: formatDateTime(row.last_calibrated_at),
      action: Number(row.active_events || 0) > 0 ? '优先处理关联质控事件' : '继续观察，保持常规质控'
    }));

    const qcEventRows = getQcEventRows(database);
    const qcEvents = qcEventRows.map(toQcEventDto);

    const reagentBatches = getRows(database, `
      SELECT rb.*, ti.item_name, ti.item_code, i.instrument_name, i.instrument_code
      FROM reagent_batches rb
      LEFT JOIN test_items ti ON ti.id = rb.test_item_id
      LEFT JOIN instruments i ON i.id = rb.instrument_id
      ORDER BY date(rb.expires_at), rb.id;
    `);

    const reagentExpiryAlerts = getReagentExpiryAlertRows(database).map(toReagentExpiryAlertDto);

    const batchRisks = reagentBatches.map((row) => ({
      lot: row.batch_no,
      project: row.item_name || row.item_code || '--',
      samples: 0,
      abnormal: 0,
      recheck: row.status === 'active' ? '否' : '是',
      recheckClass: row.status === 'active' ? 'badge-a' : 'badge-b',
      suggestion: row.status === 'active' ? '按近效期预警规则继续观察' : '复核批次状态并记录处理'
    }));

    const warningEvents = qcEventRows.filter((event) => String(event.trigger_rule || '').includes('警告') || event.event_status === 'handling').length;
    const closedEvents = qcEventRows.filter((event) => event.event_status === 'closed').length;
    const openEvents = qcEventRows.filter((event) => ['open', 'handling'].includes(event.event_status)).length;
    const highRiskReagents = reagentExpiryAlerts.filter((item) => item.risk === '高风险').length;

    return {
      stats: {
        qcItemsTotal: instruments.length + qcEvents.length,
        qcPassed: closedEvents,
        qcWarnings: warningEvents,
        qcOutOfControl: highRiskReagents,
        affectedItems: new Set(qcEvents.map((event) => event.project).filter(Boolean)).size,
        qcEventsOpen: openEvents,
        instrumentsTotal: instruments.length,
        qcEventsTotal: qcEvents.length,
        reagentBatchesTotal: reagentBatches.length,
        reagentExpiryAlerts: reagentExpiryAlerts.length,
        highRiskReagents
      },
      instruments,
      qcEvents,
      reagentBatches: batchRisks,
      reagentExpiryAlerts,
      databasePath
    };
  } finally {
    database.close();
  }
};

const getQcEventsData = async (options = {}) => {
  const { database, databasePath } = await openDatabase(options);

  try {
    database.run('PRAGMA foreign_keys = ON;');

    return {
      qcEvents: getQcEventRows(database).map(toQcEventDto),
      databasePath
    };
  } finally {
    database.close();
  }
};

const getReagentExpiryAlertsData = async (options = {}) => {
  const { database, databasePath } = await openDatabase(options);

  try {
    database.run('PRAGMA foreign_keys = ON;');

    return {
      reagentExpiryAlerts: getReagentExpiryAlertRows(database).map(toReagentExpiryAlertDto),
      databasePath
    };
  } finally {
    database.close();
  }
};

const handleQcEvent = async (eventId, handling = {}, operator = {}, options = {}) => {
  const numericEventId = ensureQcEventId(eventId);
  const handlingNote = normalizeHandlingNote(handling);
  const { database, databasePath } = await openDatabase(options);
  let transactionStarted = false;

  try {
    database.run('PRAGMA foreign_keys = ON;');
    database.run('BEGIN TRANSACTION;');
    transactionStarted = true;

    const beforeRow = getQcEventRawRow(database, numericEventId);

    if (!beforeRow) {
      throw new Error(`质控事件不存在，无法处理：${numericEventId}`);
    }

    if (isQcEventClosed(beforeRow)) {
      throw new Error(`质控事件 ${beforeRow.event_no} 当前状态为 ${beforeRow.event_status}，不能重复处理。`);
    }

    const now = getCurrentTimestamp();

    database.run(`
      UPDATE qc_events
      SET
        event_status = 'closed',
        suggested_action = :handlingNote,
        handled_by = :handledBy,
        handled_at = :handledAt,
        updated_at = :updatedAt
      WHERE id = :eventId;
    `, {
      ':handlingNote': handlingNote,
      ':handledBy': getOperatorUserId(operator),
      ':handledAt': now,
      ':updatedAt': now,
      ':eventId': numericEventId
    });

    const afterRow = getQcEventRawRow(database, numericEventId);

    writeQcEventAuditLog(database, {
      userId: getOperatorUserId(operator),
      operationType: '处理质控事件',
      eventId: numericEventId,
      beforeRow,
      afterRow,
      remark: '处理质控事件',
      createdAt: now
    });

    const auditLogId = Number(getRow(database, 'SELECT last_insert_rowid() AS id;').id);

    database.run('COMMIT;');
    transactionStarted = false;
    saveDatabase(database, databasePath);

    return {
      event: toQcEventDto({
        ...afterRow,
        event_id: afterRow.id
      }),
      auditLogId,
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

const handleReagentExpiryAlert = async (alertId, handling = {}, operator = {}, options = {}) => {
  const numericAlertId = ensureReagentExpiryAlertId(alertId);
  const handlingNote = normalizeReagentExpiryHandlingNote(handling);
  const { database, databasePath } = await openDatabase(options);
  let transactionStarted = false;

  try {
    database.run('PRAGMA foreign_keys = ON;');
    database.run('BEGIN TRANSACTION;');
    transactionStarted = true;

    const beforeRow = getReagentExpiryAlertRawRow(database, numericAlertId);

    if (!beforeRow) {
      throw new Error(`试剂近效期预警不存在，无法处理：${numericAlertId}`);
    }

    if (isReagentExpiryAlertClosed(beforeRow)) {
      throw new Error(`试剂近效期预警 ${numericAlertId} 当前状态为 ${beforeRow.alert_status}，不能重复处理。`);
    }

    const now = getCurrentTimestamp();

    database.run(`
      UPDATE reagent_expiry_alerts
      SET
        alert_status = 'handled',
        suggested_action = :handlingNote,
        updated_at = :updatedAt
      WHERE id = :alertId;
    `, {
      ':handlingNote': handlingNote,
      ':updatedAt': now,
      ':alertId': numericAlertId
    });

    const afterRow = getReagentExpiryAlertRawRow(database, numericAlertId);

    writeReagentExpiryAlertAuditLog(database, {
      userId: getOperatorUserId(operator),
      operationType: '处理试剂近效期预警',
      alertId: numericAlertId,
      beforeRow,
      afterRow,
      remark: '处理试剂近效期预警',
      createdAt: now
    });

    const auditLogId = Number(getRow(database, 'SELECT last_insert_rowid() AS id;').id);

    database.run('COMMIT;');
    transactionStarted = false;
    saveDatabase(database, databasePath);

    return {
      alert: toReagentExpiryAlertDto({
        ...afterRow,
        alert_id: afterRow.id
      }),
      auditLogId,
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
  getQcDashboardData,
  getQcEventsData,
  getReagentExpiryAlertsData,
  handleQcEvent,
  handleReagentExpiryAlert
};
