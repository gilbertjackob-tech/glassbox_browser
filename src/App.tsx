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
  Keyboard,
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
import {
  DEFAULT_SHORTCUTS,
  detectShortcutConflicts,
  formatShortcut,
  parseShortcutEvent,
  type ShortcutGroup,
  type ShortcutCommand,
} from './lib/shortcuts';

interface Tab {
  tabId: string;
  profileId: string;
  url: string;
  title: string;
}

interface Profile {
  id: string;
  name: string;
  email?: string | null;
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
type SettingsPageId =
  | 'profiles'
  | 'backup'
  | 'appearance'
  | 'search'
  | 'privacy'
  | 'automation'
  | 'shortcuts'
  | 'utility'
  | 'about';

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

const settingsPages: Array<{
  id: SettingsPageId;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  {
    id: 'profiles',
    label: 'Profiles',
    description: 'Manage isolated browser profiles and connected accounts.',
    icon: Monitor,
  },
  {
    id: 'backup',
    label: 'Backup & Restore',
    description: 'Export or import encrypted full profile backups.',
    icon: Database,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'Theme and visual preferences.',
    icon: Sun,
  },
  {
    id: 'search',
    label: 'Search Engine',
    description: 'Default search engine and site shortcuts.',
    icon: Globe,
  },
  {
    id: 'privacy',
    label: 'Privacy & Data',
    description: 'History, downloads, passwords, and local data controls.',
    icon: History,
  },
  {
    id: 'automation',
    label: 'Automation',
    description: 'GlassBox DOM/API action tools and logs.',
    icon: Terminal,
  },
  {
    id: 'shortcuts',
    label: 'Keyboard Shortcuts',
    description: 'Browse, edit, and reset keyboard shortcuts.',
    icon: Keyboard,
  },
  {
    id: 'utility',
    label: 'Utility Panels',
    description: 'Choose which utility panels appear.',
    icon: Settings,
  },
  {
    id: 'about',
    label: 'About',
    description: 'Version and system information.',
    icon: Activity,
  },
];

const SHORTCUT_STORAGE_KEY = 'gb-shortcuts';
const SHORTCUT_GROUPS: Array<'All' | ShortcutGroup> = [
  'All',
  'Navigation',
  'Tabs',
  'Profiles',
  'Settings',
  'Utility Panels',
  'Automation',
  'Safety',
  'Command',
];

function getInitialShortcutOverrides() {
  if (typeof window === 'undefined') return {} as Record<string, string>;

  try {
    const saved = JSON.parse(window.localStorage.getItem(SHORTCUT_STORAGE_KEY) || '{}');
    return saved && typeof saved === 'object' ? saved as Record<string, string> : {};
  } catch {
    return {} as Record<string, string>;
  }
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

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
  const [activeSettingsPage, setActiveSettingsPage] = useState<SettingsPageId>('profiles');
  const [enabledPanels, setEnabledPanels] = useState<UtilityPanelId[]>(getInitialUtilityPanels);
  const [profileCreatorOpen, setProfileCreatorOpen] = useState(false);
  const [profileCreatorName, setProfileCreatorName] = useState('');
  const [profileCreatorStartUrl, setProfileCreatorStartUrl] = useState('https://accounts.google.com/');
  const [profileCreatorOpenLogin, setProfileCreatorOpenLogin] = useState(true);
  const [profileCreatorError, setProfileCreatorError] = useState<string | null>(null);
  const [profileCreatorBusy, setProfileCreatorBusy] = useState(false);
  const [profileCreatorEmail, setProfileCreatorEmail] = useState('');
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editingProfileName, setEditingProfileName] = useState('');
  const [editingProfileBusy, setEditingProfileBusy] = useState(false);
  const [editingProfileError, setEditingProfileError] = useState<string | null>(null);
  const [profileBackupOpen, setProfileBackupOpen] = useState(false);
  const [backupPassword, setBackupPassword] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [passwordForm, setPasswordForm] = useState({ origin: '', username: '', password: '' });
  const [shortcutOverrides, setShortcutOverrides] = useState<Record<string, string>>(getInitialShortcutOverrides);
  const [shortcutSearch, setShortcutSearch] = useState('');
  const [shortcutFilter, setShortcutFilter] = useState<'All' | ShortcutGroup>('All');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('');
  const [recentlyClosedTabs, setRecentlyClosedTabs] = useState<Array<{ url: string; title: string; profileId: string }>>([]);
  const [automationPaused, setAutomationPaused] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const browserViewRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const profileSelectRef = useRef<HTMLSelectElement>(null);
  const commandPaletteInputRef = useRef<HTMLInputElement>(null);
  const hasInitializedRef = useRef(false);
  const profileEmailDetectTimerRef = useRef<number | null>(null);

  const activeTab = tabs.find((tab) => tab.tabId === activeTabId);
  const activeSettingsPageConfig = settingsPages.find((page) => page.id === activeSettingsPage) || settingsPages[0];
  const shortcutDefinitions = DEFAULT_SHORTCUTS.map((definition) => ({
    ...definition,
    keys: formatShortcut(shortcutOverrides[definition.id] || definition.keys),
  }));
  const shortcutConflicts = detectShortcutConflicts(shortcutDefinitions);

  const focusShell = () => {
    void (window as any).windowControls?.focusShell?.();
  };

  const clearProfileEmailDetectLoop = () => {
    if (profileEmailDetectTimerRef.current !== null) {
      window.clearTimeout(profileEmailDetectTimerRef.current);
      profileEmailDetectTimerRef.current = null;
    }
  };

  const showToast = (message: string) => {
    setToastMessage(message);
  };

  const focusAddressBar = () => {
    focusShell();
    requestAnimationFrame(() => {
      urlInputRef.current?.focus();
      urlInputRef.current?.select();
    });
  };

  const openSettingsPage = (pageId: SettingsPageId) => {
    setSettingsOpen(true);
    setActiveSettingsPage(pageId);
  };

  const togglePanelState = (panelId: UtilityPanelId, forceOpen = false) => {
    setEnabledPanels((currentPanels) => {
      if (forceOpen) {
        return currentPanels.includes(panelId) ? currentPanels : [...currentPanels, panelId];
      }

      return currentPanels.includes(panelId)
        ? currentPanels.filter((id) => id !== panelId)
        : [...currentPanels, panelId];
    });
  };

  const updateShortcutOverride = (shortcutId: string, nextKeys: string) => {
    setShortcutOverrides((current) => ({ ...current, [shortcutId]: formatShortcut(nextKeys) }));
  };

  const resetShortcutOverride = (shortcutId: string) => {
    setShortcutOverrides((current) => {
      const next = { ...current };
      delete next[shortcutId];
      return next;
    });
  };

  const resetAllShortcutOverrides = () => {
    setShortcutOverrides({});
    showToast('Keyboard shortcuts reset to defaults.');
  };

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
    const isAddressBarFocused = typeof document !== 'undefined' && document.activeElement === urlInputRef.current;

