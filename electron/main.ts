import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as net from 'net';

// 使用 Electron 内置 API 判断开发环境，避免依赖外部包
const isDev = !app.isPackaged;

// 后端模块延迟加载：必须在 app.whenReady 且设置 IMA_USER_DATA_DIR 之后
// 否则 server 端 config.ts 会在 asar 只读目录下初始化数据目录
let serverModule: { startServer: (port: number, clientDir?: string) => any } | null = null;

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

  // 设置用户数据目录到环境变量，供后端 config.ts 使用
  // 必须在 require 后端模块之前设置，避免初始化时回退到只读目录
  process.env.IMA_USER_DATA_DIR = app.getPath('userData');

  // 延迟加载后端模块（必须在 IMA_USER_DATA_DIR 设置后）
  if (!serverModule) {
    // @ts-ignore - 生产构建时存在
    serverModule = require('../server/dist/index.js');
  }

  const port = await findAvailablePort(37173);

  try {
    const clientDistPath = path.join(__dirname, '..', 'client', 'dist');

    console.log('[Backend] Starting on port:', port);
    console.log('[Backend] User data:', process.env.IMA_USER_DATA_DIR);
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

// IPC: 窗口控制
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

// IPC: 文件对话框
ipcMain.handle('dialog:openFile', async (_event, options = {}) => {
  if (!mainWindow) return { canceled: true, filePaths: [] };
  return dialog.showOpenDialog(mainWindow, options);
});

ipcMain.handle('dialog:openDirectory', async (_event, options = {}) => {
  if (!mainWindow) return { canceled: true, filePaths: [] };
  return dialog.showOpenDialog(mainWindow, { ...options, properties: ['openDirectory', ...(options.properties || [])] });
});

ipcMain.handle('dialog:saveFile', async (_event, options = {}) => {
  if (!mainWindow) return { canceled: true, filePath: '' };
  return dialog.showSaveDialog(mainWindow, options);
});

// IPC: 应用信息
ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:getName', () => app.getName());
ipcMain.handle('app:getPath', (_event, name: string) => app.getPath(name as any));
ipcMain.handle('app:isElectron', () => true);
ipcMain.handle('app:platform', () => process.platform);

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

// Quit when all windows are closed (except macOS)
app.on('window-all-closed', () => {
  // 关闭后端服务
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
