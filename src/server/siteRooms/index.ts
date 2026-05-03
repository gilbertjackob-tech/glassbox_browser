import { detectChatGptRoom } from './chatgptRoomDetector.js';
import { detectGeminiRoom } from './geminiRoomDetector.js';
import { detectGitHubRoom } from './githubRoomDetector.js';
import { detectGoogleRoom } from './googleRoomDetector.js';
import { detectWhatsAppRoom } from './whatsappRoomDetector.js';
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

  if (host === 'chatgpt.com' || host.endsWith('.chatgpt.com')) {
    return detectChatGptRoom(input);
  }

  if (host === 'gemini.google.com') {
    return detectGeminiRoom(input);
  }

  if (host === 'google.com' || host.endsWith('.google.com')) {
    return detectGoogleRoom(input);
  }

  if (host === 'github.com') {
    return detectGitHubRoom(input);
  }

  if (host === 'web.whatsapp.com') {
    return detectWhatsAppRoom(input);
  }

  return null;
}
