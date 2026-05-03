import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const outputDir = path.resolve('debug-youtube-run-safe-suggestion-output');

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

async function installYoutubeSkills() {
  return requestJson(`${API_BASE}/api/site-packs/youtube.com/install-skills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

async function runSkill(tabId, body) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/skills/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function runSuggestion(tabId, body) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/site-room/run-suggestion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function getSuggestions(tabId) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/site-room/suggestions`);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const tabId = await getOrCreateTabId();

  await installYoutubeSkills();

  await navigate(tabId, 'https://www.youtube.com');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const openResult = await runSkill(tabId, {
    skill: 'youtube_search_and_open_first',
    inputs: {
      query: `database lecture ${Date.now()}`,
    },
    stopOnFailure: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 3000));

  const suggestions = await getSuggestions(tabId);

  const safeSuggestionExists = suggestions.suggestions?.some(
    (item) =>
      item.type === 'skill' &&
      item.name === 'youtube_pause_or_play_video' &&
      item.safe === true
  );

  const runSafe = await runSuggestion(tabId, {
    name: 'youtube_pause_or_play_video',
    inputs: {},
    stopOnFailure: true,
  });

  const blockedLike = await runSuggestion(tabId, {
    targetKey: 'like_button',
  });

  const passed =
    Boolean(openResult.ok) &&
    suggestions.room === 'youtube_watch_page' &&
    Boolean(safeSuggestionExists) &&
    Boolean(runSafe.ok) &&
    blockedLike.ok === false &&
    blockedLike.reason === 'SUGGESTION_NOT_SAFE_OR_NOT_EXECUTABLE';

  const payload = {
    runAt: new Date().toISOString(),
    tabId,
    passed,
    checks: {
      openOk: Boolean(openResult.ok),
      room: suggestions.room,
      safeSuggestionExists,
      runSafeOk: Boolean(runSafe.ok),
      blockedLikeOk: blockedLike.ok,
      blockedLikeReason: blockedLike.reason,
    },
    openResult,
    suggestions,
    runSafe,
    blockedLike,
  };

  const resultPath = path.join(outputDir, 'result.json');
  const summaryPath = path.join(outputDir, 'summary.txt');

  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8');

  const summary = [
    `passed: ${passed}`,
    `tabId: ${tabId}`,
    `openOk: ${Boolean(openResult.ok)}`,
    `room: ${suggestions.room}`,
    `safeSuggestionExists: ${safeSuggestionExists}`,
    `runSafeOk: ${Boolean(runSafe.ok)}`,
    `blockedLikeOk: ${blockedLike.ok}`,
    `blockedLikeReason: ${blockedLike.reason}`,
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
