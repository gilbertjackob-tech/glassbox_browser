import cors from 'cors';
import express from 'express';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import db from './memoryDb.js';
import { exportFullProfileBackup, importFullProfileBackup } from './profileBackupService.js';
import { profileStore } from './profileStore.js';
import { memoryService } from '../server/memoryService.js';
import { listMicroSkills, saveMicroSkill } from '../server/skillService.js';
import { tabManager } from '../server/tabManager.js';
import { listTargetMemory, siteHostFromUrl } from '../server/targetMemoryService.js';
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

    app.get('/api/memory/targets', (req, res) => {
      try {
        const profileId = resolveProfileId(req.query.profileId);
        const host = typeof req.query.host === 'string' ? req.query.host : undefined;
        res.json(listTargetMemory(profileId, host));
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.get('/api/skills', (req, res) => {
      try {
        const profileId = resolveProfileId(req.query.profileId);
        res.json(listMicroSkills(profileId));
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.post('/api/skills', (req, res) => {
      try {
        const profileId = resolveProfileId(req.body?.profileId);
        const skill = saveMicroSkill({
          profileId,
          name: req.body?.name,
          queryPattern: typeof req.body?.queryPattern === 'string' ? req.body.queryPattern : undefined,
          steps: req.body?.steps,
        });

        res.json({
          ok: true,
          skill,
        });
      } catch (error: any) {
        errorResponse(res, error);
      }
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
        const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';

        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          res.status(400).json({
            error: 'INVALID_EMAIL',
            message: 'Enter a valid email address.',
          });
          return;
        }

        const profile = profileStore.create(name, id, email);
        res.json(profile);
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.patch('/api/profiles/:id', (req, res) => {
      try {
        const profile = profileStore.update(req.params.id, {
          name: typeof req.body?.name === 'string' ? req.body.name : undefined,
        });
        res.json({ success: true, ...profile });
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.post('/api/profiles/:id/detect-email', async (req, res) => {
      try {
        const profile = profileStore.get(req.params.id);
        if (!profile) {
          res.status(404).json({ error: 'PROFILE_NOT_FOUND' });
          return;
        }

        if (profile.id === 'default') {
          res.json({
            success: false,
            reason: 'DEFAULT_PROFILE_EMAIL_OPTIONAL',
            email: null,
          });
          return;
        }

        const profileTabs = tabManager
          .getAllTabs()
          .filter((tab) => tab.profileId === profile.id);

        if (profileTabs.length === 0) {
          res.json({
            success: false,
            reason: 'NO_PROFILE_TAB',
            email: null,
          });
          return;
        }

        const activeTabId = tabManager.getActiveTabId?.();
        const selectedTab =
          profileTabs.find((tab) => tab.tabId === activeTabId) ||
          profileTabs.find((tab) => {
            try {
              const detectedHost = new URL(tab.url).hostname.toLowerCase();
              return detectedHost === 'mail.google.com' ||
                detectedHost === 'accounts.google.com' ||
                detectedHost === 'myaccount.google.com' ||
                detectedHost === 'www.google.com' ||
                detectedHost === 'google.com';
            } catch {
              return false;
            }
          }) ||
          profileTabs[0];

        const tab = tabManager.getTab(selectedTab.tabId);
        if (!tab) {
          res.json({
            success: false,
            reason: 'TAB_NOT_FOUND',
            email: null,
          });
          return;
        }

        const currentUrl = tab.webContents.getURL();
        let host = '';

        try {
          host = new URL(currentUrl).hostname.toLowerCase();
        } catch {
          host = '';
        }

        const trustedGoogleHosts = new Set([
          'accounts.google.com',
          'myaccount.google.com',
          'mail.google.com',
          'www.google.com',
          'google.com',
        ]);

        if (!trustedGoogleHosts.has(host)) {
          res.json({
            success: false,
            reason: 'NOT_GOOGLE_IDENTITY_PAGE',
            url: currentUrl,
            email: null,
          });
          return;
        }

        const email = await tab.webContents.executeJavaScript(`
          (() => {
            const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/ig;

            const candidates = new Set();

            const add = (value) => {
              if (!value || typeof value !== 'string') return;
              const matches = value.match(emailRegex);
              if (!matches) return;
              for (const match of matches) {
                candidates.add(match.toLowerCase());
              }
            };

            add(document.body?.innerText || '');
            add(document.title || '');

            for (const el of Array.from(document.querySelectorAll('[aria-label], [title], [data-email], [href], [email]'))) {
              add(el.getAttribute('aria-label'));
              add(el.getAttribute('title'));
              add(el.getAttribute('data-email'));
              add(el.getAttribute('email'));
              add(el.getAttribute('href'));
              add(el.textContent || '');
            }

            for (const script of Array.from(document.scripts || [])) {
              add(script.textContent || '');
            }

            const list = Array.from(candidates);

            const preferred = list.find((detectedEmail) =>
              detectedEmail.endsWith('@gmail.com') ||
              detectedEmail.endsWith('@googlemail.com')
            );

            return preferred || list[0] || null;
          })();
        `, true);

        if (!email || typeof email !== 'string') {
          res.json({
            success: false,
            reason: 'EMAIL_NOT_FOUND_ON_PAGE',
            url: currentUrl,
            email: null,
          });
          return;
        }

        const updated = profileStore.setEmail(profile.id, email);

        res.json({
          success: true,
          email,
          profile: updated,
          sourceUrl: currentUrl,
        });
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

    app.post('/api/profiles/export-full', async (req, res) => {
      try {
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        const backup = await exportFullProfileBackup(password);
        res.json(backup);
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.post('/api/profiles/import-full', async (req, res) => {
      try {
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        const backup = req.body?.backup;

        const result = await importFullProfileBackup(backup, password);
        res.json(result);
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

    app.get('/api/tabs/:id/action-targets', async (req, res) => {
      try {
        res.json(await vlmPageApi.actionTargets(req.params.id));
      } catch (error: any) {
        errorResponse(res, error, 404);
      }
    });

    app.get('/api/tabs/:id/state', async (req, res) => {
      try {
        res.json(await vlmPageApi.getState(req.params.id));
      } catch (error: any) {
        errorResponse(res, error, 404);
      }
    });

    app.post('/api/tabs/:id/resolve-target', async (req, res) => {
      try {
        res.json(await vlmPageApi.resolveTarget(req.params.id, req.body || {}));
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.post('/api/tabs/:id/action/by-target', async (req, res) => {
      try {
        res.json(await vlmPageApi.actionByTarget(req.params.id, req.body || {}));
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.post('/api/tabs/:id/action/resolve-and-act', async (req, res) => {
      try {
        res.json(await vlmPageApi.actionResolveAndAct(req.params.id, req.body || {}));
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.post('/api/tabs/:id/action/run-chain', async (req, res) => {
      try {
        res.json(await vlmPageApi.runActionChain(req.params.id, req.body || {}));
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.post('/api/tabs/:id/skills/run', async (req, res) => {
      try {
        res.json(await vlmPageApi.runMicroSkill(req.params.id, req.body || {}));
      } catch (error: any) {
        errorResponse(res, error);
      }
    });

    app.post('/api/tabs/:id/memory/resolve-target', async (req, res) => {
      try {
        const tab = tabManager.getTab(req.params.id);
        if (!tab) {
          res.status(404).json({ error: 'TAB_NOT_FOUND' });
          return;
        }

        const targetKey = typeof req.body?.targetKey === 'string' ? req.body.targetKey : '';
        if (!targetKey) {
          res.status(400).json({ error: 'TARGET_KEY_REQUIRED' });
          return;
        }

        const host = siteHostFromUrl(tab.url || tab.webContents.getURL());
        const memories = (listTargetMemory(tab.profileId, host) as any[]).filter((item: any) => item.target_key === targetKey);

        for (const memory of memories) {
          const result = await vlmPageApi.query(req.params.id, {
            selector: memory.selector,
            limit: 1,
          });

          const element = result.elements?.[0];
          if (element?.visible && element?.interactable) {
            res.json({
              found: true,
              targetKey,
              memory,
              target: {
                targetKey,
                selector: memory.selector,
                kind: memory.kind,
                label: memory.label,
                visible: element.visible,
                enabled: element.interactable,
                bbox: element.bbox,
              },
            });
            return;
          }
        }

        res.json({
          found: false,
          targetKey,
          reason: 'NO_MEMORY_TARGET_RESOLVED',
        });
      } catch (error: any) {
        errorResponse(res, error);
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
        const result = await vlmPageApi.wait(req.params.id, req.body || {});
        if (!result.ok && result.reason === 'timeout') {
          res.status(408).json(result);
          return;
        }
        res.json(result);
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
          const result = await vlmPageApi.wait(tabId, req.body || {});
          if (!result.ok && result.reason === 'timeout') {
            res.status(408).json(result);
            return;
          }
          res.json(result);
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
            COALESCE(before_url, '') AS before_url,
            COALESCE(after_url, '') AS after_url,
            COALESCE(before_dom_hash, '') AS before_dom_hash,
            COALESCE(after_dom_hash, '') AS after_dom_hash,
            COALESCE(evidence_json, '{}') AS evidence_json
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
