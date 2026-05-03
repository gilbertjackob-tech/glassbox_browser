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

export async function detectChatGptRoom(input: {
  url: string;
  title?: string;
  resolveTarget: (targetKey: string, kind?: string) => Promise<any>;
  evaluate: (script: string) => Promise<any>;
}): Promise<SiteRoomResult> {
  const { host, path } = getPathAndParams(input.url);

  const domSignals = await input.evaluate(`
    (() => {
      const assistantMessages = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
      const userMessages = Array.from(document.querySelectorAll('[data-message-author-role="user"]'));

      return {
        hasPromptBox: Boolean(document.querySelector('textarea[data-testid="prompt-textarea"], #prompt-textarea, textarea[placeholder], [contenteditable="true"]')),
        hasSendButton: Boolean(document.querySelector('button[data-testid="send-button"], button[aria-label*="Send"], button[type="submit"]')),
        assistantMessageCount: assistantMessages.length,
        userMessageCount: userMessages.length,
        hasConversationList: Boolean(document.querySelector('nav a[href^="/c/"], a[href^="/c/"]')),
        hasAuthButtons: Boolean(document.querySelector('button[data-testid="login-button"], button[data-testid="signup-button"], a[href*="/auth/login"], a[href*="/auth/signup"]')),
        titleSample: document.title || '',
      };
    })();
  `).catch(() => ({ result: {} }));

  const signals = {
    path,
    ...(domSignals?.result || {}),
  };

  let room: SiteRoomResult['room'] = 'chatgpt_unknown';
  let confidence = 0.3;
  let landmarks: RoomLandmark[] = [];

  if (host !== 'chatgpt.com') {
    return {
      ok: false,
      host,
      site: 'chatgpt',
      room,
      confidence,
      url: input.url,
      title: input.title,
      signals,
      landmarks: [],
    };
  }

  const assistantCount = Number((domSignals?.result || {}).assistantMessageCount || 0);
  const userCount = Number((domSignals?.result || {}).userMessageCount || 0);
  const hasPromptBox = Boolean((domSignals?.result || {}).hasPromptBox);
  const hasAuthButtons = Boolean((domSignals?.result || {}).hasAuthButtons);

  if ((path.startsWith('/c/') || assistantCount > 0 || userCount > 0) && hasPromptBox) {
    room = 'chatgpt_chat';
    confidence = path.startsWith('/c/') ? 0.95 : 0.85;
    landmarks = [
      landmark('prompt_box'),
      landmark('send_button', { optional: true }),
      landmark('last_assistant_message', { optional: true }),
      landmark('last_user_message', { optional: true }),
      landmark('new_chat_button', { optional: true }),
      landmark('conversation_list', { optional: true }),
    ];
  } else if (hasPromptBox || path === '/' || path === '') {
    room = 'chatgpt_home';
    confidence = hasPromptBox ? 0.9 : 0.65;
    landmarks = [
      landmark('prompt_box'),
      landmark('send_button', { optional: true }),
      landmark('new_chat_button', { optional: true }),
      landmark('conversation_list', { optional: true }),
    ];
  } else if (path.startsWith('/auth/') || hasAuthButtons) {
    confidence = path.startsWith('/auth/') ? 0.85 : 0.7;
  }

  const resolvedLandmarks: RoomLandmark[] = [];

  for (const item of landmarks) {
    const kind =
      item.targetKey.includes('button') ? 'button'
      : item.targetKey.includes('box') ? 'input'
      : item.targetKey.includes('message') ? 'card'
      : item.targetKey.includes('list') ? 'card'
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
    ok: room !== 'chatgpt_unknown',
    host,
    site: 'chatgpt',
    room,
    confidence,
    url: input.url,
    title: input.title,
    signals,
    landmarks: resolvedLandmarks,
    reason: room === 'chatgpt_unknown' && (path.startsWith('/auth/') || hasAuthButtons)
      ? 'AUTH_REQUIRED'
      : undefined,
  };
}
