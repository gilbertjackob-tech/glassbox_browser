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

export async function detectWhatsAppRoom(input: {
  url: string;
  title?: string;
  resolveTarget: (targetKey: string, kind?: string) => Promise<any>;
  evaluate: (script: string) => Promise<any>;
}): Promise<SiteRoomResult> {
  const { host, path } = getPathAndParams(input.url);

  const domSignals = await input.evaluate(`
    (() => {
      const text = document.body?.innerText || '';
      const editableNodes = Array.from(document.querySelectorAll('div[contenteditable="true"], [role="textbox"][contenteditable="true"]'));
      const hasFooterComposer = Boolean(document.querySelector('footer div[contenteditable="true"], footer [role="textbox"][contenteditable="true"]'));
      const hasChatList = Boolean(
        document.querySelector('[aria-label*="Chat list"], [role="grid"], [data-testid="chat-list"], div[role="listitem"]')
      );
      const hasHeader = Boolean(document.querySelector('header'));
      const hasQr = Boolean(document.querySelector('canvas, div[data-ref], [aria-label*="Scan"]'));
      const hasLoginText = /link a device|use whatsapp on your computer|scan.*qr|qr code|log in/i.test(text);

      return {
        editableCount: editableNodes.length,
        hasFooterComposer,
        hasChatList,
        hasHeader,
        hasQr,
        hasLoginText,
        textSample: text.slice(0, 500),
        titleSample: document.title || '',
      };
    })();
  `).catch(() => ({ result: {} }));

  const signals = {
    path,
    ...(domSignals?.result || {}),
  };

  let room: SiteRoomResult['room'] = 'whatsapp_unknown';
  let confidence = 0.3;
  let landmarks: RoomLandmark[] = [];

  if (host !== 'web.whatsapp.com') {
    return {
      ok: false,
      host,
      site: 'whatsapp',
      room,
      confidence,
      url: input.url,
      title: input.title,
      signals,
      landmarks: [],
    };
  }

  const hasQr = Boolean((domSignals?.result || {}).hasQr);
  const hasLoginText = Boolean((domSignals?.result || {}).hasLoginText);
  const hasChatList = Boolean((domSignals?.result || {}).hasChatList);
  const hasFooterComposer = Boolean((domSignals?.result || {}).hasFooterComposer);
  const hasHeader = Boolean((domSignals?.result || {}).hasHeader);

  if ((hasQr || hasLoginText) && !hasChatList) {
    room = 'whatsapp_auth';
    confidence = 0.95;
    landmarks = [
      landmark('qr_code', { guarded: true, optional: true }),
    ];
  } else if (hasChatList && hasFooterComposer && hasHeader) {
    room = 'whatsapp_chat';
    confidence = 0.92;
    landmarks = [
      landmark('chat_search_box', { optional: true }),
      landmark('active_chat_header'),
      landmark('message_box'),
      landmark('send_button', { guarded: true }),
      landmark('attach_button', { guarded: true, optional: true }),
      landmark('voice_call_button', { guarded: true, optional: true }),
      landmark('video_call_button', { guarded: true, optional: true }),
    ];
  } else if (hasChatList) {
    room = 'whatsapp_home';
    confidence = 0.85;
    landmarks = [
      landmark('chat_search_box'),
      landmark('first_chat', { optional: true }),
    ];
  }

  const resolvedLandmarks: RoomLandmark[] = [];

  for (const item of landmarks) {
    const kind =
      item.targetKey.includes('button') ? 'button'
      : item.targetKey.includes('box') ? 'input'
      : item.targetKey.includes('chat') || item.targetKey.includes('code') || item.targetKey.includes('header') ? 'card'
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
    ok: room !== 'whatsapp_unknown',
    host,
    site: 'whatsapp',
    room,
    confidence,
    url: input.url,
    title: input.title,
    signals,
    landmarks: resolvedLandmarks,
    reason: room === 'whatsapp_auth'
      ? 'AUTH_REQUIRED'
      : undefined,
  };
}
