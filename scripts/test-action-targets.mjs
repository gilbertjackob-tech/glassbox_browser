// Usage:
//   node scripts/test-action-targets.mjs
//   node scripts/test-action-targets.mjs <tabId>
//
// Output:
//   debug-action-targets-output/targets.json
//   debug-action-targets-output/summary.txt

import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const outputDir = path.resolve('debug-action-targets-output');

const CHECK_SITES = [
  { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=lecture' },
  { name: 'Google', url: 'https://www.google.com/search?q=lecture' },
  { name: 'GitHub', url: 'https://github.com/search?q=lecture&type=repositories' },
];

async function requestJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} from ${url}\n${text}`);
  }
  return res.json();
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

async function navigateTab(tabId, url) {
  await requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/action/navigate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

async function fetchTargets(tabId) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/action-targets`);
}

function findTarget(data, matchers) {
  const targets = Array.isArray(data?.targets) ? data.targets : [];
  return targets.find((target) => matchers.some((matcher) => matcher(target)));
}

function verifySite(name, data) {
  if (name === 'YouTube') {
    const searchInput = findTarget(data, [
      (t) => t.kind === 'input' && /search/i.test(t.label || ''),
      (t) => /search_query/.test(t.selector || ''),
    ]);
    const searchButton = findTarget(data, [
      (t) => t.kind === 'button' && /search/i.test(t.label || ''),
      (t) => /search/.test(t.selector || '') && t.kind === 'button',
    ]);
    return { searchInput: Boolean(searchInput), searchButton: Boolean(searchButton) };
  }

  if (name === 'Google') {
    const searchBox = findTarget(data, [
      (t) => t.kind === 'input' && (/search/i.test(t.label || '') || /name="q"/.test(t.selector || '')),
    ]);
    return { searchBox: Boolean(searchBox) };
  }

  if (name === 'GitHub') {
    const searchInput = findTarget(data, [
      (t) => t.kind === 'input' && /search/i.test(t.label || ''),
      (t) => /query-builder-test|name="q"/.test(t.selector || ''),
    ]);
    const searchControl = findTarget(data, [
      (t) => /search or jump|search/i.test((t.label || '').toLowerCase()),
      (t) => /search/.test((t.selector || '').toLowerCase()),
    ]);
    return { searchInputOrControl: Boolean(searchInput || searchControl) };
  }

  return {};
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const tabId = process.argv[2] || await getOrCreateTabId();
  const runAt = new Date().toISOString();
  const results = [];

  for (const site of CHECK_SITES) {
    await navigateTab(tabId, site.url);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const targets = await fetchTargets(tabId);
    const checks = verifySite(site.name, targets);
    const passed = Object.values(checks).every(Boolean);
    results.push({
      site: site.name,
      url: site.url,
      title: targets.title,
      stateHash: targets.stateHash,
      targetCount: Array.isArray(targets.targets) ? targets.targets.length : 0,
      checks,
      passed,
      targets: targets.targets || [],
    });
  }

  const payload = {
    runAt,
    tabId,
    sites: results,
  };

  const jsonPath = path.join(outputDir, 'targets.json');
  const summaryPath = path.join(outputDir, 'summary.txt');

  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

  const summaryLines = [
    `runAt: ${runAt}`,
    `tabId: ${tabId}`,
    '',
    ...results.flatMap((site) => [
      `[${site.site}]`,
      `url: ${site.url}`,
      `title: ${site.title || ''}`,
      `targetCount: ${site.targetCount}`,
      `checks: ${JSON.stringify(site.checks)}`,
      `passed: ${site.passed}`,
      '',
    ]),
    `targets.json: ${jsonPath}`,
  ];

  fs.writeFileSync(summaryPath, summaryLines.join('\n'), 'utf8');

  console.log('\nDONE');
  console.log(summaryLines.join('\n'));
}

main().catch((error) => {
  console.error('\nFAILED');
  console.error(error.message);
  process.exit(1);
});
