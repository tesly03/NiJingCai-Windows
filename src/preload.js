const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  onBluetoothDeviceList: (cb) => ipcRenderer.on('bluetooth-device-list', (e, list) => cb(list)),
  selectBluetoothDevice: (deviceId) => ipcRenderer.invoke('select-bluetooth-device', deviceId),
  cancelBluetoothRequest: () => ipcRenderer.invoke('cancel-bluetooth-request'),
  platform: process.platform,
});
