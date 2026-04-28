import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Box,
  Check,
  Database,
  Download,
  Globe,
  History,
  Monitor,
  Moon,
  Plus,
  RotateCw,
  Settings,
  Sun,
  Terminal,
  X,
} from 'lucide-react';

import { normalizeUrl, resolveNavigationInput, SEARCH_ENGINE_OPTIONS, type SearchEngineName } from './lib/urlUtils';

interface Tab {
  tabId: string;
  profileId: string;
  url: string;
  title: string;
}

interface Profile {
  id: string;
  name: string;
}

interface DomElement {
  tag: string;
  text?: string;
  role?: string;
  id?: string;
  selector?: string;
  bounds: { x: number; y: number; w: number; h: number };
}

interface ActionLog {
  id: string;
  action_type: string;
  intent: string;
  success: boolean;
  timestamp: string;
  reason?: string;
  before_dom_hash?: string;
  after_dom_hash?: string;
}

interface SavedPassword {
  id: string;
  profile_id: string;
  origin: string;
  username: string;
  password: string;
  created_at: string;
  updated_at: string;
}

type ThemePreference = 'system' | 'light' | 'dark';
type UtilityPanelId = 'memory' | 'skills' | 'bookmarks' | 'dom' | 'logs' | 'history' | 'downloads';

const utilityPanelConfigs: Array<{
  id: UtilityPanelId;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  { id: 'memory', label: 'Memory Search', description: 'Search history and skill memory.', icon: Database },
  { id: 'skills', label: 'Suggested Skills', description: 'Show matched automation skills.', icon: Activity },
  { id: 'bookmarks', label: 'Bookmark Cache', description: 'Show cached quick links.', icon: Bookmark },
  { id: 'dom', label: 'DOM Snapshot', description: 'Inspect scanned page elements.', icon: Terminal },
  { id: 'logs', label: 'Activity Log', description: 'Show recent automation actions.', icon: Activity },
  { id: 'history', label: 'Browsing History', description: 'Search visited pages.', icon: History },
  { id: 'downloads', label: 'Downloads', description: 'Review captured downloads.', icon: Download },
];

const themeOptions: Array<{
  value: ThemePreference;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Day', icon: Sun },
  { value: 'dark', label: 'Night', icon: Moon },
];

function getInitialThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  const saved = window.localStorage.getItem('gb-theme');
  return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
}

function getInitialUtilityPanels(): UtilityPanelId[] {
  if (typeof window === 'undefined') return [];

  try {
    const saved = JSON.parse(window.localStorage.getItem('gb-utility-panels') || '[]');
    if (!Array.isArray(saved)) return [];

    const validPanelIds = new Set(utilityPanelConfigs.map((panel) => panel.id));
    return saved.filter((panelId): panelId is UtilityPanelId => validPanelIds.has(panelId));
  } catch {
    return [];
  }
}

