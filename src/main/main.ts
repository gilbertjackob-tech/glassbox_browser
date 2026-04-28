import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';

let mainWindow: BrowserWindow | null = null;
const API_URL = 'http://localhost:3000';

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: join(app.getAppPath(), 'dist-electron', 'preload', 'preload.cjs'),
    },
    titleBarStyle: 'hidden',
  });

  mainWindow.on('resize', () => {
    // Resize events are handled by the frontend ResizeObserver
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(join(app.getAppPath(), 'dist', 'index.html'));
  }
}

// --- API ---
// All API endpoints are now provided by the backend server on port 3000
// This Electron main process focuses only on window management and IPC

// --- IPC ---
// IPC handlers for Electron-specific features
// Most API calls go through the frontend → backend API (port 3000)

ipcMain.handle('gb:activate-tab', (event, { tabId, bounds }) => {
  // Tab activation is handled by the backend and frontend
  // This is just a notification to the main process if needed
});

ipcMain.on('gb:heartbeat', (event, data) => {
  // Heartbeat IPC is now handled primarily by the preload script
  // and the backend API. No database operations needed in main process.
});

app.whenReady().then(async () => {
  await createWindow();
  
  console.log("Electron main process ready. Backend API should be running on port 3000.");
  console.log("Make sure to run 'npm run dev' in another terminal.");
});
