import { ipcRenderer, contextBridge } from 'electron';
import CryptoJS from 'crypto-js';
import { parseShortcutEvent } from '../lib/shortcuts.js';

// --- GlassBox DOM Intelligence ---

function scanDOM() {
  const elements = Array.from(document.querySelectorAll('button, a, input, [role], [onclick], select, textarea')).slice(0, 500);
  const results = elements.map(el => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    return {
      tag: el.tagName.toLowerCase(),
      id: el.id,
      role: el.getAttribute('role'),
      text: (el.textContent || '').trim().substring(0, 100),
      aria: el.getAttribute('aria-label'),
      placeholder: el.getAttribute('placeholder'),
      type: (el as HTMLInputElement).type,
      bounds: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      visible: true,
      enabled: !(el as HTMLButtonElement).disabled,
      selector: getBestSelector(el)
    };
  }).filter(Boolean);

  const domHash = CryptoJS.SHA256(JSON.stringify(results)).toString();
  return { elements: results, hash: domHash };
}

function getBestSelector(el: Element): string {
  if (el.id) return `#${el.id}`;
  if (el.getAttribute('aria-label')) return `[aria-label="${el.getAttribute('aria-label')}"]`;
  if (el.getAttribute('role')) return `[role="${el.getAttribute('role')}"]`;
  if (el.tagName === 'INPUT' && el.getAttribute('name')) return `input[name="${el.getAttribute('name')}"]`;
  
  // Tag + index fallback
  const tag = el.tagName.toLowerCase();
  const index = Array.from(document.querySelectorAll(tag)).indexOf(el);
  return `${tag}:nth-of-type(${index + 1})`;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

function requestZoom(direction: 'in' | 'out') {
  void ipcRenderer.invoke('gb:zoom-adjust', { direction });
}

function isShellAppContext() {
  return window.location.origin === 'http://127.0.0.1:3000' || window.location.origin === 'http://127.0.0.1:5173';
}

function installZoomShortcuts() {
  window.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return;

    event.preventDefault();
    requestZoom(event.deltaY < 0 ? 'in' : 'out');
  }, { passive: false, capture: true });

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;

    if ((event.key === '0' && (event.ctrlKey || event.metaKey))) {
      event.preventDefault();
      void ipcRenderer.invoke('gb:zoom-reset');
      return;
    }

    if (isEditableTarget(event.target)) return;
    if (!event.shiftKey) return;

    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      requestZoom('in');
      return;
    }

    if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      requestZoom('out');
    }
  }, true);
}

function installShortcutForwarding() {
  if (isShellAppContext()) {
    ipcRenderer.on('gb:shortcut-triggered', (_event, payload) => {
      window.dispatchEvent(new CustomEvent('glassbox-shortcut', { detail: payload }));
    });
    return;
  }

  window.addEventListener('keydown', (event) => {
    const shortcut = parseShortcutEvent(event);
    if (!shortcut) return;

    const allowedShortcuts = new Set([
      'Ctrl+L',
      'Ctrl+K',
      'Alt+Left',
      'Alt+Right',
      'Ctrl+R',
      'Ctrl+Shift+R',
      'Esc',
      'Ctrl+T',
      'Ctrl+W',
      'Ctrl+Shift+T',
      'Ctrl+Tab',
      'Ctrl+Shift+Tab',
      'Alt+1',
      'Alt+2',
      'Alt+3',
      'Alt+4',
      'Alt+5',
      'Alt+6',
      'Alt+7',
      'Alt+8',
      'Alt+9',
      'Ctrl+Shift+P',
      'Ctrl+Alt+P',
      'Ctrl+Alt+E',
      'Ctrl+Alt+B',
      'Ctrl+Alt+N',
      'Ctrl+Alt+0',
      'Ctrl+,',
      'Ctrl+Alt+1',
      'Ctrl+Alt+2',
      'Ctrl+Alt+3',
      'Ctrl+Alt+4',
      'Ctrl+Alt+5',
      'Ctrl+Alt+6',
      'Ctrl+Alt+7',
      'Ctrl+Alt+8',
      'Ctrl+Shift+M',
      'Ctrl+Shift+H',
      'Ctrl+Shift+J',
      'Ctrl+Shift+O',
      'Ctrl+Shift+A',
      'Ctrl+Shift+U',
      'Ctrl+Alt+D',
      'Ctrl+Alt+H',
      'Ctrl+Alt+S',
      'Ctrl+Alt+A',
      'Ctrl+Alt+Q',
      'Ctrl+Alt+X',
      'Ctrl+Alt+C',
      'Ctrl+Alt+V',
      'Ctrl+Alt+R',
      'Ctrl+Alt+L',
      'Ctrl+Alt+Esc',
      'Ctrl+Alt+Space',
      'Ctrl+Alt+Backspace',
      'Ctrl+Alt+Z',
      'Ctrl+Shift+K',
    ]);

    if (!allowedShortcuts.has(shortcut)) return;

    const allowedInEditable = shortcut === 'Ctrl+L' || shortcut === 'Ctrl+K' || shortcut === 'Esc';
    if (isEditableTarget(event.target) && !allowedInEditable) return;

    event.preventDefault();
    ipcRenderer.send('gb:shortcut-triggered', { shortcut });
  }, true);
}

