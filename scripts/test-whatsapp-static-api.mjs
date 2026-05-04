import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const outputDir = path.resolve('debug-whatsapp-static-api-output');
const expectedChats = [
  'Hasnat (You)',
  'Bihi',
  'আমাদের পরিবার',
  'Tasfia New',
  'Ammu',
  'Abbu 2',
];

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

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const result = await requestJson(`${API_BASE}/api/whatsapp/static-chats`);
  const actualNames = Array.isArray(result.chats) ? result.chats.map((item) => item.name) : [];
  const passed = expectedChats.every((name) => actualNames.includes(name));

  const payload = {
    runAt: new Date().toISOString(),
    passed,
    expectedChats,
    actualNames,
    result,
  };

  const resultPath = path.join(outputDir, 'result.json');
  const summaryPath = path.join(outputDir, 'summary.txt');
  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8');
  const summary = [
    `passed: ${passed}`,
    `chatCount: ${actualNames.length}`,
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
