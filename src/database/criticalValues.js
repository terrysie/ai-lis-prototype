const fs = require('fs');
const path = require('path');
const { getDefaultDatabasePath, initializeDatabase } = require('./initDatabase');

const STATUS_GROUPS = {
  pendingConfirm: ['pending', 'pending_confirm', '待确认', '待处理'],
  notified: ['notified', '已通知'],
  overdue: ['overdue', '超时', '催办', '超时催办'],
  closed: ['closed', 'completed', '已闭环']
};

const NOTIFIABLE_STATUSES = ['pending', 'pending_confirm', '待确认', '待处理'];
const ACKNOWLEDGEABLE_STATUSES = ['notified', '已通知'];
const CONFIRMED_STATUSES = ['confirmed', '已确认'];
const COMPLETED_STATUSES = ['completed', 'closed', '已完成', '已闭环'];

const CRITICAL_NOTIFICATION_SELECT_COLUMNS = `
  cn.id,
  cn.critical_value_id,
  cn.notify_method,
  cn.notify_target,
  cn.notified_by,
  cn.notified_at,
  cn.confirm_status,
  cn.confirmed_at,
  cn.remark,
  cn.created_at,
  cv.status AS critical_value_status,
  cv.closed_at AS critical_value_closed_at,
  cv.updated_at AS critical_value_updated_at
`;

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

const normalizeStatus = (status) => String(status || '').trim().toLowerCase();

const isStatusInGroup = (status, group) => {
  const normalizedStatus = normalizeStatus(status);
  return STATUS_GROUPS[group].some((candidate) => normalizeStatus(candidate) === normalizedStatus);
};

const isInStatusList = (status, candidates) => {
  const normalizedStatus = normalizeStatus(status);
  return candidates.some((candidate) => normalizeStatus(candidate) === normalizedStatus);
};

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

const getOperatorName = (operator = {}) => {
  const operatorName = operator.displayName || operator.username || operator.name || operator.operatorName;
  return String(operatorName || operator.userId || operator.id || 'unknown').trim() || 'unknown';
};

const ensureNotificationId = (notificationId, actionText) => {
  const numericNotificationId = Number(notificationId);

  if (!Number.isInteger(numericNotificationId) || numericNotificationId <= 0) {
    throw new Error(`危急值通知记录 ID 无效，无法${actionText}。`);
  }

  return numericNotificationId;
};

const getCriticalNotificationRow = (database, notificationId) => getRow(database, `
  SELECT ${CRITICAL_NOTIFICATION_SELECT_COLUMNS}
  FROM critical_notifications cn
  INNER JOIN critical_values cv ON cv.id = cn.critical_value_id
  WHERE cn.id = :notificationId;
`, {
  ':notificationId': notificationId
});

const toCriticalNotificationAuditPayload = (row) => ({
  id: Number(row.id),
  critical_value_id: Number(row.critical_value_id),
  notify_method: row.notify_method,
  notify_target: row.notify_target,
  notified_by: row.notified_by === null || row.notified_by === undefined ? null : Number(row.notified_by),
  notified_at: row.notified_at || null,
  confirm_status: row.confirm_status || null,
  confirmed_at: row.confirmed_at || null,
  remark: row.remark || null,
  critical_value_status: row.critical_value_status || null,
  critical_value_closed_at: row.critical_value_closed_at || null,
  critical_value_updated_at: row.critical_value_updated_at || null
});

const isCriticalNotificationCompleted = (notification) => (
  Boolean(notification?.critical_value_closed_at)
  || isStatusInGroup(notification?.critical_value_status, 'closed')
  || isInStatusList(notification?.confirm_status, COMPLETED_STATUSES)
);

const canNotifyCriticalValue = (notification) => (
  !isCriticalNotificationCompleted(notification)
  && isInStatusList(notification?.confirm_status, NOTIFIABLE_STATUSES)
);

const canAcknowledgeCriticalValue = (notification) => (
  !isCriticalNotificationCompleted(notification)
  && !notification?.confirmed_at
  && Boolean(notification?.notified_at)
  && isInStatusList(notification?.confirm_status, ACKNOWLEDGEABLE_STATUSES)
);

const canCompleteCriticalValue = (notification) => (
  !isCriticalNotificationCompleted(notification)
  && Boolean(notification?.confirmed_at)
  && isInStatusList(notification?.confirm_status, CONFIRMED_STATUSES)
);

