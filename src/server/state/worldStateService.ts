/**
 * WorldState Service
 *
 * Captures the current state of GlassBox:
 * - Is the app running?
 * - Which profile is active?
 * - What tabs exist and which is focused?
 * - What site room is each tab in?
 * - What targets are currently visible?
 * - What was the last verified action?
 *
 * This is the foundation for resumable task planning.
 */

import type { TabManager } from '../tabManager';
import type { VLMPageApi } from '../vlmPageApi';

export interface TabSnapshot {
  tabId: string;
  url: string;
  host: string;
  title: string;
  focused: boolean;
  readyState?: 'loading' | 'interactive' | 'complete' | 'app_ready' | 'unknown';
  room?: string;
  lastVisitedAt?: string;
  diagnostics?: {
    isLoggedIn?: boolean;
    isAuthPage?: boolean;
    loadingIndicators?: string[];
  };
}

export interface VisibleTarget {
  key: string;
  label: string;
  role: string;
  selector?: string;
  bbox?: any;
  confidence: number;
  visible: boolean;
  enabled: boolean;
}

export interface WorldState {
  appRunning: boolean;
  timestamp: string;
  activeProfileId?: string;
  activeProfileEmail?: string;
  tabs: TabSnapshot[];
  focusedTabId?: string;
  visibleTargets: Array<VisibleTarget & { tabId: string }>;
  lastVerifiedAction?: {
    tabId: string;
    action: string;
    target?: string;
    timestamp: string;
  };
  suggestedResume?: {
    reason: string;
    skipReason?: string;
    nextAction?: string;
  };
}

export async function getWorldState(
  tabManager: TabManager,
  vlmPageApi: VLMPageApi,
  profileId?: string
): Promise<WorldState> {
  const tabs: TabSnapshot[] = [];
  let focusedTabId: string | undefined;
  const visibleTargets: Array<VisibleTarget & { tabId: string }> = [];

  // Gather tab snapshots
  const allTabs = tabManager.getTabs();
  for (const tab of allTabs) {
    if (profileId && tab.profileId !== profileId) {
      continue;
    }

    const url = tab.webContents.getURL();
    const host = extractHost(url);
    const title = tab.webContents.getTitle();

    const snapshot: TabSnapshot = {
      tabId: tab.id,
      url,
      host,
      title,
      focused: tab.webContents.isFocused(),
      readyState: await inferTabReadyState(tab),
    };

    if (snapshot.focused) {
      focusedTabId = tab.id;
    }

    // Try to detect site room
    try {
      // This would call detectSiteRoom if available in your codebase
      snapshot.room = detectSiteRoomFromTab(tab);
    } catch (e) {
      // Room detection failed, continue
    }

    tabs.push(snapshot);

    // Collect visible targets from focused tab
    if (snapshot.focused) {
      try {
        const targets = await vlmPageApi.query(tab.id, {
          limit: 100,
          interactableOnly: true,
        });

        if (targets.elements) {
          for (const el of targets.elements) {
            visibleTargets.push({
              tabId: tab.id,
              key: el.targetId || `elem_${Math.random().toString(36).slice(2, 9)}`,
              label: el.label || el.text || `${el.tagName}`,
              role: el.role || 'unknown',
              selector: el.selector,
              bbox: el.bbox,
              confidence: el.confidence || 0.9,
              visible: el.visible,
              enabled: el.interactable,
            });
          }
        }
      } catch (e) {
        // Query failed, continue without this tab's targets
      }
    }
  }

  const state: WorldState = {
    appRunning: allTabs.length > 0,
    timestamp: new Date().toISOString(),
    activeProfileId: profileId,
    tabs,
    focusedTabId,
    visibleTargets,
  };

  return state;
}

function extractHost(url: string): string {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return '';
  }
}

async function inferTabReadyState(
  tab: any
): Promise<'loading' | 'interactive' | 'complete' | 'app_ready' | 'unknown'> {
  try {
    // This is a stub; you'd integrate with your actual readiness detection
    // For now, return based on loading state
    if (tab.webContents.isLoading?.()) {
      return 'loading';
    }

    // Check if page has loaded
    const readyState = await tab.webContents.executeJavaScript(
      'document.readyState'
    );

    if (readyState === 'complete') {
      // Check for app-level readiness (e.g., React app mounted)
      const appReady = await tab.webContents.executeJavaScript(
        `Boolean(window.__APP_READY__ || 
                 document.querySelector('[data-reactroot], [data-react-root], #root.hydrated') ||
                 document.body.classList.contains('app-ready'))`
      );
      return appReady ? 'app_ready' : 'complete';
    }

    return readyState as any;
  } catch {
    return 'unknown';
  }
}

function detectSiteRoomFromTab(tab: any): string | undefined {
  try {
    const url = tab.webContents.getURL();
    const host = extractHost(url);

    // Simple room detection by URL pattern
    // This would be enhanced by actual detectSiteRoom logic
    if (host.includes('chatgpt.com')) return 'chatgpt_chat';
    if (host.includes('gemini.google.com')) return 'gemini_chat';
    if (host.includes('github.com')) return 'github_repo';
    if (host.includes('web.whatsapp.com')) return 'whatsapp_chat';
    if (host.includes('youtube.com')) return 'youtube_watch';
    if (host.includes('google.com/search')) return 'google_search';

    return undefined;
  } catch {
    return undefined;
  }
}

export function describeWorldState(state: WorldState): string {
  const parts: string[] = [];

  parts.push(`🌍 World State (${state.timestamp})`);
  parts.push(`App: ${state.appRunning ? '✓ Running' : '✗ Not running'}`);
  parts.push(`Profile: ${state.activeProfileId || 'none'}`);
  parts.push(
    `Tabs: ${state.tabs.length} (${state.focusedTabId ? 'focused: ' + state.focusedTabId : 'none focused'})`
  );

  for (const tab of state.tabs) {
    const badge = tab.focused ? '📌' : '  ';
    const room = tab.room ? ` [${tab.room}]` : '';
    parts.push(
      `${badge} ${tab.host || 'about'}${room} (${tab.readyState || 'unknown'})`
    );
  }

  if (state.visibleTargets.length > 0) {
    parts.push(`Visible targets: ${state.visibleTargets.length}`);
  }

  return parts.join('\n');
}
