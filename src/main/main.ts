import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';

import { startApiServer } from './apiServer.js';
import { profileStore } from './profileStore.js';
import { tabManager } from '../server/tabManager.js';

const DEV_APP_URL = 'http://127.0.0.1:5173';
const PROD_APP_URL = 'http://127.0.0.1:3000';

let mainWindow: BrowserWindow | null = null;

interface StartupArgs {
  profile?: string;
  url?: string;
  createProfile: boolean;
  noDefaultTab: boolean;
}

function parseStartupArgs(argv: string[]): StartupArgs {
  const args: StartupArgs = { createProfile: false, noDefaultTab: false };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--profile') {
      args.profile = argv[index + 1];
      index += 1;
    } else if (item.startsWith('--profile=')) {
      args.profile = item.slice('--profile='.length);
    } else if (item === '--url') {
      args.url = argv[index + 1];
      index += 1;
    } else if (item.startsWith('--url=')) {
      args.url = item.slice('--url='.length);
    } else if (item === '--create-profile') {
      args.createProfile = true;
    } else if (item === '--no-default-tab') {
      args.noDefaultTab = true;
    }
  }

  return args;
}

function resolveStartupProfile(args: StartupArgs) {
  if (!args.profile) {
    return profileStore.getActive() || profileStore.get('default');
  }

  const existing = profileStore.get(args.profile);
  if (existing) {
    profileStore.setActive(existing.id);
    return existing;
  }

  if (args.createProfile) {
    const created = profileStore.create(args.profile);
    profileStore.setActive(created.id);
    return created;
  }

  throw new Error(`Startup profile not found: ${args.profile}`);
}

async function createWindow() {
  const isDev = !app.isPackaged && process.env.NODE_ENV === 'development';
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    show: true,
    width: 1280,
    height: 800,
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

ipcMain.handle('gb:tab-back', async (_event, { tabId }) => {
  if (!tabId) {
    return { success: false, reason: 'INVALID_INPUT' };
  }

  try {
    return await tabManager.goBack(tabId);
  } catch (error: any) {
    return { success: false, reason: error.message || 'BACK_FAILED' };
  }
});

ipcMain.handle('gb:tab-forward', async (_event, { tabId }) => {
  if (!tabId) {
    return { success: false, reason: 'INVALID_INPUT' };
  }

  try {
    return await tabManager.goForward(tabId);
  } catch (error: any) {
    return { success: false, reason: error.message || 'FORWARD_FAILED' };
  }
});

ipcMain.handle('gb:tab-reload', async (_event, { tabId, hard }) => {
  if (!tabId) {
    return { success: false, reason: 'INVALID_INPUT' };
  }

  try {
    return await tabManager.reload(tabId, Boolean(hard));
  } catch (error: any) {
    return { success: false, reason: error.message || 'RELOAD_FAILED' };
  }
});

ipcMain.handle('gb:tab-stop', async (_event, { tabId }) => {
  if (!tabId) {
    return { success: false, reason: 'INVALID_INPUT' };
  }

  try {
    return await tabManager.stop(tabId);
  } catch (error: any) {
    return { success: false, reason: error.message || 'STOP_FAILED' };
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

ipcMain.handle('gb:focus-shell', () => {
  if (!mainWindow) {
    return { success: false };
  }

  mainWindow.focus();
  mainWindow.webContents.focus();
  return { success: true };
});

ipcMain.handle('gb:zoom-adjust', (_event, { direction }) => {
  if (direction !== 'in' && direction !== 'out') {
    return { success: false, reason: 'INVALID_DIRECTION' };
  }

  const zoomFactor = tabManager.adjustZoom(direction);
  return { success: true, zoomFactor };
});

ipcMain.handle('gb:zoom-reset', () => {
  const zoomFactor = tabManager.resetZoom();
  return { success: true, zoomFactor };
});

ipcMain.handle('gb:zoom-get', () => {
  return { success: true, zoomFactor: tabManager.getZoomFactor() };
});

ipcMain.on('gb:heartbeat', (event, data) => {
  tabManager.handleHeartbeat(event.sender, data || {});
});

ipcMain.on('gb:shortcut-triggered', (_event, payload) => {
  mainWindow?.webContents.send('gb:shortcut-triggered', payload);
});

app.whenReady().then(async () => {
  const startupArgs = parseStartupArgs(process.argv.slice(1));
  const startupProfile = resolveStartupProfile(startupArgs);

  await startApiServer();
  await createWindow();

  if (startupProfile && startupArgs.url) {
    const tabId = tabManager.createTabSync(startupProfile.id, startupArgs.url);
    tabManager.focusTab(tabId);
  } else if (!startupArgs.noDefaultTab && tabManager.getAllTabs().length === 0) {
    const tabId = tabManager.createTabSync(startupProfile?.id || 'default');
    tabManager.focusTab(tabId);
  }

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
