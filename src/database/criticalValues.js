const fs = require('fs');
const path = require('path');
const { getDefaultDatabasePath, initializeDatabase } = require('./initDatabase');

const STATUS_GROUPS = {
  pendingConfirm: ['pending', 'pending_confirm', '待确认', '待处理'],
  notified: ['notified', '已通知'],
  overdue: ['overdue', '超时', '催办', '超时催办'],
  closed: ['closed', 'completed', '已闭环']
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

const normalizeStatus = (status) => String(status || '').trim().toLowerCase();

const isStatusInGroup = (status, group) => {
  const normalizedStatus = normalizeStatus(status);
  return STATUS_GROUPS[group].some((candidate) => normalizeStatus(candidate) === normalizedStatus);
};

const toCriticalValueDto = (row) => ({
  id: Number(row.id),
  sampleId: Number(row.sample_id),
  sampleNo: row.sample_no,
  patientCode: row.patient_code,
  department: row.department,
  testGroup: row.test_group,
  resultId: Number(row.result_id),
  itemName: row.item_name || row.test_item_name,
  resultValue: row.result_value,
  unit: row.unit || null,
  thresholdText: row.threshold_text || null,
  triggeredAt: row.triggered_at,
  status: row.status,
  responsibleDoctor: row.responsible_doctor || null,
  closedAt: row.closed_at || null,
  notificationCount: Number(row.notification_count || 0),
  latestNotifyMethod: row.latest_notify_method || null,
  latestNotifyTarget: row.latest_notify_target || null,
  latestNotifiedAt: row.latest_notified_at || null,
  latestConfirmStatus: row.latest_confirm_status || null,
  latestConfirmedAt: row.latest_confirmed_at || null
});

const toNotificationDto = (row) => ({
  id: Number(row.id),
  criticalValueId: Number(row.critical_value_id),
  notifyMethod: row.notify_method,
  notifyTarget: row.notify_target,
  notifiedBy: row.notified_by_name || (row.notified_by ? String(row.notified_by) : null),
  notifiedAt: row.notified_at || null,
  confirmStatus: row.confirm_status || null,
  confirmedAt: row.confirmed_at || null,
  remark: row.remark || null,
  createdAt: row.created_at
});

const getCriticalValuesData = async (options = {}) => {
  const { database, databasePath } = await openDatabase(options);

  try {
    database.run('PRAGMA foreign_keys = ON;');

    const criticalValues = getRows(database, `
      SELECT
        cv.id,
        cv.sample_id,
        s.sample_no,
        s.patient_code,
        s.department,
        s.test_group,
        cv.result_id,
        COALESCE(cv.item_name, ti.item_name) AS item_name,
        ti.item_name AS test_item_name,
        cv.result_value,
        COALESCE(cv.unit, tr.unit, ti.unit) AS unit,
        cv.threshold_text,
        cv.triggered_at,
        cv.status,
        cv.responsible_doctor,
        cv.closed_at,
        COUNT(cn.id) AS notification_count,
        latest.notify_method AS latest_notify_method,
        latest.notify_target AS latest_notify_target,
        latest.notified_at AS latest_notified_at,
        latest.confirm_status AS latest_confirm_status,
        latest.confirmed_at AS latest_confirmed_at
      FROM critical_values cv
      INNER JOIN samples s ON s.id = cv.sample_id
      INNER JOIN test_results tr ON tr.id = cv.result_id
      LEFT JOIN test_items ti ON ti.id = tr.test_item_id
      LEFT JOIN critical_notifications cn ON cn.critical_value_id = cv.id
      LEFT JOIN critical_notifications latest ON latest.id = (
        SELECT cn2.id
        FROM critical_notifications cn2
        WHERE cn2.critical_value_id = cv.id
        ORDER BY datetime(COALESCE(cn2.notified_at, cn2.created_at)) DESC, cn2.id DESC
        LIMIT 1
      )
      GROUP BY cv.id
      ORDER BY datetime(cv.triggered_at) DESC, cv.id DESC;
    `).map(toCriticalValueDto);

    const notifications = getRows(database, `
      SELECT
        cn.id,
        cn.critical_value_id,
        cn.notify_method,
        cn.notify_target,
        cn.notified_by,
        u.username AS notified_by_name,
        cn.notified_at,
        cn.confirm_status,
        cn.confirmed_at,
        cn.remark,
        cn.created_at
      FROM critical_notifications cn
      LEFT JOIN users u ON u.id = cn.notified_by
      ORDER BY datetime(COALESCE(cn.notified_at, cn.created_at)) DESC, cn.id DESC;
    `).map(toNotificationDto);

    return {
      stats: {
        totalCriticalValues: criticalValues.length,
        pendingConfirm: criticalValues.filter((item) => isStatusInGroup(item.status, 'pendingConfirm')).length,
        notified: criticalValues.filter((item) => isStatusInGroup(item.status, 'notified')).length,
        overdue: criticalValues.filter((item) => isStatusInGroup(item.status, 'overdue')).length,
        closed: criticalValues.filter((item) => isStatusInGroup(item.status, 'closed')).length
      },
      criticalValues,
      notifications,
      databasePath: databasePath || getDefaultDatabasePath(options)
    };
  } finally {
    database.close();
  }
};

module.exports = {
  getCriticalValuesData
};
