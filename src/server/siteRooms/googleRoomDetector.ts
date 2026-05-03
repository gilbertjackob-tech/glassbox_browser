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

export async function detectGoogleRoom(input: {
  url: string;
  title?: string;
  resolveTarget: (targetKey: string, kind?: string) => Promise<any>;
  evaluate: (script: string) => Promise<any>;
}): Promise<SiteRoomResult> {
  const { host, path, params } = getPathAndParams(input.url);

  const domSignals = await input.evaluate(`
    (() => {
      return {
        hasSearchInput: Boolean(document.querySelector('textarea[name="q"], input[name="q"], [role="combobox"][name="q"]')),
        hasResultsContainer: Boolean(document.querySelector('#search, #rso, [data-async-context]')),
        hasResultLinks: Boolean(document.querySelector('#search a[href], a[href^="http"]')),
        titleSample: document.title || '',
      };
    })();
  `).catch(() => ({ result: {} }));

  const signals = {
    path,
    hasQuery: params.has('q'),
    ...(domSignals?.result || {}),
  };

  let room: SiteRoomResult['room'] = 'google_unknown';
  let confidence = 0.3;
  let landmarks: RoomLandmark[] = [];

  if ((path === '/search' || params.has('q') || Boolean((domSignals?.result || {}).hasResultsContainer)) && host === 'google.com') {
    room = 'google_search_results';
    confidence = path === '/search' || params.has('q') ? 0.93 : 0.8;
    landmarks = [
      landmark('search_box'),
      landmark('first_result'),
      landmark('result_links'),
    ];
  } else if (host === 'google.com' && path === '/' && Boolean((domSignals?.result || {}).hasSearchInput)) {
    room = 'google_home';
    confidence = 0.95;
    landmarks = [
      landmark('search_box'),
      landmark('search_button', { optional: true }),
    ];
  }

  const resolvedLandmarks: RoomLandmark[] = [];

  for (const item of landmarks) {
    const kind =
      item.targetKey.includes('button') ? 'button'
      : item.targetKey.includes('box') ? 'input'
      : item.targetKey.includes('result') || item.targetKey.includes('link') ? 'link'
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
    ok: room !== 'google_unknown',
    host,
    site: 'google',
    room,
    confidence,
    url: input.url,
    title: input.title,
    signals,
    landmarks: resolvedLandmarks,
  };
}
