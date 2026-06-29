#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { getDefaultDatabasePath, resetDatabase } = require('../src/database/initDatabase');
const {
  getSampleReceptionHistory,
  confirmSampleReception,
  rejectSampleReception,
  createSampleRecollectionTask
} = require('../src/database/sampleReception');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SQL_WASM_PATH = path.join(PROJECT_ROOT, 'node_modules', 'sql.js', 'dist');
const SMOKE_OPERATOR = { userId: 3, username: 'li.receive', displayName: 'Smoke Sample Reception Operator' };

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

const assertIncludes = (value, expected, message) => {
  if (!String(value || '').includes(expected)) {
    throw new Error(`${message}: expected "${value}" to include "${expected}"`);
  }
};

const assertHistoryContains = (history, predicate, message) => {
  if (!Array.isArray(history)) {
    throw new Error(`${message}: expected history to be an array`);
  }

  if (!history.some(predicate)) {
    throw new Error(`${message}: matching audit log not found`);
  }
};

const expectReject = async (action, expectedMessagePart, passMessage) => {
  try {
    await action();
  } catch (error) {
    if (expectedMessagePart) {
      assertIncludes(error.message, expectedMessagePart, passMessage);
    }

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

const getRow = (database, sql, params = {}) => {
  const statement = database.prepare(sql);

  try {
    statement.bind(params);
    return statement.step() ? statement.getAsObject() : null;
  } finally {
    statement.free();
  }
};

const getCount = (database, tableName) => {
  const row = getRow(database, `SELECT COUNT(*) AS count FROM ${tableName};`);
  return Number(row.count);
};

const getSample = (database, sampleId) => getRow(database, `
  SELECT id, sample_no, status, reject_reason
  FROM samples
  WHERE id = :sampleId;
`, {
  ':sampleId': sampleId
});

const resetForCase = async (caseName) => {
  const { databasePath } = await resetDatabase();
  console.log(`RESET ${caseName}: ${databasePath}`);
};

const runConfirmSmoke = async () => {
  await resetForCase('confirmSampleReception');

  await withDatabase((database) => {
    assertEqual(getCount(database, 'audit_logs'), 5, 'confirmSampleReception initial audit log count');
  });

  await confirmSampleReception(5, SMOKE_OPERATOR);

  await withDatabase((database) => {
    const sample = getSample(database, 5);
    assertEqual(sample.status, 'reviewing', 'confirmSampleReception sample status');
    console.log('PASS confirmSampleReception writes reviewing status');

    assertEqual(getCount(database, 'audit_logs'), 6, 'confirmSampleReception audit log count');
    console.log('PASS confirmSampleReception writes audit log');
  });

  const history = await getSampleReceptionHistory(5);
  assertHistoryContains(
    history,
    (record) => (
      record.operation_type === 'confirm_sample_reception' &&
      record.target_table === 'samples' &&
      record.target_id === 5 &&
      record.after_json?.status === 'reviewing'
    ),
    'confirmSampleReception history lookup'
  );
  console.log('PASS getSampleReceptionHistory reads confirm audit log');

  await expectReject(
    () => confirmSampleReception(5, SMOKE_OPERATOR),
    null,
    'confirmSampleReception rejects repeated confirmation'
  );
};

const runRejectSmoke = async () => {
  await resetForCase('rejectSampleReception');

  await withDatabase((database) => {
    assertEqual(getCount(database, 'audit_logs'), 5, 'rejectSampleReception initial audit log count');
  });

  await rejectSampleReception(5, 'smoke reject reason', SMOKE_OPERATOR);

  await withDatabase((database) => {
    const sample = getSample(database, 5);
    assertEqual(sample.status, 'rejected', 'rejectSampleReception sample status');
    console.log('PASS rejectSampleReception writes rejected status');

    assertEqual(sample.reject_reason, 'smoke reject reason', 'rejectSampleReception reject reason');
    console.log('PASS rejectSampleReception writes reject reason');

    assertEqual(getCount(database, 'audit_logs'), 6, 'rejectSampleReception audit log count');
    console.log('PASS rejectSampleReception writes audit log');
  });

  const history = await getSampleReceptionHistory(5);
  assertHistoryContains(
    history,
    (record) => (
      record.operation_type === '样本退样' &&
      record.target_table === 'samples' &&
      record.target_id === 5 &&
      record.after_json?.status === 'rejected' &&
      record.after_json?.reject_reason === 'smoke reject reason'
    ),
    'rejectSampleReception history lookup'
  );
  console.log('PASS getSampleReceptionHistory reads rejection audit log');

  await expectReject(
    () => rejectSampleReception(5, '', SMOKE_OPERATOR),
    null,
    'rejectSampleReception requires reason'
  );

  await expectReject(
    () => rejectSampleReception(5, 'smoke duplicate reject reason', SMOKE_OPERATOR),
    null,
    'rejectSampleReception rejects repeated rejection'
  );
};

const runRecollectionSmoke = async () => {
  await resetForCase('createSampleRecollectionTask');

  await withDatabase((database) => {
    assertEqual(getCount(database, 'sample_recollection_tasks'), 0, 'createSampleRecollectionTask initial task count');
    assertEqual(getCount(database, 'audit_logs'), 5, 'createSampleRecollectionTask initial audit log count');
  });

  await createSampleRecollectionTask(5, 'smoke recollection reason', SMOKE_OPERATOR);

  await withDatabase((database) => {
    assertEqual(getCount(database, 'sample_recollection_tasks'), 1, 'createSampleRecollectionTask task count');
    console.log('PASS createSampleRecollectionTask writes task');

    const task = getRow(database, `
      SELECT sample_id, sample_no, reason, status
      FROM sample_recollection_tasks
      WHERE sample_id = :sampleId;
    `, {
      ':sampleId': 5
    });

    assertEqual(task.sample_no, 'S202606120005', 'createSampleRecollectionTask sample number');
    assertEqual(task.reason, 'smoke recollection reason', 'createSampleRecollectionTask reason');
    assertEqual(task.status, 'pending', 'createSampleRecollectionTask task status');

    assertEqual(getCount(database, 'audit_logs'), 6, 'createSampleRecollectionTask audit log count');
    console.log('PASS createSampleRecollectionTask writes audit log');
  });

  const history = await getSampleReceptionHistory(5);
  assertHistoryContains(
    history,
    (record) => (
      record.operation_type === '创建补采任务' &&
      record.target_table === 'sample_recollection_tasks' &&
      record.after_json?.sample_id === 5 &&
      record.after_json?.reason === 'smoke recollection reason'
    ),
    'createSampleRecollectionTask history lookup'
  );
  console.log('PASS getSampleReceptionHistory reads recollection audit log');
  console.log('PASS getSampleReceptionHistory links sample_recollection_tasks by sampleId');

  await expectReject(
    () => createSampleRecollectionTask(5, '', SMOKE_OPERATOR),
    null,
    'createSampleRecollectionTask requires reason'
  );

  await expectReject(
    () => createSampleRecollectionTask(999999, 'smoke missing sample reason', SMOKE_OPERATOR),
    null,
    'createSampleRecollectionTask rejects missing sample'
  );
};

const main = async () => {
  await expectReject(
    () => getSampleReceptionHistory(),
    null,
    'getSampleReceptionHistory requires sampleId'
  );
  await runConfirmSmoke();
  await runRejectSmoke();
  await runRecollectionSmoke();
  console.log('PASS sample reception write smoke completed');
};

main().catch((error) => {
  console.error('FAIL sample reception write smoke');
  console.error(error);
  process.exit(1);
});
