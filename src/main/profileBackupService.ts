import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { app, session } from 'electron';

import db from './memoryDb.js';
import { profileStore } from './profileStore.js';
import { tabManager } from '../server/tabManager.js';

const FORMAT = 'glassbox-profile-backup';
const SCHEMA_VERSION = 2;
const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;

const SKIP_NAMES = new Set([
  'LOCK',
  'SingletonLock',
  'SingletonSocket',
  'SingletonCookie',
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'GrShaderCache',
]);

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, 32);
}

function encryptPayload(payload: unknown, password: string) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    encrypted: true,
    crypto: {
      algorithm: 'aes-256-gcm',
      kdf: 'scrypt',
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
    },
    payloadBase64: encrypted.toString('base64'),
  };
}

function decryptPayload(backup: any, password: string) {
  if (!backup || backup.format !== FORMAT || backup.schemaVersion !== SCHEMA_VERSION) {
    throw new Error('INVALID_BACKUP_FILE');
  }

  if (!backup.encrypted) {
    throw new Error('BACKUP_NOT_ENCRYPTED');
  }

  try {
    const salt = Buffer.from(backup.crypto?.salt || '', 'base64');
    const iv = Buffer.from(backup.crypto?.iv || '', 'base64');
    const authTag = Buffer.from(backup.crypto?.authTag || '', 'base64');
    const encrypted = Buffer.from(backup.payloadBase64 || '', 'base64');

    const key = deriveKey(password, salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw new Error('INVALID_BACKUP_PASSWORD_OR_CORRUPTED');
  }
}

function stripPersistPrefix(partition: string) {
  return partition.startsWith('persist:') ? partition.slice('persist:'.length) : partition;
}

function getCandidatePartitionDirs(partition: string): string[] {
  const userData = app.getPath('userData');
  const clean = stripPersistPrefix(partition);

  return [
    path.join(userData, 'Partitions', clean),
    path.join(userData, 'Partitions', partition),
    path.join(userData, clean),
    path.join(userData, partition),
  ];
}

function findPartitionDir(partition: string): string | null {
  for (const candidate of getCandidatePartitionDirs(partition)) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  return null;
}

function walkFiles(rootDir: string, currentDir = rootDir): string[] {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (SKIP_NAMES.has(entry.name)) continue;

    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkFiles(rootDir, fullPath));
      continue;
    }

    if (entry.isFile()) {
      const stat = fs.statSync(fullPath);
      if (stat.size <= MAX_FILE_SIZE_BYTES) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function readDirAsBackupFiles(rootDir: string) {
  const files = walkFiles(rootDir);
  const backupFiles: Array<{ relativePath: string; base64: string }> = [];
  const warnings: string[] = [];

  for (const filePath of files) {
    try {
      backupFiles.push({
        relativePath: path.relative(rootDir, filePath).replace(/\\/g, '/'),
        base64: fs.readFileSync(filePath).toString('base64'),
      });
    } catch (error: any) {
      warnings.push(`Skipped ${path.relative(rootDir, filePath).replace(/\\/g, '/')}: ${error?.message || error}`);
    }
  }

  return {
    files: backupFiles,
    warnings,
  };
}

function isSafeRelativePath(relativePath: string) {
  if (!relativePath) return false;
  if (path.isAbsolute(relativePath)) return false;
  if (relativePath.includes('..')) return false;
  if (relativePath.includes('\0')) return false;
  return true;
}

function restoreBackupFiles(rootDir: string, files: Array<{ relativePath: string; base64: string }>) {
  fs.mkdirSync(rootDir, { recursive: true });

  for (const file of files) {
    if (!isSafeRelativePath(file.relativePath)) {
      continue;
    }

    const targetPath = path.join(rootDir, file.relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, Buffer.from(file.base64, 'base64'));
  }
}

function cookieUrlFromCookie(cookie: any) {
  if (typeof cookie?.url === 'string' && cookie.url) {
    return cookie.url;
  }

  const rawDomain = typeof cookie?.domain === 'string' ? cookie.domain : '';
  const hostname = rawDomain.replace(/^\./, '');
  if (!hostname) {
    return null;
  }

  const scheme = cookie?.secure ? 'https' : 'http';
  const pathname = typeof cookie?.path === 'string' && cookie.path ? cookie.path : '/';
  return `${scheme}://${hostname}${pathname}`;
}

async function snapshotPartitionCookies(partition: string) {
  try {
    const ses = session.fromPartition(partition);
    if (!ses.cookies || typeof ses.cookies.get !== 'function') {
      return [];
    }
    return await ses.cookies.get({});
  } catch {
    return [];
  }
}

async function restorePartitionCookies(partition: string, cookies: any[]) {
  if (!Array.isArray(cookies) || cookies.length === 0) {
    return 0;
  }

  const ses = session.fromPartition(partition);
  if (!ses.cookies || typeof ses.cookies.set !== 'function') {
    return 0;
  }

  let restored = 0;

  for (const cookie of cookies) {
    const url = cookieUrlFromCookie(cookie);
    if (!url || !cookie?.name) {
      continue;
    }

    try {
      await ses.cookies.set({
        url,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        expirationDate: cookie.expirationDate,
        sameSite: cookie.sameSite,
      });
      restored += 1;
    } catch {
      // Skip incompatible cookie rows.
    }
  }

  if (ses.cookies && typeof ses.cookies.flushStore === 'function') {
    await ses.cookies.flushStore();
  }

  return restored;
}

function importRows(tableName: string, rows: any[]) {
  if (!Array.isArray(rows) || rows.length === 0) return;

  const allowedTables = new Set([
    'history',
    'downloads',
    'saved_passwords',
    'actions',
    'tabs',
  ]);

  if (!allowedTables.has(tableName)) return;

  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all().map((c: any) => c.name);

  for (const row of rows) {
    const rowColumns = columns.filter((column: string) =>
      Object.prototype.hasOwnProperty.call(row, column)
    );

    if (rowColumns.length === 0) continue;

    const placeholders = rowColumns.map(() => '?').join(', ');
    const values = rowColumns.map((column: string) => row[column]);

    const updateSet = rowColumns
      .filter((column: string) => column !== 'id')
      .map((column: string) => `${column} = excluded.${column}`)
      .join(', ');

    const sql = `
      INSERT INTO ${tableName} (${rowColumns.join(', ')})
      VALUES (${placeholders})
      ON CONFLICT(id) DO ${updateSet ? `UPDATE SET ${updateSet}` : 'NOTHING'}
    `;

    try {
      db.prepare(sql).run(...values);
    } catch {
      // Skip incompatible row.
    }
  }
}

export async function exportFullProfileBackup(password: string) {
  if (!password || password.length < 8) {
    throw new Error('BACKUP_PASSWORD_TOO_SHORT');
  }

  const profiles = profileStore.list();
  const activeProfileId = profileStore.getActiveId();

  for (const profile of profiles) {
    try {
      const ses = session.fromPartition(profile.partition);

      if (typeof ses.flushStorageData === 'function') {
        await ses.flushStorageData();
      }

      if (ses.cookies && typeof ses.cookies.flushStore === 'function') {
        await ses.cookies.flushStore();
      }
    } catch {
      // Continue export even if one session fails to flush.
    }
  }

  const sessions = [];

  for (const profile of profiles) {
    const cookies = await snapshotPartitionCookies(profile.partition);
    const partitionDir = findPartitionDir(profile.partition);

    if (!partitionDir) {
      sessions.push({
        profileId: profile.id,
        partition: profile.partition,
        found: false,
        files: [],
        cookies,
        warning: 'Partition folder not found. Session data may not have been written yet.',
        candidates: getCandidatePartitionDirs(profile.partition),
      });
      continue;
    }

    const snapshot = readDirAsBackupFiles(partitionDir);
    sessions.push({
      profileId: profile.id,
      partition: profile.partition,
      found: true,
      files: snapshot.files,
      cookies,
      warnings: snapshot.warnings,
    });
  }

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    app: 'glassbox-browser',
    exportedAt: new Date().toISOString(),
    activeProfileId,
    profiles,
    sqlite: {
      history: db.prepare('SELECT * FROM history').all(),
      downloads: db.prepare('SELECT * FROM downloads').all(),
      saved_passwords: db.prepare('SELECT * FROM saved_passwords').all(),
      actions: db.prepare('SELECT * FROM actions').all(),
      tabs: db.prepare('SELECT * FROM tabs').all(),
    },
    sessions,
    warning: 'This backup may contain cookies and login session tokens. Some websites may still require re-login after restore.',
  };

  return encryptPayload(payload, password);
}