// Expose API to Window
contextBridge.exposeInMainWorld('glassbox', {
  getSnapshot: () => scanDOM(),
  activateTab: (tabId: string, bounds: any) => ipcRenderer.invoke('gb:activate-tab', { tabId, bounds })
});

contextBridge.exposeInMainWorld('api', {
  navigate: (tabId: string, url: string) => ipcRenderer.invoke('gb:navigate', { tabId, url })
});

contextBridge.exposeInMainWorld('windowControls', {
  minimize: () => ipcRenderer.invoke('gb:window-minimize'),
  toggleMaximize: () => ipcRenderer.invoke('gb:window-toggle-maximize'),
  close: () => ipcRenderer.invoke('gb:window-close'),
  closeTab: (tabId: string) => ipcRenderer.invoke('gb:window-close-tab', { tabId }),
  focusShell: () => ipcRenderer.invoke('gb:focus-shell'),
  tabBack: (tabId: string) => ipcRenderer.invoke('gb:tab-back', { tabId }),
  tabForward: (tabId: string) => ipcRenderer.invoke('gb:tab-forward', { tabId }),
  tabReload: (tabId: string, hard = false) => ipcRenderer.invoke('gb:tab-reload', { tabId, hard }),
  tabStop: (tabId: string) => ipcRenderer.invoke('gb:tab-stop', { tabId }),
  zoomIn: () => ipcRenderer.invoke('gb:zoom-adjust', { direction: 'in' }),
  zoomOut: () => ipcRenderer.invoke('gb:zoom-adjust', { direction: 'out' }),
  resetZoom: () => ipcRenderer.invoke('gb:zoom-reset'),
  getZoom: () => ipcRenderer.invoke('gb:zoom-get')
});

// Periodic Heartbeat to Main Process
let lastHash = '';
let scanTimeout: NodeJS.Timeout | null = null;
let lastScanTime = 0;
const THROTTLE_MS = 1000;

function triggerScan() {
  const now = Date.now();
  if (now - lastScanTime >= THROTTLE_MS) {
    performScan();
  } else if (!scanTimeout) {
    scanTimeout = setTimeout(() => {
      scanTimeout = null;
      performScan();
    }, THROTTLE_MS - (now - lastScanTime));
  }
}

function performScan() {
  lastScanTime = Date.now();
  try {
    const snapshot = scanDOM();
    if (snapshot.hash !== lastHash) {
      lastHash = snapshot.hash;
      ipcRenderer.send('gb:heartbeat', {
        url: window.location.href,
        title: document.title,
        domHash: snapshot.hash,
        snapshot: snapshot.elements
      });
    }
  } catch (e) {
    console.warn('GlassBox Preload Sync Failed', e);
  }
}

const observer = new MutationObserver(() => {
  triggerScan();
});

document.addEventListener('DOMContentLoaded', () => {
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  triggerScan();
});

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  triggerScan();
}

installZoomShortcuts();
installShortcutForwarding();

// Fallback Heartbeat
setInterval(triggerScan, 2000);
