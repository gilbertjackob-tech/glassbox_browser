import cors from 'cors';
import express from 'express';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import db from './memoryDb.js';
import { actionExecutor } from '../server/actionExecutor.js';
import { memoryService } from '../server/memoryService.js';
import { tabManager } from '../server/tabManager.js';

function getTableColumns(tableName: string): string[] {
  try {
    return db.prepare(`PRAGMA table_info(${tableName})`).all().map((column: any) => column.name as string);
  } catch {
    return [];
  }
}

const downloadColumns = getTableColumns('downloads');
const downloadFileNameColumn = downloadColumns.includes('file_name') ? 'file_name' : (downloadColumns.includes('filename') ? 'filename' : null);
const downloadUrlColumn = downloadColumns.includes('url') ? 'url' : null;
const downloadTimestampColumn = downloadColumns.includes('timestamp') ? 'timestamp' : (downloadColumns.includes('created_at') ? 'created_at' : null);

const actionsColumns = getTableColumns('actions');
const actionLogsColumns = getTableColumns('action_logs');

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

function resolveProfileId(profileId: unknown) {
  return typeof profileId === 'string' && profileId.trim().length > 0
    ? profileId
    : getSettingValue('active_profile_id', 'default');
}

let serverPromise: Promise<void> | null = null;