export async function importFullProfileBackup(backup: any, password: string) {
  if (!password) {
    throw new Error('BACKUP_PASSWORD_REQUIRED');
  }

  const payload = decryptPayload(backup, password);

  if (!payload || payload.app !== 'glassbox-browser' || payload.schemaVersion !== SCHEMA_VERSION) {
    throw new Error('INVALID_BACKUP_PAYLOAD');
  }

  const profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
  const sqlite = payload.sqlite || {};
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];

  for (const profile of profiles) {
    try {
      const tabs = tabManager.getAllTabs().filter((tab) => tab.profileId === profile.id);
      for (const tab of tabs) {
        await tabManager.closeTab(tab.tabId);
      }
    } catch {
      // Continue.
    }
  }

  const tx = db.transaction(() => {
    for (const profile of profiles) {
      if (!profile.id || !profile.name) continue;

      const partition = profile.partition || `persist:gb-profile-${profile.id}`;
      const importedEmail = typeof profile.email === 'string' ? profile.email.trim() : '';
      const emailToStore = profile.id === 'default'
        ? importedEmail || null
        : importedEmail || `missing-email+${profile.id}@glassbox.local`;

      db.prepare(`
        INSERT INTO profiles (id, name, email, partition, created_at)
        VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          email = excluded.email,
          partition = excluded.partition
      `).run(
        profile.id,
        profile.name,
        emailToStore,
        partition,
        profile.created_at || null
      );
    }

    importRows('history', sqlite.history);
    importRows('downloads', sqlite.downloads);
    importRows('saved_passwords', sqlite.saved_passwords);
    importRows('actions', sqlite.actions);
    importRows('tabs', sqlite.tabs);

    if (payload.activeProfileId) {
      try {
        profileStore.setActive(payload.activeProfileId);
      } catch {
        // Ignore invalid active id.
      }
    }
  });

  tx();

  let restoredSessions = 0;

  for (const item of sessions) {
    if (!item.partition) continue;

    let restored = false;

    if (Array.isArray(item.files)) {
      const targetDir = getCandidatePartitionDirs(item.partition)[0];

      try {
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true });
        }

        restoreBackupFiles(targetDir, item.files);
        restored = restored || item.files.length > 0;
      } catch {
        // Continue with logical cookie restore even if files are locked.
      }
    }

    const restoredCookies = await restorePartitionCookies(item.partition, item.cookies);
    if (restored || restoredCookies > 0) {
      restoredSessions += 1;
    }
  }

  return {
    success: true,
    importedProfiles: profiles.length,
    restoredSessions,
    activeProfileId: profileStore.getActiveId(),
    restartRecommended: restoredSessions > 0,
  };
}
