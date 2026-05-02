import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const outputDir = path.resolve('debug-save-micro-skill-output');

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

  const saveResult = await requestJson(`${API_BASE}/api/skills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'youtube_search',
      queryPattern: 'search youtube',
      steps: [
        {
          name: 'type search query',
          targetKey: 'search_box',
          kind: 'input',
          action: 'type',
          text: '{{query}}',
          clearFirst: true,
          verify: {
            valueChanged: true
          }
        },
        {
          name: 'submit search',
          targetKey: 'search_box',
          kind: 'input',
          action: 'press',
          key: 'Enter',
          verify: {
            urlChanged: true
          }
        }
      ]
    }),
  });

  const skills = await requestJson(`${API_BASE}/api/skills`);
  const found = Array.isArray(skills) && skills.some((skill) => skill.name === 'youtube_search');

  const passed = Boolean(saveResult.ok) && Boolean(saveResult.skill) && found;

  const payload = {
    runAt: new Date().toISOString(),
    passed,
    saveResult,
    found,
  };

  const resultPath = path.join(outputDir, 'result.json');
  const summaryPath = path.join(outputDir, 'summary.txt');

  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8');

  const summary = [
    `passed: ${passed}`,
    `saved: ${Boolean(saveResult.skill)}`,
    `found: ${found}`,
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
