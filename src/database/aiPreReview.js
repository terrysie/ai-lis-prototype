const fs = require('fs');
const path = require('path');
const { getDefaultDatabasePath, initializeDatabase } = require('./initDatabase');

const LEVEL_GROUPS = {
  autoRelease: ['a', 'a_class', 'auto_release', 'low_risk', '低风险', 'a 类', 'a类', '自动放行'],
  quickReview: ['b', 'b_class', 'quick_review', 'medium_risk', '中风险', 'b 类', 'b类', '快速复核'],
  focusReview: ['c', 'c_class', 'focus_review', 'high_risk', '高风险', 'c 类', 'c类', '重点复核']
};

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

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const CLOSED_INFECTIOUS_ALERT_STATUSES = ['closed', 'resolved', 'handled', 'completed', 'ignored', '已关闭', '已处理', '已完成', '已忽略'];

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

const ensureInfectiousAlertId = (alertId) => {
  const numericAlertId = Number(alertId);

  if (!Number.isInteger(numericAlertId) || numericAlertId <= 0) {
    throw new Error('传染病阳性预警 ID 无效，无法处理。');
  }

  return numericAlertId;
};

const normalizeInfectiousHandlingNote = (handling = {}) => {
  const source = typeof handling === 'string'
    ? handling
    : handling.action ?? handling.resolution ?? handling.handlingNote ?? handling.note;
  const note = String(source ?? '').trim();

  if (!note) {
    throw new Error('传染病阳性预警处理措施不能为空。');
  }

  return note;
};

const isInfectiousAlertClosed = (alert) => [
  alert?.review_status,
  alert?.notify_status,
  alert?.infection_control_status,
  alert?.report_hint_status
].some((status) => CLOSED_INFECTIOUS_ALERT_STATUSES.some((candidate) => normalizeText(candidate) === normalizeText(status)));

const isLevelInGroup = (level, group) => {
  const normalizedLevel = normalizeText(level);
  return LEVEL_GROUPS[group].some((candidate) => normalizeText(candidate) === normalizedLevel);
};

const parseJsonList = (value) => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((item) => {
      if (typeof item === 'string') {
        return item;
      }

      if (item && typeof item === 'object') {
        return item.rule || item.item || JSON.stringify(item);
      }

      return String(item);
    });
  } catch (error) {
    return [];
  }
};

const hasJsonListItems = (value) => parseJsonList(value).length > 0;

const getInfectiousStatusText = (status, type) => {
  const normalized = normalizeText(status);
  const maps = {
    review: {
      pending_review: '待复核',
      reviewing: '复核中',
      reviewed: '已复核',
      handled: '已处理',
      closed: '已关闭',
      resolved: '已处理'
    },
    notify: {
      pending_notify: '待通知',
      notified: '已通知',
      handled: '已处理',
      closed: '已关闭',
      resolved: '已处理'
    },
    infection: {
      pending_followup: '待院感跟进',
      followup: '跟进中',
      handled: '已处理',
      closed: '已关闭',
      resolved: '已处理'
    },
    hint: {
      pending_hint: '待生成提示',
      hint_generated: '已生成提示',
      handled: '已处理',
      closed: '已关闭',
      resolved: '已处理'
    }
  };

  return maps[type]?.[normalized] || status || '--';
};

const getInfectiousBadgeClass = (alert) => {
  if (isInfectiousAlertClosed(alert)) {
    return 'badge-a';
  }

  if (normalizeText(alert?.notify_status) === 'pending_notify') {
    return 'badge-c';
  }

  return 'badge-b';
};

const getInfectiousAlertRawRow = (database, alertId) => getRow(database, `
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
    deadline_at,
    created_at,
    updated_at
  FROM infectious_alerts
  WHERE id = :alertId;
`, {
  ':alertId': alertId
});

