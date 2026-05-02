import type { SiteStarterPack } from './types.js';

export const chatgptPack: SiteStarterPack = {
  host: 'chatgpt.com',
  aliases: ['www.chatgpt.com'],
  targets: [
    {
      targetKey: 'prompt_box',
      kind: 'input',
      selectors: [
        'textarea[placeholder]',
        'textarea[data-testid="prompt-textarea"]',
        '[contenteditable="true"]',
        '#prompt-textarea',
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
  ],
};
