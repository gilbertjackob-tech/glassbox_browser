import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const outputDir = path.resolve('debug-google-fast-pack-output');

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

async function getSuggestions(tabId) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/site-room/suggestions`);
}

async function installGoogleSkills() {
  return requestJson(`${API_BASE}/api/site-packs/google.com/install-skills`, {
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

async function resolveTarget(tabId, body) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/resolve-target`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function getState(tabId) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/state`);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const tabId = await getOrCreateTabId();

  await navigate(tabId, 'https://www.google.com');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const homeRoom = await getSiteRoom(tabId);
  const homeSuggestions = await getSuggestions(tabId);
  const installResult = await installGoogleSkills();

  const searchSkill = await runSkill(tabId, {
    skill: 'google_search',
    inputs: {
      query: 'database management system',
    },
    stopOnFailure: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 2500));

  const resultsRoom = await getSiteRoom(tabId);
  const firstResult = await resolveTarget(tabId, {
    targetKey: 'first_result',
    kind: 'link',
  });

  const beforeState = await getState(tabId);
  const openFirst = await runSkill(tabId, {
    skill: 'google_open_first_result',
    inputs: {},
    stopOnFailure: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 2500));

  const afterState = await getState(tabId);

  const homeRoomOk = homeRoom.room === 'google_home';
  const searchSuggestionOk = homeSuggestions.suggestions?.some((item) => item.name === 'google_search');
  const searchSkillOk = Boolean(searchSkill.ok);
  const resultsRoomOk = resultsRoom.room === 'google_search_results';
  const firstResultFound = Boolean(firstResult.found);
  const openFirstOk =
    Boolean(openFirst.ok) &&
    String(afterState.url || '') !== String(beforeState.url || '') &&
    !/google\./i.test(new URL(String(afterState.url || 'https://www.google.com')).hostname.replace(/^www\./, ''));

  const passed =
    homeRoomOk &&
    Boolean(searchSuggestionOk) &&
    searchSkillOk &&
    resultsRoomOk &&
    firstResultFound &&
    openFirstOk;

  const payload = {
    runAt: new Date().toISOString(),
    tabId,
    passed,
    checks: {
      homeRoomOk,
      searchSuggestionOk: Boolean(searchSuggestionOk),
      searchSkillOk,
      resultsRoomOk,
      firstResultFound,
      openFirstOk,
    },
    homeRoom,
    homeSuggestions,
    installResult: {
      ok: installResult.ok,
      installedCount: installResult.installedCount,
    },
    searchSkill,
    resultsRoom,
    firstResult,
    beforeUrl: beforeState.url,
    openFirst,
    afterUrl: afterState.url,
  };

  const resultPath = path.join(outputDir, 'result.json');
  const summaryPath = path.join(outputDir, 'summary.txt');

  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8');

  const summary = [
    `passed: ${passed}`,
    `tabId: ${tabId}`,
    `homeRoomOk: ${homeRoomOk}`,
    `searchSuggestionOk: ${Boolean(searchSuggestionOk)}`,
    `searchSkillOk: ${searchSkillOk}`,
    `resultsRoomOk: ${resultsRoomOk}`,
    `firstResultFound: ${firstResultFound}`,
    `openFirstOk: ${openFirstOk}`,
    `beforeUrl: ${beforeState.url || ''}`,
    `afterUrl: ${afterState.url || ''}`,
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
