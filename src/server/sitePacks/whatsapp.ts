import type { SiteStarterPack } from './types.js';

export const whatsappPack: SiteStarterPack = {
  host: 'web.whatsapp.com',
  aliases: [],
  targets: [
    {
      targetKey: 'chat_search_box',
      kind: 'input',
      selectors: [
        'div[contenteditable="true"][data-tab]',
        '[role="textbox"][contenteditable="true"]',
        'div[aria-label*="Search"][contenteditable="true"]',
        'div[title*="Search"][contenteditable="true"]',
      ],
      actions: ['focus', 'type', 'clear'],
      verify: {
        valueChanged: true,
      },
    },
    {
      targetKey: 'first_chat',
      kind: 'card',
      selectors: [
        '[aria-label*="Chat list"] [role="listitem"]',
        '[role="grid"] [role="row"]',
        '[data-testid="cell-frame-container"]',
        'div[role="listitem"]',
      ],
      actions: ['click'],
      verify: {
        domChanged: true,
      },
    },
    {
      targetKey: 'active_chat_header',
      kind: 'card',
      selectors: [
        'header [role="button"]',
        'header span[title]',
        'header',
      ],
      actions: [],
      verify: {},
    },
    {
      targetKey: 'message_box',
      kind: 'input',
      selectors: [
        'footer div[contenteditable="true"][data-tab]',
        'footer [role="textbox"][contenteditable="true"]',
        'div[aria-label*="Type a message"][contenteditable="true"]',
        'div[title*="Type a message"][contenteditable="true"]',
      ],
      actions: ['focus', 'type', 'clear'],
      verify: {
        valueChanged: true,
      },
    },
    {
      targetKey: 'send_button',
      kind: 'button',
      selectors: [
        'button[aria-label*="Send"]',
        'span[data-icon="send"]',
        '[data-testid="send"]',
      ],
      actions: ['click'],
      verify: {
        domChanged: true,
      },
    },
    {
      targetKey: 'attach_button',
      kind: 'button',
      selectors: [
        'button[aria-label*="Attach"]',
        'span[data-icon="plus"]',
        'span[data-icon="clip"]',
        '[data-testid*="attach"]',
      ],
      actions: ['click'],
      verify: {
        domChanged: true,
      },
    },
    {
      targetKey: 'voice_call_button',
      kind: 'button',
      selectors: [
        'button[aria-label*="Voice call"]',
        'span[data-icon*="call"]',
      ],
      actions: ['click'],
      verify: {
        domChanged: true,
      },
    },
    {
      targetKey: 'video_call_button',
      kind: 'button',
      selectors: [
        'button[aria-label*="Video call"]',
        'span[data-icon*="video-call"]',
      ],
      actions: ['click'],
      verify: {
        domChanged: true,
      },
    },
    {
      targetKey: 'qr_code',
      kind: 'card',
      selectors: [
        'canvas',
        'div[data-ref]',
        '[aria-label*="Scan"]',
      ],
      actions: [],
      verify: {},
    },
  ],
  microSkills: [
    {
      name: 'whatsapp_search_chat',
      queryPattern: 'search whatsapp chat',
      steps: [
        {
          name: 'type chat search',
          targetKey: 'chat_search_box',
          kind: 'input',
          action: 'type',
          text: '{{chat}}',
          clearFirst: true,
          verify: {
            valueChanged: true,
          },
        },
      ],
    },
    {
      name: 'whatsapp_open_first_chat',
      queryPattern: 'open first whatsapp chat',
      steps: [
        {
          name: 'open first chat',
          targetKey: 'first_chat',
          kind: 'card',
          action: 'click',
          verify: {
            domChanged: true,
          },
        },
      ],
    },
    {
      name: 'whatsapp_prepare_message',
      queryPattern: 'prepare whatsapp message',
      steps: [
        {
          name: 'type message without sending',
          targetKey: 'message_box',
          kind: 'input',
          action: 'type',
          text: '{{message}}',
          clearFirst: true,
          verify: {
            valueChanged: true,
          },
        },
      ],
    },
  ],
};
