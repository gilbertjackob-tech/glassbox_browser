import type { SiteStarterPack } from './types.js';

export const googlePack: SiteStarterPack = {
  host: 'google.com',
  aliases: ['www.google.com'],
  targets: [
    {
      targetKey: 'search_box',
      kind: 'input',
      selectors: [
        'textarea[name="q"]',
        'input[name="q"]',
        '[role="combobox"][name="q"]',
        'textarea[aria-label*="Search"]',
      ],
      actions: ['focus', 'type', 'clear'],
      verify: {
        valueChanged: true,
      },
    },
    {
      targetKey: 'search_button',
      kind: 'button',
      selectors: [
        'input[name="btnK"]',
        'button[aria-label*="Search"]',
        '[role="button"][aria-label*="Search"]',
      ],
      actions: ['click'],
      verify: {
        urlChanged: true,
      },
    },
    {
      targetKey: 'first_result',
      kind: 'link',
      selectors: [
        'a[jsname][href]',
        '#search a[href]',
        'a[href^="http"]',
      ],
      actions: ['click'],
      verify: {
        urlChanged: true,
      },
    },
    {
      targetKey: 'result_links',
      kind: 'link',
      selectors: [
        '#search a[href]',
        'a[href^="http"]',
      ],
      actions: ['click'],
      verify: {
        urlChanged: true,
      },
    },
  ],
  microSkills: [
    {
      name: 'google_search',
      queryPattern: 'search google',
      steps: [
        {
          name: 'type search query',
          targetKey: 'search_box',
          kind: 'input',
          action: 'type',
          text: '{{query}}',
          clearFirst: true,
          verify: {
            valueChanged: true,
          },
        },
        {
          name: 'submit search',
          targetKey: 'search_box',
          kind: 'input',
          action: 'press',
          key: 'Enter',
          verify: {
            urlChanged: true,
          },
        },
      ],
    },
    {
      name: 'google_open_first_result',
      queryPattern: 'open first google result',
      steps: [
        {
          name: 'open first result',
          targetKey: 'first_result',
          kind: 'link',
          action: 'click',
          verify: {
            urlChanged: true,
          },
        },
      ],
    },
    {
      name: 'google_search_and_open_first',
      queryPattern: 'search google and open first result',
      steps: [
        {
          name: 'type search query',
          targetKey: 'search_box',
          kind: 'input',
          action: 'type',
          text: '{{query}}',
          clearFirst: true,
          verify: {
            valueChanged: true,
          },
        },
        {
          name: 'submit search',
          targetKey: 'search_box',
          kind: 'input',
          action: 'press',
          key: 'Enter',
          verify: {
            urlChanged: true,
          },
        },
        {
          name: 'open first result',
          targetKey: 'first_result',
          kind: 'link',
          action: 'click',
          verify: {
            urlChanged: true,
          },
        },
      ],
    },
  ],
};
