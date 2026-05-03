import { getSitePackForHost } from './sitePacks/index.js';

export async function resolveFromStarterPack(input: {
  tabUrl: string;
  runQuery: (selector: string) => Promise<any>;
  targetKey: string;
  kind?: string;
}) {
  function normalizeHost(url: string) {
    try {
      return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return String(url || '').toLowerCase().replace(/^www\./, '');
    }
  }

  function isGoogleExternalResult(href: string) {
    if (!href) return false;

    let parsed: URL;
    try {
      parsed = new URL(href, 'https://www.google.com');
    } catch {
      return false;
    }

    const normalizedHref = parsed.toString().toLowerCase();
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.toLowerCase();

    if (normalizedHref.startsWith('javascript:')) return false;
    if (path === '/search' || path === '/preferences' || path === '/advanced_search') return false;
    if (host === 'accounts.google.com' || host === 'support.google.com') return false;
    if (host === 'google.com' || host.endsWith('.google.com')) return false;

    return /^https?:/.test(parsed.protocol);
  }

  function isGitHubUsefulResult(href: string) {
    if (!href) return false;

    let parsed: URL;
    try {
      parsed = new URL(href, 'https://github.com');
    } catch {
      return false;
    }

    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'github.com') return false;

    const path = parsed.pathname;
    const parts = path.split('/').filter(Boolean);

    if (parts.length < 2) return false;

    const blockedFirst = new Set([
      'login',
      'signup',
      'features',
      'pricing',
      'search',
      'topics',
      'trending',
      'marketplace',
      'explore',
      'settings',
      'notifications',
      'pulls',
      'issues',
    ]);

    if (blockedFirst.has(parts[0])) return false;
    if (parsed.hash && !parsed.search && parts.length < 2) return false;

    return true;
  }

  const pack = getSitePackForHost(input.tabUrl);
  if (!pack) {
    return {
      found: false,
      reason: 'NO_SITE_PACK',
    };
  }

  const target = pack.targets.find((item) => item.targetKey === input.targetKey);
  if (!target) {
    return {
      found: false,
      reason: 'TARGET_NOT_IN_SITE_PACK',
      host: pack.host,
    };
  }

  if (input.kind && target.kind && input.kind !== target.kind) {
    return {
      found: false,
      reason: 'KIND_MISMATCH',
      host: pack.host,
      targetKey: input.targetKey,
    };
  }

  const attempts: any[] = [];
  const host = normalizeHost(input.tabUrl);

  for (const selector of target.selectors) {
    try {
      const result = await input.runQuery(selector);
      const elements = Array.isArray(result?.elements) ? result.elements : [];
      let element = elements[0];
      let resolvedSelector = selector;

      if (host === 'google.com' && (target.targetKey === 'first_result' || target.targetKey === 'result_links')) {
        const candidateIndex = elements.findIndex((item: any) => {
          const href = String(item?.attributes?.href || '');
          return item?.visible && item?.interactable && isGoogleExternalResult(href);
        });

        if (candidateIndex >= 0) {
          element = elements[candidateIndex];
          const href = String(element?.attributes?.href || '').replace(/"/g, '\\"');
          const concreteSelector = href ? `a[href="${href}"]` : '';
          if (concreteSelector) {
            resolvedSelector = concreteSelector;
          }
        } else {
          element = undefined;
        }
      }

      if (host === 'github.com' && target.targetKey === 'first_search_result') {
        const candidateIndex = elements.findIndex((item: any) => {
          const href = String(item?.attributes?.href || '');
          return item?.visible && item?.interactable && isGitHubUsefulResult(href);
        });

        if (candidateIndex >= 0) {
          element = elements[candidateIndex];
          const href = String(element?.attributes?.href || '').replace(/"/g, '\\"');
          const concreteSelector = href ? `a[href="${href}"]` : '';
          if (concreteSelector) {
            resolvedSelector = concreteSelector;
          }
        } else {
          element = undefined;
        }
      }

      attempts.push({
        selector,
        resolvedSelector,
        found: Boolean(element),
        visible: Boolean(element?.visible),
        enabled: Boolean(element?.interactable),
        href: element?.attributes?.href || '',
      });

      if (element?.visible && element?.interactable) {
        return {
          found: true,
          source: 'starter_pack',
          host: pack.host,
          targetKey: target.targetKey,
          target: {
            targetId: `starter_${target.targetKey}`,
            kind: target.kind || element.kind || input.kind || 'card',
            label: element.text || target.targetKey,
            selector: resolvedSelector,
            bbox: element.bbox,
            visible: element.visible,
            enabled: element.interactable,
            actions: target.actions || [],
            text: element.text || '',
          },
          starterTarget: target,
          attempts,
        };
      }
    } catch (error: any) {
      attempts.push({
        selector,
        error: error?.message || String(error),
      });
    }
  }

  return {
    found: false,
    reason: 'STARTER_PACK_TARGET_NOT_RESOLVED',
    host: pack.host,
    targetKey: input.targetKey,
    attempts,
  };
}
