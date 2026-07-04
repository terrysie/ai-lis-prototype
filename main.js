const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { initializeDatabase } = require('./src/database/initDatabase');
const { getDashboardStats } = require('./src/database/dashboardStats');
const {
  getSampleReceptionData,
  getSampleReceptionHistory,
  confirmSampleReception,
  rejectSampleReception,
  createSampleRecollectionTask
} = require('./src/database/sampleReception');
const { getAiPreReviewData, getInfectiousAlertsData, handleInfectiousAlert } = require('./src/database/aiPreReview');
const { getResultReviewData, approveResultReview, rejectResultReview } = require('./src/database/resultReview');
const { getReportPreviewData, generateReportHtml, exportReportHtml } = require('./src/database/reportOutput');
const { getReportPublishPreview, publishReport } = require('./src/database/reportPublish');
const {
  getCriticalValuesData,
  notifyCriticalValue,
  acknowledgeCriticalValue,
  completeCriticalValue
} = require('./src/database/criticalValues');
const {
  getQcDashboardData,
  getQcEventsData,
  getReagentExpiryAlertsData,
  handleQcEvent,
  handleReagentExpiryAlert
} = require('./src/database/qcDashboard');
const {
  getSystemSettingsData,
  getSystemRulesData,
  updateSystemRule,
  toggleSystemRule
} = require('./src/database/systemSettings');

// Desktop demo context only; this is not production authentication or authorization.
const defaultActionGuardContext = {
  operatorId: 'demo_operator',
  role: 'demo_operator',
  mode: 'demo'
};

const sensitiveActionGuards = {
  sampleReceptionConfirm: {
    actionName: '样本签收确认',
    suggestedRoles: ['technician', 'lab_manager'],
    requiresAuditLog: true,
    requiresConfirmation: false,
    demoOperatorAllowed: true
  },
  sampleReceptionReject: {
    actionName: '样本退样',
    suggestedRoles: ['technician', 'lab_manager'],
    requiresAuditLog: true,
    requiresConfirmation: true,
    demoOperatorAllowed: true
  },
  sampleRecollectionCreate: {
    actionName: '创建补采任务',
    suggestedRoles: ['technician', 'lab_manager'],
    requiresAuditLog: true,
    requiresConfirmation: true,
    demoOperatorAllowed: true
  },
  resultReviewApprove: {
    actionName: '结果审核通过',
    suggestedRoles: ['reviewer', 'lab_manager'],
    requiresAuditLog: true,
    requiresConfirmation: true,
    demoOperatorAllowed: true
  },
  resultReviewReject: {
    actionName: '结果审核退回',
    suggestedRoles: ['reviewer', 'lab_manager'],
    requiresAuditLog: true,
    requiresConfirmation: true,
    demoOperatorAllowed: true
  },
  criticalValueNotify: {
    actionName: '危急值通知记录',
    suggestedRoles: ['technician', 'lab_manager', 'reviewer'],
    requiresAuditLog: true,
    requiresConfirmation: true,
    demoOperatorAllowed: true
  },
  criticalValueAcknowledge: {
    actionName: '危急值临床确认',
    suggestedRoles: ['lab_manager', 'reviewer'],
    requiresAuditLog: true,
    requiresConfirmation: true,
    demoOperatorAllowed: true
  },
  criticalValueComplete: {
    actionName: '危急值闭环确认',
    suggestedRoles: ['lab_manager', 'reviewer'],
    requiresAuditLog: true,
    requiresConfirmation: true,
    demoOperatorAllowed: true
  },
  reportPublish: {
    actionName: '报告发布',
    suggestedRoles: ['reviewer', 'lab_manager'],
    requiresAuditLog: true,
    requiresConfirmation: true,
    demoOperatorAllowed: true
  },
  reportExport: {
    actionName: '报告导出',
    suggestedRoles: ['reviewer', 'lab_manager'],
    requiresAuditLog: true,
    requiresConfirmation: true,
    demoOperatorAllowed: true
  },
  reportPrint: {
    actionName: '报告打印',
    suggestedRoles: ['reviewer', 'lab_manager'],
    requiresAuditLog: true,
    requiresConfirmation: true,
    demoOperatorAllowed: true
  },
  qcEventHandle: {
    actionName: '质控事件处理',
    suggestedRoles: ['technician', 'lab_manager'],
    requiresAuditLog: true,
    requiresConfirmation: true,
    demoOperatorAllowed: true
  },
  reagentExpiryHandle: {
    actionName: '试剂近效期预警处理',
    suggestedRoles: ['technician', 'lab_manager'],
    requiresAuditLog: true,
    requiresConfirmation: true,
    demoOperatorAllowed: true
  },
  infectiousAlertHandle: {
    actionName: '传染病阳性预警处理',
    suggestedRoles: ['lab_manager', 'reviewer'],
    requiresAuditLog: true,
    requiresConfirmation: true,
    demoOperatorAllowed: true
  },
  systemRuleCreate: {
    actionName: '系统规则新增',
    suggestedRoles: ['system_admin'],
    requiresAuditLog: true,
    requiresConfirmation: true,
    demoOperatorAllowed: false
  },
  systemRuleEdit: {
    actionName: '系统规则编辑',
    suggestedRoles: ['system_admin'],
    requiresAuditLog: true,
    requiresConfirmation: true,
    demoOperatorAllowed: false
  },
  systemRuleToggle: {
    actionName: '系统规则启用 / 停用',
    suggestedRoles: ['system_admin'],
    requiresAuditLog: true,
    requiresConfirmation: true,
    demoOperatorAllowed: false
  }
};

