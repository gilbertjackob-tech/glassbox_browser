import db from './memoryDb.js';

export interface ProfileRecord {
  id: string;
  name: string;
  email?: string | null;
  partition: string;
  created_at?: string;
}

const ACTIVE_PROFILE_KEY = 'active_profile_id';

function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'profile';
}

function getSettingValue(key: string, fallback: string) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value?: string } | undefined;
  return row?.value || fallback;
}

function setSettingValue(key: string, value: string) {
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run(key, value);
}

function profilePartition(id: string) {
  return `persist:gb-profile-${id}`;
}

class ProfileStore {
  list(): ProfileRecord[] {
    const profiles = db.prepare('SELECT * FROM profiles ORDER BY created_at ASC').all() as ProfileRecord[];
    return profiles.map((profile) => this.ensurePartition(profile));
  }

  get(idOrName: string = 'default'): ProfileRecord | null {
    const key = idOrName.trim();
    if (!key) {
      return this.get(this.getActiveId());
    }

    const byId = db.prepare('SELECT * FROM profiles WHERE id = ?').get(key) as ProfileRecord | undefined;
    if (byId) {
      return this.ensurePartition(byId);
    }

    const byName = db.prepare('SELECT * FROM profiles WHERE LOWER(name) = LOWER(?)').get(key) as ProfileRecord | undefined;
    return byName ? this.ensurePartition(byName) : null;
  }

  getActiveId() {
    return getSettingValue(ACTIVE_PROFILE_KEY, 'default');
  }

  getActive() {
    return this.get(this.getActiveId()) || this.get('default');
  }

  setActive(idOrName: string) {
    const profile = this.get(idOrName);
    if (!profile) {
      throw new Error('PROFILE_NOT_FOUND');
    }

    setSettingValue(ACTIVE_PROFILE_KEY, profile.id);
    return profile;
  }

  create(name: string, requestedId?: string, email?: string) {
    const cleanName = name.trim();
    const cleanEmail = typeof email === 'string' ? email.trim() : '';
    if (!cleanName) {
      throw new Error('PROFILE_NAME_REQUIRED');
    }

    const id = requestedId?.trim()
      ? this.validateRequestedId(requestedId)
      : this.nextAvailableId(slugify(cleanName));

    if (this.get(id)) {
      throw new Error('PROFILE_ID_EXISTS');
    }

    const partition = profilePartition(id);
    db.prepare('INSERT INTO profiles (id, name, email, partition) VALUES (?, ?, ?, ?)')
      .run(id, cleanName, cleanEmail || null, partition);

    return this.get(id) as ProfileRecord;
  }

  update(idOrName: string, payload: { name?: string }) {
    const profile = this.get(idOrName);
    if (!profile) {
      throw new Error('PROFILE_NOT_FOUND');
    }

    const hasName = typeof payload.name === 'string';
    if (!hasName) {
      throw new Error('PROFILE_UPDATE_REQUIRED');
    }

    const cleanName = payload.name!.trim();

    if (!cleanName) {
      throw new Error('PROFILE_NAME_REQUIRED');
    }

    db.prepare('UPDATE profiles SET name = ? WHERE id = ?').run(cleanName, profile.id);
    return this.get(profile.id) as ProfileRecord;
  }

  setEmail(idOrName: string, email: string) {
    const profile = this.get(idOrName);
    if (!profile) {
      throw new Error('PROFILE_NOT_FOUND');
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      throw new Error('EMAIL_REQUIRED_FOR_PROFILE');
    }

    db.prepare('UPDATE profiles SET email = ? WHERE id = ?').run(cleanEmail, profile.id);
    return this.get(profile.id) as ProfileRecord;
  }

  delete(idOrName: string) {
    const profile = this.get(idOrName);
    if (!profile) {
      throw new Error('PROFILE_NOT_FOUND');
    }
    if (profile.id === 'default') {
      throw new Error('DEFAULT_PROFILE_LOCKED');
    }

    const deleteTables = [
      'profiles',
      'tabs',
      'history',
      'downloads',
      'actions',
      'tasks',
      'skills',
      'dom_snapshots',
      'saved_passwords',
    ];

    const transaction = db.transaction(() => {
      for (const table of deleteTables) {
        if (table === 'profiles') {
          db.prepare('DELETE FROM profiles WHERE id = ?').run(profile.id);
        } else {
          db.prepare(`DELETE FROM ${table} WHERE profile_id = ?`).run(profile.id);
        }
      }

      if (this.getActiveId() === profile.id) {
        setSettingValue(ACTIVE_PROFILE_KEY, 'default');
      }
    });

    transaction();
    return profile;
  }

  resolveId(idOrName: unknown) {
    if (typeof idOrName === 'string' && idOrName.trim()) {
      const profile = this.get(idOrName);
      if (!profile) {
        throw new Error('PROFILE_NOT_FOUND');
      }
      return profile.id;
    }

    return this.getActiveId();
  }

  private ensurePartition(profile: ProfileRecord) {
    if (profile.partition) {
      return profile;
    }

    const partition = profilePartition(profile.id);
    db.prepare('UPDATE profiles SET partition = ? WHERE id = ?').run(partition, profile.id);
    return { ...profile, partition };
  }

  private nextAvailableId(baseId: string) {
    let candidate = baseId;
    let suffix = 2;

    while (db.prepare('SELECT id FROM profiles WHERE id = ?').get(candidate)) {
      candidate = `${baseId}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  private validateRequestedId(id: string) {
    const slug = slugify(id);
    if (slug !== id.trim().toLowerCase()) {
      throw new Error('PROFILE_ID_MUST_BE_SLUG');
    }

    return slug;
  }
}

export const profileStore = new ProfileStore();
