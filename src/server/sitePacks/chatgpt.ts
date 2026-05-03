import type { SiteStarterPack } from './types.js';

export const chatgptPack: SiteStarterPack = {
  host: 'chatgpt.com',
  aliases: ['www.chatgpt.com'],
  targets: [
    {
      targetKey: 'prompt_box',
      kind: 'input',
      selectors: [
        'textarea[data-testid="prompt-textarea"]',
        '#prompt-textarea',
        'textarea[placeholder]',
        '[contenteditable="true"]',
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
        'button[data-testid="send-button"]',
        'button[aria-label*="Send"]',
        'button[type="submit"]',
      ],
      actions: ['click'],
      verify: {
        domChanged: true,
      },
    },
    {
      targetKey: 'new_chat_button',
      kind: 'button',
      selectors: [
        'a[href="/"]',
        'button[aria-label*="New chat"]',
        '[data-testid*="new-chat"]',
      ],
      actions: ['click'],
      verify: {
        urlChanged: true,
      },
    },
    {
      targetKey: 'last_assistant_message',
      kind: 'card',
      selectors: [
        '[data-message-author-role="assistant"]:last-of-type',
        '[data-testid*="conversation-turn"] [data-message-author-role="assistant"]',
        '.markdown',
      ],
      actions: ['click'],
      verify: {
        domChanged: true,
      },
    },
    {
      targetKey: 'last_user_message',
      kind: 'card',
      selectors: [
        '[data-message-author-role="user"]:last-of-type',
        '[data-testid*="conversation-turn"] [data-message-author-role="user"]',
      ],
      actions: ['click'],
      verify: {
        domChanged: true,
      },
    },
    {
      targetKey: 'conversation_list',
      kind: 'card',
      selectors: [
        'nav a[href^="/c/"]',
        'a[href^="/c/"]',
      ],
      actions: ['click'],
      verify: {
        domChanged: true,
      },
    },
  ],
  microSkills: [
    {
      name: 'chatgpt_send_prompt',
      queryPattern: 'send chatgpt prompt',
      steps: [
        {
          name: 'type prompt',
          targetKey: 'prompt_box',
          kind: 'input',
          action: 'type',
          text: '{{prompt}}',
          clearFirst: true,
          verify: {
            valueChanged: true,
          },
        },
        {
          name: 'send prompt',
          targetKey: 'send_button',
          kind: 'button',
          action: 'click',
          verify: {
            domChanged: true,
          },
        },
      ],
    },
    {
      name: 'chatgpt_new_chat',
      queryPattern: 'start new chatgpt chat',
      steps: [
        {
          name: 'new chat',
          targetKey: 'new_chat_button',
          kind: 'button',
          action: 'click',
          verify: {
            urlChanged: true,
          },
        },
      ],
    },
  ],
};