const writeCriticalValueAuditLog = (database, {
  userId,
  operationType,
  notificationId,
  beforeNotification,
  afterNotification,
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
      '危急值中心',
      :operationType,
      'critical_notifications',
      :targetId,
      :beforeJson,
      :afterJson,
      :remark,
      :createdAt
    );
  `, {
    ':userId': userId,
    ':operationType': operationType,
    ':targetId': notificationId,
    ':beforeJson': JSON.stringify(beforeNotification),
    ':afterJson': JSON.stringify(afterNotification),
    ':remark': remark,
    ':createdAt': createdAt
  });
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
  latestNotificationId: row.latest_notification_id === null || row.latest_notification_id === undefined ? null : Number(row.latest_notification_id),
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
        latest.id AS latest_notification_id,
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

const notifyCriticalValue = async (notificationId, channelOrRemark, operator = {}, options = {}) => {
  const numericNotificationId = ensureNotificationId(notificationId, '确认危急值通知');
  const { database, databasePath } = await openDatabase(options);
  let transactionStarted = false;

  try {
    database.run('PRAGMA foreign_keys = ON;');
    database.run('BEGIN TRANSACTION;');
    transactionStarted = true;

    const beforeRow = getCriticalNotificationRow(database, numericNotificationId);

    if (!beforeRow) {
      throw new Error(`危急值通知记录不存在，无法确认通知：${numericNotificationId}`);
    }

    if (!canNotifyCriticalValue(beforeRow)) {
      throw new Error(`危急值通知记录 ${numericNotificationId} 当前状态为 ${beforeRow.confirm_status}，不能重复确认通知。`);
    }

    const now = getCurrentTimestamp();
    const operatorUserId = getOperatorUserId(operator);
    const operatorName = getOperatorName(operator);
    const notifyRemark = String(channelOrRemark || '').trim() || '危急值通知已确认。';

    database.run(`
      UPDATE critical_notifications
      SET
        notified_by = :notifiedBy,
        notified_at = :notifiedAt,
        confirm_status = 'notified',
        remark = :remark
      WHERE id = :notificationId;
    `, {
      ':notifiedBy': operatorUserId,
      ':notifiedAt': now,
      ':remark': notifyRemark,
      ':notificationId': numericNotificationId
    });

    database.run(`
      UPDATE critical_values
      SET
        status = 'notified',
        updated_at = :updatedAt
      WHERE id = :criticalValueId;
    `, {
      ':updatedAt': now,
      ':criticalValueId': beforeRow.critical_value_id
    });

    const afterRow = getCriticalNotificationRow(database, numericNotificationId);
    writeCriticalValueAuditLog(database, {
      userId: operatorUserId,
      operationType: '危急值通知',
      notificationId: numericNotificationId,
      beforeNotification: toCriticalNotificationAuditPayload(beforeRow),
      afterNotification: toCriticalNotificationAuditPayload(afterRow),
      remark: `危急值通知：notificationId=${numericNotificationId}；方式：${afterRow.notify_method || '--'}；对象：${afterRow.notify_target || '--'}；操作者：${operatorName}；说明：${notifyRemark}`,
      createdAt: now
    });

    database.run('COMMIT;');
    transactionStarted = false;
    saveDatabase(database, databasePath);

    return {
      notification: toCriticalNotificationAuditPayload(afterRow),
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

const acknowledgeCriticalValue = async (notificationId, operator = {}, options = {}) => {
  const numericNotificationId = ensureNotificationId(notificationId, '确认危急值接收');
  const { database, databasePath } = await openDatabase(options);
  let transactionStarted = false;

  try {
    database.run('PRAGMA foreign_keys = ON;');
    database.run('BEGIN TRANSACTION;');
    transactionStarted = true;

    const beforeRow = getCriticalNotificationRow(database, numericNotificationId);

    if (!beforeRow) {
      throw new Error(`危急值通知记录不存在，无法确认接收：${numericNotificationId}`);
    }

    if (!canAcknowledgeCriticalValue(beforeRow)) {
      throw new Error(`危急值通知记录 ${numericNotificationId} 当前状态为 ${beforeRow.confirm_status}，必须先确认已通知，且不能重复临床确认。`);
    }

    const now = getCurrentTimestamp();
    const operatorUserId = getOperatorUserId(operator);
    const operatorName = getOperatorName(operator);
    const acknowledgeRemark = beforeRow.remark
      ? `${beforeRow.remark}；临床已确认接收。`
      : '临床已确认接收。';

    database.run(`
      UPDATE critical_notifications
      SET
        confirm_status = 'confirmed',
        confirmed_at = :confirmedAt,
        remark = :remark
      WHERE id = :notificationId;
    `, {
      ':confirmedAt': now,
      ':remark': acknowledgeRemark,
      ':notificationId': numericNotificationId
    });

    database.run(`
      UPDATE critical_values
      SET
        status = 'confirmed',
        updated_at = :updatedAt
      WHERE id = :criticalValueId;
    `, {
      ':updatedAt': now,
      ':criticalValueId': beforeRow.critical_value_id
    });

    const afterRow = getCriticalNotificationRow(database, numericNotificationId);
    writeCriticalValueAuditLog(database, {
      userId: operatorUserId,
      operationType: '危急值确认',
      notificationId: numericNotificationId,
      beforeNotification: toCriticalNotificationAuditPayload(beforeRow),
      afterNotification: toCriticalNotificationAuditPayload(afterRow),
      remark: `危急值确认：notificationId=${numericNotificationId}；操作者：${operatorName}；确认状态：${afterRow.confirm_status}`,
      createdAt: now
    });

    database.run('COMMIT;');
    transactionStarted = false;
    saveDatabase(database, databasePath);

    return {
      notification: toCriticalNotificationAuditPayload(afterRow),
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

const completeCriticalValue = async (notificationId, resolution, operator = {}, options = {}) => {
  const numericNotificationId = ensureNotificationId(notificationId, '完成危急值闭环');
  const completionResolution = String(resolution || '').trim();

  if (!completionResolution) {
    throw new Error('危急值完成处理说明不能为空。');
  }

  const { database, databasePath } = await openDatabase(options);
  let transactionStarted = false;

  try {
    database.run('PRAGMA foreign_keys = ON;');
    database.run('BEGIN TRANSACTION;');
    transactionStarted = true;

    const beforeRow = getCriticalNotificationRow(database, numericNotificationId);

    if (!beforeRow) {
      throw new Error(`危急值通知记录不存在，无法完成闭环：${numericNotificationId}`);
    }

    if (!canCompleteCriticalValue(beforeRow)) {
      throw new Error(`危急值通知记录 ${numericNotificationId} 当前状态为 ${beforeRow.confirm_status}，不能完成或重复完成闭环。`);
    }

    const now = getCurrentTimestamp();
    const operatorUserId = getOperatorUserId(operator);
    const operatorName = getOperatorName(operator);
    const completionRemark = beforeRow.remark
      ? `${beforeRow.remark}；处理说明：${completionResolution}`
      : `处理说明：${completionResolution}`;

    database.run(`
      UPDATE critical_notifications
      SET
        confirm_status = 'completed',
        remark = :remark
      WHERE id = :notificationId;
    `, {
      ':remark': completionRemark,
      ':notificationId': numericNotificationId
    });

    database.run(`
      UPDATE critical_values
      SET
        status = 'closed',
        closed_at = :closedAt,
        updated_at = :updatedAt
      WHERE id = :criticalValueId;
    `, {
      ':closedAt': now,
      ':updatedAt': now,
      ':criticalValueId': beforeRow.critical_value_id
    });

    const afterRow = getCriticalNotificationRow(database, numericNotificationId);
    writeCriticalValueAuditLog(database, {
      userId: operatorUserId,
      operationType: '危急值完成',
      notificationId: numericNotificationId,
      beforeNotification: toCriticalNotificationAuditPayload(beforeRow),
      afterNotification: toCriticalNotificationAuditPayload(afterRow),
      remark: `危急值完成：notificationId=${numericNotificationId}；操作者：${operatorName}；处理说明：${completionResolution}`,
      createdAt: now
    });

    database.run('COMMIT;');
    transactionStarted = false;
    saveDatabase(database, databasePath);

    return {
      notification: toCriticalNotificationAuditPayload(afterRow),
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
  getCriticalValuesData,
  notifyCriticalValue,
  acknowledgeCriticalValue,
  completeCriticalValue
};
