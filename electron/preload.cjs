const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('apex', {
  appName: 'Apex',
});