export default function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>('default');
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [domSnapshot, setDomSnapshot] = useState<DomElement[]>([]);
  const [logs, setLogs] = useState<ActionLog[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [downloads, setDownloads] = useState<any[]>([]);
  const [passwords, setPasswords] = useState<SavedPassword[]>([]);
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [downloadsSearchQuery, setDownloadsSearchQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any>(null);
  const [suggestedSkills] = useState<any[]>([]);
  const [searchEngine, setSearchEngine] = useState<SearchEngineName>('duckduckgo');
  const [isNavigating, setIsNavigating] = useState(false);
  const [navError, setNavError] = useState<string | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>(getInitialThemePreference);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [enabledPanels, setEnabledPanels] = useState<UtilityPanelId[]>(getInitialUtilityPanels);
  const [newProfileName, setNewProfileName] = useState('');
  const [passwordForm, setPasswordForm] = useState({ origin: '', username: '', password: '' });
  const browserViewRef = useRef<HTMLDivElement>(null);
  const hasInitializedRef = useRef(false);

  const activeTab = tabs.find((tab) => tab.tabId === activeTabId);

  const syncBrowserViewBounds = (tabIdToSync: string | null = activeTabId) => {
    if (!tabIdToSync || !browserViewRef.current || !(window as any).glassbox) return;

    const rect = browserViewRef.current.getBoundingClientRect();
    (window as any).glassbox.activateTab(tabIdToSync, {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  };

  useLayoutEffect(() => {
    if (!activeTabId || !browserViewRef.current) return;

    const observer = new ResizeObserver(() => syncBrowserViewBounds());
    observer.observe(browserViewRef.current);
    syncBrowserViewBounds();

    const rafId = requestAnimationFrame(() => syncBrowserViewBounds());
    const secondRafId = requestAnimationFrame(() => requestAnimationFrame(() => syncBrowserViewBounds()));
    const resizeHandler = () => syncBrowserViewBounds();

    window.addEventListener('resize', resizeHandler);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resizeHandler);
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(secondRafId);
    };
  }, [activeTabId, tabs.length, enabledPanels.length]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      const resolvedTheme = themePreference === 'system'
        ? (mediaQuery.matches ? 'dark' : 'light')
        : themePreference;

      document.documentElement.dataset.theme = resolvedTheme;
      document.documentElement.dataset.themePreference = themePreference;
      window.localStorage.setItem('gb-theme', themePreference);
    };

    applyTheme();
    mediaQuery.addEventListener('change', applyTheme);

    return () => mediaQuery.removeEventListener('change', applyTheme);
  }, [themePreference]);

  useEffect(() => {
    window.localStorage.setItem('gb-utility-panels', JSON.stringify(enabledPanels));
    requestAnimationFrame(() => syncBrowserViewBounds());
  }, [enabledPanels]);

  useEffect(() => {
    const init = async () => {
      if (hasInitializedRef.current) return;
      hasInitializedRef.current = true;

      try {
        const initialSettings = await fetchAppSettings();
        const initialProfileId = initialSettings.activeProfileId || 'default';
        setActiveProfileId(initialProfileId);
        await fetchProfiles();
        const initialTabs = await fetchTabs(initialProfileId);
        if (initialTabs.length === 0) {
          await createTab(undefined, initialProfileId);
        }
        await fetchLogs(initialProfileId);
        await fetchHistory('', initialProfileId);
        await fetchDownloads('', initialProfileId);
        await fetchPasswords(initialProfileId);
      } catch {
        // ignore init failures
      }
    };

    init();
  }, []);

  useEffect(() => {
    if (activeTab && activeTab.url !== 'about:blank' && !isNavigating) {
      setUrlInput(activeTab.url);
    } else if (!activeTab) {
      setUrlInput('');
    }
  }, [activeTab?.url, isNavigating]);

  useEffect(() => {
    if (!activeTabId) {
      setDomSnapshot([]);
      return;
    }

    requestAnimationFrame(() => syncBrowserViewBounds(activeTabId));
    updateActiveTabData(activeTabId);
  }, [activeTabId]);

  const fetchAppSettings = async () => {
    const res = await fetch('/api/settings');
    return await res.json();
  };

  const persistActiveProfile = async (profileId: string) => {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeProfileId: profileId }),
    });
  };

  const fetchProfiles = async () => {
    try {
      const res = await fetch('/api/profiles');
      setProfiles(await res.json());
    } catch {
      // ignore
    }
  };

  const fetchTabs = async (profileId?: string, preferredActiveTabId?: string | null) => {
    try {
      const res = await fetch('/api/tabs');
      const data = await res.json();
      const currentProfileId = profileId || activeProfileId;
      const filteredData = data.filter((tab: any) => tab.profileId === currentProfileId);

      setTabs(filteredData);
      setActiveTabId((currentActive) => {
        if (filteredData.length === 0) return null;
        if (preferredActiveTabId && filteredData.some((tab: Tab) => tab.tabId === preferredActiveTabId)) return preferredActiveTabId;
        if (filteredData.some((tab: Tab) => tab.tabId === currentActive)) return currentActive;
        return filteredData[0].tabId;
      });

      return filteredData as Tab[];
    } catch {
      return [] as Tab[];
    }
  };

  const createProfile = async (nameOverride?: string) => {
    const name = (nameOverride ?? prompt('Enter new profile name:') ?? '').trim();
    if (!name) return;

    const res = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    const newProfile = await res.json();
    await fetchProfiles();
    setNewProfileName('');
    await switchProfile(newProfile.id);
  };

  const renameProfile = async (profileId: string) => {
    const currentProfile = profiles.find((profile) => profile.id === profileId);
    const nextName = (prompt('Rename profile:', currentProfile?.name || '') ?? '').trim();
    if (!nextName) return;

    await fetch(`/api/profiles/${profileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nextName }),
    });

    await fetchProfiles();
  };

  const deleteProfile = async (profileId: string) => {
    if (profileId === 'default') return;
    if (!confirm('Delete this profile and its local data?')) return;

    const res = await fetch(`/api/profiles/${profileId}`, { method: 'DELETE' });
    const data = await res.json();
    await fetchProfiles();
    await switchProfile(data.activeProfileId || 'default');
  };

  const switchProfile = async (profileId: string) => {
    await persistActiveProfile(profileId);
    setActiveProfileId(profileId);
    const filteredData = await fetchTabs(profileId);
    await fetchLogs(profileId);
    await fetchHistory('', profileId);
    await fetchDownloads('', profileId);
    await fetchPasswords(profileId);

    if (filteredData.length === 0) {
      await createTab(undefined, profileId);
      return;
    }

    const nextActiveTabId = filteredData[0].tabId;
    setActiveTabId(nextActiveTabId);
    requestAnimationFrame(() => syncBrowserViewBounds(nextActiveTabId));
  };

  const fetchLogs = async (profileId: string = activeProfileId) => {
    try {
      const res = await fetch(`/api/memory/logs?profileId=${encodeURIComponent(profileId)}`);
      setLogs(await res.json());
    } catch {
      // ignore
    }
  };

  const fetchHistory = async (q: string = '', profileId: string = activeProfileId) => {
    try {
      const params = new URLSearchParams({ profileId });
      if (q) params.set('q', q);
      const queryStr = `?${params.toString()}`;
      const res = await fetch(`/api/memory/history${queryStr}`);
      setHistory(await res.json());
    } catch {
      // ignore
    }
  };

  const fetchDownloads = async (q: string = '', profileId: string = activeProfileId) => {
    try {
      const params = new URLSearchParams({ profileId });
      if (q) params.set('q', q);
      const queryStr = `?${params.toString()}`;
      const res = await fetch(`/api/memory/downloads${queryStr}`);
      setDownloads(await res.json());
    } catch {
      // ignore
    }
  };

  const fetchPasswords = async (profileId: string = activeProfileId) => {
    try {
      const res = await fetch(`/api/passwords?profileId=${encodeURIComponent(profileId)}`);
      setPasswords(await res.json());
    } catch {
      // ignore
    }
  };

  const searchMemory = async (q: string) => {
    setSearchQuery(q);
    if (q.length < 2) {
      setSearchResults(null);
      return;
    }

    const res = await fetch(`/api/memory/search?q=${encodeURIComponent(q)}&profileId=${encodeURIComponent(activeProfileId)}`);
    setSearchResults(await res.json());
  };

  const handleHistorySearch = (q: string) => {
    setHistorySearchQuery(q);
    fetchHistory(q);
  };

  const handleDownloadsSearch = (q: string) => {
    setDownloadsSearchQuery(q);
    fetchDownloads(q);
  };

  const clearHistory = async () => {
    await fetch(`/api/memory/history?profileId=${encodeURIComponent(activeProfileId)}`, { method: 'DELETE' });
    await fetchHistory('', activeProfileId);
  };

  const clearDownloads = async () => {
    await fetch(`/api/memory/downloads?profileId=${encodeURIComponent(activeProfileId)}`, { method: 'DELETE' });
    await fetchDownloads('', activeProfileId);
  };

  const savePassword = async () => {
    if (!passwordForm.origin.trim() || !passwordForm.username.trim() || !passwordForm.password) return;

    await fetch('/api/passwords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profileId: activeProfileId,
        origin: passwordForm.origin.trim(),
        username: passwordForm.username.trim(),
        password: passwordForm.password,
      }),
    });

    setPasswordForm({ origin: '', username: '', password: '' });
    await fetchPasswords(activeProfileId);
  };

  const deletePassword = async (passwordId: string) => {
    await fetch(`/api/passwords/${passwordId}`, { method: 'DELETE' });
    await fetchPasswords(activeProfileId);
  };

  const updateActiveTabData = async (specificTabId?: string) => {
    const id = specificTabId || activeTabId;
    if (!id) return;

    const domRes = await fetch(`/api/tabs/${id}/dom`);
    setDomSnapshot(await domRes.json());
  };

  const createTab = async (urlToAutoNavigate?: string, profileIdOverride?: string) => {
    const res = await fetch('/api/tabs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profileId: profileIdOverride || activeProfileId,
        initialUrl: urlToAutoNavigate?.trim() || undefined,
      }),
    });

    const { id: tabId } = await res.json();

    await fetchTabs(profileIdOverride || activeProfileId, tabId);
    setActiveTabId(tabId);
    requestAnimationFrame(() => syncBrowserViewBounds(tabId));

    return tabId;
  };

  const closeTab = async (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();

    const closeResult = await (window as any).windowControls?.closeTab?.(tabId);
    const nextActiveTabId = closeResult?.nextActiveTabId || null;

    await fetchTabs(activeProfileId, nextActiveTabId);
    setActiveTabId(nextActiveTabId);

    if (nextActiveTabId) {
      requestAnimationFrame(() => syncBrowserViewBounds(nextActiveTabId));
      updateActiveTabData(nextActiveTabId);
    } else {
      setDomSnapshot([]);
    }

    await fetchLogs(activeProfileId);
  };

  const executeNavigate = async (tabIdToUse: string, url: string) => {
    setNavError(null);
    setIsNavigating(true);

    const finalUrl = normalizeUrl(url);

    try {
      syncBrowserViewBounds(tabIdToUse);

      if ((window as any).api?.navigate) {
        const data = await (window as any).api.navigate(tabIdToUse, finalUrl);
        if (!data?.success) {
          setNavError(data?.reason || 'Navigation failed');
        } else {
          setTabs((prev) => prev.map((tab) => (tab.tabId === tabIdToUse ? { ...tab, url: finalUrl } : tab)));
          setUrlInput(finalUrl);
        }
      } else {
        const resp = await fetch('/api/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intent: `Navigate to ${finalUrl}`,
            tabId: tabIdToUse,
            profileId: activeProfileId,
            actionType: 'navigate',
            input: finalUrl,
          }),
        });

        const data = await resp.json();
        if (!resp.ok || !data.success) {
          setNavError(data.reason || data.error || 'Navigation failed');
        } else {
          setTabs((prev) => prev.map((tab) => (tab.tabId === tabIdToUse ? { ...tab, url: finalUrl } : tab)));
          setUrlInput(finalUrl);
        }
      }
    } catch {
      setNavError('Network error during navigation');
    }

    setIsNavigating(false);
    requestAnimationFrame(() => syncBrowserViewBounds(tabIdToUse));
    updateActiveTabData(tabIdToUse);
  };

  const navigate = async () => {
    if (!urlInput) return;

    const navigationTarget = resolveNavigationInput(urlInput.trim(), searchEngine);
    if (!navigationTarget.url) return;

    if (!activeTabId) {
      await createTab(navigationTarget.url);
      return;
    }

    await executeNavigate(activeTabId, navigationTarget.url);
  };

  const handleAction = async (type: 'click' | 'type', target: any, input?: string) => {
    if (!activeTabId) return;

    await fetch('/api/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: `${type === 'click' ? 'Click' : 'Type in'} element`,
        tabId: activeTabId,
        actionType: type,
        target,
        input,
      }),
    });

    updateActiveTabData();
    fetchLogs(activeProfileId);
  };

  const toggleUtilityPanel = (panelId: UtilityPanelId) => {
    setEnabledPanels((currentPanels) => (
      currentPanels.includes(panelId)
        ? currentPanels.filter((id) => id !== panelId)
        : [...currentPanels, panelId]
    ));
  };

  const renderUtilityPanel = (panelId: UtilityPanelId) => {
    switch (panelId) {
      case 'memory':
        return (
          <UtilityPanel key={panelId} title="Memory Search" icon={Database} onClose={() => toggleUtilityPanel(panelId)}>
            <input
              type="text"
              placeholder="Search history and skills..."
              value={searchQuery}
              onChange={(e) => searchMemory(e.target.value)}
              className="w-full rounded border border-gb-border bg-gb-bg px-2 py-1.5 text-[11px] text-gb-text outline-none transition-colors focus:border-gb-accent-primary"
            />
            <div className="mt-3 space-y-2">
              {Array.isArray(searchResults) && searchResults.length > 0 ? searchResults.slice(0, 8).map((result: any, index: number) => (
                <div key={`${result.type || 'result'}-${index}`} className="rounded border border-gb-border bg-gb-surface p-2">
                  <div className="truncate text-[11px] font-semibold text-gb-text">{result.title || result.name || result.type}</div>
                  <div className="mt-1 truncate text-[10px] text-gb-text-dim">{result.path || result.url || result.intent}</div>
                </div>
              )) : (
                <EmptyPanelState text={searchQuery.length >= 2 ? 'No memory results.' : 'Type at least two characters.'} />
              )}
            </div>
          </UtilityPanel>
        );

      case 'skills':
        return (
          <UtilityPanel key={panelId} title="Suggested Skills" icon={Activity} onClose={() => toggleUtilityPanel(panelId)}>
            <div className="space-y-2">
              {(suggestedSkills.length > 0 ? suggestedSkills : [
                { name: 'Order Lookup', match: '94%' },
                { name: 'Research Summary', match: '81%' },
              ]).map((skill: any, index: number) => (
                <div key={index} className="rounded border border-gb-border bg-gb-surface p-2">
                  <div className="text-[11px] font-semibold text-gb-text">{skill.name}</div>
                  <div className="mt-1 text-[10px] text-gb-text-dim">Match: {skill.match || 'High Confidence'}</div>
                </div>
              ))}
            </div>
          </UtilityPanel>
        );

      case 'bookmarks':
        return (
          <UtilityPanel key={panelId} title="Bookmark Cache" icon={Bookmark} onClose={() => toggleUtilityPanel(panelId)}>
            <div className="space-y-2 text-[11px]">
              {['Fiverr Dashboard', 'Google Search', 'Playwright Docs'].map((bookmark) => (
                <div key={bookmark} className="flex cursor-pointer items-center gap-2 truncate rounded border border-gb-border bg-gb-surface px-2 py-1.5 text-gb-text-dim hover:text-gb-text">
                  <Box size={12} /> {bookmark}
                </div>
              ))}
            </div>
          </UtilityPanel>
        );

      case 'dom':
        return (
          <UtilityPanel key={panelId} title="DOM Snapshot" icon={Terminal} onClose={() => toggleUtilityPanel(panelId)}>
            <div className="space-y-1.5 font-mono text-[9px]">
              {domSnapshot.length > 0 ? domSnapshot.slice(0, 50).map((el, index) => (
                <div key={index} className="rounded p-1 transition-colors hover:bg-gb-surface-bright">
                  <div className="text-gb-accent-primary">&lt;{el.tag} {el.role && `role="${el.role}"`}&gt;</div>
                  <div className="truncate pl-3 text-gb-text-dim">selector: {el.id ? `#${el.id}` : (el.selector || el.tag)}</div>
                </div>
              )) : (
                <EmptyPanelState text="No elements scanned." />
              )}
            </div>
          </UtilityPanel>
        );

      case 'logs':
        return (
          <UtilityPanel key={panelId} title="Activity Log" icon={Activity} onClose={() => toggleUtilityPanel(panelId)}>
            <div className="space-y-3 font-mono text-[9px]">
              {logs.length > 0 ? logs.map((log) => (
                <div key={log.id} className={`border-l-2 pl-2 ${log.success ? 'border-gb-accent-success' : 'border-red-500'}`}>
                  <div className="flex items-center justify-between gap-2 text-gb-text">
                    <span className="font-bold">{log.action_type.toUpperCase()}</span>
                    <span className="text-[8px] text-gb-text-dim">{new Date(log.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div className="mt-1 truncate text-[8px] text-gb-text-dim">Intent: {log.intent}</div>
                  {log.reason && <div className="mt-1 text-[8px] text-red-400">{log.reason}</div>}
                </div>
              )) : (
                <EmptyPanelState text="Log cache empty." />
              )}
            </div>
          </UtilityPanel>
        );

      case 'history':
        return (
          <UtilityPanel key={panelId} title="Browsing History" icon={History} onClose={() => toggleUtilityPanel(panelId)}>
            <input
              type="text"
              placeholder="Search history..."
              value={historySearchQuery}
              onChange={(e) => handleHistorySearch(e.target.value)}
              className="w-full rounded border border-gb-border bg-gb-bg px-2 py-1.5 text-[11px] text-gb-text outline-none transition-colors focus:border-gb-accent-primary"
            />
            <div className="mt-3 space-y-1.5 text-[10px]">
              {history.length > 0 ? history.map((item: any) => (
                <div key={item.id} className="rounded border border-gb-border bg-gb-surface p-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate font-semibold text-gb-text">{item.title || item.url}</span>
                    <span className="shrink-0 whitespace-nowrap text-[8px] text-gb-text-dim">
                      {new Date(item.last_visited).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-gb-accent-primary">{item.url}</div>
                </div>
              )) : (
                <EmptyPanelState text="No history matching query." />
              )}
            </div>
          </UtilityPanel>
        );

      case 'downloads':
        return (
          <UtilityPanel key={panelId} title="Downloads" icon={Download} onClose={() => toggleUtilityPanel(panelId)}>
            <input
              type="text"
              placeholder="Search downloads..."
              value={downloadsSearchQuery}
              onChange={(e) => handleDownloadsSearch(e.target.value)}
              className="w-full rounded border border-gb-border bg-gb-bg px-2 py-1.5 text-[11px] text-gb-text outline-none transition-colors focus:border-gb-accent-primary"
            />
            <div className="mt-3 space-y-1.5 text-[10px]">
              {downloads.length > 0 ? downloads.map((item: any) => (
                <div key={item.id} className="rounded border border-gb-border bg-gb-surface p-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate font-semibold text-gb-text">{item.file_name || item.filename}</span>
                    <span className="shrink-0 whitespace-nowrap text-[8px] text-gb-text-dim">
                      {new Date(item.timestamp || item.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-gb-accent-primary">{item.url}</div>
                </div>
              )) : (
                <EmptyPanelState text="No downloads matching query." />
              )}
            </div>
          </UtilityPanel>
        );
    }
  };

  void handleAction;

  return (
    <div className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden border border-gb-border bg-gb-bg font-sans text-sm text-gb-text">
      <header className="flex min-w-0 shrink-0 flex-col overflow-visible border-b border-gb-border">
        <div className="drag-region flex h-10 min-w-0 items-center gap-2 border-b border-gb-border bg-gb-surface px-2 py-1">
          <div className="no-drag scrollbar-hide flex min-w-0 items-center gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <div
                key={tab.tabId}
                onClick={() => setActiveTabId(tab.tabId)}
                className={`group no-drag flex min-w-[160px] max-w-[240px] shrink-0 cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 transition-all ${
                  activeTabId === tab.tabId
                    ? 'border-gb-border bg-gb-bg text-gb-text'
                    : 'border-transparent text-gb-text-dim opacity-80 hover:border-gb-border hover:text-gb-text hover:opacity-100'
                }`}
              >
                <Globe size={12} className={activeTabId === tab.tabId ? 'text-gb-accent-primary' : ''} />
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                  {tab.url !== 'about:blank' ? tab.url.replace('https://', '').replace('www.', '') : 'New Tab'}
                </span>
                <button
                  type="button"
                  className="no-drag cursor-pointer text-gb-text-dim transition-colors hover:text-gb-text"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => closeTab(e, tab.tabId)}
                  aria-label={`Close ${tab.title || 'tab'}`}
                  title="Close tab"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={() => createTab()}
            className="no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gb-border bg-gb-surface-bright text-gb-text transition-colors hover:bg-gb-bg"
            type="button"
            aria-label="Open new tab"
            title="New tab"
          >
            <Plus size={14} />
          </button>

          <div className="min-w-8 flex-1" />
        </div>

        <div className="relative z-50 flex min-w-0 items-center gap-2 overflow-visible border-t border-gb-border bg-gb-bg p-2">
          <div className="flex shrink-0 gap-2 px-1 text-gb-text-dim">
            <button className="p-1 transition-colors hover:text-gb-text" title="Back"><ArrowLeft size={16} /></button>
            <button className="p-1 transition-colors hover:text-gb-text" title="Forward"><ArrowRight size={16} /></button>
            <button className="p-1 transition-colors hover:text-gb-text" title="Reload"><RotateCw size={16} /></button>
          </div>

          <div className="group flex min-w-[180px] flex-1 items-center rounded-full border border-gb-border bg-gb-surface px-4 py-1.5 transition-colors focus-within:border-gb-accent-primary">
            <span className="mr-2 shrink-0 text-xs text-gb-accent-success">LOCKED</span>
            <input
              type="text"
              value={urlInput}
              placeholder="https://..."
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && navigate()}
              className="h-4 min-w-0 flex-1 border-none bg-transparent p-0 font-mono text-[11px] text-gb-text outline-none placeholder:text-gb-text-dim"
            />
            {navError && <span className="ml-2 max-w-[150px] truncate text-[10px] text-red-400" title={navError}>{navError}</span>}
            {isNavigating && <RotateCw size={12} className="ml-2 animate-spin text-gb-accent-primary" />}
          </div>

          <div className="flex min-w-0 shrink items-center gap-2 pr-1">
            <div className="flex min-w-0 max-w-[210px] shrink items-center rounded border border-gb-border bg-gb-surface-bright px-2 py-1 text-[9px] font-bold text-gb-text transition-colors focus-within:border-gb-accent-primary">
              <div className="mr-2 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-blue-500"></div>
              <span className="mr-1 hidden shrink-0 opacity-60 lg:inline">PROFILE:</span>
              <select
                value={activeProfileId}
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    createProfile();
                  } else {
                    switchProfile(e.target.value);
                  }
                }}
                className="min-w-0 cursor-pointer appearance-none truncate border-none bg-transparent pr-3 uppercase text-gb-text outline-none"
                style={{ backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%228%22%20height%3D%225%22%20viewBox%3D%220%200%208%205%22%20fill%3D%22none%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cpath%20d%3D%22M4%205L0%200H8L4%205Z%22%20fill%3D%22%2364748B%22/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right center' }}
              >
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id} className="bg-gb-bg">{profile.name || profile.id}</option>
                ))}
                <option value="__new__" className="bg-gb-bg text-gb-accent-success">+ NEW PROFILE</option>
              </select>
            </div>

            <div className="flex min-w-0 max-w-[220px] shrink items-center rounded border border-gb-border bg-gb-surface-bright px-2 py-1 text-[9px] font-bold text-gb-text transition-colors focus-within:border-gb-accent-primary">
              <div className="mr-2 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500"></div>
              <span className="mr-1 hidden shrink-0 opacity-60 lg:inline">ENGINE:</span>
              <select
                value={searchEngine}
                onChange={(e) => setSearchEngine(e.target.value as SearchEngineName)}
                className="min-w-0 cursor-pointer appearance-none truncate border-none bg-transparent pr-3 uppercase text-gb-text outline-none"
                style={{ backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%228%22%20height%3D%225%22%20viewBox%3D%220%200%208%205%22%20fill%3D%22none%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cpath%20d%3D%22M4%205L0%200H8L4%205Z%22%20fill%3D%22%2364748B%22/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right center' }}
              >
                {SEARCH_ENGINE_OPTIONS.map((engine) => (
                  <option key={engine} value={engine} className="bg-gb-bg">
                    {engine === 'duckduckgo' ? 'DuckDuckGo' : engine.charAt(0).toUpperCase() + engine.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={navigate}
              className="shrink-0 rounded bg-gb-accent-primary px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-blue-500"
            >
              EXECUTE
            </button>

            <div>
              <button
                onClick={() => setSettingsOpen((open) => !open)}
                className={`inline-flex h-8 w-8 items-center justify-center rounded border border-gb-border transition-colors ${
                  settingsOpen ? 'bg-gb-accent-primary text-white' : 'bg-gb-surface-bright text-gb-text hover:bg-gb-surface'
                }`}
                type="button"
                aria-label="Open settings"
                title="Settings"
              >
                <Settings size={15} />
              </button>
            </div>
          </div>
        </div>

        {settingsOpen && (
          <div className="no-drag border-t border-gb-border bg-gb-surface px-3 py-3 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-gb-text-dim">Settings</span>
              <div className="flex items-center gap-3">
                {enabledPanels.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setEnabledPanels([])}
                    className="text-[10px] font-medium text-gb-text-dim hover:text-gb-text"
                  >
                    Hide all
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="rounded p-1 text-gb-text-dim transition-colors hover:bg-gb-surface-bright hover:text-gb-text"
                  aria-label="Close settings"
                  title="Close settings"
                >
                  <X size={13} />
                </button>
              </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-[260px_320px_1fr]">
              <div>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gb-text-dim">Theme</div>
                <div className="grid grid-cols-3 gap-1 rounded-md border border-gb-border bg-gb-bg p-1">
                  {themeOptions.map((option) => {
                    const Icon = option.icon;
                    const isActive = themePreference === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setThemePreference(option.value)}
                        className={`flex items-center justify-center gap-1 rounded px-2 py-1.5 text-[10px] font-semibold transition-colors ${
                          isActive ? 'bg-gb-accent-primary text-white' : 'text-gb-text-dim hover:bg-gb-surface-bright hover:text-gb-text'
                        }`}
                      >
                        <Icon size={12} />
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gb-text-dim">Profiles</span>
                  <span className="text-[10px] text-gb-text-dim">Active: {profiles.find((profile) => profile.id === activeProfileId)?.name || activeProfileId}</span>
                </div>
                <div className="rounded-md border border-gb-border bg-gb-bg p-2">
                  <div className="mb-2 flex gap-2">
                    <input
                      type="text"
                      value={newProfileName}
                      onChange={(e) => setNewProfileName(e.target.value)}
                      placeholder="New profile name"
                      className="min-w-0 flex-1 rounded border border-gb-border bg-gb-surface px-2 py-1.5 text-[11px] text-gb-text outline-none focus:border-gb-accent-primary"
                    />
                    <button
                      type="button"
                      onClick={() => createProfile(newProfileName)}
                      className="shrink-0 rounded bg-gb-accent-primary px-3 py-1.5 text-[10px] font-semibold text-white"
                    >
                      Add
                    </button>
                  </div>
                  <div className="max-h-[220px] space-y-1 overflow-y-auto pr-1">
                    {profiles.map((profile) => (
                      <div key={profile.id} className="flex items-center gap-2 rounded border border-gb-border bg-gb-surface p-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11px] font-semibold text-gb-text">{profile.name}</div>
                          <div className="truncate text-[10px] text-gb-text-dim">{profile.id === 'default' ? 'Default local profile' : profile.id}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => switchProfile(profile.id)}
                          className={`rounded px-2 py-1 text-[10px] font-semibold ${
                            profile.id === activeProfileId ? 'bg-gb-accent-primary text-white' : 'bg-gb-surface-bright text-gb-text'
                          }`}
                        >
                          {profile.id === activeProfileId ? 'Active' : 'Use'}
                        </button>
                        <button
                          type="button"
                          onClick={() => renameProfile(profile.id)}
                          className="rounded bg-gb-surface-bright px-2 py-1 text-[10px] font-semibold text-gb-text"
                        >
                          Rename
                        </button>
                        {profile.id !== 'default' && (
                          <button
                            type="button"
                            onClick={() => deleteProfile(profile.id)}
                            className="rounded bg-red-500/15 px-2 py-1 text-[10px] font-semibold text-red-400"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gb-text-dim">Utility Panels</div>
                <div className="grid max-h-[220px] gap-1 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
                  {utilityPanelConfigs.map((panel) => {
                    const Icon = panel.icon;
                    const enabled = enabledPanels.includes(panel.id);

                    return (
                      <button
                        key={panel.id}
                        type="button"
                        onClick={() => toggleUtilityPanel(panel.id)}
                        className={`flex min-w-0 items-start gap-2 rounded border p-2 text-left transition-colors ${
                          enabled
                            ? 'border-gb-accent-primary bg-gb-accent-primary/10'
                            : 'border-gb-border bg-gb-bg hover:bg-gb-surface-bright'
                        }`}
                      >
                        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                          enabled ? 'border-gb-accent-primary bg-gb-accent-primary text-white' : 'border-gb-border text-gb-text-dim'
                        }`}>
                          {enabled ? <Check size={12} /> : <Icon size={12} />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[11px] font-semibold text-gb-text">{panel.label}</span>
                          <span className="block truncate text-[10px] text-gb-text-dim">{panel.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1fr_1.2fr]">
              <section className="rounded-md border border-gb-border bg-gb-bg p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gb-text-dim">History</span>
                  <button
                    type="button"
                    onClick={clearHistory}
                    className="rounded bg-gb-surface-bright px-2 py-1 text-[10px] font-semibold text-gb-text"
                  >
                    Clear
                  </button>
                </div>
                <div className="mb-2 text-[10px] text-gb-text-dim">{history.length} entries in this profile.</div>
                <div className="space-y-1">
                  {history.slice(0, 4).map((item: any) => (
                    <div key={item.id} className="rounded border border-gb-border bg-gb-surface p-2">
                      <div className="truncate text-[11px] font-semibold text-gb-text">{item.title || item.url}</div>
                      <div className="mt-1 truncate text-[10px] text-gb-text-dim">{item.url}</div>
                    </div>
                  ))}
                  {history.length === 0 && <EmptyPanelState text="No local history for this profile." />}
                </div>
              </section>

              <section className="rounded-md border border-gb-border bg-gb-bg p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gb-text-dim">Downloads</span>
                  <button
                    type="button"
                    onClick={clearDownloads}
                    className="rounded bg-gb-surface-bright px-2 py-1 text-[10px] font-semibold text-gb-text"
                  >
                    Clear
                  </button>
                </div>
                <div className="mb-2 text-[10px] text-gb-text-dim">{downloads.length} entries in this profile.</div>
                <div className="space-y-1">
                  {downloads.slice(0, 4).map((item: any) => (
                    <div key={item.id} className="rounded border border-gb-border bg-gb-surface p-2">
                      <div className="truncate text-[11px] font-semibold text-gb-text">{item.file_name || item.filename}</div>
                      <div className="mt-1 truncate text-[10px] text-gb-text-dim">{item.url}</div>
                    </div>
                  ))}
                  {downloads.length === 0 && <EmptyPanelState text="No local downloads for this profile." />}
                </div>
              </section>

              <section className="rounded-md border border-gb-border bg-gb-bg p-3">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gb-text-dim">Password Manager</div>
                <div className="mb-2 grid gap-2 md:grid-cols-3">
                  <input
                    type="text"
                    value={passwordForm.origin}
                    onChange={(e) => setPasswordForm((current) => ({ ...current, origin: e.target.value }))}
                    placeholder="Site origin"
                    className="rounded border border-gb-border bg-gb-surface px-2 py-1.5 text-[11px] text-gb-text outline-none focus:border-gb-accent-primary"
                  />
                  <input
                    type="text"
                    value={passwordForm.username}
                    onChange={(e) => setPasswordForm((current) => ({ ...current, username: e.target.value }))}
                    placeholder="Username"
                    className="rounded border border-gb-border bg-gb-surface px-2 py-1.5 text-[11px] text-gb-text outline-none focus:border-gb-accent-primary"
                  />
                  <input
                    type="password"
                    value={passwordForm.password}
                    onChange={(e) => setPasswordForm((current) => ({ ...current, password: e.target.value }))}
                    placeholder="Password"
                    className="rounded border border-gb-border bg-gb-surface px-2 py-1.5 text-[11px] text-gb-text outline-none focus:border-gb-accent-primary"
                  />
                </div>
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[10px] text-gb-text-dim">Stored locally in SQLite for this profile.</span>
                  <button
                    type="button"
                    onClick={savePassword}
                    className="rounded bg-gb-accent-primary px-3 py-1.5 text-[10px] font-semibold text-white"
                  >
                    Save Credential
                  </button>
                </div>
                <div className="max-h-[220px] space-y-1 overflow-y-auto pr-1">
                  {passwords.map((entry) => (
                    <div key={entry.id} className="flex items-center gap-2 rounded border border-gb-border bg-gb-surface p-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] font-semibold text-gb-text">{entry.origin}</div>
                        <div className="truncate text-[10px] text-gb-text-dim">{entry.username}</div>
                      </div>
                      <div className="max-w-[120px] truncate text-[10px] text-gb-text-dim">••••••••</div>
                      <button
                        type="button"
                        onClick={() => deletePassword(entry.id)}
                        className="rounded bg-red-500/15 px-2 py-1 text-[10px] font-semibold text-red-400"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  {passwords.length === 0 && <EmptyPanelState text="No saved credentials for this profile." />}
                </div>
              </section>
            </div>

            {enabledPanels.length > 0 && (
              <div className="mt-3 grid gap-3 xl:grid-cols-3">
                {enabledPanels.map(renderUtilityPanel)}
              </div>
            )}
          </div>
        )}
      </header>

      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-black">
          <div
            ref={browserViewRef}
            className="relative flex h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden bg-black"
          >
            {!activeTabId && <div className="flex h-full items-center justify-center"></div>}
            {activeTabId && (
              <div className="pointer-events-none absolute right-2 top-2 z-50 flex items-center gap-2">
                <span className="rounded bg-emerald-500/80 px-1.5 py-0.5 text-[8px] font-bold text-white shadow-lg">LIVE VIEW</span>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function UtilityPanel({
  title,
  icon: Icon,
  onClose,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-gb-border bg-gb-surface">
      <div className="flex items-center justify-between border-b border-gb-border px-3 py-2">
        <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-gb-text">
          <Icon size={11} className="text-gb-accent-primary" />
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-gb-text-dim transition-colors hover:bg-gb-surface-bright hover:text-gb-text"
          aria-label={`Close ${title}`}
          title="Close panel"
        >
          <X size={12} />
        </button>
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function EmptyPanelState({ text }: { text: string }) {
  return (
    <div className="flex min-h-16 items-center justify-center rounded border border-dashed border-gb-border px-3 py-4 text-center text-[10px] italic text-gb-text-dim">
      {text}
    </div>
  );
}
