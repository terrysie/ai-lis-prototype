#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { getDefaultDatabasePath, resetDatabase } = require('../src/database/initDatabase');
const {
  updateSystemRule,
  toggleSystemRule
} = require('../src/database/systemSettings');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SQL_WASM_PATH = path.join(PROJECT_ROOT, 'node_modules', 'sql.js', 'dist');
const SYSTEM_RULE_OPERATOR = { userId: 1, username: 'admin', displayName: 'Smoke System Rules Operator' };
const SMOKE_MARKER = 'SYSTEM-RULE-SMOKE';

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

const assertTruthy = (value, message) => {
  if (!value) {
    throw new Error(`${message}: expected truthy value`);
  }
};

const expectReject = async (action, passMessage) => {
  try {
    await action();
  } catch (_error) {
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

const parseJson = (value, message) => {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${message}: invalid JSON ${error.message}`);
  }
};

const getUpdateableSystemRule = (database) => getRow(database, `
  SELECT
    id,
    rule_type,
    rule_name,
    rule_config_json,
    status,
    updated_at
  FROM system_rules
  WHERE rule_config_json IS NOT NULL
    AND trim(rule_config_json) <> ''
  ORDER BY id ASC
  LIMIT 1;
`);

const getSystemRule = (database, ruleId) => getRow(database, `
  SELECT
    id,
    rule_type,
    rule_name,
    rule_config_json,
    status,
    updated_at
  FROM system_rules
  WHERE id = :ruleId;
`, {
  ':ruleId': ruleId
});

const getSystemRuleAuditLog = (database, ruleId, operationType) => getRow(database, `
  SELECT
    id,
    user_id,
    module_name,
    operation_type,
    target_table,
    target_id,
    before_json,
    after_json,
    remark
  FROM audit_logs
  WHERE target_table = 'system_rules'
    AND target_id = :ruleId
    AND operation_type = :operationType
  ORDER BY id DESC
  LIMIT 1;
`, {
  ':ruleId': ruleId,
  ':operationType': operationType
});

const buildSmokeRuleConfig = (rule) => {
  const parsed = parseJson(rule.rule_config_json, 'system rule seed config');
  const baseConfig = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};

  return JSON.stringify({
    ...baseConfig,
    smoke_marker: SMOKE_MARKER,
    smoke_rule_id: Number(rule.id)
  });
};

const main = async () => {
  const { databasePath } = await resetDatabase();
  console.log(`RESET systemRules: ${databasePath}`);

  const initialAuditCount = await withDatabase((database) => getCount(database, 'audit_logs'));
  assertEqual(initialAuditCount, 5, 'system rules initial audit log count');

  const rule = await withDatabase((database) => getUpdateableSystemRule(database));
  assertTruthy(rule, 'system rules updateable seed rule');
  const ruleId = Number(rule.id);
  const nextRuleConfigJson = buildSmokeRuleConfig(rule);

  const updateResult = await updateSystemRule(
    ruleId,
    { rule_config_json: nextRuleConfigJson },
    SYSTEM_RULE_OPERATOR
  );
  assertEqual(updateResult.rule.id, ruleId, 'updateSystemRule result rule id');
  assertTruthy(updateResult.auditLogId, 'updateSystemRule auditLogId');

  await withDatabase((database) => {
    const updatedRule = getSystemRule(database, ruleId);
    assertTruthy(updatedRule, 'updateSystemRule updated rule row');
    assertEqual(updatedRule.rule_config_json, nextRuleConfigJson, 'updateSystemRule rule_config_json');
    assertTruthy(String(updatedRule.rule_config_json).includes(SMOKE_MARKER), 'updateSystemRule smoke marker');
    assertTruthy(updatedRule.updated_at, 'updateSystemRule updated_at');

    const auditLog = getSystemRuleAuditLog(database, ruleId, '更新系统规则');
    assertTruthy(auditLog, 'updateSystemRule audit log');
    assertEqual(auditLog.module_name, '系统设置', 'updateSystemRule audit module');
    assertEqual(auditLog.operation_type, '更新系统规则', 'updateSystemRule audit operation');
    assertEqual(auditLog.target_table, 'system_rules', 'updateSystemRule audit target table');
    assertEqual(Number(auditLog.target_id), ruleId, 'updateSystemRule audit target id');

    const beforeJson = parseJson(auditLog.before_json, 'updateSystemRule before_json');
    const afterJson = parseJson(auditLog.after_json, 'updateSystemRule after_json');
    assertEqual(Number(beforeJson.id), ruleId, 'updateSystemRule before_json id');
    assertEqual(Number(afterJson.id), ruleId, 'updateSystemRule after_json id');
    assertEqual(afterJson.rule_config_json, nextRuleConfigJson, 'updateSystemRule after_json rule_config_json');
    assertEqual(getCount(database, 'audit_logs'), initialAuditCount + 1, 'updateSystemRule audit log count');
  });
  console.log('PASS updateSystemRule writes rule value and audit log');

  await expectReject(
    () => updateSystemRule(999999, { rule_config_json: nextRuleConfigJson }, SYSTEM_RULE_OPERATOR),
    'updateSystemRule rejects missing rule'
  );

  await expectReject(
    () => updateSystemRule(ruleId, {}, SYSTEM_RULE_OPERATOR),
    'updateSystemRule rejects empty updates'
  );

  await expectReject(
    () => updateSystemRule(ruleId, { missing_field: 'SYSTEM-RULE-SMOKE' }, SYSTEM_RULE_OPERATOR),
    'updateSystemRule rejects unknown field'
  );

  await expectReject(
    () => updateSystemRule(ruleId, { status: 'inactive' }, SYSTEM_RULE_OPERATOR),
    'updateSystemRule rejects direct status update'
  );

  await expectReject(
    () => updateSystemRule(ruleId, { rule_name: 'SYSTEM-RULE-SMOKE name' }, SYSTEM_RULE_OPERATOR),
    'updateSystemRule rejects rule_name update'
  );

  await expectReject(
    () => updateSystemRule(ruleId, { version_no: 'SYSTEM-RULE-SMOKE version' }, SYSTEM_RULE_OPERATOR),
    'updateSystemRule rejects version_no update'
  );

  const beforeToggle = await withDatabase((database) => getSystemRule(database, ruleId));
  const shouldEnable = String(beforeToggle.status || '').toLowerCase() !== 'active';
  const expectedStatus = shouldEnable ? 'active' : 'inactive';
  const toggleResult = await toggleSystemRule(ruleId, shouldEnable, SYSTEM_RULE_OPERATOR);
  assertEqual(toggleResult.rule.id, ruleId, 'toggleSystemRule result rule id');
  assertEqual(toggleResult.rule.status, expectedStatus, 'toggleSystemRule result status');
  assertTruthy(toggleResult.auditLogId, 'toggleSystemRule auditLogId');

  await withDatabase((database) => {
    const toggledRule = getSystemRule(database, ruleId);
    assertTruthy(toggledRule, 'toggleSystemRule toggled rule row');
    assertEqual(toggledRule.status, expectedStatus, 'toggleSystemRule status');

    const auditLog = getSystemRuleAuditLog(database, ruleId, '启停系统规则');
    assertTruthy(auditLog, 'toggleSystemRule audit log');
    assertEqual(auditLog.module_name, '系统设置', 'toggleSystemRule audit module');
    assertEqual(auditLog.operation_type, '启停系统规则', 'toggleSystemRule audit operation');
    assertEqual(auditLog.target_table, 'system_rules', 'toggleSystemRule audit target table');
    assertEqual(Number(auditLog.target_id), ruleId, 'toggleSystemRule audit target id');

    const beforeJson = parseJson(auditLog.before_json, 'toggleSystemRule before_json');
    const afterJson = parseJson(auditLog.after_json, 'toggleSystemRule after_json');
    assertEqual(Number(beforeJson.id), ruleId, 'toggleSystemRule before_json id');
    assertEqual(Number(afterJson.id), ruleId, 'toggleSystemRule after_json id');
    assertEqual(afterJson.status, expectedStatus, 'toggleSystemRule after_json status');
    assertEqual(getCount(database, 'audit_logs'), initialAuditCount + 2, 'toggleSystemRule audit log count');
  });
  console.log('PASS toggleSystemRule writes status and audit log');

  console.log('PASS system rules smoke completed');
};

main().catch((error) => {
  console.error('FAIL system rules smoke');
  console.error(error);
  process.exit(1);
});
