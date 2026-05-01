import cors from 'cors';
import express from 'express';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import db from './memoryDb.js';
import { profileStore } from './profileStore.js';
import { memoryService } from '../server/memoryService.js';
import { tabManager } from '../server/tabManager.js';
import { vlmPageApi } from '../server/vlmPageApi.js';

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

function resolveProfileId(profileId: unknown) {
  return profileStore.resolveId(profileId);
}

function boolQuery(value: unknown, fallback: boolean) {
  if (typeof value !== 'string') return fallback;
  return !['0', 'false', 'no'].includes(value.toLowerCase());
}

function errorResponse(res: express.Response, error: any, status = 400) {
  res.status(status).json({ error: error?.message || String(error) });
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
      res.json(profileStore.list());
    });

    app.get('/api/settings', (_req, res) => {
      res.json({
        activeProfileId: profileStore.getActiveId(),
      });
    });

    app.put('/api/settings', (req, res) => {
      try {
        const activeProfileId = req.body?.activeProfileId ?? req.body?.activeProfile;
        const profile = profileStore.setActive(activeProfileId);
        res.json({ success: true, activeProfileId: profile.id, profile });
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.post('/api/profiles', (req, res) => {
      try {
        const name = typeof req.body?.name === 'string' ? req.body.name : '';
        const id = typeof req.body?.id === 'string' ? req.body.id : undefined;
        const profile = profileStore.create(name, id);
        res.json(profile);
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.patch('/api/profiles/:id', (req, res) => {
      try {
        const name = typeof req.body?.name === 'string' ? req.body.name : '';
        const profile = profileStore.rename(req.params.id, name);
        res.json({ success: true, ...profile });
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.delete('/api/profiles/:id', async (req, res) => {
      try {
        const profile = profileStore.get(req.params.id);
        if (!profile) {
          res.status(404).json({ error: 'PROFILE_NOT_FOUND' });
          return;
        }

        const tabs = tabManager.getAllTabs().filter((tab) => tab.profileId === profile.id);
        for (const tab of tabs) {
          await tabManager.closeTab(tab.tabId);
        }

        const deleteStorage = boolQuery(req.query.deleteStorage, true);
        if (deleteStorage) {
          await tabManager.clearProfileStorage(profile.partition);
        }

        profileStore.delete(profile.id);
        res.json({ success: true, activeProfileId: profileStore.getActiveId(), deletedStorage: deleteStorage });
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.post('/api/profiles/:id/open', (req, res) => {
      try {
        const profile = profileStore.setActive(req.params.id);
        const initialUrl = typeof req.body?.url === 'string' ? req.body.url : undefined;
        const id = tabManager.createTabSync(profile.id, initialUrl);
        try {
          tabManager.focusTab(id);
        } catch {
          // The window may not exist yet during startup-driven opens.
        }
        res.json({ success: true, id, tabId: id, profileId: profile.id });
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.get('/api/tabs', (_req, res) => {
      res.json(tabManager.getAllTabs());
    });

    app.post('/api/tabs', (req, res) => {
      try {
        const profileId = resolveProfileId(req.body?.profileId);
        const initialUrl = typeof req.body?.url === 'string'
          ? req.body.url
          : (typeof req.body?.initialUrl === 'string' ? req.body.initialUrl : undefined);
        const id = tabManager.createTabSync(profileId, initialUrl);
        res.json({ id, tabId: id, profileId });
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.delete('/api/tabs/:id', async (req, res) => {
      const result = await tabManager.closeTab(req.params.id);
      res.json({ success: true, nextActiveTabId: result.nextActiveTabId });
    });

    app.put('/api/tabs/:id/focus', (req, res) => {
      try {
        res.json({ success: true, tab: tabManager.focusTab(req.params.id) });
      } catch (error: any) {
        errorResponse(res, error, 404);
      }
    });

    app.get('/api/tabs/:id/dom', (req, res) => {
      const tab = tabManager.getTab(req.params.id);
      res.json(tab?.elements || []);
    });

    app.get('/api/tabs/:id/html', async (req, res) => {
      try {
        res.json(await vlmPageApi.getHtml(req.params.id));
      } catch (error: any) {
        errorResponse(res, error, 404);
      }
    });

    app.post('/api/tabs/:id/query', async (req, res) => {
      try {
        res.json(await vlmPageApi.query(req.params.id, req.body || {}));
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.get('/api/tabs/:id/screenshot', async (req, res) => {
      try {
        const screenshot = await vlmPageApi.screenshot(req.params.id, {
          selector: typeof req.query.selector === 'string' ? req.query.selector : undefined,
          highlight: boolQuery(req.query.highlight, false),
        });

        if (req.query.format === 'json') {
          res.json({
            width: screenshot.width,
            height: screenshot.height,
            base64: screenshot.png.toString('base64'),
          });
          return;
        }

        res.type('png').send(screenshot.png);
      } catch (error: any) {
        errorResponse(res, error, 404);
      }
    });

    app.post('/api/tabs/:id/style', async (req, res) => {
      try {
        res.json(await vlmPageApi.style(req.params.id, req.body || {}));
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.get('/api/tabs/:id/a11y', async (req, res) => {
      try {
        res.json(await vlmPageApi.a11y(req.params.id));
      } catch (error: any) {
        errorResponse(res, error, 404);
      }
    });

    app.post('/api/tabs/:id/action/click', async (req, res) => {
      try {
        res.json(await vlmPageApi.click(req.params.id, req.body || {}));
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.post('/api/tabs/:id/action/type', async (req, res) => {
      try {
        res.json(await vlmPageApi.type(req.params.id, req.body || {}));
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.post('/api/tabs/:id/action/scroll', async (req, res) => {
      try {
        res.json(await vlmPageApi.scroll(req.params.id, req.body || {}));
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.post('/api/tabs/:id/action/navigate', async (req, res) => {
      try {
        res.json(await vlmPageApi.navigate(req.params.id, req.body || {}));
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.post('/api/tabs/:id/action/wait', async (req, res) => {
      try {
        res.json(await vlmPageApi.wait(req.params.id, req.body || {}));
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.post('/api/tabs/:id/action/evaluate', async (req, res) => {
      try {
        res.json(await vlmPageApi.evaluate(req.params.id, req.body || {}));
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.post('/api/actions', async (req, res) => {
      try {
        const tabId = req.body?.tabId;
        if (!tabId) {
          throw new Error('TAB_REQUIRED');
        }

        const actionType = req.body?.actionType;
        if (actionType === 'navigate') {
          res.json(await vlmPageApi.navigate(tabId, { url: req.body?.input || req.body?.url }));
          return;
        }
        if (actionType === 'click') {
          res.json(await vlmPageApi.click(tabId, req.body?.target || req.body || {}));
          return;
        }
        if (actionType === 'type') {
          res.json(await vlmPageApi.type(tabId, {
            ...(req.body?.target || {}),
            text: req.body?.input ?? req.body?.text,
            clearFirst: req.body?.clearFirst,
            targetType: req.body?.target?.type,
          }));
          return;
        }
        if (actionType === 'scroll') {
          res.json(await vlmPageApi.scroll(tabId, req.body || {}));
          return;
        }
        if (actionType === 'wait_for') {
          res.json(await vlmPageApi.wait(tabId, req.body || {}));
          return;
        }

        throw new Error('UNSUPPORTED_ACTION_TYPE');
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
