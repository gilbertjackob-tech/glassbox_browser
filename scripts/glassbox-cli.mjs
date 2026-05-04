import { existsSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const API_BASE = process.env.GLASSBOX_API_BASE || process.env.GLASSBOX_API || 'http://127.0.0.1:3000';
const isWindows = process.platform === 'win32';

function usage(exitCode = 1) {
  console.error(`GlassBox CLI

Profiles:
  npm run gb -- profile list
  npm run gb -- profile create <name> [--id <slug>]
  npm run gb -- profile delete <slug>
  npm run gb -- profile use <slug>
  npm run gb -- open --profile <slug> [--url <url>]

Agent control:
  npm run gb -- task run-smart "send this file to Bihi on WhatsApp" [--file path] [--message text] [--profile id] [--allowExternalSend] [--dryRun]
  npm run gb -- snapshot --tab <tabId> [--out file.html]
  npm run gb -- screenshot --tab <tabId> [--out file.png] [--sel "..."] [--highlight]
  npm run gb -- query --tab <tabId> --sel "..."
  npm run gb -- click --tab <tabId> --sel "..."
  npm run gb -- click --tab <tabId> --x 100 --y 200
  npm run gb -- type --tab <tabId> --sel "..." --text "..."
  npm run gb -- wait --tab <tabId> --sel "..." --until present

WhatsApp:
  npm run gb -- whatsapp list-chats
  npm run gb -- whatsapp open-chat [--tabId "<TAB_ID>"] --chat "Bihi"
  npm run gb -- whatsapp send-message [--tabId "<TAB_ID>"] --chat "Hasnat (You)" --message "test" [--allowExternalSend]
  npm run gb -- whatsapp send-file [--tabId "<TAB_ID>"] --chat "Hasnat (You)" --file "P:\\Hasnat\\test.pdf" [--file "P:\\Hasnat\\test2.pdf"] [--caption "test file"] [--allowExternalSend]
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
    const key = rawKey === 'sel' ? 'selector' : rawKey;
    const assignValue = (value) => {
      if (key === 'file') {
        if (!Array.isArray(out.file)) {
          out.file = typeof out.file === 'string' ? [out.file] : [];
        }
        out.file.push(value);
        return;
      }
      out[key] = value;
    };

    if (inlineValue !== undefined) {
      assignValue(inlineValue);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      assignValue(argv[i + 1]);
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function request(route, options = {}) {
  const response = await fetch(`${API_BASE}${route}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }

  return response;
}

async function requestJson(route, options = {}) {
  const response = await request(route, options);
  return await response.json();
}

async function isApiRunning() {
  try {
    await request('/api/settings');
    return true;
  } catch {
    return false;
  }
}

function electronBinary() {
  const candidates = isWindows
    ? [path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe')]
    : process.platform === 'darwin'
      ? [path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')]
      : [path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron')];

  const binary = candidates.find((candidate) => existsSync(candidate));
  if (!binary) {
    throw new Error('Electron binary not found. Run npm install first.');
  }
  return binary;
}

function launchElectron(profile, url) {
  const args = ['.'];
  if (profile) args.push('--profile', profile, '--create-profile');
  if (url) args.push('--url', url);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronBinary(), args, {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env,
  });
  child.unref();
  return { launched: true, profile, url: url || null };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [command, subcommand, ...rest] = args._;

  if (args.help || command === 'help') {
    usage(0);
  }

  if (!command) usage();

  if (command === 'profile') {
    if (subcommand === 'list') {
      printJson(await requestJson('/api/profiles'));
      return;
    }
    if (subcommand === 'create') {
      const name = rest.join(' ').trim();
      if (!name) usage();
      printJson(await requestJson('/api/profiles', {
        method: 'POST',
        body: JSON.stringify({ name, id: args.id }),
      }));
      return;
    }
    if (subcommand === 'delete') {
      const id = rest[0];
      if (!id) usage();
      printJson(await requestJson(`/api/profiles/${encodeURIComponent(id)}?deleteStorage=true`, { method: 'DELETE' }));
      return;
    }
    if (subcommand === 'use') {
      const id = rest[0];
      if (!id) usage();
      printJson(await requestJson('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ activeProfileId: id }),
      }));
      return;
    }
    usage();
  }

  if (command === 'open') {
    const profile = args.profile;
    if (!profile || typeof profile !== 'string') usage();
    const url = typeof args.url === 'string' ? args.url : undefined;

    if (await isApiRunning()) {
      printJson(await requestJson(`/api/profiles/${encodeURIComponent(profile)}/open`, {
        method: 'POST',
        body: JSON.stringify({ url }),
      }));
      return;
    }

    printJson(launchElectron(profile, url));
    return;
  }

  if (command === 'task') {
    if (subcommand === 'run-smart') {
      const goal = rest.join(' ').trim();
      const fileValues = Array.isArray(args.file)
        ? args.file
        : typeof args.file === 'string'
          ? [args.file]
          : [];
      const extraFilePath = typeof args.filePath === 'string' ? [args.filePath] : [];
      const filesJson = typeof args.filesJson === 'string'
        ? JSON.parse(args.filesJson)
        : [];
      const filePaths = [
        ...fileValues,
        ...extraFilePath,
        ...(Array.isArray(filesJson) ? filesJson : []),
      ].filter((item) => typeof item === 'string' && item.trim());

      if (!goal) usage();
      printJson(await requestJson('/api/task/run-smart', {
        method: 'POST',
        body: JSON.stringify({
          goal,
          profileId: typeof args.profile === 'string' ? args.profile : args.profileId,
          filePath: filePaths[0] || '',
          message: typeof args.message === 'string' ? args.message : '',
          allowExternalSend: Boolean(args.allowExternalSend || args['allow-external-send']),
          dryRun: Boolean(args.dryRun || args['dry-run']),
        }),
      }));
      return;
    }

    usage();
  }

  if (command === 'snapshot') {
    if (!args.tab) usage();
    const data = await requestJson(`/api/tabs/${encodeURIComponent(args.tab)}/html`);
    if (args.out) {
      writeFileSync(args.out, data.html, 'utf8');
      printJson({ ok: true, out: args.out, tabId: data.tabId, url: data.url });
    } else {
      process.stdout.write(data.html);
    }
    return;
  }

  if (command === 'screenshot') {
    if (!args.tab) usage();
    const params = new URLSearchParams();
    if (typeof args.selector === 'string') params.set('selector', args.selector);
    if (args.highlight) params.set('highlight', 'true');
    const response = await request(`/api/tabs/${encodeURIComponent(args.tab)}/screenshot?${params.toString()}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (args.out) {
      writeFileSync(args.out, buffer);
      printJson({ ok: true, out: args.out, bytes: buffer.length });
    } else {
      process.stdout.write(buffer);
    }
    return;
  }

  if (command === 'query') {
    if (!args.tab || !args.selector) usage();
    printJson(await requestJson(`/api/tabs/${encodeURIComponent(args.tab)}/query`, {
      method: 'POST',
      body: JSON.stringify({ selector: args.selector, limit: args.limit ? Number(args.limit) : undefined }),
    }));
    return;
  }

  if (command === 'click') {
    if (!args.tab) usage();
    printJson(await requestJson(`/api/tabs/${encodeURIComponent(args.tab)}/action/click`, {
      method: 'POST',
      body: JSON.stringify(args.selector ? { selector: args.selector } : { x: Number(args.x), y: Number(args.y) }),
    }));
    return;
  }

  if (command === 'type') {
    if (!args.tab || !args.selector || typeof args.text !== 'string') usage();
    printJson(await requestJson(`/api/tabs/${encodeURIComponent(args.tab)}/action/type`, {
      method: 'POST',
      body: JSON.stringify({ selector: args.selector, text: args.text, clearFirst: Boolean(args.clearFirst) }),
    }));
    return;
  }

  if (command === 'wait') {
    if (!args.tab || !args.selector) usage();
    printJson(await requestJson(`/api/tabs/${encodeURIComponent(args.tab)}/action/wait`, {
      method: 'POST',
      body: JSON.stringify({
        selector: args.selector,
        until: args.until || 'present',
        timeoutMs: args.timeoutMs ? Number(args.timeoutMs) : undefined,
      }),
    }));
    return;
  }

  if (command === 'whatsapp') {
    if (subcommand === 'list-chats') {
      printJson(await requestJson('/api/whatsapp/static-chats'));
      return;
    }

    if (subcommand === 'open-chat') {
      if (!args.chat) usage();
      printJson(await requestJson('/api/whatsapp/open-chat', {
        method: 'POST',
        body: JSON.stringify({
          tabId: args.tabId,
          chat: args.chat,
        }),
      }));
      return;
    }

    if (subcommand === 'send-message') {
      if (!args.chat || typeof args.message !== 'string') usage();
      printJson(await requestJson('/api/whatsapp/send-message', {
        method: 'POST',
        body: JSON.stringify({
          tabId: args.tabId,
          chat: args.chat,
          message: args.message,
          allowExternalSend: Boolean(args.allowExternalSend),
        }),
      }));
      return;
    }

    if (subcommand === 'send-file') {
      const fileValues = Array.isArray(args.file)
        ? args.file
        : typeof args.file === 'string'
          ? [args.file]
          : [];
      const extraFilePath = typeof args.filePath === 'string' ? [args.filePath] : [];
      const filesJson = typeof args.filesJson === 'string'
        ? JSON.parse(args.filesJson)
        : [];
      const filePaths = [
        ...fileValues,
        ...extraFilePath,
        ...(Array.isArray(filesJson) ? filesJson : []),
      ].filter((item) => typeof item === 'string' && item.trim());

      if (!args.chat || filePaths.length < 1) usage();
      printJson(await requestJson('/api/whatsapp/send-file', {
        method: 'POST',
        body: JSON.stringify({
          tabId: args.tabId,
          chat: args.chat,
          filePath: filePaths[0],
          filePaths,
          caption: typeof args.caption === 'string' ? args.caption : '',
          allowExternalSend: Boolean(args.allowExternalSend),
        }),
      }));
      return;
    }

    usage();
  }

  usage();
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
