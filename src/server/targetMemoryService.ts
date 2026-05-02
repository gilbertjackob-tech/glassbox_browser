import { v4 as uuidv4 } from 'uuid';
import db from '../main/memoryDb.js';

export type TargetMemoryRecord = {
  id: string;
  profile_id: string;
  site_host: string;
  target_key: string;
  kind: string;
  label: string | null;
  selector: string;
  actions_json: string | null;
  success_count: number;
  failure_count: number;
  confidence: number;
  last_seen: string | null;
  last_worked: string | null;
  created_at: string;
  updated_at: string;
};

export function siteHostFromUrl(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return 'unknown';
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

export function inferTargetKey(target: {
  kind?: string;
  label?: string;
  selector?: string;
  text?: string;
}) {
  const kind = String(target.kind || '').toLowerCase();
  const label = String(target.label || target.text || '').toLowerCase();
  const selector = String(target.selector || '').toLowerCase();

  const haystack = `${label} ${selector}`;

  if (kind === 'input' && /search|query|search_query|q/.test(haystack)) {
    return 'search_box';
  }

  if (kind === 'button' && /search/.test(haystack)) {
    return 'search_button';
  }

  if (/sign in|signin|log in|login/.test(haystack)) {
    return 'sign_in_button';
  }

  if (kind === 'input' && /email|username|user/.test(haystack)) {
    return 'username_or_email_field';
  }

  if (kind === 'input' && /password/.test(haystack)) {
    return 'password_field';
  }

  if (kind === 'button' && /send/.test(haystack)) {
    return 'send_button';
  }

  if (kind === 'button' && /compose/.test(haystack)) {
    return 'compose_button';
  }

  const base = slugify(label || selector || kind || 'target');
  return `${kind || 'target'}_${base || 'unknown'}`;
}

export function shouldRememberAction(action: string, verification: any) {
  if (!verification) return false;

  if (action === 'type' || action === 'clear') {
    return verification.valueChanged === true || verification.focusConfirmed === true;
  }

  if (action === 'click' || action === 'press' || action === 'focus') {
    return (
      verification.urlChanged === true ||
      verification.domChanged === true ||
      verification.focusConfirmed === true ||
      verification.loadingStable === true
    );
  }

  return false;
}

export function rememberSuccessfulTarget(input: {
  profileId: string;
  url: string;
  action: string;
  target: {
    kind: string;
    label: string;
    selector: string;
    actions?: string[];
    text?: string;
  };
  verification: any;
}) {
  if (!shouldRememberAction(input.action, input.verification)) {
    return null;
  }

  const siteHost = siteHostFromUrl(input.url);
  const targetKey = inferTargetKey(input.target);
  const actionsJson = JSON.stringify(input.target.actions || []);

  const existing = db.prepare(`
    SELECT *
    FROM target_memory
    WHERE profile_id = ?
      AND site_host = ?
      AND target_key = ?
      AND selector = ?
  `).get(input.profileId, siteHost, targetKey, input.target.selector) as TargetMemoryRecord | undefined;

  if (existing) {
    const successCount = Number(existing.success_count || 0) + 1;
    const failureCount = Number(existing.failure_count || 0);
    const confidence = Math.min(0.99, 0.5 + successCount * 0.08 - failureCount * 0.05);

    db.prepare(`
      UPDATE target_memory
      SET
        kind = ?,
        label = ?,
        actions_json = ?,
        success_count = ?,
        confidence = ?,
        last_seen = CURRENT_TIMESTAMP,
        last_worked = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      input.target.kind,
      input.target.label || null,
      actionsJson,
      successCount,
      confidence,
      existing.id
    );

    return db.prepare('SELECT * FROM target_memory WHERE id = ?').get(existing.id);
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO target_memory (
      id,
      profile_id,
      site_host,
      target_key,
      kind,
      label,
      selector,
      actions_json,
      success_count,
      confidence,
      last_seen,
      last_worked
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0.58, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(
    id,
    input.profileId,
    siteHost,
    targetKey,
    input.target.kind,
    input.target.label || null,
    input.target.selector,
    actionsJson
  );

  return db.prepare('SELECT * FROM target_memory WHERE id = ?').get(id);
}

export function listTargetMemory(profileId: string, host?: string) {
  const cleanHost = host ? siteHostFromUrl(host.includes('://') ? host : `https://${host}`) : '';

  if (cleanHost) {
    return db.prepare(`
      SELECT *
      FROM target_memory
      WHERE profile_id = ?
        AND site_host = ?
      ORDER BY confidence DESC, success_count DESC, updated_at DESC
    `).all(profileId, cleanHost);
  }

  return db.prepare(`
    SELECT *
    FROM target_memory
    WHERE profile_id = ?
    ORDER BY site_host ASC, confidence DESC, success_count DESC, updated_at DESC
  `).all(profileId);
}

export function markTargetMemoryFailure(id: string) {
  const existing = db.prepare('SELECT * FROM target_memory WHERE id = ?').get(id) as TargetMemoryRecord | undefined;
  if (!existing) return null;

  const successCount = Number(existing.success_count || 0);
  const failureCount = Number(existing.failure_count || 0) + 1;
  const confidence = Math.max(0.1, 0.5 + successCount * 0.08 - failureCount * 0.08);

  db.prepare(`
    UPDATE target_memory
    SET
      failure_count = ?,
      confidence = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(failureCount, confidence, id);

  return db.prepare('SELECT * FROM target_memory WHERE id = ?').get(id);
}
