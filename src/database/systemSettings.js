const fs = require('fs');
const path = require('path');
const { initializeDatabase } = require('./initDatabase');

const ACTIVE_STATUSES = ['active', 'enabled', '正常', '启用', '生效'];

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

const allRows = (database, sql, params = {}) => {
  const statement = database.prepare(sql);

  try {
    statement.bind(params);
    const rows = [];

    while (statement.step()) {
      rows.push(statement.getAsObject());
    }

    return rows;
  } finally {
    statement.free();
  }
};

const countRows = (database, sql, params = {}) => {
  const row = allRows(database, sql, params)[0];
  return Number(row?.count || 0);
};

const getRow = (database, sql, params = {}) => allRows(database, sql, params)[0] || null;

const saveDatabase = (database, databasePath) => {
  const exportedDatabase = database.export();
  fs.writeFileSync(databasePath, Buffer.from(exportedDatabase));
};

const parseJsonValue = (value, fallback) => {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return value;
  }
};

const normalizePermissions = (permissionsJson) => {
  const parsed = parseJsonValue(permissionsJson, []);

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (parsed && typeof parsed === 'object') {
    const modules = Array.isArray(parsed.modules) ? parsed.modules.map((item) => `模块:${item}`) : [];
    const actions = Array.isArray(parsed.actions) ? parsed.actions.map((item) => `操作:${item}`) : [];
    return [...modules, ...actions];
  }

  return parsed ? [String(parsed)] : [];
};

const activeWhereClause = (columnName) => `lower(${columnName}) IN ('active', 'enabled') OR ${columnName} IN ('正常', '启用', '生效')`;

const SYSTEM_RULE_UPDATE_FIELD_ALIASES = {
  ruleConfig: 'rule_config_json',
  ruleConfigJson: 'rule_config_json',
  ruleValue: 'rule_config_json',
  value: 'rule_config_json'
};

const SYSTEM_RULE_CONFIG_UPDATE_FIELDS = new Set(['rule_config_json']);
const SYSTEM_RULE_STATUS_UPDATE_FIELDS = new Set(['status']);

const SYSTEM_RULE_PROTECTED_FIELDS = new Set(['id', 'created_at', 'createdAt', 'updated_at', 'updatedAt']);

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

const ensureRuleId = (ruleId) => {
  const numericRuleId = Number(ruleId);

  if (!Number.isInteger(numericRuleId) || numericRuleId <= 0) {
    throw new Error('系统规则 ID 无效，无法更新系统规则。');
  }

  return numericRuleId;
};

const normalizeRuleUpdateField = (field) => SYSTEM_RULE_UPDATE_FIELD_ALIASES[field] || field;

const normalizeRuleUpdateValue = (field, value) => {
  if (field === 'rule_config_json') {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return JSON.stringify(value);
    }

    const text = String(value ?? '').trim();

    if (!text) {
      throw new Error('系统规则配置值不能为空。');
    }

    try {
      JSON.parse(text);
    } catch (error) {
      throw new Error(`系统规则配置必须是合法 JSON：${error.message}`);
    }

    return text;
  }

  const text = String(value ?? '').trim();

  if (!text) {
    throw new Error('系统规则字段值不能为空。');
  }

  return text;
};

const normalizeSystemRuleUpdates = (updates = {}, { allowStatus = false } = {}) => {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new Error('系统规则更新内容不能为空。');
  }

  const normalizedUpdates = {};
  const entries = Object.entries(updates);

  if (entries.length === 0) {
    throw new Error('系统规则更新内容不能为空。');
  }

  entries.forEach(([field, value]) => {
    if (SYSTEM_RULE_PROTECTED_FIELDS.has(field)) {
      throw new Error(`系统规则字段不允许更新：${field}`);
    }

    const normalizedField = normalizeRuleUpdateField(field);
    const isAllowedConfigField = SYSTEM_RULE_CONFIG_UPDATE_FIELDS.has(normalizedField);
    const isAllowedStatusField = allowStatus && SYSTEM_RULE_STATUS_UPDATE_FIELDS.has(normalizedField);

    if (!isAllowedConfigField && !isAllowedStatusField) {
      throw new Error(`系统规则字段不存在或不允许更新：${field}`);
    }

    normalizedUpdates[normalizedField] = normalizeRuleUpdateValue(normalizedField, value);
  });

  return normalizedUpdates;
};

