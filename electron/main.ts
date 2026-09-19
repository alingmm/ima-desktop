import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as net from 'net';
import isDev from 'electron-is-dev';

// 静态引用后端模块，确保 electron-builder 能分析到依赖
// 开发环境下 server/dist 可能不存在，用动态 require 兜底
let serverModule: { startServer: (port: number, clientDir?: string) => any } | null = null;
if (!isDev) {
  // @ts-ignore - 生产构建时存在
  serverModule = require('../server/dist/index.js');
}

let mainWindow: BrowserWindow | null = null;
let httpServer: { close: () => void } | null = null;

// 查找可用端口
function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => {
      resolve(findAvailablePort(startPort + 1));
    });
    server.listen(startPort, () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

// 等待端口就绪
function waitForPort(port: number, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const check = () => {
      const client = net.connect({ port }, () => {
        client.end();
        resolve();
      });
      client.on('error', () => {
        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`Port ${port} not ready in ${timeoutMs}ms`));
        } else {
          setTimeout(check, 200);
        }
      });
    };
    check();
  });
}

// 启动后端服务（生产环境直接在主进程内启动 Express）
async function startBackend(): Promise<number> {
  if (isDev) {
    // 开发模式：Vite 已经在跑，用 5173
    return 5173;
  }

  const port = await findAvailablePort(37173);

  try {
    const clientDistPath = path.join(__dirname, '..', 'client', 'dist');

    console.log('[Backend] Starting on port:', port);
    console.log('[Backend] Client dist:', clientDistPath);

    if (!serverModule) {
      throw new Error('Server module not loaded');
    }

    httpServer = serverModule.startServer(port, clientDistPath);

    await waitForPort(port, 10000);
    console.log('[Backend] Server is ready on port', port);
    return port;
  } catch (err) {
    console.error('[Backend] Failed to start:', err);
    throw err;
  }
}

function createWindow(port: number): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    frame: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f1419',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Ready-to-show for smoother startup
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Load app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadURL(`http://localhost:${port}`);
  }

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App lifecycle
app.whenReady().then(async () => {
  try {
    const port = await startBackend();
    createWindow(port);
  } catch (err) {
    console.error('Failed to start backend:', err);
    // 显示错误窗口
    createWindow(0);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      app.whenReady().then(async () => {
        try {
          const port = await startBackend();
          createWindow(port);
        } catch (err) {
          console.error('Failed to start backend on activate:', err);
        }
      });
    }
  });
});

app.on('window-all-closed', () => {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
});

// ===== Window Control IPC =====
ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
  return mainWindow?.isMaximized() ?? false;
});

ipcMain.handle('window:close', () => {
  mainWindow?.close();
});

ipcMain.handle('window:isMaximized', () => {
  return mainWindow?.isMaximized() ?? false;
});

// ===== Dialog IPC =====
ipcMain.handle('dialog:openFile', async (_event, options = {}) => {
  if (!mainWindow) return { canceled: true, filePaths: [] };
  return dialog.showOpenDialog(mainWindow, options as Electron.OpenDialogOptions);
});

ipcMain.handle('dialog:openDirectory', async (_event, options = {}) => {
  if (!mainWindow) return { canceled: true, filePaths: [] };
  return dialog.showOpenDialog(mainWindow, {
    ...(options as Electron.OpenDialogOptions),
    properties: ['openDirectory'],
  });
});

ipcMain.handle('dialog:saveFile', async (_event, options = {}) => {
  if (!mainWindow) return { canceled: true, filePath: '' };
  return dialog.showSaveDialog(mainWindow, options as Electron.SaveDialogOptions);
});

// ===== App Info IPC =====
ipcMain.handle('app:getVersion', () => {
  return app.getVersion();
});

ipcMain.handle('app:getName', () => {
  return app.getName();
});

ipcMain.handle('app:getPath', (_event, name: string) => {
  return app.getPath(name as Parameters<typeof app.getPath>[0]);
});

ipcMain.handle('app:isElectron', () => {
  return true;
});

ipcMain.handle('app:platform', () => {
  return process.platform;
});
