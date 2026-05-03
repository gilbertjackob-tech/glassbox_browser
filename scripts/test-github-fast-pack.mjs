import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const outputDir = path.resolve('debug-github-fast-pack-output');

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

async function installGitHubSkills() {
  return requestJson(`${API_BASE}/api/site-packs/github.com/install-skills`, {
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

  await navigate(tabId, 'https://github.com');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const homeRoom = await getSiteRoom(tabId);
  const homeSuggestions = await getSuggestions(tabId);
  const installResult = await installGitHubSkills();

  const homeRoomOk = homeRoom.room === 'github_home';
  const homeSearchSuggestionOk = homeSuggestions.suggestions?.some((item) => item.name === 'github_search');

  const searchSkill = await runSkill(tabId, {
    skill: 'github_search',
    inputs: {
      query: 'glassbox browser',
    },
    stopOnFailure: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 3000));

  const searchRoom = await getSiteRoom(tabId);
  const firstSearchResult = await resolveTarget(tabId, {
    targetKey: 'first_search_result',
    kind: 'link',
  });

  const beforeOpenSearch = await getState(tabId);
  const openFirstSearch = await runSkill(tabId, {
    skill: 'github_open_first_search_result',
    inputs: {},
    stopOnFailure: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 2500));
  const afterOpenSearch = await getState(tabId);

  const searchRoomOk = searchRoom.room === 'github_search_results';
  const firstSearchResultFound = Boolean(firstSearchResult.found);
  const openFirstSearchOk =
    Boolean(openFirstSearch.ok) &&
    String(afterOpenSearch.url || '') !== String(beforeOpenSearch.url || '') &&
    /github\.com/i.test(String(afterOpenSearch.url || ''));

  await navigate(tabId, 'https://github.com/gilbertjackob-tech/glassbox_browser');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const repoRoom = await getSiteRoom(tabId);
  const repoSuggestions = await getSuggestions(tabId);

  const repoRoomOk = repoRoom.room === 'github_repo';
  const repoSuggestsIssues = repoSuggestions.suggestions?.some((item) => item.name === 'github_open_issues');
  const repoSuggestsPulls = repoSuggestions.suggestions?.some((item) => item.name === 'github_open_pulls');

  const openIssues = await runSkill(tabId, {
    skill: 'github_open_issues',
    inputs: {},
    stopOnFailure: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 2500));

  const issuesRoom = await getSiteRoom(tabId);
  const issuesState = await getState(tabId);
  const openIssuesOk =
    Boolean(openIssues.ok) &&
    (issuesRoom.room === 'github_issues' || String(issuesState.url || '').includes('/issues'));

  const passed =
    homeRoomOk &&
    Boolean(homeSearchSuggestionOk) &&
    Boolean(installResult.ok) &&
    Boolean(searchSkill.ok) &&
    searchRoomOk &&
    firstSearchResultFound &&
    openFirstSearchOk &&
    repoRoomOk &&
    Boolean(repoSuggestsIssues || repoSuggestsPulls) &&
    openIssuesOk;

  const payload = {
    runAt: new Date().toISOString(),
    tabId,
    passed,
    checks: {
      homeRoomOk,
      homeSearchSuggestionOk: Boolean(homeSearchSuggestionOk),
      installOk: Boolean(installResult.ok),
      searchSkillOk: Boolean(searchSkill.ok),
      searchRoomOk,
      firstSearchResultFound,
      openFirstSearchOk,
      repoRoomOk,
      repoSuggestsIssues: Boolean(repoSuggestsIssues),
      repoSuggestsPulls: Boolean(repoSuggestsPulls),
      openIssuesOk,
    },
    homeRoom,
    homeSuggestions,
    installResult: {
      ok: installResult.ok,
      installedCount: installResult.installedCount,
    },
    searchSkill,
    searchRoom,
    firstSearchResult,
    beforeOpenSearchUrl: beforeOpenSearch.url,
    openFirstSearch,
    afterOpenSearchUrl: afterOpenSearch.url,
    repoRoom,
    repoSuggestions,
    openIssues,
    issuesRoom,
    issuesUrl: issuesState.url,
  };

  const resultPath = path.join(outputDir, 'result.json');
  const summaryPath = path.join(outputDir, 'summary.txt');

  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8');

  const summary = [
    `passed: ${passed}`,
    `tabId: ${tabId}`,
    `homeRoomOk: ${homeRoomOk}`,
    `homeSearchSuggestionOk: ${Boolean(homeSearchSuggestionOk)}`,
    `installOk: ${Boolean(installResult.ok)}`,
    `searchSkillOk: ${Boolean(searchSkill.ok)}`,
    `searchRoomOk: ${searchRoomOk}`,
    `firstSearchResultFound: ${firstSearchResultFound}`,
    `openFirstSearchOk: ${openFirstSearchOk}`,
    `repoRoomOk: ${repoRoomOk}`,
    `repoSuggestsIssues: ${Boolean(repoSuggestsIssues)}`,
    `repoSuggestsPulls: ${Boolean(repoSuggestsPulls)}`,
    `openIssuesOk: ${openIssuesOk}`,
    `issuesUrl: ${issuesState.url || ''}`,
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
