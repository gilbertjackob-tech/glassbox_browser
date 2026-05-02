import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const outputDir = path.resolve('debug-target-memory-output');

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
  if (Array.isArray(tabs) && tabs.length > 0) {
    return tabs[0].tabId || tabs[0].id;
  }

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

async function listMemory(host) {
  return requestJson(`${API_BASE}/api/memory/targets?host=${encodeURIComponent(host)}`);
}

async function resolveMemory(tabId, targetKey) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/memory/resolve-target`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetKey }),
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

  if (!target) {
    throw new Error('Search input target not found');
  }

  steps.push({
    step: 'target-selected',
    targetId: target.targetId,
    selector: target.selector,
  });

  const actionResult = await actByTarget(tabId, {
    targetId: target.targetId,
    stateHash: snapshot.stateHash,
    action: 'type',
    text: 'database lecture',
    clearFirst: true,
  });

  steps.push({
    step: 'type-by-target',
    ok: actionResult.ok,
    verification: actionResult.verification,
    memoryRecord: actionResult.memoryRecord,
  });

  const memory = await listMemory('youtube.com');
  const searchMemory = memory.find((item) => item.target_key === 'search_box');

  steps.push({
    step: 'list-memory',
    memoryCount: memory.length,
    hasSearchBox: Boolean(searchMemory),
    searchMemory,
  });

  const resolved = await resolveMemory(tabId, 'search_box');

  steps.push({
    step: 'resolve-memory',
    resolved,
  });

  const passed =
    Boolean(actionResult.ok) &&
    Boolean(actionResult.memoryRecord) &&
    Boolean(searchMemory) &&
    Boolean(resolved.found);

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
    `memoryRecord: ${Boolean(actionResult.memoryRecord)}`,
    `hasSearchBox: ${Boolean(searchMemory)}`,
    `resolvedFound: ${Boolean(resolved.found)}`,
    `result: ${resultPath}`,
  ].join('\n');

  fs.writeFileSync(summaryPath, summary, 'utf8');

  console.log('\nDONE');
  console.log(summary);

  if (!passed) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('\nFAILED');
  console.error(error.message);
  process.exit(1);
});
