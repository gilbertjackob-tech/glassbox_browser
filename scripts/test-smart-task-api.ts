import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE_URL = process.env.GLASSBOX_API_BASE || 'http://127.0.0.1:3000';

type SmartTaskApiBody = {
  goal: string;
  dryRun?: boolean;
  filePath?: string;
  allowExternalSend?: boolean;
  profileId?: string;
  site?: string;
};

async function requestJson(path: string, init?: RequestInit) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

function assertSmartTaskShape(result: any) {
  assert.ok(result && typeof result === 'object', 'response payload must be an object');
  assert.ok('ok' in result, 'missing ok');
  assert.ok('status' in result, 'missing status');
  assert.ok('detectedIntent' in result, 'missing detectedIntent');
  assert.ok('initialWorldStateSummary' in result, 'missing initialWorldStateSummary');
  assert.ok('skippedSteps' in result, 'missing skippedSteps');
  assert.ok('executedSteps' in result, 'missing executedSteps');
  assert.ok('verification' in result, 'missing verification');
  assert.ok('evidence' in result, 'missing evidence');
  assert.ok(Array.isArray(result.skippedSteps), 'skippedSteps must be array');
  assert.ok(Array.isArray(result.executedSteps), 'executedSteps must be array');
}

function assertDryRunNoRealActions(result: any) {
  assert.ok(
    result.status === 'DRY_RUN' || result.status === 'AMBIGUOUS' || result.status === 'FAILED' || result.status === 'NEEDS_AUTH',
    'dryRun request must be non-successful without real side effects',
  );

  const executed = Array.isArray(result.executedSteps) ? result.executedSteps : [];
  for (const step of executed) {
    const reason = String(step?.reason || '');
    assert.notEqual(reason, 'CLICK_SENT', 'dryRun must not click send button');
    assert.notEqual(reason, 'WHATSAPP_FILES_SENT', 'dryRun must not send files');
    assert.notEqual(step?.sent, true, 'dryRun must not mark send as completed');
    if ('dryRun' in step) {
      assert.equal(step.dryRun, true, 'executed dry-run step must carry dryRun=true');
    }
  }
}

async function runSmartTaskApi(body: SmartTaskApiBody) {
  const response = await requestJson('/api/task/run-smart', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  assert.equal(response.ok, true, `run-smart failed for goal: ${body.goal}`);
  assertSmartTaskShape(response.payload);
  return response.payload;
}

async function ensureApiHealthy() {
  const health = await requestJson('/api/health');
  if (health.ok) return;

  const settings = await requestJson('/api/settings');
  assert.equal(
    settings.ok,
    true,
    `API health check failed. Tried /api/health and fallback /api/settings on ${BASE_URL}`,
  );
}

function assertAuthStatusWhenAuthRoom(result: any) {
  const room = String(result?.verification?.room?.room || '');
  if (room.endsWith('_auth')) {
    assert.equal(result.status, 'NEEDS_AUTH', 'auth room must return NEEDS_AUTH');
  }
}

async function main() {
  await ensureApiHealthy();

  const tempDir = await mkdtemp(join(tmpdir(), 'glassbox-smart-task-'));
  const dummyFile = join(tempDir, 'dummy-file.txt');
  await writeFile(dummyFile, 'smart task api dry-run fixture', 'utf8');

  try {
    const chatGpt = await runSmartTaskApi({
      goal: 'ask ChatGPT: explain DBMS normalization',
      dryRun: true,
    });
    assertDryRunNoRealActions(chatGpt);
    assertAuthStatusWhenAuthRoom(chatGpt);

    const gemini = await runSmartTaskApi({
      goal: 'ask Gemini: explain DBMS normalization',
      dryRun: true,
    });
    assertDryRunNoRealActions(gemini);
    assertAuthStatusWhenAuthRoom(gemini);

    const githubIssues = await runSmartTaskApi({
      goal: 'open issues in this GitHub repo',
      dryRun: true,
    });
    assertDryRunNoRealActions(githubIssues);

    const whatsappMessage = await runSmartTaskApi({
      goal: 'send hello to Bihi on WhatsApp',
      dryRun: true,
      allowExternalSend: true,
    });
    assertDryRunNoRealActions(whatsappMessage);
    assertAuthStatusWhenAuthRoom(whatsappMessage);

    const whatsappFile = await runSmartTaskApi({
      goal: 'send this file to Bihi on WhatsApp',
      dryRun: true,
      filePath: dummyFile,
      allowExternalSend: true,
    });
    assertDryRunNoRealActions(whatsappFile);
    assertAuthStatusWhenAuthRoom(whatsappFile);

    const unsupported = await runSmartTaskApi({
      goal: 'do something magical and undefined across random websites',
      dryRun: true,
    });
    assert.ok(
      unsupported.status === 'AMBIGUOUS' || unsupported.status === 'FAILED',
      'unsupported tasks must return AMBIGUOUS or FAILED, never fake SUCCESS',
    );

    console.log('smart-task API dry-run integration checks passed');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
