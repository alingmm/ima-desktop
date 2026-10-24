import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import * as path from 'path';
import * as net from 'net';

// ========== 全局异常兜底：捕获后记录日志，绝不让异常直接终止应用 ==========
// 后端 Express 运行在主进程内，任何未捕获异常/未处理 Promise rejection 都会导致闪退
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

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

function buildApplicationMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{ label: 'IMA 工作台', submenu: [
          { role: 'about' as const, label: '关于 IMA 工作台' },
          { type: 'separator' as const },
          { role: 'hide' as const, label: '隐藏 IMA 工作台' },
          { role: 'quit' as const, label: '退出 IMA 工作台' },
        ] } as Electron.MenuItemConstructorOptions]
      : []),
    {
      label: '文件',
      submenu: [
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'forceReload', label: '强制刷新' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'close', label: '关闭' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(port: number): void {
  buildApplicationMenu();
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: true,
    title: 'IMA 工作台',
    backgroundColor: '#0f1419',
    show: false,
    resizable: true,
    maximizable: true,
    minimizable: true,
    fullscreenable: true,
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
    // 后端启动失败时明确告知用户，避免只开一个空白窗口让人无从下手
    const detail = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox(
      '启动失败',
      `应用后台服务没能启动，界面将无法加载。\n\n原因：${detail}\n\n请尝试重启应用；若反复出现，请把本提示截图反馈给开发者。`
    );
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
