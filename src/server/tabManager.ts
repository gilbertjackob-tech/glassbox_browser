import db from '../main/memoryDb.js';
import { profileStore } from '../main/profileStore.js';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'path';
import { createRequire } from 'module';

const require = createRequire(typeof __filename === 'string' ? __filename : `${process.cwd()}\\src\\server\\tabManager.ts`);
const DEFAULT_LANDING_URL = 'https://bing.com';
const MIN_ZOOM_FACTOR = 0.5;
const MAX_ZOOM_FACTOR = 3;
const ZOOM_STEP = 0.1;
const CHROME_WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const WHATSAPP_UA_PATCH_JS = `
(() => {
  try {
    Object.defineProperty(navigator, 'userAgent', {
      get: () => '${CHROME_WINDOWS_UA}',
      configurable: true
    });

    Object.defineProperty(navigator, 'appVersion', {
      get: () => '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      configurable: true
    });

    if (navigator.userAgentData) {
      Object.defineProperty(navigator, 'userAgentData', {
        get: () => ({
          brands: [
            { brand: 'Google Chrome', version: '142' },
            { brand: 'Chromium', version: '142' },
            { brand: 'Not A(Brand', version: '99' }
          ],
          mobile: false,
          platform: 'Windows',
          getHighEntropyValues: async () => ({
            brands: [
              { brand: 'Google Chrome', version: '142' },
              { brand: 'Chromium', version: '142' },
              { brand: 'Not A(Brand', version: '99' }
            ],
            mobile: false,
            platform: 'Windows',
            platformVersion: '10.0.0',
            architecture: 'x86',
            model: '',
            uaFullVersion: '142.0.0.0',
            fullVersionList: [
              { brand: 'Google Chrome', version: '142.0.0.0' },
              { brand: 'Chromium', version: '142.0.0.0' },
              { brand: 'Not A(Brand', version: '99.0.0.0' }
            ]
          })
        }),
        configurable: true
      });
    }
  } catch {}
})();
`;

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
      getUserAgent: () => '',
      setUserAgent: () => {},
      executeJavaScript: async () => {},
      insertText: () => {},
      capturePage: async () => ({ toPNG: () => Buffer.from([]), getSize: () => ({ width: 0, height: 0 }) }),
      sendInputEvent: () => {},
      removeAllListeners: () => {},
      isDestroyed: () => false,
      close: () => {},
    };
    setBounds() {}
    setAutoResize() {}
  };
  session = { fromPartition: () => ({ clearCache: async () => {}, clearStorageData: async () => {} }) };
}

const patchedSessions = new WeakSet<any>();

function shouldUseWhatsAppSpoof(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'web.whatsapp.com' || host.endsWith('.whatsapp.net');
  } catch {
    return false;
  }
}

function installWhatsAppUserAgentPatch(partitionSession: any) {
  if (!partitionSession || patchedSessions.has(partitionSession)) {
    return;
  }

  patchedSessions.add(partitionSession);

  if (!partitionSession.webRequest?.onBeforeSendHeaders) {
    return;
  }

  partitionSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://web.whatsapp.com/*', 'https://*.whatsapp.net/*'] },
    (details: any, callback: (response: { requestHeaders: Record<string, string> }) => void) => {
      const requestHeaders = { ...(details.requestHeaders || {}) };
      requestHeaders['User-Agent'] = CHROME_WINDOWS_UA;

      delete requestHeaders['sec-ch-ua'];
      delete requestHeaders['Sec-CH-UA'];
      delete requestHeaders['sec-ch-ua-mobile'];
      delete requestHeaders['Sec-CH-UA-Mobile'];
      delete requestHeaders['sec-ch-ua-platform'];
      delete requestHeaders['Sec-CH-UA-Platform'];
      delete requestHeaders['sec-ch-ua-platform-version'];
      delete requestHeaders['Sec-CH-UA-Platform-Version'];
      delete requestHeaders['sec-ch-ua-full-version'];
      delete requestHeaders['Sec-CH-UA-Full-Version'];
      delete requestHeaders['sec-ch-ua-full-version-list'];
      delete requestHeaders['Sec-CH-UA-Full-Version-List'];

      callback({ requestHeaders });
    }
  );
}

