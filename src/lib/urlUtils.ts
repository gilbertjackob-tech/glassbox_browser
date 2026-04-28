export type SearchEngineName = 'duckduckgo' | 'google' | 'bing';

const SEARCH_ENGINES: Record<SearchEngineName, (query: string) => string> = {
  duckduckgo: (query: string) => `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
  google: (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  bing: (query: string) => `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
};

const SEARCH_ENGINE_HOMES: Record<SearchEngineName, string> = {
  duckduckgo: 'https://duckduckgo.com/',
  google: 'https://www.google.com/',
  bing: 'https://www.bing.com/',
};

const ENGINE_ALIASES: Record<string, SearchEngineName> = {
  ddg: 'duckduckgo',
  duckduckgo: 'duckduckgo',
  google: 'google',
  g: 'google',
  bing: 'bing',
};

const DEFAULT_SEARCH_ENGINE: SearchEngineName = 'duckduckgo';

export function normalizeUrl(url: string = ''): string {
  const finalUrl = url.trim();
  if (!finalUrl) return finalUrl;

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(finalUrl)) {
    return finalUrl;
  }

  if (
    finalUrl.startsWith('localhost') ||
    finalUrl.startsWith('127.0.0.1') ||
    finalUrl.startsWith('192.168.') ||
    finalUrl.startsWith('10.')
  ) {
    return finalUrl.startsWith('http') ? finalUrl : `http://${finalUrl}`;
  }

  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/;
  if (ipv4Pattern.test(finalUrl)) {
    return `http://${finalUrl}`;
  }

  if (finalUrl.startsWith('www.')) {
    return `https://${finalUrl}`;
  }

  if (finalUrl.includes('.') && !/\s/.test(finalUrl)) {
    return `https://${finalUrl}`;
  }

  return search(finalUrl);
}

export function search(query: string, engine: SearchEngineName = DEFAULT_SEARCH_ENGINE): string {
  const searchFn = SEARCH_ENGINES[engine] || SEARCH_ENGINES[DEFAULT_SEARCH_ENGINE];
  return searchFn(query);
}

export function getSearchEngineHome(engine: SearchEngineName = DEFAULT_SEARCH_ENGINE): string {
  return SEARCH_ENGINE_HOMES[engine] || SEARCH_ENGINE_HOMES[DEFAULT_SEARCH_ENGINE];
}

export function isUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
    return true;
  }

  if (/^(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?(\/|$)/.test(trimmed)) {
    return true;
  }

  if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/|$)/.test(trimmed)) {
    return true;
  }

  if (/\s/.test(trimmed)) {
    return false;
  }

  return trimmed.includes('.');
}

export function resolveNavigationInput(
  input: string,
  defaultEngine: SearchEngineName = DEFAULT_SEARCH_ENGINE
): { kind: 'url' | 'search' | 'engine-home'; url: string; engine: SearchEngineName; query?: string } {
  const trimmed = input.trim();

  if (!trimmed) {
    return { kind: 'search', url: '', engine: defaultEngine, query: '' };
  }

  if (isUrl(trimmed)) {
    return { kind: 'url', url: normalizeUrl(trimmed), engine: defaultEngine };
  }

  const [firstToken, ...restTokens] = trimmed.split(/\s+/);
  const engine = ENGINE_ALIASES[firstToken.toLowerCase()];
  const rest = restTokens.join(' ').trim();

  if (engine && !rest) {
    return { kind: 'engine-home', url: getSearchEngineHome(engine), engine };
  }

  if (engine && rest) {
    return { kind: 'search', url: search(rest, engine), engine, query: rest };
  }

  return { kind: 'search', url: search(trimmed, defaultEngine), engine: defaultEngine, query: trimmed };
}

export const SEARCH_ENGINE_OPTIONS: SearchEngineName[] = ['duckduckgo', 'google', 'bing'];

export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    return urlObj.hostname;
  } catch {
    return url;
  }
}

export function getDisplayUrl(url: string): string {
  const domain = extractDomain(url);
  return domain.replace('www.', '');
}