function guardSensitiveAction(actionKey, context = {}) {
  if (!actionKey) {
    throw new Error('缺少敏感操作 actionKey。');
  }

  const guard = sensitiveActionGuards[actionKey];
  if (!guard) {
    throw new Error(`未知敏感操作：${actionKey}`);
  }

  const guardContext = {
    ...defaultActionGuardContext,
    ...context
  };
  const operatorId = String(guardContext.operatorId || defaultActionGuardContext.operatorId);
  const role = String(guardContext.role || defaultActionGuardContext.role);
  const mode = String(guardContext.mode || defaultActionGuardContext.mode);

  if (mode !== 'demo') {
    if (role === 'demo_operator' && guard.demoOperatorAllowed === false) {
      throw new Error(`${guard.actionName} 不允许 demo_operator 在非 demo 模式执行。`);
    }

    if (!guard.suggestedRoles.includes(role)) {
      throw new Error(`${guard.actionName} 需要角色 ${guard.suggestedRoles.join(', ')}，当前角色为 ${role}。`);
    }
  }

  return {
    actionKey,
    actionName: guard.actionName,
    operatorId,
    role,
    mode,
    requiresAuditLog: guard.requiresAuditLog
  };
}

const createMainWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    title: 'TERRY-LIS 实验室信息管理系统',
    backgroundColor: '#f4f8fb',
    resizable: true,
    maximizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
};

