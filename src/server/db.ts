import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const DATA_DIR = join(process.cwd(), 'data');
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR);
}

const db = new Database(join(DATA_DIR, 'glassbox.sqlite'));

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    session_partition TEXT,
    user_data_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tabs (
    id TEXT PRIMARY KEY,
    profile_id TEXT,
    url TEXT,
    title TEXT,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS history (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    visit_count INTEGER DEFAULT 1,
    last_visited DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(profile_id) REFERENCES profiles(id)
  );

  CREATE TABLE IF NOT EXISTS action_logs (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    tab_id TEXT NOT NULL,
    intent TEXT,
    action_type TEXT NOT NULL,
    target_selector TEXT,
    target_text TEXT,
    success BOOLEAN,
    reason TEXT,
    before_url TEXT,
    after_url TEXT,
    before_dom_hash TEXT,
    after_dom_hash TEXT,
    evidence_json TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(profile_id) REFERENCES profiles(id)
  );

  CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    url_pattern TEXT,
    action_sequence_json TEXT, -- List of action_ids or steps
    success_rate REAL DEFAULT 0.0,
    use_count INTEGER DEFAULT 0,
    last_used DATETIME
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    parent_skill_id TEXT,
    name TEXT NOT NULL,
    status TEXT CHECK(status IN ('pending', 'running', 'completed', 'failed')),
    result_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(parent_skill_id) REFERENCES skills(id)
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    tags TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(profile_id) REFERENCES profiles(id)
  );
  
  CREATE TABLE IF NOT EXISTS downloads (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    url TEXT,
    file_path TEXT,
    mime_type TEXT,
    size_bytes INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(profile_id) REFERENCES profiles(id)
  );

  CREATE TABLE IF NOT EXISTS snapshots (
    id TEXT PRIMARY KEY,
    tab_id TEXT NOT NULL,
    url TEXT NOT NULL,
    dom_json TEXT NOT NULL,
    dom_hash TEXT,
    screenshot_path TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Insert default profile if none exists
const defaultProfile = db.prepare('SELECT id FROM profiles WHERE id = ?').get('default');
if (!defaultProfile) {
  db.prepare('INSERT INTO profiles (id, name) VALUES (?, ?)').run('default', 'Default Profile');
}

export default db;
