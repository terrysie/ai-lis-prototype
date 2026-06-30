const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('terryLisApi', {
  getDashboardStats: () => ipcRenderer.invoke('dashboard:getStats'),
  getSampleReceptionData: () => ipcRenderer.invoke('sampleReception:getData'),
  getSampleReceptionHistory: (sampleId) => ipcRenderer.invoke('sampleReception:getHistory', sampleId),
  confirmSampleReception: (sampleId) => ipcRenderer.invoke('sampleReception:confirm', sampleId),
  rejectSampleReception: (sampleId, reason) => ipcRenderer.invoke('sampleReception:reject', sampleId, reason),
  createSampleRecollectionTask: (sampleId, reason) => ipcRenderer.invoke('sampleReception:createRecollectionTask', sampleId, reason),
  getAiPreReviewData: () => ipcRenderer.invoke('aiPreReview:getData'),
  getResultReviewData: () => ipcRenderer.invoke('resultReview:getData'),
  approveResultReview: (reviewId) => ipcRenderer.invoke('resultReview:approve', reviewId),
  rejectResultReview: (reviewId, reason) => ipcRenderer.invoke('resultReview:reject', reviewId, reason),
  getReportPreviewData: (resultId) => ipcRenderer.invoke('reportOutput:getPreview', resultId),
  generateReportHtml: (resultId) => ipcRenderer.invoke('reportOutput:generateHtml', resultId),
  exportReportHtml: (resultId) => ipcRenderer.invoke('reportOutput:exportHtml', resultId),
  getCriticalValuesData: () => ipcRenderer.invoke('criticalValues:getData'),
  notifyCriticalValue: (notificationId, remark) => ipcRenderer.invoke('criticalValues:notify', notificationId, remark),
  acknowledgeCriticalValue: (notificationId) => ipcRenderer.invoke('criticalValues:acknowledge', notificationId),
  completeCriticalValue: (notificationId, resolution) => ipcRenderer.invoke('criticalValues:complete', notificationId, resolution),
  getQcDashboardData: () => ipcRenderer.invoke('qcDashboard:getData'),
  getSystemSettingsData: () => ipcRenderer.invoke('systemSettings:getData')
});
