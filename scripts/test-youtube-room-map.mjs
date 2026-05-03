import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const outputDir = path.resolve('debug-youtube-room-map-output');

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

async function getSiteRoom(tabId) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/site-room`);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const tabId = await getOrCreateTabId();
  const results = [];

  await navigate(tabId, 'https://www.youtube.com');
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const homeRoom = await getSiteRoom(tabId);
  results.push({ name: 'home', result: homeRoom });

  await navigate(tabId, 'https://www.youtube.com/results?search_query=database+lecture');
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const resultsRoom = await getSiteRoom(tabId);
  results.push({ name: 'search_results', result: resultsRoom });

  const openFirst = await requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/action/resolve-and-act`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetKey: 'first_video_result',
      kind: 'link',
      action: 'click',
    }),
  }).catch((error) => ({ ok: false, error: error.message }));

  await new Promise((resolve) => setTimeout(resolve, 4000));

  let watchRoom = await getSiteRoom(tabId);

  if (watchRoom.room !== 'youtube_watch_page') {
    const href = await requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/action/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        script: `
          (() => {
            const el = document.querySelector('a[href*="/watch"]');
            if (!el) return null;
            return new URL(el.href || el.getAttribute('href'), location.href).toString();
          })();
        `,
      }),
    });

    if (href?.result) {
      await navigate(tabId, href.result);
      await new Promise((resolve) => setTimeout(resolve, 4000));
      watchRoom = await getSiteRoom(tabId);
    }
  }

  results.push({ name: 'watch_page', openFirst, result: watchRoom });

  const homeOk = homeRoom.room === 'youtube_home';
  const searchOk = resultsRoom.room === 'youtube_search_results';
  const watchOk = watchRoom.room === 'youtube_watch_page';

  const requiredLandmarksOk =
    resultsRoom.landmarks?.some((item) => item.targetKey === 'search_box') &&
    resultsRoom.landmarks?.some((item) => item.targetKey === 'first_video_result') &&
    watchRoom.landmarks?.some((item) => item.targetKey === 'video_player');

  const passed = homeOk && searchOk && watchOk && Boolean(requiredLandmarksOk);

  const payload = {
    runAt: new Date().toISOString(),
    tabId,
    passed,
    checks: {
      homeOk,
      searchOk,
      watchOk,
      requiredLandmarksOk: Boolean(requiredLandmarksOk),
    },
    results,
  };

  const resultPath = path.join(outputDir, 'result.json');
  const summaryPath = path.join(outputDir, 'summary.txt');

  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8');

  const summary = [
    `passed: ${passed}`,
    `tabId: ${tabId}`,
    `homeRoom: ${homeRoom.room}`,
    `searchRoom: ${resultsRoom.room}`,
    `watchRoom: ${watchRoom.room}`,
    `homeOk: ${homeOk}`,
    `searchOk: ${searchOk}`,
    `watchOk: ${watchOk}`,
    `requiredLandmarksOk: ${Boolean(requiredLandmarksOk)}`,
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
