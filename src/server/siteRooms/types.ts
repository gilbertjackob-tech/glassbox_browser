export type SiteRoomName =
  | 'chatgpt_auth'
  | 'chatgpt_home'
  | 'chatgpt_chat'
  | 'chatgpt_unknown'
  | 'gemini_home'
  | 'gemini_chat'
  | 'gemini_auth'
  | 'gemini_unknown'
  | 'github_home'
  | 'github_repo'
  | 'github_search_results'
  | 'github_issues'
  | 'github_pulls'
  | 'github_unknown'
  | 'google_home'
  | 'google_search_results'
  | 'google_unknown'
  | 'youtube_home'
  | 'youtube_search_results'
  | 'youtube_watch_page'
  | 'youtube_channel_page'
  | 'youtube_unknown'
  | 'unknown';

export type RoomLandmark = {
  targetKey: string;
  expected: boolean;
  found?: boolean;
  optional?: boolean;
  guarded?: boolean;
  source?: string;
  reason?: string;
};

export type SiteRoomResult = {
  ok: boolean;
  host: string;
  site: string;
  room: SiteRoomName;
  confidence: number;
  url: string;
  title?: string;
  signals: Record<string, unknown>;
  landmarks: RoomLandmark[];
  reason?: string;
};
