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

export async function detectYouTubeRoom(input: {
  url: string;
  title?: string;
  resolveTarget: (targetKey: string, kind?: string) => Promise<any>;
  evaluate: (script: string) => Promise<any>;
}): Promise<SiteRoomResult> {
  const { host, path, params } = getPathAndParams(input.url);

  const domSignals = await input.evaluate(`
    (() => {
      return {
        hasSearchInput: Boolean(document.querySelector('input[name="search_query"], input[placeholder="Search"]')),
        hasVideoRenderer: Boolean(document.querySelector('ytd-video-renderer, ytd-rich-grid-media, ytd-compact-video-renderer')),
        hasMoviePlayer: Boolean(document.querySelector('#movie_player, .html5-video-player, video')),
        hasChannelHeader: Boolean(document.querySelector('ytd-c4-tabbed-header-renderer, ytd-page-header-renderer, #channel-header')),
        hasRichGrid: Boolean(document.querySelector('ytd-rich-grid-renderer')),
        hasGuide: Boolean(document.querySelector('ytd-guide-renderer, #guide')),
        bodyTextSample: (document.body?.innerText || '').slice(0, 500),
      };
    })();
  `).catch(() => ({ result: {} }));

  const signals = {
    path,
    hasSearchQuery: params.has('search_query'),
    hasVideoId: params.has('v'),
    ...(domSignals?.result || {}),
  };

  let room: SiteRoomResult['room'] = 'youtube_unknown';
  let confidence = 0.3;
  let landmarks: RoomLandmark[] = [];

  if (path === '/watch' && params.has('v')) {
    room = 'youtube_watch_page';
    confidence = 0.95;
    landmarks = [
      landmark('video_player'),
      landmark('play_pause_button'),
      landmark('like_button', { guarded: true }),
      landmark('subscribe_button', { guarded: true }),
      landmark('comment_box', { optional: true }),
      landmark('search_box'),
    ];
  } else if (path === '/results' && params.has('search_query')) {
    room = 'youtube_search_results';
    confidence = 0.92;
    landmarks = [
      landmark('search_box'),
      landmark('first_video_result'),
      landmark('video_card'),
      landmark('video_title_link'),
      landmark('channel_link', { optional: true }),
    ];
  } else if (
    path.startsWith('/@') ||
    path.startsWith('/channel/') ||
    path.startsWith('/c/') ||
    path.startsWith('/user/')
  ) {
    room = 'youtube_channel_page';
    confidence = 0.85;
    landmarks = [
      landmark('search_box'),
      landmark('subscribe_button', { guarded: true, optional: true }),
      landmark('video_card', { optional: true }),
      landmark('video_title_link', { optional: true }),
      landmark('channel_link', { optional: true }),
    ];
  } else if (host === 'youtube.com') {
    room = 'youtube_home';
    confidence = path === '/' ? 0.9 : 0.65;
    landmarks = [
      landmark('search_box'),
      landmark('video_card', { optional: true }),
      landmark('video_title_link', { optional: true }),
    ];
  }

  const resolvedLandmarks: RoomLandmark[] = [];

  for (const item of landmarks) {
    const kind =
      item.targetKey.includes('button') ? 'button' :
      item.targetKey.includes('box') ? 'input' :
      item.targetKey.includes('link') || item.targetKey.includes('result') ? 'link' :
      undefined;

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
    ok: room !== 'youtube_unknown',
    host,
    site: 'youtube',
    room,
    confidence,
    url: input.url,
    title: input.title,
    signals,
    landmarks: resolvedLandmarks,
  };
}
