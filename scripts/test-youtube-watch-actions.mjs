import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const outputDir = path.resolve('debug-youtube-watch-actions-output');
const SAFE_MODE = true;
const ALLOW_ACCOUNT_ACTIONS = String(process.env.ALLOW_ACCOUNT_ACTIONS || '').toLowerCase() === 'true';

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

async function resolveTarget(tabId, body) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/resolve-target`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function resolveAndAct(tabId, body) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/action/resolve-and-act`, {
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

async function getState(tabId) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/state`);
}

async function waitForWatchUrl(tabId, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await getState(tabId);
    if (String(state.url || '').includes('/watch')) {
      return { ok: true, state };
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return { ok: false };
}

async function clickFirstVideoWithRetry(tabId) {
  let firstVideo = await resolveAndAct(tabId, {
    targetKey: 'first_video_result',
    kind: 'link',
    action: 'click',
  });

  if (!firstVideo?.ok && firstVideo?.reason === 'ELEMENT_NOT_VISIBLE' && firstVideo?.resolve?.target?.selector) {
    const selector = firstVideo.resolve.target.selector;
    await evaluate(tabId, `
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el) {
          el.scrollIntoView({ block: 'center', inline: 'nearest' });
          return true;
        }
        return false;
      })();
    `);
    await new Promise((resolve) => setTimeout(resolve, 600));
    firstVideo = await resolveAndAct(tabId, {
      targetKey: 'first_video_result',
      kind: 'link',
      action: 'click',
    });
  }

  return firstVideo;
}

function playerStateChanged(before, after) {
  return (
    before?.paused !== after?.paused ||
    before?.buttonTitle !== after?.buttonTitle ||
    before?.ariaLabel !== after?.ariaLabel ||
    (typeof before?.currentTime === 'number' &&
      typeof after?.currentTime === 'number' &&
      Math.abs(after.currentTime - before.currentTime) > 0.05)
  );
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const tabId = await getOrCreateTabId();
  const steps = [];

  await navigate(tabId, 'https://www.youtube.com/results?search_query=database+lecture');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const firstVideo = await clickFirstVideoWithRetry(tabId);
  steps.push({ step: 'open_first_video', firstVideo });

  const watchWait = await waitForWatchUrl(tabId, 12000);
  const openedVideo = Boolean(firstVideo?.ok) && watchWait.ok;

  const playPauseResolved = await resolveTarget(tabId, {
    targetKey: 'play_pause_button',
    kind: 'button',
  });

  const beforeStateRes = await evaluate(tabId, `
    (() => {
      const video = document.querySelector('video');
      const button = document.querySelector('.ytp-play-button, button.ytp-play-button');
      return {
        paused: video ? video.paused : null,
        currentTime: video ? video.currentTime : null,
        buttonTitle: button?.getAttribute('title') || '',
        ariaLabel: button?.getAttribute('aria-label') || ''
      };
    })();
  `);

  const playPauseClick = await resolveAndAct(tabId, {
    targetKey: 'play_pause_button',
    kind: 'button',
    action: 'click',
  });

  await new Promise((resolve) => setTimeout(resolve, 900));

  const afterStateRes = await evaluate(tabId, `
    (() => {
      const video = document.querySelector('video');
      const button = document.querySelector('.ytp-play-button, button.ytp-play-button');
      return {
        paused: video ? video.paused : null,
        currentTime: video ? video.currentTime : null,
        buttonTitle: button?.getAttribute('title') || '',
        ariaLabel: button?.getAttribute('aria-label') || ''
      };
    })();
  `);

  const beforePlayerState = beforeStateRes?.result || {};
  const afterPlayerState = afterStateRes?.result || {};
  const playPauseClicked = Boolean(playPauseClick?.ok);
  const playerStateChangedOk = playerStateChanged(beforePlayerState, afterPlayerState);

  const commentResolve = await resolveTarget(tabId, {
    targetKey: 'comment_box',
    kind: 'input',
  });
  const commentFocus = commentResolve?.found
    ? await resolveAndAct(tabId, {
        targetKey: 'comment_box',
        kind: 'input',
        action: 'focus',
      })
    : { ok: false, reason: 'COMMENT_BOX_NOT_FOUND' };

  const commentBoxFound = Boolean(commentResolve?.found);
  const commentBoxFocused = Boolean(commentFocus?.ok && commentFocus?.verification?.focusConfirmed);

  const likeResolve = await resolveTarget(tabId, {
    targetKey: 'like_button',
    kind: 'button',
  });
  const subscribeResolve = await resolveTarget(tabId, {
    targetKey: 'subscribe_button',
    kind: 'button',
  });

  const likeButtonResolved = Boolean(likeResolve?.found);
  const subscribeButtonResolved = Boolean(subscribeResolve?.found);

  const likeButtonClicked = !SAFE_MODE && ALLOW_ACCOUNT_ACTIONS
    ? Boolean((await resolveAndAct(tabId, { targetKey: 'like_button', kind: 'button', action: 'click' }))?.ok)
    : false;
  const subscribeButtonClicked = !SAFE_MODE && ALLOW_ACCOUNT_ACTIONS
    ? Boolean((await resolveAndAct(tabId, { targetKey: 'subscribe_button', kind: 'button', action: 'click' }))?.ok)
    : false;

  const passed =
    openedVideo &&
    Boolean(playPauseResolved?.found) &&
    playPauseClicked &&
    playerStateChangedOk;

  const payload = {
    runAt: new Date().toISOString(),
    tabId,
    passed,
    safeMode: SAFE_MODE,
    allowAccountActions: ALLOW_ACCOUNT_ACTIONS,
    openedVideo,
    playPauseResolved: Boolean(playPauseResolved?.found),
    playPauseClicked,
    playerStateChanged: playerStateChangedOk,
    beforePlayerState,
    afterPlayerState,
    commentBoxFound,
    commentBoxFocused,
    likeButtonResolved,
    likeButtonClicked,
    subscribeButtonResolved,
    subscribeButtonClicked,
    accountActionReason: 'ACCOUNT_CHANGING_ACTION_BLOCKED_BY_DEFAULT',
    steps: {
      firstVideo,
      playPauseResolved,
      playPauseClick,
      commentResolve,
      commentFocus,
      likeResolve,
      subscribeResolve,
    },
  };

  const resultPath = path.join(outputDir, 'result.json');
  const summaryPath = path.join(outputDir, 'summary.txt');
  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8');

  const summary = [
    `passed: ${passed}`,
    `tabId: ${tabId}`,
    `openedVideo: ${openedVideo}`,
    `playPauseResolved: ${Boolean(playPauseResolved?.found)}`,
    `playPauseClicked: ${playPauseClicked}`,
    `playerStateChanged: ${playerStateChangedOk}`,
    `commentBoxFound: ${commentBoxFound}`,
    `commentBoxFocused: ${commentBoxFocused}`,
    `likeButtonResolved: ${likeButtonResolved}`,
    `likeButtonClicked: ${likeButtonClicked}`,
    `subscribeButtonResolved: ${subscribeButtonResolved}`,
    `subscribeButtonClicked: ${subscribeButtonClicked}`,
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
