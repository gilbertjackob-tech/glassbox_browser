import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';
const rendererPort = 5173;

function getElectronBinary() {
  const candidates = isWindows
    ? [path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe')]
    : process.platform === 'darwin'
      ? [path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')]
      : [path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron')];

  const binary = candidates.find((candidate) => existsSync(candidate));
  if (!binary) {
    throw new Error('Electron binary not found in node_modules/electron/dist');
  }

  return binary;
}

function spawnShellCommand(command) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  if (isWindows) {
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
      stdio: 'inherit',
      env,
    });
  }

  return spawn(command, {
    stdio: 'inherit',
    shell: true,
    env,
  });
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function start() {
  const rendererAlreadyRunning = await isPortOpen(rendererPort);
  let renderer = null;

  if (!rendererAlreadyRunning) {
    renderer = spawnShellCommand('npm run renderer:dev');
  }

  const ready = await waitForPort(rendererPort);
  if (!ready) {
    throw new Error(`Renderer dev server did not start on port ${rendererPort}`);
  }

  const shutdown = () => {
    if (renderer && !renderer.killed) {
      renderer.kill();
    }
  };

  const electron = spawn(getElectronBinary(), ['.'], {
    stdio: 'inherit',
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE')),
      NODE_ENV: 'development',
    },
  });

  electron.on('exit', (code) => {
    shutdown();
    process.exit(code ?? 0);
  });

  process.on('SIGINT', () => {
    electron.kill();
    shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    electron.kill();
    shutdown();
    process.exit(0);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
