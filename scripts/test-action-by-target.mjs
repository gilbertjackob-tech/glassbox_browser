// Usage:
//   node scripts/test-action-by-target.mjs
//
// Test:
// - open YouTube search results
// - fetch action-targets
// - find search input targetId
// - type "database lecture" by targetId
// - press Enter by targetId
// - verify URL/title/DOM changed

import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const outputDir = path.resolve('debug-action-by-target-output');

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

function findYouTubeSearchInput(targets) {
  return targets.find((target) =>
    target.kind === 'input' &&
    (
      /search/i.test(target.label || '') ||
      /search_query/.test(target.selector || '')
    )
  );
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const tabId = await getOrCreateTabId();
  const steps = [];

  steps.push({
    step: 'navigate',
    result: await navigate(tabId, 'https://www.youtube.com/results?search_query=lecture'),
  });

  await new Promise((resolve) => setTimeout(resolve, 3000));

  const snapshot = await getTargets(tabId);
  steps.push({
    step: 'action-targets',
    stateHash: snapshot.stateHash,
    targetCount: snapshot.targets?.length || 0,
  });

  const searchInput = findYouTubeSearchInput(snapshot.targets || []);
  if (!searchInput) {
    throw new Error('Could not find YouTube search input target');
  }

  steps.push({
    step: 'selected-target',
    target: {
      targetId: searchInput.targetId,
      kind: searchInput.kind,
      label: searchInput.label,
      selector: searchInput.selector,
      bbox: searchInput.bbox,
    },
  });

  const typeResult = await actByTarget(tabId, {
    targetId: searchInput.targetId,
    stateHash: snapshot.stateHash,
    action: 'type',
    text: 'database lecture',
    clearFirst: true,
  });

  steps.push({
    step: 'type-by-target',
    result: {
      ok: typeResult.ok,
      action: typeResult.action,
      targetId: typeResult.targetId,
      afterValue: typeResult.afterValue,
    },
  });

  const pressResult = await actByTarget(tabId, {
    targetId: searchInput.targetId,
    action: 'press',
    key: 'Enter',
  });

  steps.push({
    step: 'press-enter-by-target',
    result: {
      ok: pressResult.ok,
      action: pressResult.action,
      targetId: pressResult.targetId,
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 3000));

  const after = await getTargets(tabId);
  const passed =
    Boolean(typeResult.ok) &&
    Boolean(pressResult.ok) &&
    /database|lecture/i.test(after.url || '');

  const payload = {
    runAt: new Date().toISOString(),
    tabId,
    passed,
    beforeUrl: snapshot.url,
    afterUrl: after.url,
    beforeStateHash: snapshot.stateHash,
    afterStateHash: after.stateHash,
    steps,
  };

  fs.writeFileSync(path.join(outputDir, 'result.json'), JSON.stringify(payload, null, 2), 'utf8');

  const summary = [
    `passed: ${passed}`,
    `tabId: ${tabId}`,
    `beforeUrl: ${snapshot.url}`,
    `afterUrl: ${after.url}`,
    `beforeStateHash: ${snapshot.stateHash}`,
    `afterStateHash: ${after.stateHash}`,
    `result: ${path.join(outputDir, 'result.json')}`,
  ].join('\n');

  fs.writeFileSync(path.join(outputDir, 'summary.txt'), summary, 'utf8');

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
