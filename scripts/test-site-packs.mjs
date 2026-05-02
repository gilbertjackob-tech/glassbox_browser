import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const outputDir = path.resolve('debug-site-packs-output');

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

  const packs = await requestJson(`${API_BASE}/api/site-packs`);
  const youtube = await requestJson(`${API_BASE}/api/site-packs/youtube.com`);

  const passed =
    Array.isArray(packs) &&
    packs.some((pack) => pack.host === 'youtube.com') &&
    packs.some((pack) => pack.host === 'google.com') &&
    youtube.targets?.some((target) => target.targetKey === 'search_box');

  const payload = {
    runAt: new Date().toISOString(),
    passed,
    packCount: Array.isArray(packs) ? packs.length : 0,
    packs,
    youtube,
  };

  const resultPath = path.join(outputDir, 'result.json');
  const summaryPath = path.join(outputDir, 'summary.txt');

  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8');

  const summary = [
    `passed: ${passed}`,
    `packCount: ${payload.packCount}`,
    `hasYoutube: ${packs.some((pack) => pack.host === 'youtube.com')}`,
    `hasGoogle: ${packs.some((pack) => pack.host === 'google.com')}`,
    `youtubeSearchBox: ${youtube.targets?.some((target) => target.targetKey === 'search_box')}`,
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
