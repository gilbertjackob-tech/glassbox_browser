import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const outputDir = path.resolve('debug-action-verification-output');

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

async function getState(tabId) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/state`);
}

async function actByTarget(tabId, body) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/action/by-target`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function findYouTubeSearchInput(targets) {
  return (targets || []).find((target) =>
    target.kind === 'input' && (
      /search/i.test(target.label || '') ||
      /search_query/.test(target.selector || '')
    )
  );
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const tabId = await getOrCreateTabId();
  const steps = [];

  await navigate(tabId, 'https://www.youtube.com/results?search_query=lecture');
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const beforeState = await getState(tabId);
  const snapshot = await getTargets(tabId);
  const inputTarget = findYouTubeSearchInput(snapshot.targets);
  if (!inputTarget) {
    throw new Error('Could not find YouTube search input target');
  }

  steps.push({
    step: 'target-selected',
    targetId: inputTarget.targetId,
    selector: inputTarget.selector,
  });

  const typeResult = await actByTarget(tabId, {
    targetId: inputTarget.targetId,
    stateHash: snapshot.stateHash,
    action: 'type',
    text: 'database lecture',
    clearFirst: true,
  });

  steps.push({
    step: 'type',
    ok: typeResult.ok,
    verification: typeResult.verification || null,
  });

  const pressResult = await actByTarget(tabId, {
    targetId: inputTarget.targetId,
    action: 'press',
    key: 'Enter',
  });

  steps.push({
    step: 'press-enter',
    ok: pressResult.ok,
    verification: pressResult.verification || null,
  });

  await new Promise((resolve) => setTimeout(resolve, 2500));
  const afterState = await getState(tabId);

  const passed =
    Boolean(typeResult.ok) &&
    Boolean(typeResult.verification?.valueChanged) &&
    Boolean(pressResult.ok) &&
    Boolean(pressResult.verification?.urlChanged) &&
    /database\+lecture/i.test(afterState.url || '');

  const payload = {
    runAt: new Date().toISOString(),
    tabId,
    passed,
    beforeState,
    afterState,
    snapshotStateHash: snapshot.stateHash,
    steps,
  };

  const resultPath = path.join(outputDir, 'result.json');
  const summaryPath = path.join(outputDir, 'summary.txt');
  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8');

  const summary = [
    `passed: ${passed}`,
    `tabId: ${tabId}`,
    `beforeUrl: ${beforeState.url}`,
    `afterUrl: ${afterState.url}`,
    `type.valueChanged: ${String(typeResult.verification?.valueChanged)}`,
    `press.urlChanged: ${String(pressResult.verification?.urlChanged)}`,
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
