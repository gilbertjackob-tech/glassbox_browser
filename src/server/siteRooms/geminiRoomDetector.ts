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

export async function detectGeminiRoom(input: {
  url: string;
  title?: string;
  resolveTarget: (targetKey: string, kind?: string) => Promise<any>;
  evaluate: (script: string) => Promise<any>;
}): Promise<SiteRoomResult> {
  const { host, path } = getPathAndParams(input.url);

  const domSignals = await input.evaluate(`
    (() => {
      const text = document.body?.innerText || '';
      return {
        hasPromptBox: Boolean(
          document.querySelector('div[contenteditable="true"], rich-textarea div[contenteditable="true"], textarea[placeholder], [aria-label*="Enter a prompt"]')
        ),
        hasSendButton: Boolean(
          document.querySelector('button[aria-label*="Send"], button[aria-label*="Submit"], button[type="submit"]')
        ),
        hasModelResponse: Boolean(
          document.querySelector('message-content, .model-response-text, [class*="model-response"], [data-test-id*="model-response"]')
        ),
        hasUserMessage: Boolean(
          document.querySelector('[class*="user-query"], [data-test-id*="user-message"], [class*="user-message"]')
        ),
        hasAuthLink: Boolean(
          document.querySelector('a[href*="accounts.google.com"], button[aria-label*="Sign in"], a[aria-label*="Sign in"]')
        ),
        hasAuthText: /sign in|login|log in|get started/i.test(text),
        titleSample: document.title || '',
        textSample: text.slice(0, 500),
      };
    })();
  `).catch(() => ({ result: {} }));

  const signals = {
    path,
    ...(domSignals?.result || {}),
  };

  let room: SiteRoomResult['room'] = 'gemini_unknown';
  let confidence = 0.3;
  let landmarks: RoomLandmark[] = [];

  if (host !== 'gemini.google.com') {
    return {
      ok: false,
      host,
      site: 'gemini',
      room,
      confidence,
      url: input.url,
      title: input.title,
      signals,
      landmarks: [],
    };
  }

  const hasPromptBox = Boolean((domSignals?.result || {}).hasPromptBox);
  const hasModelResponse = Boolean((domSignals?.result || {}).hasModelResponse);
  const hasUserMessage = Boolean((domSignals?.result || {}).hasUserMessage);
  const hasAuthLink = Boolean((domSignals?.result || {}).hasAuthLink);
  const hasAuthText = Boolean((domSignals?.result || {}).hasAuthText);

  if ((hasAuthLink || hasAuthText) && !hasPromptBox) {
    room = 'gemini_auth';
    confidence = 0.95;
    landmarks = [
      landmark('login_button', { guarded: true, optional: true }),
    ];
  } else if (hasPromptBox && (hasModelResponse || hasUserMessage)) {
    room = 'gemini_chat';
    confidence = 0.9;
    landmarks = [
      landmark('prompt_box'),
      landmark('send_button', { optional: true }),
      landmark('last_model_response', { optional: true }),
      landmark('last_user_message', { optional: true }),
      landmark('new_chat_button', { optional: true }),
    ];
  } else if (hasPromptBox || path === '/' || path === '') {
    room = 'gemini_home';
    confidence = hasPromptBox ? 0.9 : 0.65;
    landmarks = [
      landmark('prompt_box'),
      landmark('send_button', { optional: true }),
      landmark('new_chat_button', { optional: true }),
    ];
  }

  const resolvedLandmarks: RoomLandmark[] = [];

  for (const item of landmarks) {
    const kind =
      item.targetKey.includes('button') ? 'button'
      : item.targetKey.includes('box') ? 'input'
      : item.targetKey.includes('message') || item.targetKey.includes('response') ? 'card'
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
    ok: room !== 'gemini_unknown',
    host,
    site: 'gemini',
    room,
    confidence,
    url: input.url,
    title: input.title,
    signals,
    landmarks: resolvedLandmarks,
    reason: room === 'gemini_auth'
      ? 'AUTH_REQUIRED'
      : undefined,
  };
}
