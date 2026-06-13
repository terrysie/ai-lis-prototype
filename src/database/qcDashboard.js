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

    const qcEventRows = getRows(database, `
      SELECT
        qe.event_no,
        qe.qc_level,
        qe.trigger_rule,
        qe.event_status,
        qe.impact_scope,
        qe.suggested_action,
        qe.created_at,
        i.instrument_name,
        ti.item_name,
        ti.item_code
      FROM qc_events qe
      LEFT JOIN instruments i ON i.id = qe.instrument_id
      LEFT JOIN test_items ti ON ti.id = qe.test_item_id
      ORDER BY datetime(qe.created_at) DESC, qe.id DESC;
    `);

    const qcEvents = qcEventRows.map((row) => ({
      id: row.event_no,
      instrument: row.instrument_name || '--',
      project: row.item_name || row.item_code || '--',
      level: row.qc_level || '--',
      rule: row.trigger_rule || '--',
      ruleClass: String(row.trigger_rule || '').includes('警告') ? 'badge-b' : 'badge-a',
      status: getEventStatusText(row.event_status),
      statusClass: getEventStatusClass(row.event_status),
      impact: row.impact_scope || '--',
      action: row.suggested_action || '--',
      ai: {
        conclusion: `${row.instrument_name || '相关仪器'} · ${row.item_name || '相关项目'} 当前状态为${getEventStatusText(row.event_status)}。`,
        rules: [row.trigger_rule || '未记录触发规则', row.impact_scope || '无影响范围记录'],
        action: row.suggested_action || '请按实验室质控制度处理。'
      }
    }));

    const reagentBatches = getRows(database, `
      SELECT rb.*, ti.item_name, ti.item_code, i.instrument_name, i.instrument_code
      FROM reagent_batches rb
      LEFT JOIN test_items ti ON ti.id = rb.test_item_id
      LEFT JOIN instruments i ON i.id = rb.instrument_id
      ORDER BY date(rb.expires_at), rb.id;
    `);

    const reagentExpiryAlerts = getRows(database, `
      SELECT rea.*, rb.reagent_name, rb.batch_no, rb.enabled_at, rb.expires_at,
        ti.item_name, ti.item_code, i.instrument_name, i.instrument_code
      FROM reagent_expiry_alerts rea
      LEFT JOIN reagent_batches rb ON rb.id = rea.reagent_batch_id
      LEFT JOIN test_items ti ON ti.id = rb.test_item_id
      LEFT JOIN instruments i ON i.id = rb.instrument_id
      ORDER BY CASE rea.risk_level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, rea.days_left;
    `).map((row) => ({
      name: row.reagent_name,
      lot: row.batch_no,
      project: row.item_name || row.item_code || '--',
      instrument: row.instrument_code || row.instrument_name || '--',
      start: formatDateTime(row.enabled_at),
      expiry: row.expires_at,
      days: Number(row.days_left || 0),
      risk: getRiskText(row.risk_level),
      riskClass: getRiskClass(row.risk_level),
      action: row.suggested_action || '--'
    }));

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

module.exports = {
  getQcDashboardData
};
