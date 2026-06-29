const fs = require('fs');
const path = require('path');
const { getDefaultDatabasePath, initializeDatabase } = require('./initDatabase');

const STATUS_GROUPS = {
  pendingReceive: ['pending_receive', 'pending', '待签收'],
  received: ['received', 'reviewing', 'released', 'critical_pending', '已签收'],
  abnormal: ['abnormal', '异常'],
  rejected: ['rejected', '退样']
};

const SAMPLE_SELECT_COLUMNS = `
  id,
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
`;

const SAMPLE_RECOLLECTION_TASK_SELECT_COLUMNS = `
  id,
  sample_id,
  sample_no,
  reason,
  status,
  created_by,
  created_at,
  updated_at
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

const saveDatabase = (database, databasePath) => {
  const exportedDatabase = database.export();
  fs.writeFileSync(databasePath, Buffer.from(exportedDatabase));
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

const normalizeStatus = (status) => String(status || '').trim().toLowerCase();

const isStatusInGroup = (status, group) => {
  const normalizedStatus = normalizeStatus(status);
  return STATUS_GROUPS[group].some((candidate) => normalizeStatus(candidate) === normalizedStatus);
};

const isRecollectionAllowedStatus = (status) => {
  const normalizedStatus = normalizeStatus(status);
  return (
    isStatusInGroup(status, 'pendingReceive') ||
    isStatusInGroup(status, 'rejected') ||
    normalizedStatus === 'reviewing'
  );
};

const toSampleDto = (row) => ({
  id: Number(row.id),
  sampleNo: row.sample_no,
  patientCode: row.patient_code,
  sourceType: row.source_type,
  department: row.department,
  testGroup: row.test_group,
  sampleType: row.sample_type,
  containerType: row.container_type,
  collectedAt: row.collected_at,
  receivedAt: row.received_at,
  status: row.status,
  priority: row.priority,
  rejectReason: row.reject_reason || null
});

const toSampleRecollectionTaskDto = (row) => ({
  id: Number(row.id),
  sampleId: Number(row.sample_id),
  sampleNo: row.sample_no,
  reason: row.reason,
  status: row.status,
  createdBy: row.created_by === null || row.created_by === undefined ? null : Number(row.created_by),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const getSampleReceptionData = async (options = {}) => {
  const { database } = await openDatabase(options);

  try {
    database.run('PRAGMA foreign_keys = ON;');

    const rows = getRows(database, `
      SELECT
        id,
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
        reject_reason
      FROM samples
      ORDER BY
        CASE lower(priority)
          WHEN 'stat' THEN 1
          WHEN 'urgent' THEN 2
          WHEN 'routine' THEN 3
          ELSE 4
        END,
        datetime(COALESCE(created_at, collected_at)) DESC,
        id DESC;
    `);

    const samples = rows.map(toSampleDto);

    return {
      stats: {
        totalSamples: samples.length,
        pendingReceive: samples.filter((sample) => isStatusInGroup(sample.status, 'pendingReceive')).length,
        received: samples.filter((sample) => isStatusInGroup(sample.status, 'received')).length,
        abnormal: samples.filter((sample) => isStatusInGroup(sample.status, 'abnormal')).length,
        rejected: samples.filter((sample) => isStatusInGroup(sample.status, 'rejected')).length
      },
      samples,
      databasePath: getDefaultDatabasePath(options)
    };
  } finally {
    database.close();
  }
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

const confirmSampleReception = async (sampleId, operator = {}, options = {}) => {
  const numericSampleId = Number(sampleId);

  if (!Number.isInteger(numericSampleId) || numericSampleId <= 0) {
    throw new Error('样本 ID 无效，无法确认签收。');
  }

  const { database, databasePath } = await openDatabase(options);
  let transactionStarted = false;

  try {
    database.run('PRAGMA foreign_keys = ON;');
    database.run('BEGIN TRANSACTION;');
    transactionStarted = true;

    const beforeSample = getRow(database, `
      SELECT ${SAMPLE_SELECT_COLUMNS}
      FROM samples
      WHERE id = :sampleId;
    `, {
      ':sampleId': numericSampleId
    });

    if (!beforeSample) {
      throw new Error(`样本不存在，无法确认签收：${numericSampleId}`);
    }

    if (String(beforeSample.received_at || '').trim()) {
      throw new Error(`样本 ${beforeSample.sample_no} 已有签收时间，不能重复签收。`);
    }

    if (!isStatusInGroup(beforeSample.status, 'pendingReceive')) {
      throw new Error(`样本 ${beforeSample.sample_no} 当前状态为 ${beforeSample.status}，仅待签收样本允许确认签收。`);
    }

    const now = getCurrentTimestamp();

    database.run(`
      UPDATE samples
      SET
        status = 'reviewing',
        received_at = :receivedAt,
        updated_at = :updatedAt
      WHERE id = :sampleId;
    `, {
      ':receivedAt': now,
      ':updatedAt': now,
      ':sampleId': numericSampleId
    });

    const afterSample = getRow(database, `
      SELECT ${SAMPLE_SELECT_COLUMNS}
      FROM samples
      WHERE id = :sampleId;
    `, {
      ':sampleId': numericSampleId
    });

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
        'sample_reception',
        'confirm_sample_reception',
        'samples',
        :targetId,
        :beforeJson,
        :afterJson,
        :remark,
        :createdAt
      );
    `, {
      ':userId': getOperatorUserId(operator),
      ':targetId': numericSampleId,
      ':beforeJson': JSON.stringify(beforeSample),
      ':afterJson': JSON.stringify(afterSample),
      ':remark': `Confirmed sample reception for ${beforeSample.sample_no}.`,
      ':createdAt': now
    });

    database.run('COMMIT;');
    transactionStarted = false;
    saveDatabase(database, databasePath);

    return {
      sample: toSampleDto(afterSample),
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

const rejectSampleReception = async (sampleId, reason, operator = {}, options = {}) => {
  const numericSampleId = Number(sampleId);
  const rejectReason = String(reason || '').trim();

  if (!Number.isInteger(numericSampleId) || numericSampleId <= 0) {
    throw new Error('样本 ID 无效，无法退样/拒收。');
  }

  if (!rejectReason) {
    throw new Error('拒收原因不能为空。');
  }

  const { database, databasePath } = await openDatabase(options);
  let transactionStarted = false;

  try {
    database.run('PRAGMA foreign_keys = ON;');
    database.run('BEGIN TRANSACTION;');
    transactionStarted = true;

    const beforeSample = getRow(database, `
      SELECT ${SAMPLE_SELECT_COLUMNS}
      FROM samples
      WHERE id = :sampleId;
    `, {
      ':sampleId': numericSampleId
    });

    if (!beforeSample) {
      throw new Error(`样本不存在，无法退样/拒收：${numericSampleId}`);
    }

    if (!isStatusInGroup(beforeSample.status, 'pendingReceive')) {
      throw new Error(`样本 ${beforeSample.sample_no} 当前状态为 ${beforeSample.status}，仅待签收样本允许退样/拒收。`);
    }

    const now = getCurrentTimestamp();

    database.run(`
      UPDATE samples
      SET
        status = 'rejected',
        reject_reason = :rejectReason,
        updated_at = :updatedAt
      WHERE id = :sampleId;
    `, {
      ':rejectReason': rejectReason,
      ':updatedAt': now,
      ':sampleId': numericSampleId
    });

    const afterSample = getRow(database, `
      SELECT ${SAMPLE_SELECT_COLUMNS}
      FROM samples
      WHERE id = :sampleId;
    `, {
      ':sampleId': numericSampleId
    });

    const operatorName = getOperatorName(operator);
    const remark = [
      `样本退样：${beforeSample.sample_no}`,
      `拒收原因：${rejectReason}`,
      `操作者：${operatorName}`,
      `原状态：${beforeSample.status}`,
      `新状态：${afterSample.status}`
    ].join('；');

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
        '样本签收',
        '样本退样',
        'samples',
        :targetId,
        :beforeJson,
        :afterJson,
        :remark,
        :createdAt
      );
    `, {
      ':userId': getOperatorUserId(operator),
      ':targetId': numericSampleId,
      ':beforeJson': JSON.stringify(beforeSample),
      ':afterJson': JSON.stringify(afterSample),
      ':remark': remark,
      ':createdAt': now
    });

    database.run('COMMIT;');
    transactionStarted = false;
    saveDatabase(database, databasePath);

    return {
      sample: toSampleDto(afterSample),
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

const createSampleRecollectionTask = async (sampleId, reason, operator = {}, options = {}) => {
  const numericSampleId = Number(sampleId);
  const recollectionReason = String(reason || '').trim();

  if (!Number.isInteger(numericSampleId) || numericSampleId <= 0) {
    throw new Error('样本 ID 无效，无法创建补采任务。');
  }

  if (!recollectionReason) {
    throw new Error('补采原因不能为空。');
  }

  const { database, databasePath } = await openDatabase(options);
  let transactionStarted = false;

  try {
    database.run('PRAGMA foreign_keys = ON;');
    database.run('BEGIN TRANSACTION;');
    transactionStarted = true;

    const beforeSample = getRow(database, `
      SELECT ${SAMPLE_SELECT_COLUMNS}
      FROM samples
      WHERE id = :sampleId;
    `, {
      ':sampleId': numericSampleId
    });

    if (!beforeSample) {
      throw new Error(`样本不存在，无法创建补采任务：${numericSampleId}`);
    }

    if (!isRecollectionAllowedStatus(beforeSample.status)) {
      throw new Error(`样本 ${beforeSample.sample_no} 当前状态为 ${beforeSample.status}，不允许创建补采任务。`);
    }

    const now = getCurrentTimestamp();
    const taskStatus = 'pending';
    const createdBy = getOperatorUserId(operator);

    database.run(`
      INSERT INTO sample_recollection_tasks (
        sample_id,
        sample_no,
        reason,
        status,
        created_by,
        created_at,
        updated_at
      ) VALUES (
        :sampleId,
        :sampleNo,
        :reason,
        :status,
        :createdBy,
        :createdAt,
        :updatedAt
      );
    `, {
      ':sampleId': numericSampleId,
      ':sampleNo': beforeSample.sample_no,
      ':reason': recollectionReason,
      ':status': taskStatus,
      ':createdBy': createdBy,
      ':createdAt': now,
      ':updatedAt': now
    });

    const createdTaskId = Number(getRow(database, 'SELECT last_insert_rowid() AS id;').id);
    const createdTask = getRow(database, `
      SELECT ${SAMPLE_RECOLLECTION_TASK_SELECT_COLUMNS}
      FROM sample_recollection_tasks
      WHERE id = :taskId;
    `, {
      ':taskId': createdTaskId
    });

    const operatorName = getOperatorName(operator);
    const remark = [
      `创建补采任务：${beforeSample.sample_no}`,
      `补采原因：${recollectionReason}`,
      `操作者：${operatorName}`,
      `样本原状态：${beforeSample.status}`,
      `补采任务状态：${taskStatus}`
    ].join('；');

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
        '样本签收',
        '创建补采任务',
        'sample_recollection_tasks',
        :targetId,
        :beforeJson,
        :afterJson,
        :remark,
        :createdAt
      );
    `, {
      ':userId': createdBy,
      ':targetId': createdTaskId,
      ':beforeJson': JSON.stringify(beforeSample),
      ':afterJson': JSON.stringify(createdTask),
      ':remark': remark,
      ':createdAt': now
    });

    database.run('COMMIT;');
    transactionStarted = false;
    saveDatabase(database, databasePath);

    return {
      sample: toSampleDto(beforeSample),
      task: toSampleRecollectionTaskDto(createdTask),
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
  getSampleReceptionData,
  confirmSampleReception,
  rejectSampleReception,
  createSampleRecollectionTask
};
