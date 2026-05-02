import type { SiteStarterPack } from './types.js';

export const youtubePack: SiteStarterPack = {
  host: 'youtube.com',
  aliases: ['www.youtube.com', 'm.youtube.com'],
  targets: [
    {
      targetKey: 'search_box',
      kind: 'input',
      selectors: [
        'input[name="search_query"]',
        'input[placeholder="Search"]',
        '[role="combobox"][name="search_query"]',
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
        'button[aria-label="Search"]',
        'button[title="Search"]',
        'button#search-icon-legacy',
      ],
      actions: ['click'],
      verify: {
        urlChanged: true,
      },
    },
    {
      targetKey: 'first_video_result',
      kind: 'link',
      selectors: [
        'ytd-video-renderer a#video-title',
        'a#video-title',
        'ytd-rich-grid-media a#video-title-link',
      ],
      actions: ['click'],
      verify: {
        urlIncludes: '/watch',
      },
    },
  ],
  microSkills: [
    {
      name: 'youtube_search',
      queryPattern: 'search youtube',
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
      name: 'youtube_open_first_result',
      queryPattern: 'open first youtube result',
      steps: [
        {
          name: 'open first video result',
          targetKey: 'first_video_result',
          kind: 'link',
          action: 'click',
          verify: {
            urlIncludes: '/watch',
          },
        },
      ],
    },
  ],
};
