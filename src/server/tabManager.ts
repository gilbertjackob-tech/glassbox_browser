import db from '../main/memoryDb.js';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'path';
import { createRequire } from 'module';

const require = createRequire(typeof __filename === 'string' ? __filename : `${process.cwd()}\\src\\server\\tabManager.ts`);

// Defensive Electron import for Node/Vite preview
let app: any, BrowserView: any, session: any;
try {
  const electron = require('electron');
  if (!electron || !electron.app || !electron.session || !electron.BrowserView) {
    throw new Error('Electron components not found');
  }
  app = electron.app;
  BrowserView = electron.BrowserView;
  session = electron.session;
} catch (e) {
  // Mock for web preview
  app = { getAppPath: () => process.cwd() };
  BrowserView = class {
    webContents = {
      on: () => {},
      getURL: () => 'about:blank',
      loadURL: async () => {},
      executeJavaScript: async () => {},
      insertText: () => {},
      removeAllListeners: () => {},
      isDestroyed: () => false,
      close: () => {},
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
  private lastBounds = { x: 0, y: 80, width: 1280, height: 720 };

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
        preload: join(app.getAppPath(), 'dist-electron', 'preload', 'preload.cjs'),
        session: sess,
        contextIsolation: true,
        sandbox: false,
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

    view.webContents.on('did-start-loading', () => console.log('Loading started'));
    view.webContents.on('did-finish-load', () => console.log('Page loaded:', view.webContents.getURL()));

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

  private clampBounds(bounds: { x: number; y: number; width: number; height: number }) {
    const normalized = {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
    };

    if (!this.window) {
      return normalized;
    }

    const contentBounds = typeof this.window.getContentBounds === 'function'
      ? this.window.getContentBounds()
      : this.window.getBounds();

    const maxWidth = Math.max(1, contentBounds.width - normalized.x);
    const maxHeight = Math.max(1, contentBounds.height - normalized.y);

    return {
      x: normalized.x,
      y: normalized.y,
      width: Math.min(normalized.width, maxWidth),
      height: Math.min(normalized.height, maxHeight),
    };
  }

  setActiveTab(id: string, bounds: { x: number; y: number; width: number; height: number }) {
    const tab = this.tabs.get(id);
    if (tab && this.window) {
      this.activeTabId = id;
      this.lastBounds = this.clampBounds(bounds);
      this.window.setBrowserView(tab.view);

      tab.view.setBounds(this.lastBounds);
      tab.view.setAutoResize({ width: true, height: true });
    }
  }

  async navigateTab(id: string, url: string) {
    const tab = this.tabs.get(id);
    if (!tab) {
      throw new Error('TAB_NOT_FOUND');
    }

    if (this.activeTabId !== id) {
      this.setActiveTab(id, this.lastBounds);
    }

    await tab.view.webContents.loadURL(url);
    return { success: true, url };
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

  handleHeartbeat(wc: any, data: { url?: string; title?: string; domHash?: string; snapshot?: any[] }) {
    const tab = this.findTabByWebContents(wc);
    if (!tab) return;

    const nextUrl = data.url || tab.url;
    const nextTitle = data.title || tab.title;
    const nextDomHash = data.domHash || '';
    const snapshot = Array.isArray(data.snapshot) ? data.snapshot : [];

    tab.url = nextUrl;
    tab.title = nextTitle;
    tab.elements = snapshot;

    if (tab.domHash === nextDomHash) {
      return;
    }

    tab.domHash = nextDomHash;

    db.prepare(`
      INSERT INTO dom_snapshots (id, tab_id, profile_id, url, dom_hash, snapshot_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      tab.id,
      tab.profileId,
      nextUrl,
      nextDomHash,
      JSON.stringify(snapshot)
    );
  }

  private destroyTabView(tab: TabMetadata) {
    if (this.window?.getBrowserView?.() === tab.view) {
      this.window.setBrowserView(null);
    }

    const webContents = tab.view.webContents as {
      isDestroyed: () => boolean;
      removeAllListeners: () => void;
      close: () => void;
    };

    if (!webContents.isDestroyed()) {
      webContents.removeAllListeners();
      webContents.close();
    }
  }

  async closeTab(id: string) {
    const tab = this.tabs.get(id);
    if (!tab) {
      return { nextActiveTabId: this.activeTabId };
    }

    const remainingTabs = Array.from(this.tabs.values()).filter((entry) => entry.id !== id);
    const nextActiveTabId = this.activeTabId === id ? (remainingTabs[0]?.id || null) : this.activeTabId;

    this.destroyTabView(tab);
    this.tabs.delete(id);
    db.prepare('DELETE FROM tabs WHERE id = ?').run(id);

    if (nextActiveTabId && this.window) {
      this.activeTabId = nextActiveTabId;
      this.setActiveTab(nextActiveTabId, this.lastBounds);
    } else if (this.activeTabId === id) {
      this.activeTabId = null;
      this.window?.setBrowserView(null);
    }

    return { nextActiveTabId };
  }
}

export const tabManager = new TabManager();
