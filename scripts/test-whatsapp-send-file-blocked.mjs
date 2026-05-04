import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const outputDir = path.resolve('debug-whatsapp-send-file-blocked-output');

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

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const tabId = await getOrCreateTabId();

  const filePath = path.join(outputDir, 'whatsapp-test.txt');
  fs.writeFileSync(filePath, `Blocked WhatsApp file test ${Date.now()}\n`, 'utf8');

  const result = await requestJson(`${API_BASE}/api/whatsapp/send-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tabId,
      chat: 'Bihi',
      filePath,
      caption: 'Should not send',
      allowExternalSend: false,
    }),
  });

  const passed = result.ok === false && result.reason === 'BLOCKED_EXTERNAL_SEND' && result.sent === false;
  const payload = {
    runAt: new Date().toISOString(),
    passed,
    tabId,
    filePath,
    result,
  };

  const resultPath = path.join(outputDir, 'result.json');
  const summaryPath = path.join(outputDir, 'summary.txt');
  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8');
  const summary = [
    `passed: ${passed}`,
    `tabId: ${tabId}`,
    `blocked: ${result.ok === false}`,
    `reason: ${result.reason || ''}`,
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
