import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';

import { startApiServer } from './apiServer.js';
import { tabManager } from '../server/tabManager.js';

const DEV_APP_URL = 'http://127.0.0.1:5173';
const PROD_APP_URL = 'http://127.0.0.1:3000';

let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  const isDev = !app.isPackaged && process.env.NODE_ENV === 'development';
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    useContentSize: true,
    resizable: true,
    movable: true,
    frame: true,
    autoHideMenuBar: true,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: isWindows ? {
      color: '#18181B',
      symbolColor: '#CBD5E1',
      height: 40,
    } : false,
    backgroundColor: '#09090B',
    webPreferences: {
      preload: join(app.getAppPath(), 'dist-electron', 'preload', 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
    },
  });

  tabManager.setWindow(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(isDev ? DEV_APP_URL : PROD_APP_URL);
}

ipcMain.handle('gb:activate-tab', async (_event, { tabId, bounds }) => {
  if (!tabId || !bounds) {
    return { success: false, reason: 'INVALID_INPUT' };
  }

  tabManager.setActiveTab(tabId, bounds);
  return { success: true };
});

ipcMain.handle('gb:navigate', async (_event, { tabId, url }) => {
  if (!tabId || !url) {
    return { success: false, reason: 'INVALID_INPUT' };
  }

  try {
    return await tabManager.navigateTab(tabId, url);
  } catch (error: any) {
    return { success: false, reason: error.message || 'NAVIGATION_FAILED' };
  }
});

ipcMain.handle('gb:window-minimize', () => {
  mainWindow?.minimize();
  return { success: true };
});

ipcMain.handle('gb:window-toggle-maximize', () => {
  if (!mainWindow) {
    return { success: false };
  }

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }

  return { success: true, maximized: mainWindow.isMaximized() };
});

ipcMain.handle('gb:window-close', () => {
  mainWindow?.close();
  return { success: true };
});

ipcMain.handle('gb:window-close-tab', async (_event, { tabId }) => {
  if (!tabId) {
    return { success: false, reason: 'INVALID_INPUT' };
  }

  const result = await tabManager.closeTab(tabId);
  return { success: true, nextActiveTabId: result.nextActiveTabId };
});

ipcMain.on('gb:heartbeat', (event, data) => {
  tabManager.handleHeartbeat(event.sender, data || {});
});

app.whenReady().then(async () => {
  await startApiServer();

  if (tabManager.getAllTabs().length === 0) {
    tabManager.createTabSync('default');
  }

  await createWindow();

  console.log('Electron main process ready.');
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