const getInfectiousAlertRows = (database) => getRows(database, `
  SELECT
    ia.id AS alert_id,
    ia.sample_id,
    ia.result_id,
    ia.disease_item,
    ia.positive_condition,
    ia.review_status,
    ia.notify_status,
    ia.infection_control_status,
    ia.report_hint_status,
    ia.deadline_at,
    ia.created_at,
    ia.updated_at,
    s.sample_no,
    s.patient_code,
    s.department,
    ti.item_name,
    tr.result_value,
    tr.result_text,
    tr.unit
  FROM infectious_alerts ia
  INNER JOIN samples s ON s.id = ia.sample_id
  INNER JOIN test_results tr ON tr.id = ia.result_id
  LEFT JOIN test_items ti ON ti.id = tr.test_item_id
  ORDER BY datetime(COALESCE(ia.deadline_at, ia.created_at)) ASC, ia.id ASC;
`);

const toInfectiousAlertDto = (row) => {
  const alert = {
    id: row.alert_id ?? row.id,
    review_status: row.review_status,
    notify_status: row.notify_status,
    infection_control_status: row.infection_control_status,
    report_hint_status: row.report_hint_status
  };

  return {
    alertId: Number(row.alert_id ?? row.id),
    sampleId: row.sample_id === null || row.sample_id === undefined ? null : Number(row.sample_id),
    resultId: row.result_id === null || row.result_id === undefined ? null : Number(row.result_id),
    sampleNo: row.sample_no || null,
    patientCode: row.patient_code || null,
    project: row.disease_item || row.item_name || '--',
    diseaseItem: row.disease_item || '--',
    positiveCondition: row.positive_condition || '--',
    source: row.department || '--',
    review: getInfectiousStatusText(row.review_status, 'review'),
    notice: getInfectiousStatusText(row.notify_status, 'notify'),
    infectionStatus: getInfectiousStatusText(row.infection_control_status, 'infection'),
    reportHintStatus: getInfectiousStatusText(row.report_hint_status, 'hint'),
    rawReviewStatus: row.review_status,
    rawNotifyStatus: row.notify_status,
    rawInfectionControlStatus: row.infection_control_status,
    rawReportHintStatus: row.report_hint_status,
    limit: row.deadline_at || '--',
    action: isInfectiousAlertClosed(alert) ? '已完成处理留痕' : '复核阳性结果并记录通知处理',
    badgeClass: getInfectiousBadgeClass(alert),
    resultText: [row.result_value || row.result_text, row.unit].filter(Boolean).join(' ') || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
};

const writeInfectiousAlertAuditLog = (database, {
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
      '传染病预警',
      :operationType,
      'infectious_alerts',
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

const toReviewDto = (row) => ({
  id: Number(row.id),
  sampleId: Number(row.sample_id),
  sampleNo: row.sample_no,
  patientCode: row.patient_code,
  department: row.department,
  testGroup: row.test_group,
  resultId: row.result_id === null ? null : Number(row.result_id),
  itemName: row.item_name || null,
  resultValue: row.result_value || row.result_text || null,
  unit: row.unit || null,
  abnormalFlag: row.abnormal_flag || null,
  criticalFlag: row.critical_flag || null,
  aiLevel: row.ai_level,
  riskTags: parseJsonList(row.risk_tags_json),
  hitRules: parseJsonList(row.hit_rules_json),
  conclusion: row.conclusion || '',
  suggestedAction: row.suggested_action || '',
  manualOverride: row.manual_override || null,
  createdAt: row.created_at
});

const getAiPreReviewData = async (options = {}) => {
  const { database } = await openDatabase(options);

  try {
    database.run('PRAGMA foreign_keys = ON;');

    const rows = getRows(database, `
      SELECT
        apr.id,
        apr.sample_id,
        apr.result_id,
        apr.ai_level,
        apr.risk_tags_json,
        apr.hit_rules_json,
        apr.conclusion,
        apr.suggested_action,
        apr.manual_override,
        apr.created_at,
        s.sample_no,
        s.patient_code,
        s.department,
        s.test_group,
        tr.result_value,
        tr.result_text,
        tr.unit,
        tr.abnormal_flag,
        tr.critical_flag,
        ti.item_name
      FROM ai_pre_reviews apr
      INNER JOIN samples s ON s.id = apr.sample_id
      LEFT JOIN test_results tr ON tr.id = apr.result_id
      LEFT JOIN test_items ti ON ti.id = tr.test_item_id
      ORDER BY datetime(apr.created_at) DESC, apr.id DESC;
    `);

    const infectiousAlerts = getInfectiousAlertRows(database).map(toInfectiousAlertDto);

    return {
      stats: {
        total: rows.length,
        autoRelease: rows.filter((row) => isLevelInGroup(row.ai_level, 'autoRelease')).length,
        quickReview: rows.filter((row) => isLevelInGroup(row.ai_level, 'quickReview')).length,
        focusReview: rows.filter((row) => isLevelInGroup(row.ai_level, 'focusReview')).length,
        riskAlerts: rows.filter((row) => hasJsonListItems(row.risk_tags_json) || hasJsonListItems(row.hit_rules_json)).length
      },
      reviews: rows.map(toReviewDto),
      infectiousAlerts,
      databasePath: getDefaultDatabasePath(options)
    };
  } finally {
    database.close();
  }
};

const getInfectiousAlertsData = async (options = {}) => {
  const { database, databasePath } = await openDatabase(options);

  try {
    database.run('PRAGMA foreign_keys = ON;');

    return {
      infectiousAlerts: getInfectiousAlertRows(database).map(toInfectiousAlertDto),
      databasePath
    };
  } finally {
    database.close();
  }
};

const handleInfectiousAlert = async (alertId, handling = {}, operator = {}, options = {}) => {
  const numericAlertId = ensureInfectiousAlertId(alertId);
  const handlingNote = normalizeInfectiousHandlingNote(handling);
  const { database, databasePath } = await openDatabase(options);
  let transactionStarted = false;

  try {
    database.run('PRAGMA foreign_keys = ON;');
    database.run('BEGIN TRANSACTION;');
    transactionStarted = true;

    const beforeRow = getInfectiousAlertRawRow(database, numericAlertId);

    if (!beforeRow) {
      throw new Error(`传染病阳性预警不存在，无法处理：${numericAlertId}`);
    }

    if (isInfectiousAlertClosed(beforeRow)) {
      throw new Error(`传染病阳性预警 ${numericAlertId} 当前状态已处理，不能重复处理。`);
    }

    const now = getCurrentTimestamp();
    const operatorUserId = getOperatorUserId(operator);

    database.run(`
      UPDATE infectious_alerts
      SET
        review_status = 'handled',
        notify_status = 'notified',
        infection_control_status = 'handled',
        report_hint_status = 'handled',
        updated_at = :updatedAt
      WHERE id = :alertId;
    `, {
      ':updatedAt': now,
      ':alertId': numericAlertId
    });

    const afterRow = getInfectiousAlertRawRow(database, numericAlertId);
    const afterAuditPayload = {
      ...afterRow,
      handling_note: handlingNote,
      handled_by: operatorUserId,
      handled_at: now
    };

    writeInfectiousAlertAuditLog(database, {
      userId: operatorUserId,
      operationType: '处理传染病阳性预警',
      alertId: numericAlertId,
      beforeRow,
      afterRow: afterAuditPayload,
      remark: '处理传染病阳性预警',
      createdAt: now
    });

    const auditLogId = Number(getRow(database, 'SELECT last_insert_rowid() AS id;').id);

    database.run('COMMIT;');
    transactionStarted = false;
    saveDatabase(database, databasePath);

    return {
      alert: toInfectiousAlertDto({
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
  getAiPreReviewData,
  getInfectiousAlertsData,
  handleInfectiousAlert
};
