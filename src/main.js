// 尼精彩 Windows 客户端 - 主进程
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    title: '尼精彩',
    backgroundColor: '#f6f6f6',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webBluetooth: true,
      // 窗口最小化/被遮挡时也要保持 2 秒轮询定时器运行，否则状态栏会停止刷新
      backgroundThrottling: false,
    },
  });

  // Web Bluetooth 设备选择：拦截 Chromium 的默认设备选择弹窗，
  // 由渲染进程自己的设备列表 UI 完成选择。
  mainWindow.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
    event.preventDefault();
    // 将设备列表转发给渲染进程，由用户选择
    mainWindow.webContents.send('bluetooth-device-list', deviceList);
    // 保存 callback 供选择后调用
    app._bluetoothCallback = callback;
    if (deviceList.length === 0) {
      // 无设备时保持等待（扫描仍在继续）
    }
  });

  mainWindow.webContents.on('bluetooth-device-removed', (event, device) => {
    mainWindow.webContents.send('bluetooth-device-removed', device);
  });

  ipcMain.handle('select-bluetooth-device', (event, deviceId) => {
    const cb = app._bluetoothCallback;
    app._bluetoothCallback = null;
    if (cb) cb(deviceId);
  });

  ipcMain.handle('cancel-bluetooth-request', () => {
    const cb = app._bluetoothCallback;
    app._bluetoothCallback = null;
    if (cb) cb('');
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
