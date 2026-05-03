import type { SiteStarterPack } from './types.js';

export const githubPack: SiteStarterPack = {
  host: 'github.com',
  aliases: ['www.github.com'],
  targets: [
    {
      targetKey: 'global_search_box',
      kind: 'input',
      selectors: [
        'input[data-target="query-builder.input"]',
        'input[name="query-builder-test"]',
        'input[name="q"]',
        'input[placeholder*="Search"]',
        'button[data-target="qbsearch-input.inputButton"]',
        '[data-target="qbsearch-input.inputButtonText"]',
        'button[aria-label*="Search"]',
      ],
      actions: ['focus', 'type', 'clear'],
      verify: {
        focusConfirmed: true,
      },
    },
    {
      targetKey: 'search_box',
      kind: 'input',
      selectors: [
        'input[data-target="query-builder.input"]',
        'input[name="query-builder-test"]',
        'input[name="q"]',
        'input[placeholder*="Search"]',
        'button[data-target="qbsearch-input.inputButton"]',
        '[data-target="qbsearch-input.inputButtonText"]',
        'button[aria-label*="Search"]',
      ],
      actions: ['focus', 'type', 'clear'],
      verify: {
        focusConfirmed: true,
      },
    },
    {
      targetKey: 'repo_code_tab',
      kind: 'link',
      selectors: [
        'a[data-tab-item="code-tab"]',
        'a[href$="/tree/main"]',
        'a[href$="/tree/master"]',
        'a[href$="/"]',
      ],
      actions: ['click'],
      verify: {
        urlChanged: true,
      },
    },
    {
      targetKey: 'repo_issues_link',
      kind: 'link',
      selectors: [
        'a[data-tab-item="issues-tab"]',
        'a[data-content="Issues"]',
        'a#issues-tab',
        'a[href$="/issues"]',
        'a[href*="/issues"]',
      ],
      actions: ['click'],
      verify: {
        urlIncludes: '/issues',
      },
    },
    {
      targetKey: 'repo_pulls_link',
      kind: 'link',
      selectors: [
        'a[data-tab-item="pull-requests-tab"]',
        'a[data-content="Pull requests"]',
        'a#pull-requests-tab',
        'a[href$="/pulls"]',
        'a[href*="/pulls"]',
      ],
      actions: ['click'],
      verify: {
        urlIncludes: '/pulls',
      },
    },
    {
      targetKey: 'pull_requests_link',
      kind: 'link',
      selectors: [
        'a[data-tab-item="pull-requests-tab"]',
        'a[href$="/pulls"]',
        'a[href*="/pulls"]',
      ],
      actions: ['click'],
      verify: {
        urlIncludes: '/pulls',
      },
    },
    {
      targetKey: 'issues_link',
      kind: 'link',
      selectors: [
        'a[data-tab-item="issues-tab"]',
        'a[href$="/issues"]',
        'a[href*="/issues"]',
      ],
      actions: ['click'],
      verify: {
        urlIncludes: '/issues',
      },
    },
    {
      targetKey: 'first_search_result',
      kind: 'link',
      selectors: [
        '[data-testid="results-list"] a[href]',
        '.search-title a[href]',
        'a[href*="/"][href]',
      ],
      actions: ['click'],
      verify: {
        urlChanged: true,
      },
    },
    {
      targetKey: 'first_issue_link',
      kind: 'link',
      selectors: [
        '[aria-label="Issues"] a[href*="/issues/"]',
        'a[href*="/issues/"]',
      ],
      actions: ['click'],
      verify: {
        urlChanged: true,
      },
    },
    {
      targetKey: 'first_pr_link',
      kind: 'link',
      selectors: [
        '[aria-label="Pull requests"] a[href*="/pull/"]',
        'a[href*="/pull/"]',
      ],
      actions: ['click'],
      verify: {
        urlChanged: true,
      },
    },
  ],
  microSkills: [
    {
      name: 'github_search',
      queryPattern: 'search github',
      steps: [
        {
          name: 'open search',
          targetKey: 'global_search_box',
          kind: 'input',
          action: 'click',
          verify: {
            domChanged: true,
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
          keys: ['ArrowDown', 'Enter'],
          verify: {
            urlChanged: true,
          },
        },
      ],
    },
    {
      name: 'github_open_issues',
      queryPattern: 'open github issues',
      steps: [
        {
          name: 'open issues tab',
          targetKey: 'repo_issues_link',
          kind: 'link',
          action: 'click',
          verify: {
            urlIncludes: '/issues',
          },
        },
      ],
    },
    {
      name: 'github_open_pulls',
      queryPattern: 'open github pull requests',
      steps: [
        {
          name: 'open pulls tab',
          targetKey: 'repo_pulls_link',
          kind: 'link',
          action: 'click',
          verify: {
            urlIncludes: '/pulls',
          },
        },
      ],
    },
    {
      name: 'github_open_first_search_result',
      queryPattern: 'open first github search result',
      steps: [
        {
          name: 'open first search result',
          targetKey: 'first_search_result',
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
