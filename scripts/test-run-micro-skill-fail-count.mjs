import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const outputDir = path.resolve('debug-run-micro-skill-fail-count-output');

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

async function saveBadSkill() {
  return requestJson(`${API_BASE}/api/skills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'bad_missing_target_skill',
      queryPattern: 'bad missing target skill',
      steps: [
        {
          name: 'missing target should fail',
          targetKey: 'definitely_missing_target_xyz',
          kind: 'input',
          action: 'type',
          text: '{{query}}',
          verify: {
            valueChanged: true
          }
        }
      ]
    }),
  });
}

async function runSkill(tabId) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/skills/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      skill: 'bad_missing_target_skill',
      inputs: {
        query: 'should fail'
      },
      stopOnFailure: true,
    }),
  });
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const tabId = await getOrCreateTabId();

  const saveResult = await saveBadSkill();
  const runResult = await runSkill(tabId);

  const passed =
    Boolean(saveResult.ok) &&
    runResult.ok === false &&
    runResult.chainResult?.ok === false &&
    Number(runResult.updatedSkill?.failure_count || 0) >= 1;

  const payload = {
    runAt: new Date().toISOString(),
    tabId,
    passed,
    saveResult,
    runResult,
  };

  const resultPath = path.join(outputDir, 'result.json');
  const summaryPath = path.join(outputDir, 'summary.txt');

  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8');

  const summary = [
    `passed: ${passed}`,
    `tabId: ${tabId}`,
    `skillSaved: ${Boolean(saveResult.ok)}`,
    `runOk: ${Boolean(runResult.ok)}`,
    `chainOk: ${Boolean(runResult.chainResult?.ok)}`,
    `failureCount: ${runResult.updatedSkill?.failure_count}`,
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