function applyWhatsAppIdentityForUrl(tab: TabMetadata, url: string) {
  if (!tab.webContents || typeof tab.webContents.setUserAgent !== 'function') {
    return;
  }

  const nextUserAgent = shouldUseWhatsAppSpoof(url)
    ? CHROME_WINDOWS_UA
    : tab.baseUserAgent || '';

  tab.webContents.setUserAgent(nextUserAgent);
}

async function patchWhatsAppNavigatorIdentity(tab: TabMetadata) {
  const currentUrl = typeof tab.webContents?.getURL === 'function' ? tab.webContents.getURL() : tab.url;
  if (!shouldUseWhatsAppSpoof(currentUrl) || typeof tab.webContents?.executeJavaScript !== 'function') {
    return;
  }

  await tab.webContents.executeJavaScript(WHATSAPP_UA_PATCH_JS, true).catch(() => {});
}

export interface TabMetadata {
  id: string;
  profileId: string;
  partition: string;
  view: any; // BrowserView
  webContents: any; // Electron.WebContents
  url: string;
  title: string;
  domHash: string;
  elements: any[];
  baseUserAgent: string;
}

class TabManager {
  private tabs: Map<string, TabMetadata> = new Map();
  private activeTabId: string | null = null;
  private window: any | null = null;
  private lastBounds = { x: 0, y: 80, width: 1280, height: 720 };
  private zoomFactor = 1;

  setWindow(window: any) {
    this.window = window;
    this.applyZoomFactorToWindow();
  }

  getActiveTabId() {
    return this.activeTabId;
  }

  getZoomFactor() {
    return this.zoomFactor;
  }

  private clampZoomFactor(nextZoomFactor: number) {
    return Math.min(MAX_ZOOM_FACTOR, Math.max(MIN_ZOOM_FACTOR, Number(nextZoomFactor.toFixed(2))));
  }

  private applyZoomFactorToWindow() {
    if (!this.window?.webContents || typeof this.window.webContents.setZoomFactor !== 'function') {
      return;
    }

    this.window.webContents.setZoomFactor(this.zoomFactor);
  }

  private applyZoomFactorToTab(tab: TabMetadata) {
    if (!tab?.webContents || typeof tab.webContents.setZoomFactor !== 'function') {
      return;
    }

    tab.webContents.setZoomFactor(this.zoomFactor);
  }

  private applyZoomFactorToAllTabs() {
    for (const tab of this.tabs.values()) {
      this.applyZoomFactorToTab(tab);
    }
  }

  setZoomFactor(nextZoomFactor: number) {
    this.zoomFactor = this.clampZoomFactor(nextZoomFactor);
    this.applyZoomFactorToWindow();
    this.applyZoomFactorToAllTabs();
    return this.zoomFactor;
  }

  adjustZoom(direction: 'in' | 'out') {
    const delta = direction === 'in' ? ZOOM_STEP : -ZOOM_STEP;
    return this.setZoomFactor(this.zoomFactor + delta);
  }

  resetZoom() {
    return this.setZoomFactor(1);
  }

  private getDefaultViewBounds() {
    if (!this.window) {
      return this.lastBounds;
    }

    const [width, height] = typeof this.window.getContentSize === 'function'
      ? this.window.getContentSize()
      : [1280, 800];

    const TOOLBAR_HEIGHT = 60;

    return {
      x: 0,
      y: TOOLBAR_HEIGHT,
      width: Math.max(1, width),
      height: Math.max(1, height - TOOLBAR_HEIGHT),
    };
  }

