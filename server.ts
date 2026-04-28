import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import cors from 'cors';
import { tabManager } from './src/server/tabManager.js';
import { actionExecutor } from './src/server/actionExecutor.js';
import { memoryService } from './src/server/memoryService.js';
import db from './src/server/db.js';

async function start() {
  const app = express();
  const port = 3000;

  app.use(cors());
  app.use(express.json());

  // API Routes
  app.get('/api/profiles', (req, res) => {
    res.json(db.prepare('SELECT * FROM profiles').all());
  });

  app.get('/api/tabs', (req, res) => {
    res.json(tabManager.getAllTabs());
  });

  app.post('/api/tabs', async (req, res) => {
    const { profileId } = req.body;
    const tabId = tabManager.createTabSync(profileId || 'default');
    res.json({ id: tabId });
  });

  app.delete('/api/tabs/:id', async (req, res) => {
    await tabManager.closeTab(req.params.id);
    res.json({ success: true });
  });

  app.get('/api/tabs/:id/dom', async (req, res) => {
    const tab = tabManager.getTab(req.params.id);
    res.json(tab?.elements || []);
  });

  app.post('/api/actions', async (req, res) => {
    try {
      const result = await actionExecutor.execute(req.body);
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/memory/search', async (req, res) => {
    const { q } = req.query;
    const results = await memoryService.searchMemory(q as string);
    res.json(results);
  });

  app.get('/api/memory/history', (req, res) => {
    const { q } = req.query;
    let query = 'SELECT * FROM history';
    const params: any[] = [];
    if (q) {
      query += ' WHERE url LIKE ? OR title LIKE ?';
      params.push(`%${q}%`, `%${q}%`);
    }
    query += ' ORDER BY last_visited DESC LIMIT 50';
    const history = db.prepare(query).all(...params);
    res.json(history);
  });

  app.get('/api/memory/downloads', (req, res) => {
    const { q } = req.query;
    let query = 'SELECT * FROM downloads';
    const params: any[] = [];
    if (q) {
      query += ' WHERE file_name LIKE ? OR url LIKE ?';
      params.push(`%${q}%`, `%${q}%`);
    }
    query += ' ORDER BY timestamp DESC LIMIT 50';
    const downloads = db.prepare(query).all(...params);
    res.json(downloads);
  });

  app.get('/api/memory/logs', (req, res) => {
    const logs = db.prepare('SELECT * FROM action_logs ORDER BY timestamp DESC LIMIT 50').all();
    res.json(logs);
  });

  // Vite Middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`GlassBox API running on port ${port}`);
  });
}

start().catch(console.error);