ipcMain.handle('dashboard:getStats', async () => getDashboardStats({ electronApp: app }));
ipcMain.handle('sampleReception:getData', async () => getSampleReceptionData({ electronApp: app }));
ipcMain.handle('sampleReception:getHistory', async (_event, sampleId) => getSampleReceptionHistory(sampleId, { electronApp: app }));
ipcMain.handle('sampleReception:confirm', async (_event, sampleId) => {
  guardSensitiveAction('sampleReceptionConfirm');
  return confirmSampleReception(
    sampleId,
    { userId: 3, username: 'li.receive' },
    { electronApp: app }
  );
});
ipcMain.handle('sampleReception:reject', async (_event, sampleId, reason) => {
  guardSensitiveAction('sampleReceptionReject');
  return rejectSampleReception(
    sampleId,
    reason,
    { userId: 3, username: 'li.receive' },
    { electronApp: app }
  );
});
ipcMain.handle('sampleReception:createRecollectionTask', async (_event, sampleId, reason) => {
  guardSensitiveAction('sampleRecollectionCreate');
  return createSampleRecollectionTask(
    sampleId,
    reason,
    { userId: 3, username: 'li.receive' },
    { electronApp: app }
  );
});
ipcMain.handle('aiPreReview:getData', async () => getAiPreReviewData({ electronApp: app }));
ipcMain.handle('infectiousAlerts:getData', async () => getInfectiousAlertsData({ electronApp: app }));
ipcMain.handle('infectiousAlerts:handle', async (_event, alertId, handling) => {
  guardSensitiveAction('infectiousAlertHandle');
  return handleInfectiousAlert(
    alertId,
    handling,
    { userId: 1, username: 'admin' },
    { electronApp: app }
  );
});
ipcMain.handle('resultReview:getData', async () => getResultReviewData({ electronApp: app }));
ipcMain.handle('resultReview:approve', async (_event, reviewId) => {
  guardSensitiveAction('resultReviewApprove');
  return approveResultReview(
    reviewId,
    { userId: 2, username: 'chen.review' },
    { electronApp: app }
  );
});
ipcMain.handle('resultReview:reject', async (_event, reviewId, reason) => {
  guardSensitiveAction('resultReviewReject');
  return rejectResultReview(
    reviewId,
    reason,
    { userId: 2, username: 'chen.review' },
    { electronApp: app }
  );
});
ipcMain.handle('reportOutput:getPreview', async (_event, resultId) => getReportPreviewData(
  resultId,
  { electronApp: app }
));
ipcMain.handle('reportOutput:generateHtml', async (_event, resultId) => generateReportHtml(
  resultId,
  { userId: 2, username: 'chen.review' },
  { electronApp: app }
));
ipcMain.handle('reportOutput:exportHtml', async (_event, resultId) => {
  guardSensitiveAction('reportExport');
  return exportReportHtml(
    resultId,
    { userId: 2, username: 'chen.review' },
    { electronApp: app }
  );
});
ipcMain.handle('reportPublish:getPreview', async (_event, resultId) => getReportPublishPreview(
  resultId,
  { electronApp: app }
));
ipcMain.handle('reportPublish:publish', async (_event, resultId) => {
  guardSensitiveAction('reportPublish');
  return publishReport(
    resultId,
    { userId: 2, username: 'chen.review' },
    { electronApp: app }
  );
});
ipcMain.handle('criticalValues:getData', async () => getCriticalValuesData({ electronApp: app }));
ipcMain.handle('criticalValues:notify', async (_event, notificationId, remark) => {
  guardSensitiveAction('criticalValueNotify');
  return notifyCriticalValue(
    notificationId,
    remark,
    { userId: 4, username: 'wang.qc' },
    { electronApp: app }
  );
});
ipcMain.handle('criticalValues:acknowledge', async (_event, notificationId) => {
  guardSensitiveAction('criticalValueAcknowledge');
  return acknowledgeCriticalValue(
    notificationId,
    { userId: 4, username: 'wang.qc' },
    { electronApp: app }
  );
});
ipcMain.handle('criticalValues:complete', async (_event, notificationId, resolution) => {
  guardSensitiveAction('criticalValueComplete');
  return completeCriticalValue(
    notificationId,
    resolution,
    { userId: 4, username: 'wang.qc' },
    { electronApp: app }
  );
});
ipcMain.handle('qcDashboard:getData', async () => getQcDashboardData({ electronApp: app }));
ipcMain.handle('qcEvents:getData', async () => getQcEventsData({ electronApp: app }));
ipcMain.handle('qcEvents:handle', async (_event, eventId, handling) => {
  guardSensitiveAction('qcEventHandle');
  return handleQcEvent(
    eventId,
    handling,
    { userId: 1, username: 'admin' },
    { electronApp: app }
  );
});
ipcMain.handle('reagentExpiryAlerts:getData', async () => getReagentExpiryAlertsData({ electronApp: app }));
ipcMain.handle('reagentExpiryAlerts:handle', async (_event, alertId, handling) => {
  guardSensitiveAction('reagentExpiryHandle');
  return handleReagentExpiryAlert(
    alertId,
    handling,
    { userId: 1, username: 'admin' },
    { electronApp: app }
  );
});
ipcMain.handle('systemSettings:getData', async () => getSystemSettingsData({ electronApp: app }));
ipcMain.handle('systemRules:getData', async () => getSystemRulesData({ electronApp: app }));
ipcMain.handle('systemRules:update', async (_event, ruleId, updates) => {
  guardSensitiveAction('systemRuleEdit');
  return updateSystemRule(
    ruleId,
    updates,
    { userId: 1, username: 'admin' },
    { electronApp: app }
  );
});
ipcMain.handle('systemRules:toggle', async (_event, ruleId, enabled) => {
  guardSensitiveAction('systemRuleToggle');
  return toggleSystemRule(
    ruleId,
    enabled,
    { userId: 1, username: 'admin' },
    { electronApp: app }
  );
});

app.whenReady().then(async () => {
  try {
    const { databasePath } = await initializeDatabase({ electronApp: app });
    console.log(`TERRY-LIS 本地数据库路径：${databasePath}`);
  } catch (error) {
    console.error('TERRY-LIS 本地数据库初始化失败：', error);
  }

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