  createTabSync(profileId: string = 'default', initialUrl: string = DEFAULT_LANDING_URL): string {
    const profile = profileStore.get(profileId);
    if (!profile) {
      throw new Error('PROFILE_NOT_FOUND');
    }

    const id = uuidv4();
    const startUrl = initialUrl.trim() || DEFAULT_LANDING_URL;
    const partitionSession = session.fromPartition(profile.partition);
    installWhatsAppUserAgentPatch(partitionSession);

    const view = new BrowserView({
      webPreferences: {
        preload: join(app.getAppPath(), 'dist-electron', 'preload', 'preload.cjs'),
        partition: profile.partition,
        contextIsolation: true,
        sandbox: false,
      }
    });

    const tab: TabMetadata = {
      id,
      profileId: profile.id,
      partition: profile.partition,
      view,
      webContents: view.webContents,
      url: startUrl,
      title: startUrl === DEFAULT_LANDING_URL ? 'Bing' : 'New Tab',
      domHash: '',
      elements: [],
      baseUserAgent: typeof view.webContents.getUserAgent === 'function'
        ? view.webContents.getUserAgent()
        : ''
    };

    /** Persistence: Save tab into tabs table */
    db.prepare(`
      INSERT INTO tabs (id, profile_id, url, title)
      VALUES (?, ?, ?, ?)
    `).run(id, profile.id, tab.url, tab.title);

    this.tabs.set(id, tab);
    this.applyZoomFactorToTab(tab);

    tab.webContents.on('did-start-loading', () => console.log('Loading started'));
    tab.webContents.on('did-finish-load', () => console.log('Page loaded:', tab.webContents.getURL()));
    tab.webContents.on('dom-ready', () => {
      void patchWhatsAppNavigatorIdentity(tab);
    });

    // Sync metadata on navigation
    tab.webContents.on('page-title-updated', (_e: any, title: string) => {
      tab.title = title;
      this.syncHistory(profile.id, tab.webContents.getURL(), title);
      db.prepare('UPDATE tabs SET title = ?, last_active = CURRENT_TIMESTAMP WHERE id = ?').run(title, id);
    });

    tab.webContents.on('did-navigate', (_: any, url: string) => {
      tab.url = url;
      this.syncHistory(profile.id, url, tab.title);
      db.prepare('UPDATE tabs SET url = ?, last_active = CURRENT_TIMESTAMP WHERE id = ?').run(url, id);
    });

    tab.webContents.on('did-navigate-in-page', (_: any, url: string) => {
      tab.url = url;
      this.syncHistory(profile.id, url, tab.title);
      db.prepare('UPDATE tabs SET url = ?, last_active = CURRENT_TIMESTAMP WHERE id = ?').run(url, id);
    });

    applyWhatsAppIdentityForUrl(tab, startUrl);
    void tab.webContents.loadURL(startUrl).catch((error: any) => {
      console.warn('Default tab load failed:', error?.message || error);
    });

    return id;
  }

  getTab(id: string) {
    return this.tabs.get(id);
  }

  async goBack(id: string) {
    const tab = this.tabs.get(id);
    if (!tab) {
      throw new Error('TAB_NOT_FOUND');
    }

    if (typeof tab.webContents.canGoBack === 'function' && !tab.webContents.canGoBack()) {
      return { success: false, reason: 'NO_HISTORY_BACK' };
    }

    tab.webContents.goBack();
    return { success: true };
  }

  async goForward(id: string) {
    const tab = this.tabs.get(id);
    if (!tab) {
      throw new Error('TAB_NOT_FOUND');
    }

    if (typeof tab.webContents.canGoForward === 'function' && !tab.webContents.canGoForward()) {
      return { success: false, reason: 'NO_HISTORY_FORWARD' };
    }

    tab.webContents.goForward();
    return { success: true };
  }

  async reload(id: string, hard = false) {
    const tab = this.tabs.get(id);
    if (!tab) {
      throw new Error('TAB_NOT_FOUND');
    }

    if (hard && typeof tab.webContents.reloadIgnoringCache === 'function') {
      tab.webContents.reloadIgnoringCache();
    } else {
      tab.webContents.reload();
    }

    return { success: true };
  }

