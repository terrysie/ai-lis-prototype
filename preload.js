const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('terryLisApi', {
  getDashboardStats: () => ipcRenderer.invoke('dashboard:getStats'),
  getSampleReceptionData: () => ipcRenderer.invoke('sampleReception:getData'),
  getAiPreReviewData: () => ipcRenderer.invoke('aiPreReview:getData')
});
