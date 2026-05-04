/**
 * Site Learning Service
 *
 * Stores verified user and agent actions as learning events.
 * This forms the basis for:
 * - Target memory (selectors, labels, confidence)
 * - Route patterns (navigation sequences)
 * - Skill promotion (repeated successful sequences)
 * - Site room detection
 *
 * Only stores after verification. Never learns from failures.
 */

import type Database from 'better-sqlite3';

export interface SiteLearningEvent {
  id: string;
  profileId: string;
  host: string;
  urlPattern?: string;
  room?: string;
  actionType: string;
  targetKey?: string;
  targetLabel?: string;
  selector?: string;
  role?: string;
  textSignature?: string;
  beforeHash: string;
  afterHash: string;
  success: boolean;
  confidence: number;
  createdAt: string;
}

export function initializeSiteLearningSchema(db: Database.Database): void {
  // Learning events table
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_learning_events (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      host TEXT NOT NULL,
      url_pattern TEXT,
      room TEXT,
      action_type TEXT NOT NULL,
      target_key TEXT,
      target_label TEXT,
      selector TEXT,
      role TEXT,
      text_signature TEXT,
      before_hash TEXT NOT NULL,
      after_hash TEXT NOT NULL,
      success INTEGER NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.9,
      created_at TEXT NOT NULL,
      INDEX idx_host_room (host, room),
      INDEX idx_profile_host (profile_id, host),
      INDEX idx_success (success)
    );
  `);

  // Route memory: common navigation patterns
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_routes (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      host TEXT NOT NULL,
      room_from TEXT,
      room_to TEXT,
      action_sequence TEXT,
      success_count INTEGER DEFAULT 0,
      failure_count INTEGER DEFAULT 0,
      last_used TEXT,
      confidence REAL NOT NULL DEFAULT 0.8,
      INDEX idx_host_route (host, room_from, room_to),
      INDEX idx_profile (profile_id)
    );
  `);

  // Skill candidate: sequences that repeat and could be promoted
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_candidates (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      host TEXT NOT NULL,
      room TEXT,
      sequence_hash TEXT NOT NULL,
      action_count INTEGER,
      success_count INTEGER DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0.7,
      first_seen TEXT,
      last_seen TEXT,
      promoted_skill_id TEXT,
      INDEX idx_host_room (host, room),
      INDEX idx_sequence (sequence_hash),
      INDEX idx_promoted (promoted_skill_id)
    );
  `);
}

export function recordSiteLearningEvent(
  db: Database.Database,
  event: SiteLearningEvent
): void {
  if (!event.success) {
    // Don't learn from failures
    return;
  }

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO site_learning_events (
      id, profile_id, host, url_pattern, room, action_type, 
      target_key, target_label, selector, role, text_signature,
      before_hash, after_hash, success, confidence, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    event.id,
    event.profileId,
    event.host,
    event.urlPattern,
    event.room,
    event.actionType,
    event.targetKey,
    event.targetLabel,
    event.selector,
    event.role,
    event.textSignature,
    event.beforeHash,
    event.afterHash,
    event.success ? 1 : 0,
    event.confidence,
    event.createdAt
  );
}

export function queryLearnedActions(
  db: Database.Database,
  profileId: string,
  host: string,
  actionType?: string,
  room?: string
): SiteLearningEvent[] {
  let query = `
    SELECT * FROM site_learning_events 
    WHERE profile_id = ? AND host = ? AND success = 1
  `;
  const params: any[] = [profileId, host];

  if (actionType) {
    query += ` AND action_type = ?`;
    params.push(actionType);
  }

  if (room) {
    query += ` AND room = ?`;
    params.push(room);
  }

  query += ` ORDER BY created_at DESC LIMIT 100`;

  const rows = db.prepare(query).all(...params) as any[];

  return rows.map((row) => ({
    id: row.id,
    profileId: row.profile_id,
    host: row.host,
    urlPattern: row.url_pattern,
    room: row.room,
    actionType: row.action_type,
    targetKey: row.target_key,
    targetLabel: row.target_label,
    selector: row.selector,
    role: row.role,
    textSignature: row.text_signature,
    beforeHash: row.before_hash,
    afterHash: row.after_hash,
    success: row.success === 1,
    confidence: row.confidence,
    createdAt: row.created_at,
  }));
}

export function recordRoute(
  db: Database.Database,
  profileId: string,
  host: string,
  roomFrom: string | undefined,
  roomTo: string,
  actionSequence: string[],
  success: boolean
): void {
  const id = `route_${profileId}_${host}_${roomFrom || 'start'}_${roomTo}`;
  const sequenceHash = hashActionSequence(actionSequence);

  const existing = db
    .prepare(
      `SELECT * FROM site_routes WHERE id = ? AND sequence_hash = ?`
    )
    .get(id, sequenceHash) as any;

  if (existing) {
    db.prepare(
      `UPDATE site_routes 
       SET success_count = success_count + ?, 
           failure_count = failure_count + ?,
           last_used = ?,
           confidence = MAX(0.5, confidence * 1.05)
       WHERE id = ?`
    ).run(success ? 1 : 0, success ? 0 : 1, new Date().toISOString(), id);
  } else {
    db.prepare(
      `INSERT INTO site_routes (
        id, profile_id, host, room_from, room_to, 
        action_sequence, success_count, failure_count, 
        last_used, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      profileId,
      host,
      roomFrom,
      roomTo,
      JSON.stringify(actionSequence),
      success ? 1 : 0,
      success ? 0 : 1,
      new Date().toISOString(),
      0.5
    );
  }
}

function hashActionSequence(sequence: string[]): string {
  return sequence.join('|').split('').reduce((h, c) => {
    const ch = h << 5;
    return ch - h + c.charCodeAt(0);
  }, 0).toString(36);
}

export function shouldPromoteToSkill(
  db: Database.Database,
  sequenceHash: string
): boolean {
  const candidate = db
    .prepare(
      `SELECT success_count, failure_count FROM skill_candidates WHERE sequence_hash = ?`
    )
    .get(sequenceHash) as any;

  if (!candidate) return false;

  // Promote if: 3+ successes, 0-1 failures, success rate >= 90%
  const successRate = candidate.success_count / (candidate.success_count + candidate.failure_count);
  return candidate.success_count >= 3 && candidate.failure_count <= 1 && successRate >= 0.9;
}

export function describeLearningState(
  db: Database.Database,
  profileId: string
): string {
  const eventCount = (
    db
      .prepare(
        `SELECT COUNT(*) as cnt FROM site_learning_events WHERE profile_id = ? AND success = 1`
      )
      .get(profileId) as any
  )?.cnt ?? 0;

  const hostCount = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT host) as cnt FROM site_learning_events WHERE profile_id = ? AND success = 1`
      )
      .get(profileId) as any
  )?.cnt ?? 0;

  const skillCandidates = (
    db
      .prepare(
        `SELECT COUNT(*) as cnt FROM skill_candidates WHERE profile_id = ? AND promoted_skill_id IS NULL`
      )
      .get(profileId) as any
  )?.cnt ?? 0;

  return `📚 Learning: ${eventCount} events across ${hostCount} sites, ${skillCandidates} skill candidates`;
}