const toSystemRuleDto = (rule) => {
  const ruleConfigJson = rule.ruleConfigJson ?? rule.rule_config_json;

  return {
    id: Number(rule.id),
    ruleType: rule.ruleType ?? rule.rule_type,
    ruleName: rule.ruleName ?? rule.rule_name,
    ruleConfigJson,
    ruleConfig: parseJsonValue(ruleConfigJson, null),
    versionNo: rule.versionNo ?? rule.version_no,
    status: rule.status,
    createdBy: rule.createdBy ?? rule.created_by,
    approvedBy: rule.approvedBy ?? rule.approved_by,
    createdAt: rule.createdAt ?? rule.created_at,
    updatedAt: rule.updatedAt ?? rule.updated_at
  };
};

const getSystemRuleRow = (database, ruleId) => getRow(database, `
  SELECT
    id,
    rule_type,
    rule_name,
    rule_config_json,
    version_no,
    status,
    created_by,
    approved_by,
    created_at,
    updated_at
  FROM system_rules
  WHERE id = :ruleId;
`, {
  ':ruleId': ruleId
});

const getSystemRuleRows = (database) => allRows(database, `
  SELECT
    id,
    rule_type,
    rule_name,
    rule_config_json,
    version_no,
    status,
    created_by,
    approved_by,
    created_at,
    updated_at
  FROM system_rules
  ORDER BY updated_at DESC, id ASC;
`);

