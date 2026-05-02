import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const outputDir = path.resolve('debug-resolve-and-act-output');

async function requestJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}\n${JSON.stringify(data, null, 2)}`);
  }
  return data;
}

async function getOrCreateTabId() {
  const tabs = await requestJson(`${API_BASE}/api/tabs`);
  if (Array.isArray(tabs) && tabs.length > 0) return tabs[0].tabId || tabs[0].id;
  const created = await requestJson(`${API_BASE}/api/tabs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return created.tabId || created.id;
}

async function navigate(tabId, url) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/action/navigate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

async function getTargets(tabId) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/action-targets`);
}

async function actByTarget(tabId, body) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/action/by-target`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function resolveAndAct(tabId, body) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/action/resolve-and-act`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function findSearchInput(targets) {
  return (targets || []).find((target) =>
    target.kind === 'input' &&
    (/search/i.test(target.label || '') || /search_query/.test(target.selector || ''))
  );
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const tabId = await getOrCreateTabId();
  const steps = [];

  await navigate(tabId, 'https://www.youtube.com/results?search_query=lecture');
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const snapshot = await getTargets(tabId);
  const target = findSearchInput(snapshot.targets);
  if (!target) throw new Error('Search input target not found');

  const seedMemory = await actByTarget(tabId, {
    targetId: target.targetId,
    stateHash: snapshot.stateHash,
    action: 'type',
    text: 'database lecture',
    clearFirst: true,
  });
  steps.push({
    step: 'seed-memory',
    ok: seedMemory.ok,
    memoryRecord: Boolean(seedMemory.memoryRecord),
  });

  const memoryRun = await resolveAndAct(tabId, {
    targetKey: 'search_box',
    kind: 'input',
    action: 'type',
    text: 'database lecture',
    clearFirst: true,
  });
  steps.push({
    step: 'resolve-and-act-memory',
    ok: memoryRun.ok,
    source: memoryRun.source || memoryRun.resolve?.source,
    valueChanged: memoryRun.verification?.valueChanged,
  });

  const aliasRun = await resolveAndAct(tabId, {
    targetKey: 'search',
    kind: 'input',
    action: 'press',
    key: 'Enter',
  });
  steps.push({
    step: 'resolve-and-act-alias',
    ok: aliasRun.ok,
    source: aliasRun.source || aliasRun.resolve?.source,
    urlChanged: aliasRun.verification?.urlChanged,
  });

  const passed =
    Boolean(seedMemory.ok) &&
    Boolean(seedMemory.memoryRecord) &&
    Boolean(memoryRun.ok) &&
    (memoryRun.source === 'memory' || memoryRun.resolve?.source === 'memory') &&
    Boolean(aliasRun.ok);

  const payload = {
    runAt: new Date().toISOString(),
    tabId,
    passed,
    steps,
  };

  const resultPath = path.join(outputDir, 'result.json');
  const summaryPath = path.join(outputDir, 'summary.txt');
  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8');

  const summary = [
    `passed: ${passed}`,
    `tabId: ${tabId}`,
    `memoryRunSource: ${memoryRun.source || memoryRun.resolve?.source || ''}`,
    `aliasRunSource: ${aliasRun.source || aliasRun.resolve?.source || ''}`,
    `result: ${resultPath}`,
  ].join('\n');

  fs.writeFileSync(summaryPath, summary, 'utf8');
  console.log('\nDONE');
  console.log(summary);

  if (!passed) process.exit(1);
}

main().catch((error) => {
  console.error('\nFAILED');
  console.error(error.message);
  process.exit(1);
});
