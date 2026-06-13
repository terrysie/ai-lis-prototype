const fs = require('fs');
const path = require('path');
const { getDefaultDatabasePath, initializeDatabase } = require('./initDatabase');

const STATUS_GROUPS = {
  pendingReceive: ['pending_receive', 'pending', '待签收'],
  received: ['received', 'reviewing', 'released', 'critical_pending', '已签收'],
  abnormal: ['abnormal', '异常'],
  rejected: ['rejected', '退样']
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

module.exports = {
  getSampleReceptionData
};
