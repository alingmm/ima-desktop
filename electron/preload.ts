import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // File dialogs
  openFile: (options?: any) => ipcRenderer.invoke('dialog:openFile', options),
  openDirectory: (options?: any) => ipcRenderer.invoke('dialog:openDirectory', options),
  saveFile: (options?: any) => ipcRenderer.invoke('dialog:saveFile', options),

  // App info
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getName: () => ipcRenderer.invoke('app:getName'),
  getPath: (name: string) => ipcRenderer.invoke('app:getPath', name),
  isElectron: () => ipcRenderer.invoke('app:isElectron'),
  platform: () => ipcRenderer.invoke('app:platform'),
});
