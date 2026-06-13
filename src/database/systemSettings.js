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

    const systemRules = allRows(database, `
      SELECT
        id,
        rule_type AS ruleType,
        rule_name AS ruleName,
        rule_config_json AS ruleConfigJson,
        version_no AS versionNo,
        status,
        created_by AS createdBy,
        approved_by AS approvedBy,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM system_rules
      ORDER BY updated_at DESC, id ASC;
    `).map((rule) => ({
      id: rule.id,
      ruleType: rule.ruleType,
      ruleName: rule.ruleName,
      ruleConfig: parseJsonValue(rule.ruleConfigJson, null),
      versionNo: rule.versionNo,
      status: rule.status,
      createdBy: rule.createdBy,
      approvedBy: rule.approvedBy,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt
    }));

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

module.exports = {
  getSystemSettingsData,
  ACTIVE_STATUSES
};