  async stop(id: string) {
    const tab = this.tabs.get(id);
    if (!tab) {
      throw new Error('TAB_NOT_FOUND');
    }

    if (typeof tab.webContents.stop === 'function') {
      tab.webContents.stop();
    }

    return { success: true };
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

  setActiveTab(id: string, bounds?: { x: number; y: number; width: number; height: number }) {
    const tab = this.tabs.get(id);
    if (!tab || !this.window) {
      return;
    }

    this.activeTabId = id;

    const attachedViews = typeof this.window.getBrowserViews === 'function'
      ? this.window.getBrowserViews()
      : [];

    for (const entry of this.tabs.values()) {
      if (entry.id !== id && attachedViews.includes(entry.view)) {
        this.window.removeBrowserView(entry.view);
      }
    }

    const refreshedAttachedViews = typeof this.window.getBrowserViews === 'function'
      ? this.window.getBrowserViews()
      : [];

    if (!refreshedAttachedViews.includes(tab.view)) {
      this.window.addBrowserView(tab.view);
    }

    const finalBounds = this.clampBounds(bounds || this.getDefaultViewBounds());
    this.lastBounds = finalBounds;

    tab.view.setBounds(finalBounds);
    tab.view.setAutoResize({ width: true, height: true });

    if (typeof this.window.focus === 'function') {
      this.window.focus();
    }
  }

  focusTab(id: string) {
    const tab = this.tabs.get(id);
    if (!tab) {
      throw new Error('TAB_NOT_FOUND');
    }

    this.setActiveTab(id);
    return {
      tabId: tab.id,
      profileId: tab.profileId,
      url: tab.url,
      title: tab.title,
    };
  }

  async navigateTab(id: string, url: string, timeoutMs = 15000) {
    const tab = this.tabs.get(id);
    if (!tab) {
      throw new Error('TAB_NOT_FOUND');
    }

    if (this.activeTabId !== id) {
      this.setActiveTab(id);
    }

    applyWhatsAppIdentityForUrl(tab, url);

    const waitForLoad = new Promise<void>((resolve) => {
      const done = () => resolve();
      tab.webContents.once('did-finish-load', done);
    });

    await tab.webContents.loadURL(url);

    await Promise.race([
      waitForLoad,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);

    tab.url = tab.webContents.getURL();

    return { success: true, url: tab.url };
  }

  findTabByWebContents(wc: any) {
    for (const tab of this.tabs.values()) {
      if (tab.webContents === wc) return tab;
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

  async clearProfileStorage(partition: string) {
    const sess = session.fromPartition(partition);
    if (typeof sess.clearCache === 'function') {
      await sess.clearCache();
    }
    if (typeof sess.clearStorageData === 'function') {
      await sess.clearStorageData({
        storages: ['cookies', 'filesystem', 'indexdb', 'localstorage', 'shadercache', 'websql', 'serviceworkers', 'cachestorage'],
      });
    }
    if (sess.cookies && typeof sess.cookies.flushStore === 'function') {
      await sess.cookies.flushStore();
    }
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
    if (this.window && typeof this.window.getBrowserViews === 'function') {
      const views = this.window.getBrowserViews();
      if (views.includes(tab.view)) {
        this.window.removeBrowserView(tab.view);
      }
    } else if (this.window?.getBrowserView?.() === tab.view) {
      this.window.setBrowserView(null);
    }

    const webContents = tab.webContents as {
      isDestroyed: () => boolean;
      removeAllListeners: () => void;
      destroy?: () => void;
      close: () => void;
    };

    if (!webContents.isDestroyed()) {
      webContents.removeAllListeners();

      if (typeof webContents.destroy === 'function') {
        webContents.destroy();
      } else if (typeof webContents.close === 'function') {
        webContents.close();
      }
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
      this.setActiveTab(nextActiveTabId);
    } else if (this.activeTabId === id) {
      this.activeTabId = null;
      if (this.window && typeof this.window.getBrowserViews === 'function') {
        for (const view of this.window.getBrowserViews()) {
          this.window.removeBrowserView(view);
        }
      } else {
        this.window?.setBrowserView(null);
      }
    }

    return { nextActiveTabId };
  }
}

export const tabManager = new TabManager();
