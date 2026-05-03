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
    const url = String(state.url || '');
    if (url.includes('/watch')) {
      return { ok: true, url, state };
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  const state = await getState(tabId).catch(() => null);
  return {
    ok: false,
    url: String(state?.url || ''),
    state,
  };
}

async function scrollTargetIntoView(tabId, selector) {
  if (!selector) return false;

  const result = await evaluate(tabId, `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      return true;
    })();
  `);

  await new Promise((resolve) => setTimeout(resolve, 700));
  return Boolean(result?.result);
}

async function navigateResolvedFirstVideoHref(tabId, selector) {
  if (!selector) {
    return {
      ok: false,
      reason: 'NO_SELECTOR_FOR_DIRECT_HREF_NAVIGATION',
    };
  }

  const hrefResult = await evaluate(tabId, `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const href = el?.href || el?.getAttribute?.('href') || '';
      if (!href) return null;
      return new URL(href, location.href).toString();
    })();
  `);

  const href = String(hrefResult?.result || '');

  if (!href || !href.includes('/watch')) {
    return {
      ok: false,
      reason: 'NO_WATCH_HREF_FOUND',
      href,
    };
  }

  await navigate(tabId, href);
  const watch = await waitForWatchUrl(tabId, 8000);

  return {
    ok: watch.ok,
    href,
    watch,
  };
}

async function clickFirstVideoWithRetry(tabId) {
  const attempts = [];

  async function resolveFirstVideo() {
    return resolveTarget(tabId, {
      targetKey: 'first_video_result',
      kind: 'link',
    });
  }

  async function clickFirstVideo(label) {
    const clicked = await resolveAndAct(tabId, {
      targetKey: 'first_video_result',
      kind: 'link',
      action: 'click',
    });

    const watch = await waitForWatchUrl(tabId, 8000);
    const ok = Boolean(clicked?.ok) && Boolean(watch.ok);

    attempts.push({
      label,
      clickedOk: Boolean(clicked?.ok),
      clickedReason: clicked?.reason || '',
      urlChanged: Boolean(clicked?.verification?.urlChanged),
      watchOk: Boolean(watch.ok),
      finalUrl: watch.url,
      clicked,
    });

    return {
      ok,
      clicked,
      watch,
    };
  }

  const attempt1 = await clickFirstVideo('normal_click');
  if (attempt1.ok) {
    return {
      ok: true,
      strategy: 'normal_click',
      attempts,
      clicked: attempt1.clicked,
      watch: attempt1.watch,
    };
  }

  const resolved = await resolveFirstVideo();
  const selector = resolved?.target?.selector || attempt1.clicked?.resolve?.target?.selector || '';

  if (selector) {
    await scrollTargetIntoView(tabId, selector);
    const attempt2 = await clickFirstVideo('scroll_then_click');
    if (attempt2.ok) {
      return {
        ok: true,
        strategy: 'scroll_then_click',
        attempts,
        resolved,
        clicked: attempt2.clicked,
        watch: attempt2.watch,
      };
    }
  }

  const direct = await navigateResolvedFirstVideoHref(tabId, selector);
  attempts.push({
    label: 'direct_href_navigation',
    ok: Boolean(direct.ok),
    href: direct.href,
    reason: direct.reason || '',
    finalUrl: direct.watch?.url || '',
  });

  if (direct.ok) {
    return {
      ok: true,
      strategy: 'direct_href_navigation',
      attempts,
      resolved,
      direct,
      watch: direct.watch,
    };
  }

  return {
    ok: false,
    reason: 'FIRST_VIDEO_DID_NOT_OPEN',
    attempts,
    resolved,
  };
}