const writeSystemRuleAuditLog = (database, {
  userId,
  operationType,
  ruleId,
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
      '系统设置',
      :operationType,
      'system_rules',
      :ruleId,
      :beforeJson,
      :afterJson,
      :remark,
      :createdAt
    );
  `, {
    ':userId': userId,
    ':operationType': operationType,
    ':ruleId': ruleId,
    ':beforeJson': JSON.stringify(beforeRow),
    ':afterJson': JSON.stringify(afterRow),
    ':remark': remark,
    ':createdAt': createdAt
  });
};

const applySystemRuleUpdate = async (ruleId, updates, operator = {}, options = {}, auditOptions = {}) => {
  const numericRuleId = ensureRuleId(ruleId);
  const normalizedUpdates = normalizeSystemRuleUpdates(updates, {
    allowStatus: Boolean(auditOptions.allowStatus)
  });
  const { database, databasePath } = await openDatabase(options);
  let transactionStarted = false;

  try {
    database.run('PRAGMA foreign_keys = ON;');
    database.run('BEGIN TRANSACTION;');
    transactionStarted = true;

    const beforeRow = getSystemRuleRow(database, numericRuleId);

    if (!beforeRow) {
      throw new Error(`系统规则不存在，无法更新：${numericRuleId}`);
    }

    const now = getCurrentTimestamp();
    const setFragments = Object.keys(normalizedUpdates).map((field) => `${field} = :${field}`);
    const params = {
      ':ruleId': numericRuleId,
      ':updated_at': now
    };

    Object.entries(normalizedUpdates).forEach(([field, value]) => {
      params[`:${field}`] = value;
    });

    database.run(`
      UPDATE system_rules
      SET
        ${setFragments.join(',\n        ')},
        updated_at = :updated_at
      WHERE id = :ruleId;
    `, params);

    const afterRow = getSystemRuleRow(database, numericRuleId);
    const operationType = auditOptions.operationType || '更新系统规则';
    const remark = auditOptions.remark || '更新系统规则';

    writeSystemRuleAuditLog(database, {
      userId: getOperatorUserId(operator),
      operationType,
      ruleId: numericRuleId,
      beforeRow,
      afterRow,
      remark,
      createdAt: now
    });

    const auditLogId = Number(getRow(database, 'SELECT last_insert_rowid() AS id;').id);

    database.run('COMMIT;');
    transactionStarted = false;
    saveDatabase(database, databasePath);

    return {
      rule: toSystemRuleDto(afterRow),
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

const getSystemSettingsData = async (options = {}) => {
  const { database } = await openDatabase(options);

  try {
    database.run('PRAGMA foreign_keys = ON;');

    const users = allRows(database, `
      SELECT
        u.id,
        u.username,
        u.display_name AS displayName,
        u.role_id AS roleId,
        r.role_name AS roleName,
        u.department,
        u.status,
        u.created_at AS createdAt,
        u.updated_at AS updatedAt
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      ORDER BY u.id ASC;
    `);

    const roles = allRows(database, `
      SELECT
        id,
        role_name AS roleName,
        description,
        permissions_json AS permissionsJson,
        status,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM roles
      ORDER BY id ASC;
    `).map((role) => ({
      id: role.id,
      roleName: role.roleName,
      description: role.description,
      permissions: normalizePermissions(role.permissionsJson),
      status: role.status,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt
    }));

    const systemRules = getSystemRuleRows(database).map(toSystemRuleDto);

    const auditLogs = allRows(database, `
      SELECT
        a.id,
        a.user_id AS userId,
        u.username,
        u.display_name AS displayName,
        a.module_name AS moduleName,
        a.operation_type AS operationType,
        a.target_table AS targetTable,
        a.target_id AS targetId,
        a.remark,
        a.created_at AS createdAt
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 20;
    `);

    return {
      stats: {
        usersTotal: countRows(database, 'SELECT COUNT(*) AS count FROM users;'),
        activeUsers: countRows(database, `SELECT COUNT(*) AS count FROM users WHERE ${activeWhereClause('status')};`),
        rolesTotal: countRows(database, 'SELECT COUNT(*) AS count FROM roles;'),
        activeRules: countRows(database, `SELECT COUNT(*) AS count FROM system_rules WHERE ${activeWhereClause('status')};`),
        auditLogsTotal: countRows(database, 'SELECT COUNT(*) AS count FROM audit_logs;')
      },
      users,
      roles,
      systemRules,
      auditLogs
    };
  } finally {
    database.close();
  }
};

const getSystemRulesData = async (options = {}) => {
  const { database, databasePath } = await openDatabase(options);

  try {
    database.run('PRAGMA foreign_keys = ON;');

    return {
      systemRules: getSystemRuleRows(database).map(toSystemRuleDto),
      databasePath
    };
  } finally {
    database.close();
  }
};

const updateSystemRule = (ruleId, updates, operator = {}, options = {}) => applySystemRuleUpdate(
  ruleId,
  updates,
  operator,
  options,
  {
    operationType: '更新系统规则',
    remark: '更新系统规则'
  }
);

const normalizeEnabledValue = (enabled) => {
  if (typeof enabled === 'boolean') {
    return enabled;
  }

  if (enabled === 1 || enabled === '1') {
    return true;
  }

  if (enabled === 0 || enabled === '0') {
    return false;
  }

  const normalized = String(enabled ?? '').trim().toLowerCase();

  if (['true', 'active', 'enabled', 'enable', 'on', '启用', '生效'].includes(normalized)) {
    return true;
  }

  if (['false', 'inactive', 'disabled', 'disable', 'off', '暂停', '停用'].includes(normalized)) {
    return false;
  }

  throw new Error('系统规则启停值无效，必须是明确的启用或停用状态。');
};

const toggleSystemRule = (ruleId, enabled, operator = {}, options = {}) => {
  const shouldEnable = normalizeEnabledValue(enabled);

  return applySystemRuleUpdate(
    ruleId,
    { status: shouldEnable ? 'active' : 'inactive' },
    operator,
    options,
    {
      operationType: '启停系统规则',
      remark: shouldEnable ? '启用系统规则' : '停用系统规则',
      allowStatus: true
    }
  );
};

module.exports = {
  getSystemSettingsData,
  getSystemRulesData,
  updateSystemRule,
  toggleSystemRule,
  ACTIVE_STATUSES
};
