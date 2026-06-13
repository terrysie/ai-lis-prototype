const fs = require('fs');
const path = require('path');
const { getDefaultDatabasePath, initializeDatabase } = require('./initDatabase');

const RUNNING_STATUSES = ['online', 'running', 'normal', 'active', '运行中', '正常', '启用'];
const CLOSED_QC_STATUSES = ['closed', 'completed', '已处理', '已关闭', '已完成'];
const HIGH_RISK_LEVELS = ['high', '高风险', '已过期', 'expired'];

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

const normalizeText = (value) => String(value || '').trim().toLowerCase();
const matchesAny = (value, candidates) => candidates.some((candidate) => normalizeText(candidate) === normalizeText(value));

const toInstrumentDto = (row) => ({
  id: Number(row.id),
  instrumentCode: row.instrument_code,
  instrumentName: row.instrument_name,
  departmentGroup: row.department_group || null,
  status: row.status,
  lastCalibratedAt: row.last_calibrated_at || null,
  lastQcAt: row.last_qc_at || null
});

const toQcEventDto = (row) => ({
  id: Number(row.id),
  eventNo: row.event_no,
  instrumentId: Number(row.instrument_id),
  instrumentName: row.instrument_name || null,
  testItemId: row.test_item_id === null || row.test_item_id === undefined ? null : Number(row.test_item_id),
  itemName: row.item_name || null,
  qcLevel: row.qc_level || null,
  triggerRule: row.trigger_rule || null,
  eventStatus: row.event_status,
  impactScope: row.impact_scope || null,
  suggestedAction: row.suggested_action || null,
  handledBy: row.handled_by_name || (row.handled_by ? String(row.handled_by) : null),
  handledAt: row.handled_at || null,
  createdAt: row.created_at
});

const toReagentBatchDto = (row) => ({
  id: Number(row.id),
  reagentName: row.reagent_name,
  batchNo: row.batch_no,
  testItemId: row.test_item_id === null || row.test_item_id === undefined ? null : Number(row.test_item_id),
  itemName: row.item_name || null,
  instrumentId: row.instrument_id === null || row.instrument_id === undefined ? null : Number(row.instrument_id),
  instrumentName: row.instrument_name || null,
  enabledAt: row.enabled_at || null,
  expiresAt: row.expires_at || null,
  stockQty: row.stock_qty === null || row.stock_qty === undefined ? null : Number(row.stock_qty),
  status: row.status
});

const toReagentExpiryAlertDto = (row) => ({
  id: Number(row.id),
  reagentBatchId: Number(row.reagent_batch_id),
  reagentName: row.reagent_name,
  batchNo: row.batch_no,
  itemName: row.item_name || null,
  instrumentName: row.instrument_name || null,
  daysLeft: Number(row.days_left || 0),
  riskLevel: row.risk_level,
  suggestedAction: row.suggested_action || null,
  alertStatus: row.alert_status,
  createdAt: row.created_at
});

const getQcDashboardData = async (options = {}) => {
  const { database, databasePath } = await openDatabase(options);

  try {
    database.run('PRAGMA foreign_keys = ON;');

    const instruments = getRows(database, `
      SELECT id, instrument_code, instrument_name, department_group, status, last_calibrated_at, last_qc_at
      FROM instruments
      ORDER BY department_group, instrument_code;
    `).map(toInstrumentDto);

    const qcEvents = getRows(database, `
      SELECT
        qe.id, qe.event_no, qe.instrument_id, i.instrument_name, qe.test_item_id, ti.item_name,
        qe.qc_level, qe.trigger_rule, qe.event_status, qe.impact_scope, qe.suggested_action,
        qe.handled_by, u.display_name AS handled_by_name, qe.handled_at, qe.created_at
      FROM qc_events qe
      LEFT JOIN instruments i ON i.id = qe.instrument_id
      LEFT JOIN test_items ti ON ti.id = qe.test_item_id
      LEFT JOIN users u ON u.id = qe.handled_by
      ORDER BY datetime(qe.created_at) DESC, qe.id DESC;
    `).map(toQcEventDto);

    const reagentBatches = getRows(database, `
      SELECT
        rb.id, rb.reagent_name, rb.batch_no, rb.test_item_id, ti.item_name,
        rb.instrument_id, i.instrument_name, rb.enabled_at, rb.expires_at, rb.stock_qty, rb.status
      FROM reagent_batches rb
      LEFT JOIN test_items ti ON ti.id = rb.test_item_id
      LEFT JOIN instruments i ON i.id = rb.instrument_id
      ORDER BY date(rb.expires_at), rb.id;
    `).map(toReagentBatchDto);

    const reagentExpiryAlerts = getRows(database, `
      SELECT
        rea.id, rea.reagent_batch_id, rb.reagent_name, rb.batch_no, ti.item_name, i.instrument_name,
        rea.days_left, rea.risk_level, rea.suggested_action, rea.alert_status, rea.created_at
      FROM reagent_expiry_alerts rea
      INNER JOIN reagent_batches rb ON rb.id = rea.reagent_batch_id
      LEFT JOIN test_items ti ON ti.id = rb.test_item_id
      LEFT JOIN instruments i ON i.id = rb.instrument_id
      ORDER BY rea.days_left ASC, datetime(rea.created_at) DESC, rea.id DESC;
    `).map(toReagentExpiryAlertDto);

    return {
      stats: {
        instrumentsTotal: instruments.length,
        instrumentsRunning: instruments.filter((item) => matchesAny(item.status, RUNNING_STATUSES)).length,
        qcEventsTotal: qcEvents.length,
        qcEventsOpen: qcEvents.filter((item) => !matchesAny(item.eventStatus, CLOSED_QC_STATUSES)).length,
        reagentBatchesTotal: reagentBatches.length,
        reagentExpiryAlerts: reagentExpiryAlerts.length,
        highRiskReagents: reagentExpiryAlerts.filter((item) => matchesAny(item.riskLevel, HIGH_RISK_LEVELS)).length
      },
      instruments,
      qcEvents,
      reagentBatches,
      reagentExpiryAlerts,
      databasePath: databasePath || getDefaultDatabasePath(options)
    };
  } finally {
    database.close();
  }
};

module.exports = {
  getQcDashboardData
};