    if (activeTab && activeTab.url !== 'about:blank' && !isNavigating && !isAddressBarFocused) {
      setUrlInput(activeTab.url);
    } else if (!activeTab) {
      setUrlInput('');
    }
  }, [activeTab?.url, isNavigating]);

  useEffect(() => {
    if (!activeProfileId) return;

    const intervalId = window.setInterval(() => {
      void fetchTabs(activeProfileId, activeTabId);
    }, 1500);

    return () => window.clearInterval(intervalId);
  }, [activeProfileId, activeTabId]);

  useEffect(() => {
    if (!activeTabId) {
      setDomSnapshot([]);
      return;
    }

    requestAnimationFrame(() => syncBrowserViewBounds(activeTabId));
    updateActiveTabData(activeTabId);
  }, [activeTabId]);

  useEffect(() => () => clearProfileEmailDetectLoop(), []);

  useEffect(() => {
    if (!profileCreatorOpen) return;

    const rafId = requestAnimationFrame(() => focusShell());
    return () => cancelAnimationFrame(rafId);
  }, [profileCreatorOpen]);

  useEffect(() => {
    window.localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(shortcutOverrides));
  }, [shortcutOverrides]);

  useEffect(() => {
    if (!toastMessage) return;

    const timeoutId = window.setTimeout(() => setToastMessage(null), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [toastMessage]);

  useEffect(() => {
    if (!commandPaletteOpen) return;

    const rafId = requestAnimationFrame(() => {
      commandPaletteInputRef.current?.focus();
      commandPaletteInputRef.current?.select();
    });

    return () => cancelAnimationFrame(rafId);
  }, [commandPaletteOpen]);

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

  const openProfileCreator = () => {
    clearProfileEmailDetectLoop();
    setProfileCreatorName('');
    setProfileCreatorEmail('');
    setProfileCreatorStartUrl('https://accounts.google.com/');
    setProfileCreatorOpenLogin(true);
    setProfileCreatorError(null);
    setProfileCreatorOpen(true);
  };

  const detectProfileEmailSilently = async (profileId: string) => {
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/detect-email`, {
        method: 'POST',
      });
      const data = await res.json();

      if (!res.ok || data.error || !data.success || !data.email) {
        return false;
      }

      await fetchProfiles();
      return true;
    } catch {
      return false;
    }
  };

  const startProfileEmailAutoDetect = (profileId: string, attemptsLeft = 120) => {
    clearProfileEmailDetectLoop();

    const run = async () => {
      const detected = await detectProfileEmailSilently(profileId);
      if (detected || attemptsLeft <= 1) {
        clearProfileEmailDetectLoop();
        return;
      }

      profileEmailDetectTimerRef.current = window.setTimeout(() => {
        startProfileEmailAutoDetect(profileId, attemptsLeft - 1);
      }, 3000);
    };

    profileEmailDetectTimerRef.current = window.setTimeout(() => {
      void run();
    }, 2000);
  };

  const createProfile = async () => {
    const name = profileCreatorName.trim();
    const email = profileCreatorEmail.trim();

    if (!name) {
      setProfileCreatorError('Profile name is required.');
      return;
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setProfileCreatorError('Enter a valid email address.');
      return;
    }

    setProfileCreatorBusy(true);
    setProfileCreatorError(null);

    try {
      const createRes = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email: email || undefined }),
      });

      const newProfile = await createRes.json();

      if (!createRes.ok || newProfile.error) {
        throw new Error(newProfile.error || 'Failed to create profile.');
      }

      await fetchProfiles();

      const startUrl = profileCreatorOpenLogin
        ? profileCreatorStartUrl.trim() || 'https://accounts.google.com/'
        : undefined;

      const openRes = await fetch(`/api/profiles/${encodeURIComponent(newProfile.id)}/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: startUrl }),
      });

      const openData = await openRes.json();

      if (!openRes.ok || openData.error) {
        throw new Error(openData.error || 'Failed to open new profile.');
      }

      await persistActiveProfile(newProfile.id);
      setActiveProfileId(newProfile.id);

      await fetchTabs(newProfile.id, openData.tabId || openData.id);
      setActiveTabId(openData.tabId || openData.id);

      await fetchLogs(newProfile.id);
      await fetchHistory('', newProfile.id);
      await fetchDownloads('', newProfile.id);
      await fetchPasswords(newProfile.id);

      setProfileCreatorOpen(false);

      if (!email) {
        startProfileEmailAutoDetect(newProfile.id);
      }

      requestAnimationFrame(() => syncBrowserViewBounds(openData.tabId || openData.id));
    } catch (error: any) {
      setProfileCreatorError(error?.message || 'Could not create profile.');
    } finally {
      setProfileCreatorBusy(false);
    }
  };

  const startProfileEdit = (profile: Profile) => {
    setEditingProfileId(profile.id);
    setEditingProfileName(profile.name || '');
    setEditingProfileError(null);
  };

  const cancelProfileEdit = () => {
    setEditingProfileId(null);
    setEditingProfileName('');
    setEditingProfileError(null);
  };

  const saveProfileEdit = async (profileId: string) => {
    const nextName = editingProfileName.trim();

    if (!nextName) {
      setEditingProfileError('Profile name is required.');
      return;
    }

    setEditingProfileBusy(true);
    setEditingProfileError(null);

    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nextName }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to update profile.');
      }

      await fetchProfiles();
      cancelProfileEdit();
    } catch (error: any) {
      setEditingProfileError(error?.message || 'Could not save profile.');
    } finally {
      setEditingProfileBusy(false);
    }
  };

  const detectProfileEmail = async (profileId: string) => {
    try {
      clearProfileEmailDetectLoop();
      const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/detect-email`, {
        method: 'POST',
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        alert(data.message || data.error || 'Could not detect email.');
        return;
      }

      if (!data.success) {
        const messages: Record<string, string> = {
          NOT_GOOGLE_IDENTITY_PAGE: 'Open Gmail, Google, or Google Account page in this profile first, then try again.',
          EMAIL_NOT_FOUND_ON_PAGE: 'Could not find an email on this Google page. Click your Google avatar/account icon, then try again.',
          NO_PROFILE_TAB: 'No tab found for this profile.',
          TAB_NOT_FOUND: 'Profile tab was not found.',
          DEFAULT_PROFILE_EMAIL_OPTIONAL: 'Default profile does not need an email.',
        };

        alert(messages[data.reason] || data.reason || 'Could not detect email.');
        return;
      }

      await fetchProfiles();
      alert(`Detected email: ${data.email}`);
    } catch {
      alert('Could not detect email.');
    }
  };

  const exportFullProfiles = async () => {
    if (backupPassword.length < 8) {
      setBackupError('Backup password must be at least 8 characters.');
      return;
    }

    setBackupBusy(true);
    setBackupError(null);

    try {
      const res = await fetch('/api/profiles/export-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: backupPassword }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || 'Export failed.');
      }

      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `glassbox-full-profile-backup-${new Date().toISOString().slice(0, 10)}.gbprofile`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      setBackupError(error?.message || 'Export failed.');
    } finally {
      setBackupBusy(false);
    }
  };

  const importFullProfiles = async (file: File) => {
    if (!backupPassword) {
      setBackupError('Enter backup password first.');
      return;
    }

    setBackupBusy(true);
    setBackupError(null);

    try {
      const text = await file.text();
      const backup = JSON.parse(text);

      const res = await fetch('/api/profiles/import-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backup, password: backupPassword }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || 'Import failed.');
      }

      await fetchProfiles();
      await switchProfile(data.activeProfileId || 'default');

      const restartNote = data.restartRecommended
        ? ' Restart GlassBox to reload restored session files.'
        : '';

      alert(`Imported ${data.importedProfiles} profiles and restored ${data.restoredSessions} browser sessions.${restartNote}`);
    } catch (error: any) {
      setBackupError(error?.message || 'Import failed. Wrong password or corrupted file.');
    } finally {
      setBackupBusy(false);
    }
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
      const newTabId = await createTab(undefined, profileId);
      setActiveTabId(newTabId);
      requestAnimationFrame(() => syncBrowserViewBounds(newTabId));
      return;
    }

    const nextActiveTabId = filteredData[0].tabId;
    setActiveTabId(nextActiveTabId);
    requestAnimationFrame(() => syncBrowserViewBounds(nextActiveTabId));
  };

  const fetchLogs = async (profileId: string = activeProfileId) => {
    try {
      const res = await fetch(`/api/memory/logs?profileId=${encodeURIComponent(profileId)}`);
      const data = await res.json();
      setLogs(data);
      return data as ActionLog[];
    } catch {
      return [] as ActionLog[];
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

    const closingTab = tabs.find((tab) => tab.tabId === tabId);
    if (closingTab) {
      setRecentlyClosedTabs((current) => [
        { url: closingTab.url, title: closingTab.title, profileId: closingTab.profileId },
        ...current,
      ].slice(0, 12));
    }

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

  const closeActiveTab = async () => {
    if (!activeTabId) return;

    const closingTab = tabs.find((tab) => tab.tabId === activeTabId);
    if (closingTab) {
      setRecentlyClosedTabs((current) => [
        { url: closingTab.url, title: closingTab.title, profileId: closingTab.profileId },
        ...current,
      ].slice(0, 12));
    }

    const closeResult = await (window as any).windowControls?.closeTab?.(activeTabId);
    const nextActiveTabId = closeResult?.nextActiveTabId || null;

    await fetchTabs(activeProfileId, nextActiveTabId);
    setActiveTabId(nextActiveTabId);

    if (nextActiveTabId) {
      requestAnimationFrame(() => syncBrowserViewBounds(nextActiveTabId));
      await fetchLogs(activeProfileId);
      updateActiveTabData(nextActiveTabId);
      return;
    }

    setDomSnapshot([]);
    await fetchLogs(activeProfileId);
  };

  const reopenClosedTab = async () => {
    if (recentlyClosedTabs.length === 0) {
      showToast('No recently closed tabs.');
      return;
    }

    const [nextTab, ...remaining] = recentlyClosedTabs;
    setRecentlyClosedTabs(remaining);

    if (nextTab.profileId !== activeProfileId) {
      await persistActiveProfile(nextTab.profileId);
      setActiveProfileId(nextTab.profileId);
      await fetchLogs(nextTab.profileId);
      await fetchHistory('', nextTab.profileId);
      await fetchDownloads('', nextTab.profileId);
      await fetchPasswords(nextTab.profileId);
      await createTab(nextTab.url, nextTab.profileId);
      return;
    }

    await createTab(nextTab.url, nextTab.profileId);
  };

  const cycleTabs = (direction: 1 | -1) => {
    if (tabs.length < 2 || !activeTabId) return;

    const currentIndex = tabs.findIndex((tab) => tab.tabId === activeTabId);
    if (currentIndex < 0) return;

    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
    const nextTabId = tabs[nextIndex]?.tabId;
    if (!nextTabId) return;

    setActiveTabId(nextTabId);
    requestAnimationFrame(() => syncBrowserViewBounds(nextTabId));
    updateActiveTabData(nextTabId);
  };

  const switchTabByIndex = (index: number) => {
    const nextTab = tabs[index];
    if (!nextTab) {
      showToast(`Tab ${index + 1} is not available.`);
      return;
    }

    setActiveTabId(nextTab.tabId);
    requestAnimationFrame(() => syncBrowserViewBounds(nextTab.tabId));
    updateActiveTabData(nextTab.tabId);
  };

  const switchToLastTab = () => {
    if (tabs.length === 0) return;
    switchTabByIndex(tabs.length - 1);
  };

  const performTabWindowAction = async (action: 'tabBack' | 'tabForward' | 'tabStop', options?: { refreshLogs?: boolean }) => {
    if (!activeTabId) return false;

    const result = await (window as any).windowControls?.[action]?.(activeTabId);
    if (!result?.success) {
      if (result?.reason && !String(result.reason).startsWith('NO_HISTORY')) {
        showToast(String(result.reason));
      }
      return false;
    }

    window.setTimeout(() => {
      void fetchTabs(activeProfileId, activeTabId);
      updateActiveTabData(activeTabId);
    }, 250);

    if (options?.refreshLogs) {
      await fetchLogs(activeProfileId);
    }

    return true;
  };

  const reloadActiveTab = async (hard = false) => {
    if (!activeTabId) return;

    const result = await (window as any).windowControls?.tabReload?.(activeTabId, hard);
    if (!result?.success && result?.reason) {
      showToast(String(result.reason));
      return;
    }

    window.setTimeout(() => {
      void fetchTabs(activeProfileId, activeTabId);
      updateActiveTabData(activeTabId);
    }, 250);
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

  const captureTabHtml = async () => {
    if (!activeTabId) return;

    const response = await fetch(`/api/tabs/${encodeURIComponent(activeTabId)}/html`);
    const data = await response.json();
    await navigator.clipboard.writeText(data.html || '');
    showToast('Captured HTML copied to clipboard.');
  };

  const captureTabScreenshot = async () => {
    if (!activeTabId) return;

    const response = await fetch(`/api/tabs/${encodeURIComponent(activeTabId)}/screenshot`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `glassbox-screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast('Screenshot captured.');
  };

  const captureTabA11y = async () => {
    if (!activeTabId) return;

    const response = await fetch(`/api/tabs/${encodeURIComponent(activeTabId)}/a11y`);
    const data = await response.json();
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    showToast('Accessibility snapshot copied to clipboard.');
  };

  const runQuerySelector = async () => {
    if (!activeTabId) return;

    const selector = window.prompt('Enter a CSS selector to query:');
    if (!selector?.trim()) return;

    const response = await fetch(`/api/tabs/${encodeURIComponent(activeTabId)}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: selector.trim(), limit: 25 }),
    });
    const data = await response.json();
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    togglePanelState('dom', true);
    showToast('Query results copied to clipboard.');
  };

  const verifyLatestAction = async () => {
    const freshLogs = await fetchLogs(activeProfileId);
    togglePanelState('logs', true);
    const latestLog = freshLogs[0];
    if (!latestLog) {
      showToast('No recent action log found.');
      return;
    }

    showToast(`Latest action: ${latestLog.action_type} (${latestLog.success ? 'success' : 'failed'})`);
  };

  const showLatestLog = async () => {
    const freshLogs = await fetchLogs(activeProfileId);
    togglePanelState('logs', true);
    showToast(freshLogs[0] ? `Opened latest log: ${freshLogs[0].action_type}` : 'No action logs available.');
  };

  const handleNotImplementedShortcut = (command: ShortcutCommand) => {
    showToast(`Command not implemented yet: ${command}`);
  };

  const executeShortcutCommand = async (command: ShortcutCommand, payload?: Record<string, unknown>) => {
    switch (command) {
      case 'focus_address_bar':
        focusAddressBar();
        return;
      case 'navigate_current_input':
        await navigate();
        return;
      case 'browser_back':
        await performTabWindowAction('tabBack');
        return;
      case 'browser_forward':
        await performTabWindowAction('tabForward');
        return;
      case 'reload_tab':
        await reloadActiveTab(false);
        return;
      case 'hard_reload_tab':
        await reloadActiveTab(true);
        return;
      case 'escape_or_stop':
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false);
          return;
        }
        if (profileCreatorOpen) {
          setProfileCreatorOpen(false);
          return;
        }
        if (profileBackupOpen) {
          setProfileBackupOpen(false);
          return;
        }
        if (settingsOpen) {
          setSettingsOpen(false);
          return;
        }
        await performTabWindowAction('tabStop');
        return;
      case 'new_tab':
        await createTab();
        return;
      case 'close_tab':
        await closeActiveTab();
        return;
      case 'reopen_tab':
        await reopenClosedTab();
        return;
      case 'next_tab':
        cycleTabs(1);
        return;
      case 'previous_tab':
        cycleTabs(-1);
        return;
      case 'switch_tab_index':
        if (typeof payload?.index === 'number') {
          switchTabByIndex(payload.index as number);
        }
        return;
      case 'switch_last_tab':
        switchToLastTab();
        return;
      case 'open_profile_switcher':
        focusShell();
        requestAnimationFrame(() => profileSelectRef.current?.focus());
        showToast('Profile switcher focused.');
        return;
      case 'settings_profiles':
        openSettingsPage('profiles');
        return;
      case 'detect_profile_email':
        await detectProfileEmail(activeProfileId);
        return;
      case 'settings_backup':
        openSettingsPage('backup');
        return;
      case 'create_profile':
        openProfileCreator();
        return;
      case 'switch_default_profile':
        await switchProfile('default');
        return;
      case 'open_settings':
        setSettingsOpen(true);
        return;
      case 'settings_appearance':
        openSettingsPage('appearance');
        return;
      case 'settings_search':
        openSettingsPage('search');
        return;
      case 'settings_privacy':
        openSettingsPage('privacy');
        return;
      case 'settings_automation':
        openSettingsPage('automation');
        return;
      case 'settings_shortcuts':
        openSettingsPage('shortcuts');
        return;
      case 'settings_about':
        openSettingsPage('about');
        return;
      case 'toggle_memory_panel':
        togglePanelState('memory');
        return;
      case 'toggle_history_panel':
        togglePanelState('history');
        return;
      case 'toggle_downloads_panel':
        togglePanelState('downloads');
        return;
      case 'toggle_dom_panel':
        togglePanelState('dom');
        return;
      case 'toggle_logs_panel':
        togglePanelState('logs');
        return;
      case 'settings_utility':
        openSettingsPage('utility');
        return;
      case 'capture_dom':
        await updateActiveTabData();
        togglePanelState('dom', true);
        showToast('DOM snapshot refreshed.');
        return;
      case 'capture_html':
        await captureTabHtml();
        return;
      case 'capture_screenshot':
        await captureTabScreenshot();
        return;
      case 'capture_a11y':
        await captureTabA11y();
        return;
      case 'query_selector':
        await runQuerySelector();
        return;
      case 'show_latest_log':
        await showLatestLog();
        return;
      case 'verify_last_action':
        await verifyLatestAction();
        return;
      case 'panic_stop':
        setAutomationPaused(true);
        await performTabWindowAction('tabStop');
        showToast('Automation panic stop triggered.');
        return;
      case 'toggle_automation_pause':
        setAutomationPaused((current) => {
          const next = !current;
          showToast(next ? 'Automation paused.' : 'Automation resumed.');
          return next;
        });
        return;
      case 'cancel_action_queue':
      case 'undo_last_safe_action':
      case 'inspect_cursor':
      case 'copy_selector':
      case 'retry_failed_action':
      case 'open_command_palette':
        if (command === 'open_command_palette') {
          setCommandPaletteQuery('');
          setCommandPaletteOpen(true);
          return;
        }
        handleNotImplementedShortcut(command);
        return;
      default:
        handleNotImplementedShortcut(command);
    }
  };

  const triggerShortcutByKeys = async (shortcutKeys: string) => {
    const normalized = formatShortcut(shortcutKeys);
    const match = shortcutDefinitions.find((definition) => definition.keys === normalized);
    if (!match) return false;

    await executeShortcutCommand(match.command, match.payload);
    return true;
  };

  const editShortcut = (shortcutId: string) => {
    const currentShortcut = shortcutDefinitions.find((definition) => definition.id === shortcutId);
    if (!currentShortcut) return;

    const nextValue = window.prompt(`Set a shortcut for "${currentShortcut.label}"`, currentShortcut.keys);
    if (nextValue === null) return;

    const formatted = formatShortcut(nextValue);
    if (!formatted) {
      showToast('Shortcut cannot be empty.');
      return;
    }

    const conflicting = shortcutDefinitions.find((definition) => definition.id !== shortcutId && definition.keys === formatted);
    if (conflicting) {
      const shouldReplace = window.confirm(`Conflict: ${formatted} is already assigned to ${conflicting.label}.\n\nReplace it?`);
      if (!shouldReplace) {
        return;
      }
      resetShortcutOverride(conflicting.id);
    }

    updateShortcutOverride(shortcutId, formatted);
    showToast(`Shortcut updated to ${formatted}.`);
  };

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      const shortcut = parseShortcutEvent(event);
      if (!shortcut) return;

      const targetIsEditable = isEditableTarget(event.target);
      const isAddressBarTarget = event.target === urlInputRef.current;
      const allowedInTextInput = shortcut === 'Ctrl+L' || shortcut === 'Ctrl+K' || shortcut === 'Esc' || (shortcut === 'Enter' && isAddressBarTarget);

      if (targetIsEditable && !allowedInTextInput) {
        return;
      }

      const match = shortcutDefinitions.find((definition) => definition.keys === shortcut);
      if (!match) return;

      event.preventDefault();
      void executeShortcutCommand(match.command, match.payload);
    };

    const handleForwardedShortcut = (event: Event) => {
      const customEvent = event as CustomEvent<{ shortcut?: string }>;
      const shortcut = customEvent.detail?.shortcut;
      if (!shortcut) return;
      void triggerShortcutByKeys(shortcut);
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    window.addEventListener('glassbox-shortcut', handleForwardedShortcut as EventListener);

    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown);
      window.removeEventListener('glassbox-shortcut', handleForwardedShortcut as EventListener);
    };
  }, [shortcutDefinitions, activeProfileId, activeTabId, tabs, commandPaletteOpen, settingsOpen, profileCreatorOpen, profileBackupOpen, urlInput]);

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

  const renderProfilesSettings = () => (
    <section className="space-y-4">
      <SettingsPageHeader
        title="Profiles"
        description="Create, switch, rename, and delete isolated browser profiles."
      />

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-gb-border bg-gb-surface p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gb-text-dim">Active profile</div>
            <div className="mt-2 text-sm font-semibold text-gb-text">
              {profiles.find((profile) => profile.id === activeProfileId)?.name || activeProfileId}
            </div>
            <div className="mt-1 text-xs text-gb-text-dim">
              Current browser tabs, cookies, downloads, and saved logins stay isolated here.
            </div>
          </div>

          <div className="rounded-xl border border-gb-border bg-gb-surface p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gb-text-dim">Saved profiles</div>
            <div className="mt-2 text-sm font-semibold text-gb-text">{profiles.length} total</div>
            <div className="mt-1 text-xs text-gb-text-dim">
              Keep work, personal, and client accounts separated without mixing sessions.
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={openProfileCreator}
          className="rounded-xl bg-gb-accent-primary px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500"
        >
          Create new profile
        </button>
      </div>

      <div className="space-y-2">
        {profiles.map((profile) => (
          <div
            key={profile.id}
            className="rounded-xl border border-gb-border bg-gb-surface p-4 transition-colors hover:bg-gb-surface-bright"
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0 flex-1">
                {editingProfileId === profile.id ? (
                  <div className="space-y-1">
                    <input
                      type="text"
                      value={editingProfileName}
                      onChange={(e) => setEditingProfileName(e.target.value)}
                      onFocus={focusShell}
                      onMouseDown={focusShell}
                      placeholder="Profile name"
                      className="no-drag w-full rounded border border-gb-border bg-gb-bg px-2 py-1.5 text-sm text-gb-text outline-none focus:border-gb-accent-primary"
                    />
                    {editingProfileError && <div className="text-[10px] text-red-400">{editingProfileError}</div>}
                  </div>
                ) : (
                  <>
                    <div className="truncate text-sm font-semibold text-gb-text">
                      {profile.name}
                    </div>
                    <div
                      title={profile.email || ''}
                      className="mt-1 truncate text-xs text-gb-text-dim"
                    >
                      {profile.email || (profile.id === 'default' ? 'Default local profile' : 'No connected email')}
                    </div>
                  </>
                )}

                {profile.id !== 'default' && !profile.email && editingProfileId !== profile.id && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => detectProfileEmail(profile.id)}
                      className="rounded-md border border-gb-border px-2 py-1 text-[10px] font-semibold text-gb-text-dim transition-colors hover:bg-gb-surface-bright hover:text-gb-text"
                    >
                      Detect email
                    </button>
                  </div>
                )}
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {profile.id === activeProfileId ? (
                  <span className="rounded-md bg-gb-accent-primary px-3 py-1.5 text-xs font-semibold text-white">
                    Active
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => switchProfile(profile.id)}
                    className="rounded-md bg-gb-surface-bright px-3 py-1.5 text-xs font-semibold text-gb-text"
                  >
                    Use
                  </button>
                )}

                {editingProfileId === profile.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => saveProfileEdit(profile.id)}
                      disabled={editingProfileBusy}
                      className="rounded-md bg-gb-accent-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={cancelProfileEdit}
                      className="rounded-md bg-gb-surface-bright px-3 py-1.5 text-xs font-semibold text-gb-text"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => startProfileEdit(profile)}
                    className="rounded-md bg-gb-surface-bright px-3 py-1.5 text-xs font-semibold text-gb-text"
                  >
                    Rename
                  </button>
                )}

                {profile.id !== 'default' && (
                  <button
                    type="button"
                    onClick={() => deleteProfile(profile.id)}
                    className="rounded-md bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-300"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  const renderBackupSettings = () => (
    <section className="space-y-4">
      <SettingsPageHeader
        title="Backup & Restore"
        description="Create encrypted full-profile backups and restore them on another PC."
      />

      <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs leading-relaxed text-red-200">
        Full backups may contain login cookies and session tokens. Anyone with the backup file and password may access your logged-in accounts.
      </div>

      <div className="rounded-xl border border-gb-border bg-gb-surface p-4">
        <div className="text-sm font-semibold text-gb-text">Move everything safely</div>
        <div className="mt-1 text-xs leading-relaxed text-gb-text-dim">
          Export all local profiles into one encrypted backup, or restore them on another GlassBox machine.
        </div>

        <button
          type="button"
          onClick={() => {
            setBackupPassword('');
            setBackupError(null);
            setProfileBackupOpen(true);
          }}
          className="mt-4 rounded-xl bg-gb-accent-primary px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500"
        >
          Open Backup / Restore
        </button>
      </div>
    </section>
  );

  const renderAppearanceSettings = () => (
    <section className="space-y-4">
      <SettingsPageHeader
        title="Appearance"
        description="Choose how GlassBox looks."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {themeOptions.map((option) => {
          const Icon = option.icon;
          const active = themePreference === option.value;

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setThemePreference(option.value)}
              className={`rounded-xl border px-3 py-3 text-sm font-semibold transition-colors ${
                active
                  ? 'border-gb-accent-primary bg-gb-accent-primary text-white'
                  : 'border-gb-border bg-gb-surface text-gb-text-dim hover:bg-gb-surface-bright hover:text-gb-text'
              }`}
            >
              <span className="flex items-center justify-center gap-2">
                <Icon size={14} />
                {option.label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-gb-border bg-gb-surface p-3 text-xs text-gb-text-dim">
        Theme changes apply across the full GlassBox shell, including tabs, controls, and settings panels.
      </div>
    </section>
  );

  const renderSearchSettings = () => (
    <section className="space-y-4">
      <SettingsPageHeader
        title="Search Engine"
        description="Choose default search provider and use site aliases from the address bar."
      />

      <div className="rounded-xl border border-gb-border bg-gb-surface p-4">
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-gb-text-dim">
          Default search engine
        </label>

        <select
          value={searchEngine}
          onChange={(e) => setSearchEngine(e.target.value as SearchEngineName)}
          className="mt-2 w-full rounded-xl border border-gb-border bg-gb-bg px-3 py-3 text-sm text-gb-text outline-none"
        >
          {SEARCH_ENGINE_OPTIONS.map((engine) => (
            <option key={engine} value={engine}>
              {engine.toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-gb-border bg-gb-surface p-4">
        <div className="text-sm font-semibold text-gb-text">Address bar shortcuts</div>
        <div className="mt-1 text-xs text-gb-text-dim">
          Jump directly to common sites by typing an alias in the address bar.
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {['google', 'gmail', 'youtube', 'github', 'chatgpt', 'gemini', 'facebook'].map((alias) => (
            <span key={alias} className="rounded-full border border-gb-border bg-gb-bg px-2.5 py-1 text-[11px] text-gb-text-dim">
              {alias}
            </span>
          ))}
        </div>
      </div>
    </section>
  );

  const renderPrivacySettings = () => (
    <section className="space-y-4">
      <SettingsPageHeader
        title="Privacy & Data"
        description="Review and clear local profile data."
      />

      <div className="rounded-xl border border-gb-border bg-gb-surface p-4">
        <div className="text-sm font-semibold text-gb-text">History</div>
        <div className="mt-1 text-xs text-gb-text-dim">
          {history.length} entries in this profile.
        </div>
        <div className="mt-3 space-y-1">
          {history.slice(0, 4).map((item: any) => (
            <div key={item.id} className="rounded border border-gb-border bg-gb-bg p-2">
              <div className="truncate text-[11px] font-semibold text-gb-text">{item.title || item.url}</div>
              <div className="mt-1 truncate text-[10px] text-gb-text-dim">{item.url}</div>
            </div>
          ))}
          {history.length === 0 && <EmptyPanelState text="No local history for this profile." />}
        </div>
        <button
          type="button"
          onClick={clearHistory}
          className="mt-3 rounded-md border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-300"
        >
          Clear history
        </button>
      </div>

      <div className="rounded-xl border border-gb-border bg-gb-surface p-4">
        <div className="text-sm font-semibold text-gb-text">Downloads</div>
        <div className="mt-1 text-xs text-gb-text-dim">
          {downloads.length} download records in this profile.
        </div>
        <div className="mt-3 space-y-1">
          {downloads.slice(0, 4).map((item: any) => (
            <div key={item.id} className="rounded border border-gb-border bg-gb-bg p-2">
              <div className="truncate text-[11px] font-semibold text-gb-text">{item.file_name || item.filename}</div>
              <div className="mt-1 truncate text-[10px] text-gb-text-dim">{item.url}</div>
            </div>
          ))}
          {downloads.length === 0 && <EmptyPanelState text="No local downloads for this profile." />}
        </div>
        <button
          type="button"
          onClick={clearDownloads}
          className="mt-3 rounded-md border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-300"
        >
          Clear downloads
        </button>
      </div>

      <div className="rounded-xl border border-gb-border bg-gb-surface p-4">
        <div className="text-sm font-semibold text-gb-text">Saved Passwords</div>
        <div className="mt-1 text-xs text-gb-text-dim">
          {passwords.length} saved password records in this profile.
        </div>
        <div className="mt-3 space-y-1">
          {passwords.slice(0, 6).map((entry) => (
            <div key={entry.id} className="flex items-center gap-2 rounded border border-gb-border bg-gb-bg p-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-semibold text-gb-text">{entry.origin}</div>
                <div className="truncate text-[10px] text-gb-text-dim">{entry.username}</div>
              </div>
              <div className="max-w-[120px] truncate text-[10px] text-gb-text-dim">********</div>
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
      </div>
    </section>
  );

  const renderAutomationSettings = () => (
    <section className="space-y-4">
      <SettingsPageHeader
        title="Automation"
        description="Inspect GlassBox automation logs and DOM/action capabilities."
      />

      <div className="rounded-xl border border-gb-border bg-gb-surface p-4">
        <div className="text-sm font-semibold text-gb-text">Local API</div>
        <div className="mt-1 text-xs text-gb-text-dim">
          GlassBox API runs locally on 127.0.0.1:3000.
        </div>
      </div>

      <div className="rounded-xl border border-gb-border bg-gb-surface p-4">
        <div className="text-sm font-semibold text-gb-text">Recent actions</div>
        <div className="mt-2 space-y-2">
          {logs.slice(0, 8).map((log) => (
            <div key={log.id} className="rounded border border-gb-border bg-gb-bg p-2 text-xs">
              <div className="font-semibold text-gb-text">{log.action_type}</div>
              <div className="truncate text-gb-text-dim">{log.reason || log.intent}</div>
            </div>
          ))}
          {logs.length === 0 && <EmptyPanelState text="No recent automation actions for this profile." />}
        </div>
      </div>
    </section>
  );

  const renderUtilitySettings = () => (
    <section className="space-y-4">
      <SettingsPageHeader
        title="Utility Panels"
        description="Choose which side panels are available in the browser workspace."
      />

      <div className="flex items-center justify-between gap-3 rounded-xl border border-gb-border bg-gb-surface p-4">
        <span className="text-xs text-gb-text-dim">
          {enabledPanels.length} enabled
        </span>
        {enabledPanels.length > 0 && (
          <button
            type="button"
            onClick={() => setEnabledPanels([])}
            className="text-xs font-medium text-gb-text-dim hover:text-gb-text"
          >
            Hide all
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {utilityPanelConfigs.map((panel) => {
          const Icon = panel.icon;
          const active = enabledPanels.includes(panel.id);

          return (
            <button
              key={panel.id}
              type="button"
              onClick={() => toggleUtilityPanel(panel.id)}
              className={`rounded-xl border p-4 text-left transition-colors ${
                active
                  ? 'border-gb-accent-primary bg-gb-accent-primary/10'
                  : 'border-gb-border bg-gb-surface hover:bg-gb-surface-bright'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="rounded-md border border-gb-border p-1.5">
                  {active ? <Check size={16} className="text-gb-accent-primary" /> : <Icon size={16} />}
                </div>

                <div>
                  <div className="text-sm font-semibold text-gb-text">{panel.label}</div>
                  <div className="mt-1 text-xs text-gb-text-dim">{panel.description}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );

  const renderShortcutsSettings = () => {
    const filteredShortcuts = shortcutDefinitions.filter((definition) => {
      const matchesFilter = shortcutFilter === 'All' || definition.group === shortcutFilter;
      const normalizedSearch = shortcutSearch.trim().toLowerCase();
      const matchesSearch = !normalizedSearch
        || definition.label.toLowerCase().includes(normalizedSearch)
        || definition.keys.toLowerCase().includes(normalizedSearch)
        || definition.cli.toLowerCase().includes(normalizedSearch)
        || definition.command.toLowerCase().includes(normalizedSearch);

      return matchesFilter && matchesSearch;
    });

    const groupedShortcuts = SHORTCUT_GROUPS
      .filter((group): group is ShortcutGroup => group !== 'All')
      .map((group) => ({
        group,
        items: filteredShortcuts.filter((definition) => definition.group === group),
      }))
      .filter((entry) => entry.items.length > 0);

    return (
      <section className="space-y-4">
        <SettingsPageHeader
          title="Keyboard Shortcuts"
          description="Manage browser, workspace, automation, and safety shortcuts from one registry."
        />

        {shortcutConflicts.length > 0 && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100">
            <div className="font-semibold">Shortcut conflicts detected</div>
            <div className="mt-1">
              {shortcutConflicts.map((conflict) => `${conflict.keys}: ${conflict.definitions.map((item) => item.label).join(', ')}`).join(' | ')}
            </div>
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <input
            type="text"
            value={shortcutSearch}
            onChange={(e) => setShortcutSearch(e.target.value)}
            placeholder="Search shortcuts..."
            className="rounded-xl border border-gb-border bg-gb-surface px-3 py-3 text-sm text-gb-text outline-none focus:border-gb-accent-primary"
          />

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={resetAllShortcutOverrides}
              className="rounded-xl border border-gb-border bg-gb-surface px-3 py-3 text-xs font-semibold text-gb-text-dim transition-colors hover:bg-gb-surface-bright hover:text-gb-text"
            >
              Reset all
            </button>
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              className="rounded-xl bg-gb-accent-primary px-3 py-3 text-xs font-semibold text-white transition-colors hover:bg-blue-500"
            >
              Open command palette
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {SHORTCUT_GROUPS.map((group) => {
            const active = shortcutFilter === group;
            return (
              <button
                key={group}
                type="button"
                onClick={() => setShortcutFilter(group)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-gb-accent-primary text-white'
                    : 'border border-gb-border bg-gb-surface text-gb-text-dim hover:bg-gb-surface-bright hover:text-gb-text'
                }`}
              >
                {group}
              </button>
            );
          })}
        </div>

        <div className="space-y-4">
          {groupedShortcuts.map(({ group, items }) => (
            <section key={group} className="rounded-xl border border-gb-border bg-gb-surface">
              <div className="border-b border-gb-border px-4 py-3">
                <div className="text-sm font-semibold text-gb-text">{group}</div>
              </div>
              <div className="divide-y divide-gb-border">
                {items.map((definition) => (
                  <div key={definition.id} className="grid gap-3 px-4 py-3 xl:grid-cols-[minmax(0,1fr)_180px_220px_auto] xl:items-center">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gb-text">{definition.label}</div>
                      <div className="mt-1 text-[11px] uppercase tracking-wide text-gb-text-dim">{definition.command}</div>
                    </div>

                    <div className="rounded-lg border border-gb-border bg-gb-bg px-3 py-2 text-sm font-medium text-gb-text">
                      {definition.keys}
                    </div>

                    <div className="rounded-lg border border-gb-border bg-gb-bg px-3 py-2 font-mono text-xs text-gb-text-dim">
                      {definition.cli}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => editShortcut(definition.id)}
                        className="rounded-lg border border-gb-border bg-gb-bg px-3 py-2 text-xs font-semibold text-gb-text-dim transition-colors hover:bg-gb-surface-bright hover:text-gb-text"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          resetShortcutOverride(definition.id);
                          showToast(`Reset ${definition.label}.`);
                        }}
                        className="rounded-lg border border-gb-border bg-gb-bg px-3 py-2 text-xs font-semibold text-gb-text-dim transition-colors hover:bg-gb-surface-bright hover:text-gb-text"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}

          {groupedShortcuts.length === 0 && (
            <div className="rounded-xl border border-gb-border bg-gb-surface p-6 text-sm text-gb-text-dim">
              No shortcuts matched your current search and filter.
            </div>
          )}
        </div>
      </section>
    );
  };

  const renderAboutSettings = () => (
    <section className="space-y-4">
      <SettingsPageHeader
        title="About GlassBox"
        description="Visible Electron browser with profile isolation and glass-box automation APIs."
      />

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-gb-border bg-gb-surface p-4 text-xs text-gb-text-dim">
          <div><strong className="text-gb-text">App:</strong> GlassBox Browser</div>
          <div className="mt-2"><strong className="text-gb-text">Mode:</strong> Visible Electron BrowserView</div>
          <div className="mt-2"><strong className="text-gb-text">Profiles:</strong> Persistent isolated Electron partitions</div>
          <div className="mt-2"><strong className="text-gb-text">Automation:</strong> DOM, screenshot, style, action, wait APIs</div>
        </div>

        <div className="rounded-xl border border-gb-border bg-gb-surface p-4 text-xs text-gb-text-dim">
          <div className="text-sm font-semibold text-gb-text">What GlassBox is optimized for</div>
          <div className="mt-2 leading-relaxed">
            A visible browser with isolated profiles, local data ownership, and inspectable automation tools instead of hidden background browsing.
          </div>
        </div>
      </div>
    </section>
  );

  const renderSettingsPage = () => {
    switch (activeSettingsPage) {
      case 'profiles':
        return renderProfilesSettings();
      case 'backup':
        return renderBackupSettings();
      case 'appearance':
        return renderAppearanceSettings();
      case 'search':
        return renderSearchSettings();
      case 'privacy':
        return renderPrivacySettings();
      case 'automation':
        return renderAutomationSettings();
      case 'shortcuts':
        return renderShortcutsSettings();
      case 'utility':
        return renderUtilitySettings();
      case 'about':
        return renderAboutSettings();
      default:
        return renderProfilesSettings();
    }
  };

  const commandPaletteItems = shortcutDefinitions.filter((definition, index, allDefinitions) => (
    allDefinitions.findIndex((entry) => entry.command === definition.command) === index
  )).filter((definition) => {
    const query = commandPaletteQuery.trim().toLowerCase();
    if (!query) return true;

    return definition.label.toLowerCase().includes(query)
      || definition.command.toLowerCase().includes(query)
      || definition.cli.toLowerCase().includes(query)
      || definition.group.toLowerCase().includes(query);
  });

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
          <div className="no-drag flex shrink-0 gap-2 px-1 text-gb-text-dim">
            <button className="no-drag p-1 transition-colors hover:text-gb-text" title="Back" onMouseDown={focusShell} onClick={() => void performTabWindowAction('tabBack')}><ArrowLeft size={16} /></button>
            <button className="no-drag p-1 transition-colors hover:text-gb-text" title="Forward" onMouseDown={focusShell} onClick={() => void performTabWindowAction('tabForward')}><ArrowRight size={16} /></button>
            <button className="no-drag p-1 transition-colors hover:text-gb-text" title="Reload" onMouseDown={focusShell} onClick={() => void reloadActiveTab(false)}><RotateCw size={16} /></button>
          </div>

          <div className="group no-drag flex min-w-[180px] flex-1 items-center rounded-full border border-gb-border bg-gb-surface px-4 py-1.5 transition-colors focus-within:border-gb-accent-primary" onMouseDown={focusShell}>
            <span className="mr-2 shrink-0 text-xs text-gb-accent-success">LOCKED</span>
            <input
              ref={urlInputRef}
              type="text"
              value={urlInput}
              placeholder="https://..."
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && navigate()}
              onFocus={focusShell}
              onMouseDown={focusShell}
              className="no-drag h-4 min-w-0 flex-1 border-none bg-transparent p-0 font-mono text-[11px] text-gb-text outline-none placeholder:text-gb-text-dim"
            />
            {navError && <span className="ml-2 max-w-[150px] truncate text-[10px] text-red-400" title={navError}>{navError}</span>}
            {isNavigating && <RotateCw size={12} className="ml-2 animate-spin text-gb-accent-primary" />}
          </div>
          
          <button
              onClick={navigate}
              onMouseDown={focusShell}
              className="no-drag shrink-0 rounded bg-gb-accent-primary px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-blue-500" type="button">
              Go
          </button>

          <div className="flex min-w-0 shrink items-center gap-2 pr-1">
            <div className="flex min-w-0 max-w-[210px] shrink items-center rounded border border-gb-border bg-gb-surface-bright px-2 py-1 text-[9px] font-bold text-gb-text transition-colors focus-within:border-gb-accent-primary">
              <div className="mr-2 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-blue-500"></div>
              <span className="mr-1 hidden shrink-0 opacity-60 lg:inline">PROFILE:</span>
              <select
                ref={profileSelectRef}
                value={activeProfileId}
                onChange={(e) => {
                  const value = e.target.value;

                  if (value === '__new__') {
                    openProfileCreator();
                    return;
                  }

                  switchProfile(value);
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
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-gb-text-dim">
                  Settings
                </div>
                <div className="mt-1 text-lg font-semibold text-gb-text">
                  {activeSettingsPageConfig.label}
                </div>
                <div className="mt-1 text-xs text-gb-text-dim">
                  {activeSettingsPageConfig.description}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-md p-1 text-gb-text-dim transition-colors hover:bg-gb-surface-bright hover:text-gb-text"
                aria-label="Close settings"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 grid max-h-[72vh] min-h-0 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
              <select
                value={activeSettingsPage}
                onChange={(e) => setActiveSettingsPage(e.target.value as SettingsPageId)}
                className="mb-3 w-full rounded-xl border border-gb-border bg-gb-bg px-3 py-2 text-sm text-gb-text outline-none md:hidden"
              >
                {settingsPages.map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.label}
                  </option>
                ))}
              </select>

                <aside className="hidden min-h-0 md:block">
                  <div className="h-full overflow-y-auto rounded-xl border border-gb-border bg-gb-bg p-2">
                    <div className="space-y-1">
                      {settingsPages.map((page) => {
                        const Icon = page.icon;
                        const active = activeSettingsPage === page.id;

                        return (
                          <button
                            key={page.id}
                            type="button"
                            onClick={() => setActiveSettingsPage(page.id)}
                            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                              active
                                ? 'bg-gb-accent-primary text-white'
                                : 'text-gb-text-dim hover:bg-gb-surface-bright hover:text-gb-text'
                            }`}
                          >
                            <Icon size={16} />
                            <span>{page.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </aside>

                <main className="min-h-0 min-w-0">
                  <div className="h-full overflow-y-auto rounded-xl border border-gb-border bg-gb-bg p-4">
                    {renderSettingsPage()}
                  </div>
                </main>
            </div>

            {enabledPanels.length > 0 && (
              <div className="mt-4 grid gap-3 xl:grid-cols-3">
                {enabledPanels.map(renderUtilityPanel)}
              </div>
            )}

            {false && (
              <>
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
                  <div className="mb-2 grid gap-2">
                    <button
                      type="button"
                      onClick={openProfileCreator}
                      className="w-full rounded bg-gb-accent-primary px-3 py-1.5 text-[10px] font-semibold text-white"
                    >
                      Create new profile
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBackupPassword('');
                        setBackupError(null);
                        setProfileBackupOpen(true);
                      }}
                      className="w-full rounded-md border border-gb-border px-2 py-1.5 text-[10px] font-semibold text-gb-text-dim transition-colors hover:bg-gb-surface-bright hover:text-gb-text"
                    >
                      Backup / Restore
                    </button>
                  </div>
                  <div className="max-h-[220px] space-y-1 overflow-y-auto pr-1">
                    {profiles.map((profile) => (
                      <div key={profile.id} className="flex items-center gap-2 rounded border border-gb-border bg-gb-surface p-2">
                        <div className="min-w-0 flex-1">
                          {editingProfileId === profile.id ? (
                            <div className="space-y-1">
                              <input
                                type="text"
                                value={editingProfileName}
                                onChange={(e) => setEditingProfileName(e.target.value)}
                                onFocus={focusShell}
                                onMouseDown={focusShell}
                                placeholder="Profile name"
                                className="no-drag w-full rounded border border-gb-border bg-gb-bg px-2 py-1 text-[11px] text-gb-text outline-none focus:border-gb-accent-primary"
                              />
                              {editingProfileError && <div className="text-[10px] text-red-400">{editingProfileError}</div>}
                            </div>
                          ) : (
                            <>
                              <div className="text-sm font-semibold text-gb-text">{profile.name}</div>
                              <div className="mt-1 truncate text-xs text-gb-text-dim">
                                {profile.email || (profile.id === 'default' ? 'Default local profile' : 'No connected email')}
                              </div>
                              {profile.id !== 'default' && !profile.email && (
                                <button
                                  type="button"
                                  onClick={() => detectProfileEmail(profile.id)}
                                  className="mt-1 rounded-md border border-gb-border px-2 py-1 text-[10px] font-semibold text-gb-text-dim transition-colors hover:bg-gb-surface-bright hover:text-gb-text"
                                >
                                  Detect email
                                </button>
                              )}
                            </>
                          )}
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
                        {editingProfileId === profile.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => saveProfileEdit(profile.id)}
                              disabled={editingProfileBusy}
                              className="rounded bg-gb-accent-primary px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-60"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelProfileEdit}
                              className="rounded bg-gb-surface-bright px-2 py-1 text-[10px] font-semibold text-gb-text"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startProfileEdit(profile)}
                            className="rounded bg-gb-surface-bright px-2 py-1 text-[10px] font-semibold text-gb-text"
                          >
                            Rename
                          </button>
                        )}
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
              </>
            )}
          </div>
        )}
      </header>

      {commandPaletteOpen && (
        <div className="border-t border-gb-border bg-black/60 px-4 py-5">
          <div className="mx-auto w-full max-w-2xl rounded-2xl border border-gb-border bg-gb-surface p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-gb-text">Command palette</h2>
                <p className="mt-1 text-xs text-gb-text-dim">
                  Search commands, then press Enter or click a row to run it.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setCommandPaletteOpen(false)}
                className="rounded-md p-1 text-gb-text-dim transition-colors hover:bg-gb-surface-bright hover:text-gb-text"
                aria-label="Close command palette"
              >
                <X size={16} />
              </button>
            </div>

            <input
              ref={commandPaletteInputRef}
              type="text"
              value={commandPaletteQuery}
              onChange={(e) => setCommandPaletteQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && commandPaletteItems[0]) {
                  e.preventDefault();
                  void executeShortcutCommand(commandPaletteItems[0].command, commandPaletteItems[0].payload);
                  setCommandPaletteOpen(false);
                  setCommandPaletteQuery('');
                }
              }}
              placeholder="new tab, detect email, capture dom, switch profile..."
              className="w-full rounded-xl border border-gb-border bg-gb-bg px-3 py-3 text-sm text-gb-text outline-none focus:border-gb-accent-primary"
            />

            <div className="mt-4 max-h-[420px] overflow-y-auto rounded-xl border border-gb-border bg-gb-bg">
              {commandPaletteItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    void executeShortcutCommand(item.command, item.payload);
                    setCommandPaletteOpen(false);
                    setCommandPaletteQuery('');
                  }}
                  className="flex w-full items-start justify-between gap-4 border-b border-gb-border px-4 py-3 text-left last:border-b-0 hover:bg-gb-surface-bright"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gb-text">{item.label}</div>
                    <div className="mt-1 text-[11px] uppercase tracking-wide text-gb-text-dim">{item.group}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="rounded-lg border border-gb-border bg-gb-surface px-2 py-1 text-[11px] text-gb-text-dim">{item.keys}</div>
                    <div className="mt-1 font-mono text-[11px] text-gb-text-dim">{item.cli}</div>
                  </div>
                </button>
              ))}

              {commandPaletteItems.length === 0 && (
                <div className="px-4 py-6 text-sm text-gb-text-dim">No commands matched your search.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {profileCreatorOpen && (
        <div className="border-t border-gb-border bg-black/60 px-4 py-5">
          <div className="mx-auto w-full max-w-md rounded-xl border border-gb-border bg-gb-surface p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-gb-text">Create new profile</h2>
                <p className="mt-1 text-xs text-gb-text-dim">
                  Create an isolated browser profile with its own cookies, sessions, history, and saved data.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setProfileCreatorOpen(false)}
                className="rounded-md p-1 text-gb-text-dim transition-colors hover:bg-gb-surface-bright hover:text-gb-text"
                aria-label="Close profile creator"
              >
                <X size={16} />
              </button>
            </div>

            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gb-text-dim">
              Profile name
            </label>
            <input
              autoFocus
              value={profileCreatorName}
              onChange={(e) => setProfileCreatorName(e.target.value)}
              onFocus={focusShell}
              onMouseDown={focusShell}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  createProfile();
                }
              }}
              placeholder="Work, Personal, Fiverr, Research..."
              className="no-drag mt-2 w-full rounded-md border border-gb-border bg-gb-bg px-3 py-2 text-sm text-gb-text outline-none transition-colors focus:border-gb-accent-primary"
            />
            <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-gb-text-dim">
              Connected email / account identity
            </label>
            <input
              type="email"
              value={profileCreatorEmail}
              onChange={(e) => setProfileCreatorEmail(e.target.value)}
              onFocus={focusShell}
              onMouseDown={focusShell}
              placeholder="example@gmail.com"
              className="no-drag mt-2 w-full rounded-md border border-gb-border bg-gb-bg px-3 py-2 text-sm text-gb-text outline-none transition-colors focus:border-gb-accent-primary"
            />
            <p className="mt-1 text-[10px] text-gb-text-dim">
              Optional at creation. You can detect it after logging into Gmail/Google in this profile.
            </p>

            <div className="mt-4 rounded-lg border border-gb-border bg-gb-bg p-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={profileCreatorOpenLogin}
                  onChange={(e) => setProfileCreatorOpenLogin(e.target.checked)}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-xs font-semibold text-gb-text">Open sign-in page after creation</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-gb-text-dim">
                    This opens a login page inside the new isolated profile, like creating a new Chrome profile.
                  </div>
                </div>
              </label>

              {profileCreatorOpenLogin && (
                <div className="mt-3">
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-gb-text-dim">
                    Start URL
                  </label>
                  <input
                    value={profileCreatorStartUrl}
                    onChange={(e) => setProfileCreatorStartUrl(e.target.value)}
                    onFocus={focusShell}
                    onMouseDown={focusShell}
                    placeholder="https://accounts.google.com/"
                    className="no-drag mt-1 w-full rounded-md border border-gb-border bg-gb-surface px-2 py-1.5 text-xs text-gb-text outline-none transition-colors focus:border-gb-accent-primary"
                  />
                </div>
              )}
            </div>

            <div className="mt-3 rounded-lg border border-gb-border bg-gb-bg p-3 text-[11px] leading-relaxed text-gb-text-dim">
              <strong className="text-gb-text">Note:</strong> GlassBox creates an isolated Electron browser profile.
              It can keep login cookies for future use, but it does not import or sync your real Chrome profile.
            </div>

            {profileCreatorError && (
              <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {profileCreatorError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setProfileCreatorOpen(false)}
                className="rounded-md border border-gb-border px-3 py-2 text-xs font-semibold text-gb-text-dim transition-colors hover:bg-gb-surface-bright hover:text-gb-text"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={createProfile}
                disabled={profileCreatorBusy}
                className="rounded-md bg-gb-accent-primary px-3 py-2 text-xs font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
              >
                {profileCreatorBusy ? 'Creating...' : 'Create profile'}
              </button>
            </div>
          </div>
        </div>
      )}

      {profileBackupOpen && (
        <div className="border-t border-gb-border bg-black/60 px-4 py-5">
          <div className="mx-auto w-full max-w-lg rounded-xl border border-gb-border bg-gb-surface p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-gb-text">Backup / Restore profiles</h2>
                <p className="mt-1 text-xs text-gb-text-dim">
                  Export or import full GlassBox profiles, including browser session files where possible.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setProfileBackupOpen(false)}
                className="rounded-md p-1 text-gb-text-dim transition-colors hover:bg-gb-surface-bright hover:text-gb-text"
                aria-label="Close backup dialog"
              >
                <X size={16} />
              </button>
            </div>

            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs leading-relaxed text-red-200">
              This backup may contain login cookies and session tokens. Anyone with this file and password may access your logged-in accounts.
              Some websites may still require re-login after restore due to device, IP, 2FA, or security checks.
            </div>

            <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wide text-gb-text-dim">
              Backup password
            </label>

            <input
              type="password"
              value={backupPassword}
              onChange={(e) => setBackupPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              className="mt-2 w-full rounded-md border border-gb-border bg-gb-bg px-3 py-2 text-sm text-gb-text outline-none transition-colors focus:border-gb-accent-primary"
            />

            {backupError && (
              <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {backupError}
              </div>
            )}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={exportFullProfiles}
                disabled={backupBusy}
                className="rounded-md bg-gb-accent-primary px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {backupBusy ? 'Working...' : 'Export full backup'}
              </button>

              <label className="cursor-pointer rounded-md border border-gb-border px-3 py-2 text-xs font-semibold text-gb-text-dim transition-colors hover:bg-gb-surface-bright hover:text-gb-text">
                Import full backup
                <input
                  type="file"
                  accept=".gbprofile,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      void importFullProfiles(file);
                    }
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      )}

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

      {toastMessage && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-[200] max-w-sm rounded-xl border border-gb-border bg-gb-surface/95 px-4 py-3 text-sm text-gb-text shadow-2xl backdrop-blur">
          {toastMessage}
        </div>
      )}
    </div>
  );
}

function SettingsPageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="text-base font-semibold text-gb-text">{title}</h2>
      <p className="mt-1 text-xs text-gb-text-dim">{description}</p>
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