export function startApiServer(port: number = 3000): Promise<void> {
  if (serverPromise) {
    return serverPromise;
  }

  serverPromise = (async () => {
    const app = express();

    app.use(cors());
    app.use(express.json());

    app.get('/api/profiles', (_req, res) => {
      res.json(db.prepare('SELECT * FROM profiles ORDER BY created_at ASC').all());
    });

    app.get('/api/settings', (_req, res) => {
      res.json({
        activeProfileId: getSettingValue('active_profile_id', 'default'),
      });
    });

    app.put('/api/settings', (req, res) => {
      const activeProfileId = resolveProfileId(req.body?.activeProfileId);
      const profile = db.prepare('SELECT id FROM profiles WHERE id = ?').get(activeProfileId);

      if (!profile) {
        res.status(400).json({ error: 'Profile not found' });
        return;
      }

      setSettingValue('active_profile_id', activeProfileId);
      res.json({ success: true, activeProfileId });
    });

    app.post('/api/profiles', (req, res) => {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!name) {
        res.status(400).json({ error: 'Name is required' });
        return;
      }

      const id = uuidv4();
      db.prepare('INSERT INTO profiles (id, name, partition) VALUES (?, ?, ?)')
        .run(id, name, `persist:profile-${id}`);

      res.json({ id, name });
    });

    app.patch('/api/profiles/:id', (req, res) => {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!name) {
        res.status(400).json({ error: 'Name is required' });
        return;
      }

      const profile = db.prepare('SELECT id FROM profiles WHERE id = ?').get(req.params.id);
      if (!profile) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }

      db.prepare('UPDATE profiles SET name = ? WHERE id = ?').run(name, req.params.id);
      res.json({ success: true, id: req.params.id, name });
    });

    app.delete('/api/profiles/:id', async (req, res) => {
      const profileId = req.params.id;
      if (profileId === 'default') {
        res.status(400).json({ error: 'Default profile cannot be deleted' });
        return;
      }

      const profile = db.prepare('SELECT id FROM profiles WHERE id = ?').get(profileId);
      if (!profile) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }

      const tabs = tabManager.getAllTabs().filter((tab) => tab.profileId === profileId);
      for (const tab of tabs) {
        await tabManager.closeTab(tab.tabId);
      }

      db.prepare('DELETE FROM profiles WHERE id = ?').run(profileId);
      db.prepare('DELETE FROM tabs WHERE profile_id = ?').run(profileId);
      db.prepare('DELETE FROM history WHERE profile_id = ?').run(profileId);
      db.prepare('DELETE FROM downloads WHERE profile_id = ?').run(profileId);
      db.prepare('DELETE FROM actions WHERE profile_id = ?').run(profileId);
      db.prepare('DELETE FROM tasks WHERE profile_id = ?').run(profileId);
      db.prepare('DELETE FROM skills WHERE profile_id = ?').run(profileId);
      db.prepare('DELETE FROM dom_snapshots WHERE profile_id = ?').run(profileId);
      db.prepare('DELETE FROM saved_passwords WHERE profile_id = ?').run(profileId);

      if (getSettingValue('active_profile_id', 'default') === profileId) {
        setSettingValue('active_profile_id', 'default');
      }

      res.json({ success: true, activeProfileId: getSettingValue('active_profile_id', 'default') });
    });

    app.get('/api/tabs', (_req, res) => {
      res.json(tabManager.getAllTabs());
    });

    app.post('/api/tabs', (req, res) => {
      const profileId = typeof req.body?.profileId === 'string' ? req.body.profileId : 'default';
      const initialUrl = typeof req.body?.initialUrl === 'string' ? req.body.initialUrl : undefined;
      const id = tabManager.createTabSync(profileId, initialUrl);
      res.json({ id });
    });

    app.delete('/api/tabs/:id', async (req, res) => {
      const result = await tabManager.closeTab(req.params.id);
      res.json({ success: true, nextActiveTabId: result.nextActiveTabId });
    });

    app.get('/api/tabs/:id/dom', (req, res) => {
      const tab = tabManager.getTab(req.params.id);
      res.json(tab?.elements || []);
    });

    app.post('/api/actions', async (req, res) => {
      try {
        const result = await actionExecutor.execute(req.body);
        res.json(result);
      } catch (error: any) {
        res.status(400).json({ error: error.message });
      }
    });

    app.get('/api/memory/search', async (req, res) => {
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      const profileId = resolveProfileId(req.query.profileId);
      const results = await memoryService.searchMemory(query, profileId);
      res.json(results);
    });

    app.get('/api/memory/history', (req, res) => {
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      const profileId = resolveProfileId(req.query.profileId);
      let sql = 'SELECT * FROM history WHERE profile_id = ?';
      const params: string[] = [profileId];

      if (query) {
        sql += ' AND (url LIKE ? OR title LIKE ?)';
        params.push(`%${query}%`, `%${query}%`);
      }

      sql += ' ORDER BY last_visited DESC LIMIT 50';
      res.json(db.prepare(sql).all(...params));
    });

    app.delete('/api/memory/history', (req, res) => {
      const profileId = resolveProfileId(req.query.profileId);
      db.prepare('DELETE FROM history WHERE profile_id = ?').run(profileId);
      res.json({ success: true });
    });

    app.get('/api/memory/downloads', (req, res) => {
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      const profileId = resolveProfileId(req.query.profileId);
      let sql = 'SELECT * FROM downloads WHERE profile_id = ?';
      const params: string[] = [profileId];

      if (query) {
        const clauses: string[] = [];
        if (downloadFileNameColumn) clauses.push(`${downloadFileNameColumn} LIKE ?`);
        if (downloadUrlColumn) clauses.push(`${downloadUrlColumn} LIKE ?`);
        if (clauses.length > 0) {
          sql += ` AND (${clauses.join(' OR ')})`;
          params.push(...clauses.map(() => `%${query}%`));
        }
      }

      sql += ` ORDER BY ${downloadTimestampColumn || 'rowid'} DESC LIMIT 50`;
      res.json(db.prepare(sql).all(...params));
    });

    app.delete('/api/memory/downloads', (req, res) => {
      const profileId = resolveProfileId(req.query.profileId);
      db.prepare('DELETE FROM downloads WHERE profile_id = ?').run(profileId);
      res.json({ success: true });
    });

    app.get('/api/memory/logs', (req, res) => {
      const profileId = resolveProfileId(req.query.profileId);
      if (actionsColumns.length > 0) {
        const intentExpr = actionsColumns.includes('intent') ? 'COALESCE(intent, \'\') AS intent' : "'' AS intent";
        const successExpr = actionsColumns.includes('success') ? 'COALESCE(success, 0) AS success' : '0 AS success';
        const reasonExpr = actionsColumns.includes('reason') ? 'COALESCE(reason, \'\') AS reason' : "'' AS reason";
        const timestampExpr = actionsColumns.includes('created_at') ? 'created_at AS timestamp' : 'CURRENT_TIMESTAMP AS timestamp';

        const logs = db.prepare(`
          SELECT
            id,
            type AS action_type,
            ${intentExpr},
            ${successExpr},
            ${reasonExpr},
            ${timestampExpr},
            NULL AS before_dom_hash,
            NULL AS after_dom_hash
          FROM actions
          WHERE profile_id = ?
          ORDER BY ${actionsColumns.includes('created_at') ? 'created_at' : 'id'} DESC
          LIMIT 50
        `).all(profileId);

        res.json(logs);
        return;
      }

      if (actionLogsColumns.length > 0) {
        res.json(db.prepare('SELECT * FROM action_logs WHERE profile_id = ? ORDER BY timestamp DESC LIMIT 50').all(profileId));
        return;
      }

      res.json([]);
    });

    app.get('/api/passwords', (req, res) => {
      const profileId = resolveProfileId(req.query.profileId);
      const passwords = db.prepare(`
        SELECT id, profile_id, origin, username, password, created_at, updated_at
        FROM saved_passwords
        WHERE profile_id = ?
        ORDER BY updated_at DESC, created_at DESC
      `).all(profileId);
      res.json(passwords);
    });

    app.post('/api/passwords', (req, res) => {
      const profileId = resolveProfileId(req.body?.profileId);
      const origin = typeof req.body?.origin === 'string' ? req.body.origin.trim() : '';
      const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      if (!origin || !username || !password) {
        res.status(400).json({ error: 'Origin, username, and password are required' });
        return;
      }

      const id = uuidv4();
      db.prepare(`
        INSERT INTO saved_passwords (id, profile_id, origin, username, password, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(profile_id, origin, username) DO UPDATE SET
          password = excluded.password,
          updated_at = CURRENT_TIMESTAMP
      `).run(id, profileId, origin, username, password);

      res.json({ success: true });
    });

    app.delete('/api/passwords/:id', (req, res) => {
      db.prepare('DELETE FROM saved_passwords WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    });

    if (process.env.NODE_ENV !== 'development') {
      app.use(express.static(path.join(process.cwd(), 'dist')));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
      });
    }

    await new Promise<void>((resolve, reject) => {
      const server = app.listen(port, '127.0.0.1', () => {
        console.log(`GlassBox API running on port ${port}`);
        resolve();
      });

      server.on('error', reject);
    });
  })();

  return serverPromise;
}
