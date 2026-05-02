import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const outputDir = path.resolve('debug-run-chain-failure-output');

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

async function runChain(tabId, body) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/action/run-chain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const tabId = await getOrCreateTabId();

  await navigate(tabId, 'https://www.youtube.com/results?search_query=lecture');
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const chainResult = await runChain(tabId, {
    stopOnFailure: true,
    steps: [
      {
        name: 'missing target should fail',
        targetKey: 'definitely_missing_target_xyz',
        kind: 'input',
        action: 'type',
        text: 'should not type',
        verify: {
          valueChanged: true,
        },
      },
      {
        name: 'must not run',
        targetKey: 'search_box',
        kind: 'input',
        action: 'type',
        text: 'this should not run',
      },
    ],
  });

  const passed =
    chainResult.ok === false &&
    chainResult.failedAt === 0 &&
    chainResult.completedCount === 0 &&
    Array.isArray(chainResult.results) &&
    chainResult.results.length === 1;

  const payload = {
    runAt: new Date().toISOString(),
    tabId,
    passed,
    chainResult,
  };

  const resultPath = path.join(outputDir, 'result.json');
  const summaryPath = path.join(outputDir, 'summary.txt');

  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8');

  const summary = [
    `passed: ${passed}`,
    `tabId: ${tabId}`,
    `chainOk: ${Boolean(chainResult.ok)}`,
    `failedAt: ${chainResult.failedAt}`,
    `completedCount: ${chainResult.completedCount}`,
    `resultCount: ${Array.isArray(chainResult.results) ? chainResult.results.length : 0}`,
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
