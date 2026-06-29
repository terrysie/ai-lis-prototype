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
  getCriticalValuesData: () => ipcRenderer.invoke('criticalValues:getData'),
  getQcDashboardData: () => ipcRenderer.invoke('qcDashboard:getData'),
  getSystemSettingsData: () => ipcRenderer.invoke('systemSettings:getData')
});
