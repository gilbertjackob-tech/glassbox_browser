import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import express from 'express';
import cors from 'cors';
import { initDb, memory } from './memoryDb.js';
import db from './memoryDb.js';
import { tabManager } from '../server/tabManager.js';
import { actionExecutor } from '../server/actionExecutor.js';
import { memoryService } from '../server/memoryService.js';

let mainWindow: BrowserWindow | null = null;
const apiServer = express();
const PORT = 3001;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: join(app.getAppPath(), 'dist-electron', 'preload', 'preload.cjs'),
    },
    titleBarStyle: 'hidden',
  });

  tabManager.setWindow(mainWindow);

  mainWindow.on('resize', () => {
    // Force bounds sync on resize if we have an active tab
    // The frontend ResizeObserver handles primary positioning, 
    // but this ensures the native view stays pinned.
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(join(app.getAppPath(), 'dist', 'index.html'));
  }
}

// --- API ---
apiServer.use(cors());
apiServer.use(express.json());

apiServer.get('/api/profiles', (req, res) => {
  res.json(db.prepare('SELECT * FROM profiles').all());
});

apiServer.post('/api/profiles', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const id = uuidv4();
  db.prepare('INSERT INTO profiles (id, name, partition) VALUES (?, ?, ?)')
    .run(id, name, `persist:profile-${id}`);
  res.json({ id, name });
});

apiServer.get('/api/tabs', (req, res) => {
  res.json(tabManager.getAllTabs());
});

apiServer.get('/api/tabs/:tabId/dom', (req, res) => {
  const tab = tabManager.getTab(req.params.tabId);
  res.json(tab?.elements || []); 
});

apiServer.post('/api/tabs', async (req, res) => {
  const { profileId } = req.body;
  const id = tabManager.createTabSync(profileId);
  res.json({ id });
});

apiServer.post('/api/actions', async (req, res) => {
  const result = await actionExecutor.execute(req.body);
  res.json(result);
});

apiServer.get('/api/memory/search', async (req, res) => {
  const { q, profileId } = req.query;
  const results = memory.search(q as string, (profileId as string) || 'default');
  res.json(results);
});

// --- IPC ---
ipcMain.handle('navigate', (_, url) => {
  let activeTabId = tabManager.getActiveTabId();

  if (!activeTabId) {
    activeTabId = tabManager.createTabSync('default');
    const bounds = mainWindow?.getBounds();
    tabManager.setActiveTab(activeTabId, { x: 0, y: 80, width: bounds?.width || 1400, height: (bounds?.height || 900) - 80 });
  }

  const tab = tabManager.getTab(activeTabId);
  if (!tab) return;

  if (!url.startsWith('http')) {
    url = 'https://' + url;
  }

  console.log('Navigating:', url);
  tab.view.webContents.loadURL(url);
});

ipcMain.handle('gb:activate-tab', (event, { tabId, bounds }) => {
  tabManager.setActiveTab(tabId, bounds);
});

ipcMain.on('gb:heartbeat', (event, data) => {
  const { url, domHash, snapshot } = data;
  const tab = tabManager.findTabByWebContents(event.sender);
  if (tab) {
    const oldHash = tab.domHash;
    tab.url = url;
    tab.domHash = domHash;
    tab.elements = snapshot || [];

    // Persistence: Only save when dom_hash changes
    if (domHash !== oldHash) {
      db.prepare(`
        INSERT INTO dom_snapshots (id, tab_id, profile_id, url, dom_hash, snapshot_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        uuidv4(),
        tab.id,
        tab.profileId,
        url,
        domHash,
        JSON.stringify(snapshot)
      );
    }
  }
});

app.whenReady().then(async () => {
  initDb();
  await createWindow();
  
  // Auto-create default tab when app is ready
  const defaultTabId = tabManager.createTabSync('default');
  tabManager.setActiveTab(defaultTabId, { x: 0, y: 80, width: mainWindow?.getBounds().width || 1400, height: (mainWindow?.getBounds().height || 900) - 80 });
  console.log("Startup tab created:", defaultTabId);
  
  apiServer.listen(PORT, '0.0.0.0', () => {
    console.log(`GlassBox API listening on port ${PORT}`);
  });
});
