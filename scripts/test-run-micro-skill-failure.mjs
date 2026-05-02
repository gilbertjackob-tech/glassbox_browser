import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const outputDir = path.resolve('debug-run-micro-skill-failure-output');

async function requestJson(url, options, allowError = false) {
  const res = await fetch(url, options);
  const text = await res.text();

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok && !allowError) {
    throw new Error(`HTTP ${res.status} from ${url}\n${JSON.stringify(data, null, 2)}`);
  }

  return {
    status: res.status,
    ok: res.ok,
    data,
  };
}

async function getOrCreateTabId() {
  const tabsRes = await requestJson(`${API_BASE}/api/tabs`);
  const tabs = tabsRes.data;

  if (Array.isArray(tabs) && tabs.length > 0) {
    return tabs[0].tabId || tabs[0].id;
  }

  const created = await requestJson(`${API_BASE}/api/tabs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  return created.data.tabId || created.data.id;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const tabId = await getOrCreateTabId();

  const missingResult = await requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/skills/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      skill: 'definitely_missing_skill_xyz',
      inputs: {
        query: 'should not run'
      }
    }),
  }, true);

  const passed =
    missingResult.ok === false &&
    missingResult.status >= 400 &&
    /SKILL_NOT_FOUND/.test(JSON.stringify(missingResult.data));

  const payload = {
    runAt: new Date().toISOString(),
    tabId,
    passed,
    missingResult,
  };

  const resultPath = path.join(outputDir, 'result.json');
  const summaryPath = path.join(outputDir, 'summary.txt');

  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8');

  const summary = [
    `passed: ${passed}`,
    `tabId: ${tabId}`,
    `status: ${missingResult.status}`,
    `error: ${missingResult.data?.error || ''}`,
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
