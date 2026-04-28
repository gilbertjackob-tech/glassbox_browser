import React, { useState, useEffect, useRef } from 'react';
import { 
  Globe, 
  Plus, 
  X, 
  ArrowLeft, 
  ArrowRight, 
  RotateCw, 
  Search, 
  Terminal, 
  History, 
  Database, 
  Box, 
  Activity,
  ChevronRight,
  ChevronDown,
  Monitor,
  Cpu,
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { normalizeUrl, resolveNavigationInput, SEARCH_ENGINE_OPTIONS, type SearchEngineName } from './lib/urlUtils';

// --- Types ---

interface Tab {
  tabId: string;
  profileId: string;
  url: string;
  title: string;
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

// --- App Component ---

export default function App() {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>('default');
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [domSnapshot, setDomSnapshot] = useState<DomElement[]>([]);
  const [logs, setLogs] = useState<ActionLog[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [downloads, setDownloads] = useState<any[]>([]);
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [downloadsSearchQuery, setDownloadsSearchQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any>(null);
  const [suggestedSkills, setSuggestedSkills] = useState<any[]>([]);
  const [searchEngine, setSearchEngine] = useState<SearchEngineName>('duckduckgo');
  const [isNavigating, setIsNavigating] = useState(false);
  const [navError, setNavError] = useState<string | null>(null);
  const browserViewRef = useRef<HTMLDivElement>(null);

  const activeTab = tabs.find((t: Tab) => t.tabId === activeTabId);

  // Sync Electron View positioning
  useEffect(() => {
    if (!activeTabId || !browserViewRef.current) return;

    const syncBounds = () => {
      const rect = browserViewRef.current?.getBoundingClientRect();
      if (rect && (window as any).glassbox) {
        (window as any).glassbox.activateTab(activeTabId, {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        });
      }
    };

    const observer = new ResizeObserver(syncBounds);
    observer.observe(browserViewRef.current);
    syncBounds();

    return () => observer.disconnect();
  }, [activeTabId]);

  // Periodic metadata sync (history/logs)
  useEffect(() => {
    let isInitial = true;
    const init = async () => {
      try {
        await fetchProfiles();
        const res = await fetch('/api/tabs');
        const data = await res.json();
        const filteredData = data.filter((t: any) => t.profileId === activeProfileId);
        if (filteredData.length === 0) {
          // Automatically create default tab on startup
          createTab();
        } else {
          setTabs(filteredData);
          setActiveTabId(filteredData[0].tabId);
          console.log('Tabs:', filteredData.length);
          console.log('Active:', filteredData[0].tabId);
        }
      } catch {
        // ignore init fails or retries
      }
      fetchLogs();
      fetchHistory();
      fetchDownloads();
    };
    init();

    const interval = setInterval(() => {
      fetchTabs();
      fetchLogs();
      // To avoid stale closures we won't pass params here, just let them use default
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeTab && activeTab.url !== 'about:blank' && !isNavigating) {
      setUrlInput(activeTab.url);
    }
  }, [activeTab?.url]);

  const fetchProfiles = async () => {
    try {
      const res = await fetch('/api/profiles');
      const data = await res.json();
      setProfiles(data);
    } catch {
      // ignore
    }
  };

  const fetchTabs = async (profileId?: string) => {
    try {
      const res = await fetch('/api/tabs');
      const data = await res.json();
      const currentProfileId = profileId || activeProfileId;
      const filteredData = data.filter((t: any) => t.profileId === currentProfileId);
      setTabs(filteredData);
      
      // If active tab doesn't belong to current profile, switch to the first one available or null
      setTabs((currentTabs: Tab[]) => {
        setActiveTabId((currentActive: string | null) => {
          if (!currentTabs.find((t: Tab) => t.tabId === currentActive)) {
            return currentTabs.length > 0 ? currentTabs[0].tabId : null;
          }
          return currentActive;
        });
        return currentTabs;
      });
    } catch {
      // ignore
    }
  };

  const createProfile = async () => {
    const name = prompt('Enter new profile name:');
    if (!name) return;
    const res = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const newProfile = await res.json();
    await fetchProfiles();
    switchProfile(newProfile.id);
  };

  const switchProfile = async (profileId: string) => {
    setActiveProfileId(profileId);
    const res = await fetch('/api/tabs');
    const data = await res.json();
    const filteredData = data.filter((t: any) => t.profileId === profileId);
    setTabs(filteredData);
    
    if (filteredData.length === 0) {
      // Auto-create tab if none exists in this profile
      const createRes = await fetch('/api/tabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId })
      });
      const { id: tabId } = await createRes.json();
      setTabs([{ tabId, profileId, url: 'about:blank', title: 'New Tab' }]);
      setActiveTabId(tabId);
    } else {
      setActiveTabId(filteredData[0].tabId);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/memory/logs');
      setLogs(await res.json());
    } catch {
      // ignore
    }
  };

  const fetchHistory = async (q: string = '') => {
    try {
      const queryStr = q ? `?q=${encodeURIComponent(q)}` : '';
      const res = await fetch(`/api/memory/history${queryStr}`);
      setHistory(await res.json());
    } catch {
      // ignore
    }
  };

  const fetchDownloads = async (q: string = '') => {
    try {
      const queryStr = q ? `?q=${encodeURIComponent(q)}` : '';
      const res = await fetch(`/api/memory/downloads${queryStr}`);
      setDownloads(await res.json());
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
    const res = await fetch(`/api/memory/search?q=${encodeURIComponent(q)}`);
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

  const updateActiveTabData = async (specificTabId?: string) => {
    const id = specificTabId || activeTabId;
    if (!id) return;
    const domRes = await fetch(`/api/tabs/${id}/dom`);
    setDomSnapshot(await domRes.json());
  };

  const createTab = async (urlToAutoNavigate?: string) => {
    const res = await fetch('/api/tabs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: activeProfileId })
    });
    const { id: tabId } = await res.json();
    setTabs((prev: Tab[]) => {
      const newTabs: Tab[] = [...prev, { tabId, profileId: activeProfileId, url: 'about:blank', title: 'New Tab' }];
      console.log('Tabs:', newTabs.length);
      return newTabs;
    });
    setActiveTabId(tabId);
    console.log('Active:', tabId);
    
    if (typeof urlToAutoNavigate === 'string' && urlToAutoNavigate.trim().length > 0) {
      executeNavigate(tabId, urlToAutoNavigate);
    }
  };

  const closeTab = async (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    await fetch(`/api/tabs/${tabId}`, { method: 'DELETE' });
    await fetchTabs();
    if (activeTabId === tabId) setActiveTabId(null);
  };

  const executeNavigate = async (tabIdToUse: string, url: string) => {
    setNavError(null);
    setIsNavigating(true);
    
    const finalUrl = normalizeUrl(url);
    
    try {
      if ((window as any).api) {
         await (window as any).api.navigate(finalUrl);
      } else {
        const resp = await fetch('/api/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intent: `Navigate to ${finalUrl}`,
            tabId: tabIdToUse,
            actionType: 'navigate',
            input: finalUrl
          })
        });
        const data = await resp.json();
        if (!data.success) {
          setNavError(data.reason || 'Navigation failed');
        }
      }
      await fetchTabs();
    } catch (e) {
      setNavError('Network error during navigation');
    }
    
    setIsNavigating(false);
    updateActiveTabData(tabIdToUse);
  };

  const navigate = async () => {
    if (!urlInput) return;
    
    const trimmedInput = urlInput.trim();

    const navigationTarget = resolveNavigationInput(trimmedInput, searchEngine);

    if (!navigationTarget.url) return;

    if (!activeTabId) {
      createTab(navigationTarget.url);
      return;
    }

    executeNavigate(activeTabId, navigationTarget.url);
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
        target: target,
        input: input
      })
    });
    updateActiveTabData();
    fetchLogs();
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden text-sm bg-gb-bg font-sans border border-gb-border">
      {/* Header: Browser Tabs & Controls */}
      <header className="flex flex-col border-b border-gb-border">
        {/* Tab Strip */}
        <div className="flex items-center bg-gb-surface px-2 py-1 gap-1 h-10">
          <div className="flex gap-1.5 pr-4 pl-1">
            <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/40"></div>
            <div className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/40"></div>
            <div className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500/40"></div>
          </div>
          
          <div className="flex-1 flex items-center space-x-1 overflow-x-auto scrollbar-hide">
            {tabs.map((tab: Tab) => (
              <div
                key={tab.tabId}
                onClick={() => setActiveTabId(tab.tabId)}
                className={`
                  group flex items-center px-4 py-1.5 rounded-t-md space-x-2 cursor-pointer transition-all border-x border-t min-w-[140px] max-w-[200px]
                  ${activeTabId === tab.tabId 
                    ? 'bg-gb-bg border-gb-border text-white' 
                    : 'border-transparent text-gb-text-dim opacity-60 hover:opacity-100'}
                `}
              >
                <Globe size={12} className={activeTabId === tab.tabId ? 'text-gb-accent-primary' : ''} />
                <span className="truncate flex-1 text-[11px] font-medium">
                  {tab.url !== 'about:blank' ? tab.url.replace('https://', '').replace('www.', '') : 'New Tab'}
                </span>
                <span 
                  className="ml-2 opacity-0 group-hover:opacity-100 hover:text-white transition-opacity"
                  onClick={(e: React.MouseEvent) => closeTab(e, tab.tabId)}
                >
                  ×
                </span>
              </div>
            ))}
            <button 
              onClick={() => createTab()}
              className="p-1 px-2 hover:bg-gb-surface-bright rounded text-gb-text-dim transition-colors"
            >
              +
            </button>
          </div>
        </div>

        {/* Navigation & Address Bar */}
        <div className="flex items-center gap-3 p-2 bg-gb-bg border-t border-gb-border">
          <div className="flex gap-2 text-gb-text-dim px-1">
            <button className="p-1 hover:text-white transition-colors"><ArrowLeft size={16} /></button>
            <button className="p-1 hover:text-white transition-colors"><ArrowRight size={16} /></button>
            <button className="p-1 hover:text-white transition-colors"><RotateCw size={16} /></button>
          </div>
          
          <div className="flex-1 flex items-center bg-gb-surface rounded-full border border-gb-border px-4 py-1.5 group focus-within:border-gb-accent-primary transition-colors">
            <span className="text-xs text-gb-accent-success mr-2">🔒</span>
            <input
              type="text"
              value={urlInput}
              placeholder="https://..."
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrlInput(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && navigate()}
              className="text-[11px] text-slate-200 flex-1 font-mono bg-transparent outline-none border-none p-0 h-4"
            />
            {navError && <span className="text-red-400 text-[10px] ml-2 truncate max-w-[150px]" title={navError}>{navError}</span>}
            {isNavigating && <RotateCw size={12} className="animate-spin text-gb-accent-primary ml-2" />}
          </div>

          <div className="flex items-center gap-2 pr-1">
            <div className="flex items-center px-2 py-1 rounded bg-gb-surface-bright border border-gb-border text-[9px] font-bold text-slate-200 focus-within:border-gb-accent-primary transition-colors">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mr-2 animate-pulse"></div>
              <span className="opacity-60 mr-1">PROFILE:</span>
              <select 
                value={activeProfileId} 
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    createProfile();
                  } else {
                    switchProfile(e.target.value);
                  }
                }}
                className="bg-transparent uppercase outline-none border-none text-slate-200 cursor-pointer appearance-none pr-3"
                style={{ backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%228%22%20height%3D%225%22%20viewBox%3D%220%200%208%205%22%20fill%3D%22none%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cpath%20d%3D%22M4%205L0%200H8L4%205Z%22%20fill%3D%22%2394A3B8%22/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right center' }}
              >
                {profiles.map(p => (
                  <option key={p.id} value={p.id} className="bg-gb-bg">{p.name || p.id}</option>
                ))}
                <option value="__new__" className="bg-gb-bg text-gb-accent-success">+ NEW PROFILE</option>
              </select>
            </div>
            <div className="flex items-center px-2 py-1 rounded bg-gb-surface-bright border border-gb-border text-[9px] font-bold text-slate-200 focus-within:border-gb-accent-primary transition-colors">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2 animate-pulse"></div>
              <span className="opacity-60 mr-1">ENGINE:</span>
              <select
                value={searchEngine}
                onChange={(e) => setSearchEngine(e.target.value as SearchEngineName)}
                className="bg-transparent uppercase outline-none border-none text-slate-200 cursor-pointer appearance-none pr-3"
                style={{ backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%228%22%20height%3D%225%22%20viewBox%3D%220%200%208%205%22%20fill%3D%22none%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cpath%20d%3D%22M4%205L0%200H8L4%205Z%22%20fill%3D%22%2394A3B8%22/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right center' }}
              >
                {SEARCH_ENGINE_OPTIONS.map(engine => (
                  <option key={engine} value={engine} className="bg-gb-bg">
                    {engine === 'duckduckgo' ? 'DuckDuckGo' : engine.charAt(0).toUpperCase() + engine.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <button 
              onClick={navigate}
              className="p-1.5 bg-gb-accent-primary hover:bg-blue-500 text-white rounded text-[11px] px-4 font-bold transition-colors"
            >
              EXECUTE
            </button>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Aside: Memory & History */}
        <aside className="w-56 border-r border-gb-border bg-gb-bg flex flex-col shrink-0">
          <div className="p-3 border-b border-gb-border">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gb-text-dim flex items-center gap-2">
              <Database size={10} /> Memory System
            </span>
            <div className="mt-2 relative">
              <input 
                type="text" 
                placeholder="Search history & skills..." 
                value={searchQuery}
                onChange={(e) => searchMemory(e.target.value)}
                className="w-full bg-gb-surface border border-gb-border rounded px-2 py-1 text-[10px] focus:outline-none focus:border-gb-accent-primary transition-colors text-slate-300"
              />
            </div>
          </div>
          <div className="flex-1 p-3 overflow-y-auto custom-scrollbar flex flex-col gap-5">
            <section>
              <span className="text-[10px] font-bold uppercase text-gb-text-dim block mb-2 px-1">Suggested Skills</span>
              <div className="space-y-1">
                {(suggestedSkills.length > 0 ? suggestedSkills : [
                  { name: 'Order Lookup', match: '94%' },
                  { name: 'Research Summary', match: '81%' }
                ]).map((skill: any, i: number) => (
                  <div key={i} className="p-2 rounded bg-gb-surface border border-slate-800 hover:border-gb-accent-primary cursor-pointer transition-colors group">
                    <div className="text-[11px] font-medium group-hover:text-white">{skill.name}</div>
                    <div className="text-[9px] text-gb-text-dim italic">Match: {skill.match || 'High Confidence'}</div>
                  </div>
                ))}
              </div>
            </section>
            <section className="flex-1">
              <span className="text-[10px] font-bold uppercase text-gb-text-dim block mb-2 px-1">Bookmarks Cache</span>
              <div className="text-[10px] space-y-2 opacity-80 px-1">
                <div className="truncate flex items-center gap-2 text-gb-text-dim hover:text-white cursor-pointer"><Box size={10} /> Fiverr Dashboard</div>
                <div className="truncate flex items-center gap-2 text-gb-text-dim hover:text-white cursor-pointer"><Box size={10} /> Google Search</div>
                <div className="truncate flex items-center gap-2 text-gb-text-dim hover:text-white cursor-pointer"><Box size={10} /> Playwright Docs</div>
              </div>
            </section>
          </div>
        </aside>

        {/* Center: Live Browser View */}
        <main className="flex-1 bg-[#0a0a0c] flex flex-col overflow-hidden relative glass-box-grid p-4">
          <div 
             ref={browserViewRef}
             className="flex-1 w-full bg-black rounded-lg shadow-2xl relative border border-gb-border overflow-hidden"
          >
            {!activeTabId && (
              <div className="flex flex-col items-center justify-center h-full">
              </div>
            )}
            
            {activeTabId && (
              <div className="absolute top-2 right-2 z-50 flex items-center gap-2 pointer-events-none">
                <span className="text-[8px] bg-emerald-500/80 text-white px-1.5 py-0.5 rounded font-bold shadow-lg animate-pulse">LIVE VIEW</span>
              </div>
            )}
          </div>
        </main>

        {/* Right Aside: Inspection & Logs */}
        <aside className="w-80 border-l border-gb-border bg-gb-bg flex flex-col shrink-0 overflow-y-auto custom-scrollbar">
          {/* DOM Snapshot Panel */}
          <div className="h-[250px] shrink-0 border-b border-gb-border flex flex-col">
            <div className="p-2 border-b border-gb-border flex justify-between items-center bg-gb-surface">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gb-text flex items-center gap-2">
                <Terminal size={10} className="text-gb-accent-primary" /> DOM Snapshot
              </span>
              <span className="text-[8px] px-1 bg-gb-accent-success/20 text-gb-accent-success border border-gb-accent-success/30 rounded font-bold">LIVE</span>
            </div>
            <div className="flex-1 p-2 overflow-y-auto custom-scrollbar font-mono text-[9px] space-y-1.5">
              {domSnapshot.length > 0 ? domSnapshot.slice(0, 50).map((el: DomElement, i: number) => (
                <div key={i} className="group cursor-pointer hover:bg-gb-surface-bright p-1 rounded transition-colors">
                  <div className="text-blue-400">&lt;{el.tag} {el.role && `role="${el.role}"`}&gt;</div>
                  <div className="pl-3 text-slate-500 opacity-60">• selector: {el.id ? `#${el.id}` : (el.selector || el.tag)}</div>
                  <div className="pl-3 text-emerald-500/80 italic opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                    <Activity size={8} /> // Click action available
                  </div>
                </div>
              )) : (
                <div className="h-full flex items-center justify-center text-gb-text-dim italic opacity-50 text-[9px]">
                  No elements scanned...
                </div>
              )}
            </div>
          </div>

          {/* Action Logs Panel */}
          <div className="h-[250px] shrink-0 border-b border-gb-border flex flex-col">
            <div className="p-2 border-b border-gb-border bg-gb-surface">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gb-text flex items-center gap-2">
                <Activity size={10} className="text-gb-accent-primary" /> Action Logs
              </span>
            </div>
            <div className="flex-1 p-3 overflow-y-auto custom-scrollbar font-mono text-[9px] space-y-3">
              {logs.map((log: ActionLog) => (
                <div key={log.id} className={`border-l-2 pl-2 flex flex-col gap-1 transition-all ${log.success ? 'border-gb-accent-success' : 'border-red-500'}`}>
                  <div className="text-white flex justify-between items-center">
                    <span className="font-bold flex items-center gap-1">
                      {log.action_type.toUpperCase()} 
                      {log.success && <span className="text-[8px] text-gb-accent-success">[VERIFIED]</span>}
                    </span>
                    <span className="text-gb-text-dim text-[8px]">{new Date(log.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div className="text-gb-text-dim text-[8px] truncate opacity-80 italic">Intent: {log.intent}</div>
                  <div className="flex flex-col gap-0.5 mt-1 opacity-60">
                    <div className="flex justify-between"><span>PRE_HASH:</span> <span className="text-blue-400">{log.before_dom_hash?.substring(0, 8)}</span></div>
                    <div className="flex justify-between"><span>POST_HASH:</span> <span className="text-blue-400">{log.after_dom_hash?.substring(0, 8)}</span></div>
                  </div>
                  {log.reason && <div className="text-red-400 text-[8px] mt-1">{log.reason}</div>}
                </div>
              ))}
              {logs.length === 0 && (
                <div className="h-full flex items-center justify-center text-gb-text-dim italic opacity-50 text-[9px]">
                  Log cache empty...
                </div>
              )}
            </div>
          </div>

          {/* Browser History Panel */}
          <div className="h-[250px] shrink-0 border-b border-gb-border flex flex-col">
            <div className="p-2 border-b border-gb-border bg-gb-surface flex flex-col gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gb-text flex items-center gap-2">
                <History size={10} className="text-gb-accent-primary" /> Browser History
              </span>
              <input 
                type="text" 
                placeholder="Search history..." 
                value={historySearchQuery}
                onChange={(e) => handleHistorySearch(e.target.value)}
                className="w-full bg-gb-bg border border-gb-border rounded px-2 py-1 text-[9px] focus:outline-none focus:border-gb-accent-primary transition-colors text-slate-300"
              />
            </div>
            <div className="flex-1 p-2 overflow-y-auto custom-scrollbar flex flex-col text-[10px]">
              {history.length > 0 ? history.map((item: any) => (
                <div key={item.id} className="group cursor-pointer hover:bg-gb-surface-bright p-1.5 rounded transition-colors flex flex-col border-b border-gb-border/50 last:border-0">
                  <div className="flex justify-between items-start gap-2">
                    <span className="font-medium text-slate-200 truncate flex-1">{item.title || item.url}</span>
                    <span className="text-[8px] text-gb-text-dim whitespace-nowrap">{new Date(item.last_visited).toLocaleDateString()} {new Date(item.last_visited).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                  </div>
                  <div className="text-blue-400/80 truncate mt-0.5 text-[9px]">{item.url}</div>
                </div>
              )) : (
                <div className="h-full flex items-center justify-center text-gb-text-dim italic opacity-50 text-[9px]">
                  No history matching query...
                </div>
              )}
            </div>
          </div>

          {/* Downloads Panel */}
          <div className="h-[250px] shrink-0 flex flex-col">
            <div className="p-2 border-b border-gb-border bg-gb-surface flex flex-col gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gb-text flex items-center gap-2">
                <Download size={10} className="text-gb-accent-primary" /> Downloads
              </span>
              <input 
                type="text" 
                placeholder="Search downloads..." 
                value={downloadsSearchQuery}
                onChange={(e) => handleDownloadsSearch(e.target.value)}
                className="w-full bg-gb-bg border border-gb-border rounded px-2 py-1 text-[9px] focus:outline-none focus:border-gb-accent-primary transition-colors text-slate-300"
              />
            </div>
            <div className="flex-1 p-2 overflow-y-auto custom-scrollbar flex flex-col text-[10px]">
              {downloads.length > 0 ? downloads.map((item: any) => (
                <div key={item.id} className="group cursor-pointer hover:bg-gb-surface-bright p-1.5 rounded transition-colors flex flex-col border-b border-gb-border/50 last:border-0">
                  <div className="flex justify-between items-start gap-2">
                    <span className="font-medium text-slate-200 truncate flex-1">{item.file_name || item.filename}</span>
                    <span className="text-[8px] text-gb-text-dim whitespace-nowrap">{new Date(item.timestamp || item.created_at).toLocaleDateString()} {new Date(item.timestamp || item.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                  </div>
                  <div className="text-blue-400/80 truncate mt-0.5 text-[9px]">{item.url}</div>
                </div>
              )) : (
                <div className="h-full flex items-center justify-center text-gb-text-dim italic opacity-50 text-[9px]">
                  No downloads matching query...
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Footer: Status Bar */}
      <footer className="h-7 bg-gb-surface border-t border-gb-border px-3 flex items-center justify-between text-[10px] font-medium shrink-0">
        <div className="flex gap-5 text-gb-text-dim">
          <span className="flex items-center gap-1.5">DB: <span className="text-slate-300">glassbox.sqlite</span></span>
          <span className="flex items-center gap-1.5">TAB_ID: <span className="text-slate-300 truncate max-w-[80px]">{activeTabId || 'NONE'}</span></span>
          <span className="flex items-center gap-1.5">SESSIONS: <span className="text-slate-300 font-bold">{tabs.length} Active</span></span>
        </div>
        <div className="flex items-center gap-5">
          <span className="flex items-center gap-1.5 text-gb-text-dim">
            API SERVER: <span className="text-gb-accent-success flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-gb-accent-success"></div> ONLINE</span>
          </span>
          <span className="px-1.5 py-0.5 bg-gb-accent-primary/20 text-gb-accent-primary border border-gb-accent-primary/30 rounded text-[9px] font-bold">v1.2.0-MVP</span>
        </div>
      </footer>
    </div>
  );
}
