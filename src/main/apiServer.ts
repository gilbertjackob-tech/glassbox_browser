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
      const profileId = typeof req.query.profileId === 'string' ? req.query.profileId : 'default';
      const results = await memoryService.searchMemory(query, profileId);
      res.json(results);
    });

    app.get('/api/memory/history', (req, res) => {
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      let sql = 'SELECT * FROM history';
      const params: string[] = [];

      if (query) {
        sql += ' WHERE url LIKE ? OR title LIKE ?';
        params.push(`%${query}%`, `%${query}%`);
      }

      sql += ' ORDER BY last_visited DESC LIMIT 50';
      res.json(db.prepare(sql).all(...params));
    });

    app.get('/api/memory/downloads', (req, res) => {
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      let sql = 'SELECT * FROM downloads';
      const params: string[] = [];

      if (query) {
        const clauses: string[] = [];
        if (downloadFileNameColumn) clauses.push(`${downloadFileNameColumn} LIKE ?`);
        if (downloadUrlColumn) clauses.push(`${downloadUrlColumn} LIKE ?`);
        if (clauses.length > 0) {
          sql += ` WHERE (${clauses.join(' OR ')})`;
          params.push(...clauses.map(() => `%${query}%`));
        }
      }

      sql += ` ORDER BY ${downloadTimestampColumn || 'rowid'} DESC LIMIT 50`;
      res.json(db.prepare(sql).all(...params));
    });

    app.get('/api/memory/logs', (_req, res) => {
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
          ORDER BY ${actionsColumns.includes('created_at') ? 'created_at' : 'id'} DESC
          LIMIT 50
        `).all();

        res.json(logs);
        return;
      }

      if (actionLogsColumns.length > 0) {
        res.json(db.prepare('SELECT * FROM action_logs ORDER BY timestamp DESC LIMIT 50').all());
        return;
      }

      res.json([]);
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
