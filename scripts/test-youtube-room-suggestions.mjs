import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const outputDir = path.resolve('debug-youtube-room-suggestions-output');

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

async function getSuggestions(tabId) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/site-room/suggestions`);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const tabId = await getOrCreateTabId();

  await navigate(tabId, 'https://www.youtube.com');
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const home = await getSuggestions(tabId);

  await navigate(tabId, 'https://www.youtube.com/results?search_query=database+lecture');
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const search = await getSuggestions(tabId);

  const homeHasSearch =
    home.suggestions?.some((item) => item.name === 'youtube_search');

  const searchHasOpenFirst =
    search.suggestions?.some((item) => item.name === 'youtube_open_first_result');

  const passed =
    Boolean(home.ok) &&
    Boolean(search.ok) &&
    home.room === 'youtube_home' &&
    search.room === 'youtube_search_results' &&
    homeHasSearch &&
    searchHasOpenFirst;

  const payload = {
    runAt: new Date().toISOString(),
    tabId,
    passed,
    checks: {
      homeRoom: home.room,
      searchRoom: search.room,
      homeHasSearch,
      searchHasOpenFirst,
    },
    home,
    search,
  };

  const resultPath = path.join(outputDir, 'result.json');
  const summaryPath = path.join(outputDir, 'summary.txt');

  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8');

  const summary = [
    `passed: ${passed}`,
    `tabId: ${tabId}`,
    `homeRoom: ${home.room}`,
    `searchRoom: ${search.room}`,
    `homeHasSearch: ${homeHasSearch}`,
    `searchHasOpenFirst: ${searchHasOpenFirst}`,
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
