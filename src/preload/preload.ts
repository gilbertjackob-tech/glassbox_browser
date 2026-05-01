import { ipcRenderer, contextBridge } from 'electron';
import CryptoJS from 'crypto-js';

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
  focusShell: () => ipcRenderer.invoke('gb:focus-shell')
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

// Fallback Heartbeat
setInterval(triggerScan, 2000);
