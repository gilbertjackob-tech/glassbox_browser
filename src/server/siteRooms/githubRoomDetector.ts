import type { RoomLandmark, SiteRoomResult } from './types.js';

function getPathAndParams(url: string) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname.toLowerCase().replace(/^www\./, ''),
      path: parsed.pathname,
      params: parsed.searchParams,
    };
  } catch {
    return {
      host: 'unknown',
      path: '',
      params: new URLSearchParams(),
    };
  }
}

function landmark(targetKey: string, options: Partial<RoomLandmark> = {}): RoomLandmark {
  return {
    targetKey,
    expected: true,
    ...options,
  };
}

function looksLikeRepoPath(path: string) {
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2) return false;

  const blockedFirst = new Set([
    'search',
    'topics',
    'trending',
    'marketplace',
    'explore',
    'settings',
    'notifications',
    'pulls',
    'issues',
    'dashboard',
    'orgs',
    'apps',
    'features',
    'pricing',
    'login',
    'signup',
  ]);

  return !blockedFirst.has(parts[0]);
}

export async function detectGitHubRoom(input: {
  url: string;
  title?: string;
  resolveTarget: (targetKey: string, kind?: string) => Promise<any>;
  evaluate: (script: string) => Promise<any>;
}): Promise<SiteRoomResult> {
  const { host, path, params } = getPathAndParams(input.url);

  const domSignals = await input.evaluate(`
    (() => {
      return {
        hasGlobalSearch: Boolean(document.querySelector('input[name="q"], input[placeholder*="Search"], button[aria-label*="Search"]')),
        hasRepoNav: Boolean(document.querySelector('nav[aria-label*="Repository"], #repository-container-header, [data-testid="repository-container-header"]')),
        hasIssuesList: Boolean(document.querySelector('[aria-label="Issues"], [data-testid="issue-row"], a[href*="/issues/"]')),
        hasPullsList: Boolean(document.querySelector('[aria-label="Pull requests"], a[href*="/pull/"]')),
        hasSearchResults: Boolean(document.querySelector('[data-testid="results-list"], .search-title, a[href*="/"][href]')),
        titleSample: document.title || '',
      };
    })();
  `).catch(() => ({ result: {} }));

  const signals = {
    path,
    hasQuery: params.has('q'),
    ...(domSignals?.result || {}),
  };

  let room: SiteRoomResult['room'] = 'github_unknown';
  let confidence = 0.3;
  let landmarks: RoomLandmark[] = [];

  if (host !== 'github.com') {
    return {
      ok: false,
      host,
      site: 'github',
      room,
      confidence,
      url: input.url,
      title: input.title,
      signals,
      landmarks: [],
    };
  }

  if (path === '/' || path === '') {
    room = 'github_home';
    confidence = 0.9;
    landmarks = [
      landmark('global_search_box'),
      landmark('search_box'),
    ];
  } else if (path === '/search' || params.has('q')) {
    room = 'github_search_results';
    confidence = 0.9;
    landmarks = [
      landmark('global_search_box'),
      landmark('first_search_result', { optional: true }),
    ];
  } else if (/^\/[^/]+\/[^/]+\/issues\/?$/.test(path)) {
    room = 'github_issues';
    confidence = 0.92;
    landmarks = [
      landmark('global_search_box'),
      landmark('repo_code_tab'),
      landmark('repo_pulls_link'),
      landmark('first_issue_link', { optional: true }),
    ];
  } else if (/^\/[^/]+\/[^/]+\/pulls\/?$/.test(path)) {
    room = 'github_pulls';
    confidence = 0.92;
    landmarks = [
      landmark('global_search_box'),
      landmark('repo_code_tab'),
      landmark('repo_issues_link'),
      landmark('first_pr_link', { optional: true }),
    ];
  } else if (looksLikeRepoPath(path)) {
    room = 'github_repo';
    confidence = Boolean((domSignals?.result || {}).hasRepoNav) ? 0.93 : 0.75;
    landmarks = [
      landmark('global_search_box'),
      landmark('repo_code_tab', { optional: true }),
      landmark('repo_issues_link', { optional: true }),
      landmark('repo_pulls_link', { optional: true }),
    ];
  }

  const resolvedLandmarks: RoomLandmark[] = [];

  for (const item of landmarks) {
    const kind =
      item.targetKey.includes('box') ? 'input'
      : item.targetKey.includes('link') || item.targetKey.includes('tab') || item.targetKey.includes('result') ? 'link'
      : undefined;

    try {
      const resolved = await input.resolveTarget(item.targetKey, kind);
      resolvedLandmarks.push({
        ...item,
        found: Boolean(resolved?.found),
        source: resolved?.source || '',
        reason: resolved?.reason || '',
      });
    } catch (error: any) {
      resolvedLandmarks.push({
        ...item,
        found: false,
        reason: error?.message || String(error),
      });
    }
  }

  return {
    ok: room !== 'github_unknown',
    host,
    site: 'github',
    room,
    confidence,
    url: input.url,
    title: input.title,
    signals,
    landmarks: resolvedLandmarks,
  };
}
