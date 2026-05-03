export type SiteRoomName =
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
