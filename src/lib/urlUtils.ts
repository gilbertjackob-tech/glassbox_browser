const SEARCH_ENGINES = {
  duckduckgo: (query: string) => `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
  google: (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  bing: (query: string) => `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
};

const DEFAULT_SEARCH_ENGINE = 'duckduckgo';

export function normalizeUrl(url: string = ''): string {
  let finalUrl = url.trim();
  if (!finalUrl) return finalUrl;

  // Handle protocol schemes (http, https, ftp, etc.)
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(finalUrl)) {
    return finalUrl;
  }

  // Handle localhost and internal IPs
  if (finalUrl.startsWith('localhost') || finalUrl.startsWith('127.0.0.1') || finalUrl.startsWith('192.168.') || finalUrl.startsWith('10.')) {
    return finalUrl.startsWith('http') ? finalUrl : `http://${finalUrl}`;
  }

  // Handle IP addresses
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/;
  if (ipv4Pattern.test(finalUrl)) {
    return `http://${finalUrl}`;
  }

  // Handle URLs with common TLDs or subdomains without protocol
  if (finalUrl.includes('.') && !finalUrl.includes(' ') && !finalUrl.includes('?')) {
    // Looks like a domain, add https
    return `https://${finalUrl}`;
  }

  // Handle "www." prefix
  if (finalUrl.startsWith('www.')) {
    return `https://${finalUrl}`;
  }

  // Default: treat as search query
  return search(finalUrl);
}

export function search(query: string, engine: keyof typeof SEARCH_ENGINES = DEFAULT_SEARCH_ENGINE): string {
  const searchFn = SEARCH_ENGINES[engine];
  if (!searchFn) {
    return SEARCH_ENGINES[DEFAULT_SEARCH_ENGINE](query);
  }
  return searchFn(query);
}

export function isUrl(input: string): boolean {
  // Check if it's a URL-like string
  const urlPattern = /^(https?:\/\/|ftp:\/\/|localhost|127\.0\.0\.1|192\.168\.|10\.|www\.|[\w\-]+\.[\w\-]+\.)/;
  return urlPattern.test(input);
}

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
