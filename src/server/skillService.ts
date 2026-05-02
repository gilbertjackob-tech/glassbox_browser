import { v4 as uuidv4 } from 'uuid';
import db from '../main/memoryDb.js';

export type MicroSkillStep = {
  name?: string;
  targetKey: string;
  kind?: string;
  action: 'click' | 'type' | 'focus' | 'clear' | 'press';
  text?: string;
  key?: string;
  keys?: string[];
  clearFirst?: boolean;
  verify?: {
    urlChanged?: boolean;
    domChanged?: boolean;
    valueChanged?: boolean;
    focusConfirmed?: boolean;
    loadingStable?: boolean;
    urlIncludes?: string;
    titleIncludes?: string;
  };
};

function normalizeSkillName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function sanitizeSkillStep(step: any): MicroSkillStep {
  const action = String(step?.action || '');

  if (!['click', 'type', 'focus', 'clear', 'press'].includes(action)) {
    throw new Error('UNSUPPORTED_SKILL_ACTION');
  }

  const targetKey = typeof step?.targetKey === 'string' ? step.targetKey.trim() : '';
  if (!targetKey) {
    throw new Error('SKILL_STEP_TARGET_KEY_REQUIRED');
  }

  const clean: MicroSkillStep = {
    name: typeof step?.name === 'string' ? step.name.slice(0, 120) : undefined,
    targetKey,
    kind: typeof step?.kind === 'string' ? step.kind : undefined,
    action: action as MicroSkillStep['action'],
    text: typeof step?.text === 'string' ? step.text : undefined,
    key: typeof step?.key === 'string' ? step.key : undefined,
    keys: Array.isArray(step?.keys) ? step.keys.filter((key: unknown) => typeof key === 'string') : undefined,
    clearFirst: Boolean(step?.clearFirst),
    verify: typeof step?.verify === 'object' && step.verify ? step.verify : undefined,
  };

  return clean;
}

export function sanitizeSkillSteps(steps: any[]) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('SKILL_STEPS_REQUIRED');
  }

  if (steps.length > 10) {
    throw new Error('SKILL_TOO_LONG');
  }

  return steps.map(sanitizeSkillStep);
}

export function saveMicroSkill(input: {
  profileId: string;
  name: string;
  queryPattern?: string;
  steps: any[];
}) {
  const rawName = typeof input.name === 'string' ? input.name.trim() : '';
  if (!rawName) {
    throw new Error('SKILL_NAME_REQUIRED');
  }

  const name = normalizeSkillName(rawName);
  const steps = sanitizeSkillSteps(input.steps);
  const actionSequence = JSON.stringify({
    version: 1,
    type: 'micro_skill',
    steps,
  });

  const existing = db.prepare(`
    SELECT *
    FROM skills
    WHERE profile_id = ?
      AND name = ?
  `).get(input.profileId, name) as any;

  if (existing) {
    db.prepare(`
      UPDATE skills
      SET
        query_pattern = ?,
        action_sequence = ?
      WHERE id = ?
    `).run(
      input.queryPattern || rawName,
      actionSequence,
      existing.id
    );

    return db.prepare('SELECT * FROM skills WHERE id = ?').get(existing.id);
  }

  const id = uuidv4();

  db.prepare(`
    INSERT INTO skills (
      id,
      profile_id,
      name,
      query_pattern,
      action_sequence,
      success_count,
      failure_count
    )
    VALUES (?, ?, ?, ?, ?, 0, 0)
  `).run(
    id,
    input.profileId,
    name,
    input.queryPattern || rawName,
    actionSequence
  );

  return db.prepare('SELECT * FROM skills WHERE id = ?').get(id);
}

export function listMicroSkills(profileId: string) {
  return db.prepare(`
    SELECT *
    FROM skills
    WHERE profile_id = ?
    ORDER BY last_used DESC, created_at DESC
  `).all(profileId);
}

export function getMicroSkill(profileId: string, nameOrId: string) {
  const key = normalizeSkillName(nameOrId);

  return db.prepare(`
    SELECT *
    FROM skills
    WHERE profile_id = ?
      AND (id = ? OR name = ?)
    LIMIT 1
  `).get(profileId, nameOrId, key);
}

export function parseSkillSteps(skill: any) {
  if (!skill?.action_sequence) {
    throw new Error('SKILL_ACTION_SEQUENCE_EMPTY');
  }

  const parsed = JSON.parse(skill.action_sequence);
  const steps = Array.isArray(parsed?.steps) ? parsed.steps : [];

  return sanitizeSkillSteps(steps);
}
