const path = require('path');
const { app, BrowserWindow } = require('electron');
const { initializeDatabase } = require('./src/database/initDatabase');

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
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
};

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
