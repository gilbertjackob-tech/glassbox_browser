import { detectYouTubeRoom } from './youtubeRoomDetector.js';
import type { SiteRoomResult } from './types.js';

function hostFromUrl(url: string) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

export async function detectSiteRoom(input: {
  url: string;
  title?: string;
  resolveTarget: (targetKey: string, kind?: string) => Promise<any>;
  evaluate: (script: string) => Promise<any>;
}): Promise<SiteRoomResult | null> {
  const host = hostFromUrl(input.url);

  if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    return detectYouTubeRoom(input);
  }

  return null;
}
