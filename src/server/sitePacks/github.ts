import type { SiteStarterPack } from './types.js';

export const githubPack: SiteStarterPack = {
  host: 'github.com',
  aliases: ['www.github.com'],
  targets: [
    {
      targetKey: 'search_box',
      kind: 'input',
      selectors: [
        'input[name="q"]',
        'input[placeholder*="Search"]',
        '[data-target="qbsearch-input.inputButtonText"]',
        'button[aria-label*="Search"]',
      ],
      actions: ['focus', 'type', 'clear'],
      verify: {
        focusConfirmed: true,
      },
    },
    {
      targetKey: 'pull_requests_link',
      kind: 'link',
      selectors: [
        'a[href$="/pulls"]',
        'a[href*="/pulls"]',
      ],
      actions: ['click'],
      verify: {
        urlIncludes: '/pull',
      },
    },
    {
      targetKey: 'issues_link',
      kind: 'link',
      selectors: [
        'a[href$="/issues"]',
        'a[href*="/issues"]',
      ],
      actions: ['click'],
      verify: {
        urlIncludes: '/issues',
      },
    },
  ],
  microSkills: [
    {
      name: 'github_search',
      queryPattern: 'search github',
      steps: [
        {
          name: 'focus search',
          targetKey: 'search_box',
          kind: 'input',
          action: 'focus',
          verify: {
            focusConfirmed: true,
          },
        },
        {
          name: 'type github search query',
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
          name: 'submit github search',
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
  ],
};
