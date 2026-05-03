import type { SiteStarterPack } from './types.js';

export const geminiPack: SiteStarterPack = {
  host: 'gemini.google.com',
  aliases: [],
  targets: [
    {
      targetKey: 'prompt_box',
      kind: 'input',
      selectors: [
        'div[contenteditable="true"]',
        'rich-textarea div[contenteditable="true"]',
        'textarea[aria-label*="Enter a prompt"]',
        'textarea[placeholder]',
        '[aria-label*="Enter a prompt"]',
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
        'button[aria-label*="Submit"]',
        'button[data-testid*="send"]',
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
        'button[aria-label*="New chat"]',
        'a[aria-label*="New chat"]',
        '[data-test-id*="new-chat"]',
      ],
      actions: ['click'],
      verify: {
        domChanged: true,
      },
    },
    {
      targetKey: 'last_model_response',
      kind: 'card',
      selectors: [
        'message-content:last-of-type',
        '.model-response-text:last-of-type',
        '[class*="model-response"]:last-of-type',
        '[data-test-id*="model-response"]:last-of-type',
      ],
      actions: [],
      verify: {},
    },
    {
      targetKey: 'last_user_message',
      kind: 'card',
      selectors: [
        '[class*="user-query"]:last-of-type',
        '[data-test-id*="user-message"]:last-of-type',
        '[class*="user-message"]:last-of-type',
      ],
      actions: [],
      verify: {},
    },
    {
      targetKey: 'login_button',
      kind: 'button',
      selectors: [
        'a[href*="accounts.google.com"]',
        'button[aria-label*="Sign in"]',
        'a[aria-label*="Sign in"]',
      ],
      actions: ['click'],
      verify: {
        urlChanged: true,
      },
    },
  ],
  microSkills: [
    {
      name: 'gemini_send_prompt',
      queryPattern: 'send gemini prompt',
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
      name: 'gemini_new_chat',
      queryPattern: 'start new gemini chat',
      steps: [
        {
          name: 'new chat',
          targetKey: 'new_chat_button',
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
