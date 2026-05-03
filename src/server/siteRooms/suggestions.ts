import type { SiteRoomResult } from './types.js';

export type RoomSuggestion = {
  type: 'skill' | 'target' | 'info';
  name?: string;
  targetKey?: string;
  safe: boolean;
  guarded?: boolean;
  reason: string;
  inputs?: string[];
};

function landmarkFound(room: SiteRoomResult, targetKey: string) {
  return room.landmarks.some((item) => item.targetKey === targetKey && item.found);
}

export function getYouTubeRoomSuggestions(room: SiteRoomResult): RoomSuggestion[] {
  const suggestions: RoomSuggestion[] = [];

  if (room.room === 'youtube_home') {
    suggestions.push({
      type: 'skill',
      name: 'youtube_search',
      safe: true,
      inputs: ['query'],
      reason: 'Home room supports search from the main YouTube search box.',
    });

    suggestions.push({
      type: 'skill',
      name: 'youtube_search_and_open_first',
      safe: true,
      inputs: ['query'],
      reason: 'Can search and open the first result safely after verification.',
    });
  }

  if (room.room === 'youtube_search_results') {
    suggestions.push({
      type: 'skill',
      name: 'youtube_open_first_result',
      safe: true,
      reason: 'Search results room has first_video_result landmark.',
    });

    suggestions.push({
      type: 'skill',
      name: 'youtube_search_and_open_first',
      safe: true,
      inputs: ['query'],
      reason: 'Can run a fresh search and open the first result.',
    });
  }

  if (room.room === 'youtube_watch_page') {
    if (landmarkFound(room, 'play_pause_button') || landmarkFound(room, 'video_player')) {
      suggestions.push({
        type: 'skill',
        name: 'youtube_pause_or_play_video',
        safe: true,
        reason: 'Watch page has video player controls.',
      });
    }

    suggestions.push({
      type: 'target',
      targetKey: 'like_button',
      safe: false,
      guarded: true,
      reason: 'Account-changing action; user confirmation required before clicking.',
    });

    suggestions.push({
      type: 'target',
      targetKey: 'subscribe_button',
      safe: false,
      guarded: true,
      reason: 'Account-changing action; user confirmation required before clicking.',
    });

    suggestions.push({
      type: 'target',
      targetKey: 'comment_box',
      safe: false,
      guarded: true,
      reason: 'Public interaction; user confirmation required before typing or posting.',
    });
  }

  if (room.room === 'youtube_channel_page') {
    suggestions.push({
      type: 'skill',
      name: 'youtube_search',
      safe: true,
      inputs: ['query'],
      reason: 'Global YouTube search is available from channel pages.',
    });

    suggestions.push({
      type: 'target',
      targetKey: 'subscribe_button',
      safe: false,
      guarded: true,
      reason: 'Account-changing action; user confirmation required before clicking.',
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      type: 'info',
      safe: true,
      reason: 'No room-specific suggestions available yet.',
    });
  }

  return suggestions;
}

export function getGoogleRoomSuggestions(room: SiteRoomResult): RoomSuggestion[] {
  const suggestions: RoomSuggestion[] = [];

  if (room.room === 'google_home') {
    suggestions.push({
      type: 'skill',
      name: 'google_search',
      safe: true,
      inputs: ['query'],
      reason: 'Google home exposes the main search box for a safe search flow.',
    });

    suggestions.push({
      type: 'skill',
      name: 'google_search_and_open_first',
      safe: true,
      inputs: ['query'],
      reason: 'Can search and open the first non-Google result safely after verification.',
    });
  }

  if (room.room === 'google_search_results') {
    suggestions.push({
      type: 'skill',
      name: 'google_open_first_result',
      safe: true,
      reason: 'Search results room exposes a vetted first external result.',
    });

    suggestions.push({
      type: 'skill',
      name: 'google_search_and_open_first',
      safe: true,
      inputs: ['query'],
      reason: 'Can run a fresh search and open the first result safely.',
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      type: 'info',
      safe: true,
      reason: 'No room-specific suggestions available yet.',
    });
  }

  return suggestions;
}
