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
        'a.ytLockupMetadataViewModelTitle[href*="/watch"]',
        'ytd-video-renderer a#video-title',
        'ytd-video-renderer a#video-title[href*="/watch"]',
        'ytd-video-renderer a#thumbnail[href*="/watch"]',
        'a#video-title',
        'a#thumbnail[href*="/watch"]',
        'a#video-title[href*="/watch"]',
        'ytd-rich-grid-media a#video-title-link',
      ],
      actions: ['click'],
      verify: {
        urlIncludes: '/watch',
      },
    },
    {
      targetKey: 'video_card',
      kind: 'card',
      selectors: [
        'ytd-video-renderer',
        'ytd-rich-grid-media',
        'ytd-compact-video-renderer',
      ],
      actions: ['click'],
      verify: {
        domChanged: true,
      },
    },
    {
      targetKey: 'video_title_link',
      kind: 'link',
      selectors: [
        'ytd-video-renderer a#video-title',
        'a#video-title',
        'ytd-rich-grid-media a#video-title-link',
        'a.ytLockupMetadataViewModelTitle[href*="/watch"]',
      ],
      actions: ['click'],
      verify: {
        urlIncludes: '/watch',
      },
    },
    {
      targetKey: 'channel_link',
      kind: 'link',
      selectors: [
        'ytd-video-renderer a.yt-simple-endpoint.yt-formatted-string',
        '#channel-name a',
        'a[href*="/@"]',
      ],
      actions: ['click'],
      verify: {
        urlChanged: true,
      },
    },
    {
      targetKey: 'video_player',
      kind: 'card',
      selectors: [
        '.html5-video-player',
        '#movie_player',
        'video.html5-main-video',
        'video',
      ],
      actions: ['click'],
      verify: {
        focusConfirmed: true,
      },
    },
    {
      targetKey: 'play_pause_button',
      kind: 'button',
      selectors: [
        '.ytp-play-button',
        'button.ytp-play-button',
        '[aria-label*="Play"]',
        '[aria-label*="Pause"]',
      ],
      actions: ['click'],
      verify: {
        domChanged: true,
      },
    },
    {
      targetKey: 'subscribe_button',
      kind: 'button',
      selectors: [
        '#subscribe-button button',
        'button[aria-label*="Subscribe"]',
        'ytd-subscribe-button-renderer button',
      ],
      actions: ['click'],
      verify: {
        domChanged: true,
      },
    },
    {
      targetKey: 'like_button',
      kind: 'button',
      selectors: [
        'like-button-view-model button',
        'button[aria-label*="like this video"]',
        'ytd-menu-renderer button[aria-label*="like"]',
      ],
      actions: ['click'],
      verify: {
        domChanged: true,
      },
    },
    {
      targetKey: 'comment_box',
      kind: 'input',
      selectors: [
        '#simple-box',
        '#contenteditable-root',
        'ytd-comment-simplebox-renderer #contenteditable-root',
      ],
      actions: ['focus', 'type', 'clear'],
      verify: {
        focusConfirmed: true,
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
    {
      name: 'youtube_search_and_open_first',
      queryPattern: 'search youtube and open first result',
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
