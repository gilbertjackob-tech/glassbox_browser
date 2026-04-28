import db from '../main/memoryDb.js';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'path';
import { createRequire } from 'module';

const require = createRequire(typeof __filename === 'string' ? __filename : `${process.cwd()}\\src\\server\\tabManager.ts`);

// Defensive Electron import for Node/Vite preview
let app: any, BrowserWindow: any, BrowserView: any, session: any;
try {
  const electron = require('electron');
  if (!electron || !electron.app || !electron.session || !electron.BrowserView) {
    throw new Error('Electron components not found');
  }
  app = electron.app;
  BrowserWindow = electron.BrowserWindow;
  BrowserView = electron.BrowserView;
  session = electron.session;
} catch (e) {
  // Mock for web preview
  app = { getAppPath: () => process.cwd() };
  BrowserWindow = class {};
  BrowserView = class {
    webContents = {
      on: () => {},
      getURL: () => 'about:blank',
      loadURL: () => {},
      executeJavaScript: () => {}
    };
    setBounds() {}
    setAutoResize() {}
  };
  session = { fromPartition: () => ({}) };
}

interface TabMetadata {
  id: string;
  profileId: string;
  view: any; // BrowserView
  url: string;
  title: string;
  domHash: string;
  elements: any[];
}

class TabManager {
  private tabs: Map<string, TabMetadata> = new Map();
  private activeTabId: string | null = null;
  private window: any | null = null;

  setWindow(window: any) {
    this.window = window;
  }

  getActiveTabId() {
    return this.activeTabId;
  }

  createTabSync(profileId: string = 'default'): string {
    const id = uuidv4();
    const partition = `persist:gb_profile_${profileId}`;
    const sess = session.fromPartition(partition);

    const view = new BrowserView({
      webPreferences: {
        preload: join(app.getAppPath(), 'dist-electron', 'preload.js'),
        session: sess,
        contextIsolation: true,
        sandbox: true,
      }
    });

    const tab: TabMetadata = {
      id,
      profileId,
      view,
      url: 'about:blank',
      title: 'New Tab',
      domHash: '',
      elements: []
    };

    /** Persistence: Save tab into tabs table */
    db.prepare(`
      INSERT INTO tabs (id, profile_id, url, title)
      VALUES (?, ?, ?, ?)
    `).run(id, profileId, tab.url, tab.title);

    this.tabs.set(id, tab);

    view.webContents.on('did-start-loading', () => console.log("Loading started"));
    view.webContents.on('did-finish-load', () => console.log("Page loaded:", view.webContents.getURL()));

    // Sync metadata on navigation
    view.webContents.on('page-title-updated', (e, title) => {
      tab.title = title;
      this.syncHistory(profileId, view.webContents.getURL(), title);
      db.prepare('UPDATE tabs SET title = ?, last_active = CURRENT_TIMESTAMP WHERE id = ?').run(title, id);
    });

    view.webContents.on('did-navigate', (_, url) => {
      tab.url = url;
      this.syncHistory(profileId, url, tab.title);
      db.prepare('UPDATE tabs SET url = ?, last_active = CURRENT_TIMESTAMP WHERE id = ?').run(url, id);
    });

    view.webContents.on('did-navigate-in-page', (_, url) => {
      tab.url = url;
      this.syncHistory(profileId, url, tab.title);
      db.prepare('UPDATE tabs SET url = ?, last_active = CURRENT_TIMESTAMP WHERE id = ?').run(url, id);
    });

    return id;
  }

  getTab(id: string) {
    return this.tabs.get(id);
  }

  private syncHistory(profileId: string, url: string, title: string) {
    if (url === 'about:blank' || !url.startsWith('http')) return;
    db.prepare(`
      INSERT INTO history (id, profile_id, url, title, last_visited)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(profile_id, url) DO UPDATE SET 
        title = excluded.title,
        last_visited = CURRENT_TIMESTAMP,
        visit_count = visit_count + 1
    `).run(uuidv4(), profileId, url, title);
  }

  setActiveTab(id: string, bounds: { x: number; y: number; width: number; height: number }) {
    const tab = this.tabs.get(id);
    if (tab && this.window) {
      this.activeTabId = id;
      this.window.setBrowserView(tab.view);
      
      // Real bounds sync
      tab.view.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height)
      });
      tab.view.setAutoResize({ width: true, height: true });
    }
  }

  findTabByWebContents(wc: any) {
    for (const tab of this.tabs.values()) {
      if (tab.view.webContents === wc) return tab;
    }
    return null;
  }

  getAllTabs() {
    return Array.from(this.tabs.values()).map(t => ({
      tabId: t.id,
      profileId: t.profileId,
      url: t.url,
      title: t.title,
      domHash: t.domHash
    }));
  }

  async closeTab(id: string) {
    const tab = this.tabs.get(id);
    if (tab) {
      if (this.activeTabId === id) {
        this.window?.setBrowserView(null);
        this.activeTabId = null;
      }
      (tab.view.webContents as any).destroy();
      this.tabs.delete(id);
    }
  }
}

export const tabManager = new TabManager();
