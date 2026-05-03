import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const outputDir = path.resolve('debug-youtube-skill-replay-output');

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
  const profileId = `y3_replay_${Date.now()}`;
  const created = await requestJson(`${API_BASE}/api/tabs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId }),
  });
  return {
    tabId: created.tabId || created.id,
    profileId,
  };
}

async function navigate(tabId, url) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/action/navigate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

async function installYoutubeSkills(profileId) {
  return requestJson(`${API_BASE}/api/site-packs/youtube.com/install-skills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId }),
  });
}

async function runSkill(tabId, body, profileId) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/skills/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...body,
      profileId,
    }),
  });
}

async function getState(tabId) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/state`);
}

async function resolveTarget(tabId, body) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/resolve-target`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function evaluate(tabId, script) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/action/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script }),
  });
}

async function recoverFirstResultVisibility(tabId) {
  const firstResult = await resolveTarget(tabId, {
    targetKey: 'first_video_result',
    kind: 'link',
  });
  const selector = firstResult?.target?.selector;
  if (!selector) {
    return false;
  }

  await evaluate(tabId, `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      return true;
    })();
  `);
  await new Promise((resolve) => setTimeout(resolve, 700));
  return true;
}

function failedAtFirstResultStep(runResult) {
  const chain = runResult?.chainResult;
  if (!chain || chain.ok !== false || chain.failedAt !== 2) {
    return false;
  }
  const failedStep = Array.isArray(chain.results) ? chain.results[chain.failedAt] : null;
  return failedStep?.targetKey === 'first_video_result';
}

async function openFirstVideoRecovery(tabId) {
  const tryResolveAct = async () => resolveTarget(tabId, { targetKey: 'first_video_result', kind: 'link' });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const resolved = await tryResolveAct();
    if (resolved?.found) {
      const clicked = await requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/action/resolve-and-act`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetKey: 'first_video_result',
          kind: 'link',
          action: 'click',
        }),
      });
      if (clicked?.ok) {
        return { ok: true, resolved, clicked, attempt };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await evaluate(tabId, 'window.scrollTo(0, Math.min(document.body.scrollHeight, window.scrollY + 600)); true;');
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  return { ok: false };
}

async function manualSearchAndOpenFirst(tabId, query) {
  const typeResult = await requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/action/resolve-and-act`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetKey: 'search_box',
      kind: 'input',
      action: 'type',
      text: query,
      clearFirst: true,
    }),
  });

  const pressResult = await requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/action/resolve-and-act`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetKey: 'search_box',
      kind: 'input',
      action: 'press',
      key: 'Enter',
    }),
  });

  const queryUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  if (!pressResult?.verification?.urlChanged) {
    await navigate(tabId, queryUrl);
  }
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const openResult = await openFirstVideoRecovery(tabId);

  return {
    ok: Boolean(typeResult?.ok) && Boolean(pressResult?.ok) && Boolean(openResult?.ok),
    typeResult,
    pressResult,
    openResult,
  };
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const { tabId, profileId } = await getOrCreateTabId();
  const query = `database lecture ${Date.now()}`;

  await navigate(tabId, 'https://www.youtube.com');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const installResult = await installYoutubeSkills(profileId);

  let runResult = await runSkill(tabId, {
    skill: 'youtube_search_and_open_first',
    inputs: {
      query,
    },
    stopOnFailure: true,
  }, profileId);

  if (!runResult?.ok && runResult?.chainResult?.reason === 'ELEMENT_NOT_VISIBLE') {
    const recovered = await recoverFirstResultVisibility(tabId);
    if (recovered) {
      runResult = await runSkill(tabId, {
        skill: 'youtube_search_and_open_first',
        inputs: {
          query,
        },
        stopOnFailure: true,
      }, profileId);
    }
  }

  let recoveryResult = null;
  if (!runResult?.ok && failedAtFirstResultStep(runResult)) {
    recoveryResult = await openFirstVideoRecovery(tabId);
  }
  let manualRecoveryResult = null;
  if (!runResult?.ok && !recoveryResult?.ok) {
    manualRecoveryResult = await manualSearchAndOpenFirst(tabId, query);
  }

  await new Promise((resolve) => setTimeout(resolve, 1500));

  const state = await getState(tabId);
  const videoPlayer = await resolveTarget(tabId, {
    targetKey: 'video_player',
  });

  const finalUrl = String(state.url || '');
  const openedWatchPage = finalUrl.includes('/watch');

  const passed =
    Boolean(installResult.ok) &&
    ((Boolean(runResult.ok) && Boolean(runResult.chainResult?.ok)) ||
      Boolean(recoveryResult?.ok) ||
      Boolean(manualRecoveryResult?.ok)) &&
    openedWatchPage &&
    Boolean(videoPlayer.found);

  const payload = {
    runAt: new Date().toISOString(),
    tabId,
    profileId,
    query,
    passed,
    installResult: {
      ok: installResult.ok,
      installedCount: installResult.installedCount,
    },
    runResult,
    recoveryResult,
    manualRecoveryResult,
    finalUrl,
    openedWatchPage,
    videoPlayerFound: Boolean(videoPlayer.found),
    videoPlayerSource: videoPlayer.source || '',
  };

  const resultPath = path.join(outputDir, 'result.json');
  const summaryPath = path.join(outputDir, 'summary.txt');

  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8');

  const summary = [
    `passed: ${passed}`,
    `tabId: ${tabId}`,
    `installOk: ${Boolean(installResult.ok)}`,
    `runOk: ${Boolean(runResult.ok)}`,
    `chainOk: ${Boolean(runResult.chainResult?.ok)}`,
    `openedWatchPage: ${openedWatchPage}`,
    `videoPlayerFound: ${Boolean(videoPlayer.found)}`,
    `videoPlayerSource: ${videoPlayer.source || ''}`,
    `finalUrl: ${finalUrl}`,
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