async function revealPlayerControls(tabId) {
  return evaluate(tabId, `
    (() => {
      const player =
        document.querySelector('#movie_player') ||
        document.querySelector('.html5-video-player') ||
        document.querySelector('video');
      if (!player) {
        return { ok: false, reason: 'PLAYER_NOT_FOUND' };
      }

      const rect = player.getBoundingClientRect();
      const x = rect.left + Math.min(rect.width / 2, 40);
      const y = rect.top + Math.min(rect.height / 2, 40);

      ['mouseover', 'mousemove', 'mouseenter'].forEach((type) => {
        player.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          view: window,
        }));
      });

      return { ok: true, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    })();
  `);
}

async function resolvePlayPauseWithReveal(tabId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await revealPlayerControls(tabId).catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 350));

    const resolved = await resolveTarget(tabId, {
      targetKey: 'play_pause_button',
      kind: 'button',
    });

    if (resolved?.found) {
      return resolved;
    }
  }

  return {
    found: false,
    reason: 'PLAY_PAUSE_NOT_RESOLVED_AFTER_REVEAL',
  };
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

  const openedVideo = Boolean(firstVideo?.ok);

  const playPauseResolved = await resolvePlayPauseWithReveal(tabId);

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

  const playPauseClick = playPauseResolved?.found
    ? await resolveAndAct(tabId, {
        targetKey: 'play_pause_button',
        kind: 'button',
        action: 'click',
      })
    : { ok: false, reason: 'PLAY_PAUSE_NOT_FOUND' };

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
  const playerStateChangedOk = playPauseClicked && playerStateChanged(beforePlayerState, afterPlayerState);

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

  const required = {
    openedVideo,
    playPauseResolved: Boolean(playPauseResolved?.found),
    playPauseClicked,
    playerStateChanged: playerStateChangedOk,
  };

  const requiredPassed =
    required.openedVideo &&
    required.playPauseResolved &&
    required.playPauseClicked &&
    required.playerStateChanged;

  const optional = {
    commentBox: {
      found: commentBoxFound,
      focused: commentBoxFocused,
      required: false,
      reason: commentBoxFound
        ? 'COMMENT_BOX_AVAILABLE'
        : 'COMMENT_BOX_NOT_FOUND_OR_NOT_LOADED',
    },
  };

  const blockedByPolicy = {
    likeButton: {
      resolved: likeButtonResolved,
      clicked: false,
      status: 'skipped',
      reason: 'ACCOUNT_CHANGING_ACTION_BLOCKED_BY_DEFAULT',
    },
    subscribeButton: {
      resolved: subscribeButtonResolved,
      clicked: false,
      status: 'skipped',
      reason: 'ACCOUNT_CHANGING_ACTION_BLOCKED_BY_DEFAULT',
    },
  };

  const passed = requiredPassed;

  const payload = {
    runAt: new Date().toISOString(),
    tabId,
    passed,
    safeMode: SAFE_MODE,
    allowAccountActions: ALLOW_ACCOUNT_ACTIONS,
    required,
    optional,
    blockedByPolicy,
    openStrategy: firstVideo?.strategy || '',
    openFailureReason: firstVideo?.reason || '',
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
    '',
    '[Required]',
    `openedVideo: ${required.openedVideo}`,
    `playPauseResolved: ${required.playPauseResolved}`,
    `playPauseClicked: ${required.playPauseClicked}`,
    `playerStateChanged: ${required.playerStateChanged}`,
    `openStrategy: ${firstVideo?.strategy || 'none'}`,
    `openFailureReason: ${firstVideo?.reason || ''}`,
    '',
    '[Optional]',
    `commentBoxFound: ${optional.commentBox.found}`,
    `commentBoxFocused: ${optional.commentBox.focused}`,
    `commentBoxReason: ${optional.commentBox.reason}`,
    '',
    '[BlockedByPolicy]',
    `likeButtonResolved: ${blockedByPolicy.likeButton.resolved}`,
    `likeButtonClicked: ${blockedByPolicy.likeButton.status}`,
    `subscribeButtonResolved: ${blockedByPolicy.subscribeButton.resolved}`,
    `subscribeButtonClicked: ${blockedByPolicy.subscribeButton.status}`,
    '',
    `tabId: ${tabId}`,
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
