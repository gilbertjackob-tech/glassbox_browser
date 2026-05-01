import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';

const DATA_DIR = join(process.cwd(), 'data');
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(join(DATA_DIR, 'glassbox.sqlite'));

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT,
      partition TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tabs (
      id TEXT PRIMARY KEY,
      profile_id TEXT,
      url TEXT,
      title TEXT,
      last_active TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      profile_id TEXT,
      url TEXT,
      title TEXT,
      visit_count INTEGER DEFAULT 1,
      last_visited TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(profile_id, url)
    );

    CREATE TABLE IF NOT EXISTS downloads (
      id TEXT PRIMARY KEY,
      profile_id TEXT,
      url TEXT,
      filename TEXT,
      path TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS saved_passwords (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      origin TEXT NOT NULL,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(profile_id, origin, username)
    );

    CREATE TABLE IF NOT EXISTS actions (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      tab_id TEXT,
      profile_id TEXT,
      type TEXT,
      target TEXT,
      value TEXT,
      success INTEGER,
      reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      profile_id TEXT,
      query TEXT,
      status TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      profile_id TEXT,
      name TEXT,
      query_pattern TEXT,
      action_sequence TEXT,
      success_count INTEGER DEFAULT 0,
      failure_count INTEGER DEFAULT 0,
      last_used TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS dom_snapshots (
      id TEXT PRIMARY KEY,
      tab_id TEXT,
      profile_id TEXT,
      url TEXT,
      dom_hash TEXT,
      snapshot_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const profileColumns = db.prepare('PRAGMA table_info(profiles)').all().map((column: any) => column.name);
  if (!profileColumns.includes('partition')) {
    db.prepare('ALTER TABLE profiles ADD COLUMN partition TEXT').run();
  }

  // Create default profile
  const defaultProfile = db.prepare('SELECT id FROM profiles WHERE id = ?').get('default');
  if (!defaultProfile) {
    db.prepare('INSERT INTO profiles (id, name, partition) VALUES (?, ?, ?)')
      .run('default', 'Default', 'persist:gb-profile-default');
  }

  const activeProfileSetting = db.prepare('SELECT key FROM app_settings WHERE key = ?').get('active_profile_id');
  if (!activeProfileSetting) {
    db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)')
      .run('active_profile_id', 'default');
  }
}

initDb();

export const memory = {
  search: (query: string, profileId: string) => {
    // Scoring logic
    const results = [];
    
    // History
    const history = db.prepare(`
      SELECT 'history' as type, title, url as path, last_visited as last_seen,
      ((CASE WHEN url LIKE '%' || ? || '%' THEN 4 ELSE 0 END) + (CASE WHEN title LIKE '%' || ? || '%' THEN 2 ELSE 0 END)) as score
      FROM history WHERE profile_id = ? AND (url LIKE '%' || ? || '%' OR title LIKE '%' || ? || '%')
      ORDER BY score DESC, last_visited DESC LIMIT 10
    `).all(query, query, profileId, query, query);
    results.push(...history);

    // Tasks
    const tasks = db.prepare(`
      SELECT 'task' as type, query as title, id as path, completed_at as last_seen,
      (CASE WHEN query LIKE '%' || ? || '%' THEN 3 ELSE 0 END) as score
      FROM tasks WHERE profile_id = ? AND query LIKE '%' || ? || '%'
      ORDER BY score DESC, created_at DESC LIMIT 5
    `).all(query, profileId, query);
    results.push(...tasks);

    // Skills
    const skills = db.prepare(`
      SELECT 'skill' as type, name as title, id as path, last_used as last_seen,
      ((CASE WHEN name LIKE '%' || ? || '%' THEN 4 ELSE 0 END) + (CASE WHEN query_pattern LIKE '%' || ? || '%' THEN 2 ELSE 0 END)) as score
      FROM skills WHERE profile_id = ? AND (name LIKE '%' || ? || '%' OR query_pattern LIKE '%' || ? || '%')
      ORDER BY score DESC, last_used DESC LIMIT 5
    `).all(query, query, profileId, query, query);
    results.push(...skills);

    // Downloads
    const downloads = db.prepare(`
      SELECT 'download' as type, filename as title, path, created_at as last_seen,
      ((CASE WHEN filename LIKE '%' || ? || '%' THEN 4 ELSE 0 END) + (CASE WHEN url LIKE '%' || ? || '%' THEN 1 ELSE 0 END)) as score
      FROM downloads WHERE profile_id = ? AND (filename LIKE '%' || ? || '%' OR url LIKE '%' || ? || '%')
      ORDER BY score DESC, created_at DESC LIMIT 5
    `).all(query, query, profileId, query, query);
    results.push(...downloads);

    return results.sort((a: any, b: any) => b.score - a.score);
  }
};

export default db;
