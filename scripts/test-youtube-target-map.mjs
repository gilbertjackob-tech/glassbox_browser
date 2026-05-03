import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const outputDir = path.resolve('debug-youtube-target-map-output');

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

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const tabId = await getOrCreateTabId();
  const steps = [];

  await navigate(tabId, 'https://www.youtube.com/results?search_query=database+lecture');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const searchBox = await resolveTarget(tabId, { targetKey: 'search_box', kind: 'input' });
  const firstResult = await resolveTarget(tabId, { targetKey: 'first_video_result', kind: 'link' });
  const videoCard = await resolveTarget(tabId, { targetKey: 'video_card', kind: 'card' });
  const videoTitleLink = await resolveTarget(tabId, { targetKey: 'video_title_link', kind: 'link' });

  steps.push({ step: 'resolve_results_page', searchBox, firstResult, videoCard, videoTitleLink });

  if (firstResult?.found) {
    let open = await resolveAndAct(tabId, {
      targetKey: 'first_video_result',
      kind: 'link',
      action: 'click',
    });

    if (!open?.ok && open?.reason === 'ELEMENT_NOT_VISIBLE' && open?.resolve?.target?.selector) {
      const selector = open.resolve.target.selector;
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
      await new Promise((resolve) => setTimeout(resolve, 500));
      open = await resolveAndAct(tabId, {
        targetKey: 'first_video_result',
        kind: 'link',
        action: 'click',
      });
    }

    steps.push({ step: 'open_first_video', open });
    await new Promise((resolve) => setTimeout(resolve, 3500));
  } else {
    steps.push({ step: 'open_first_video', skipped: true, reason: 'FIRST_RESULT_NOT_FOUND' });
  }

  const videoPlayer = await resolveTarget(tabId, { targetKey: 'video_player', kind: 'card' });
  const playPauseButton = await resolveTarget(tabId, { targetKey: 'play_pause_button', kind: 'button' });
  const likeButton = await resolveTarget(tabId, { targetKey: 'like_button', kind: 'button' });
  const subscribeButton = await resolveTarget(tabId, { targetKey: 'subscribe_button', kind: 'button' });
  const commentBox = await resolveTarget(tabId, { targetKey: 'comment_box', kind: 'input' });

  steps.push({
    step: 'resolve_watch_page',
    videoPlayer,
    playPauseButton,
    likeButton,
    subscribeButton,
    commentBox,
  });

  const passedRequired =
    Boolean(searchBox?.found) &&
    Boolean(firstResult?.found) &&
    Boolean(videoPlayer?.found);

  const optional = {
    playPauseButton: Boolean(playPauseButton?.found),
    likeButton: Boolean(likeButton?.found),
    subscribeButton: Boolean(subscribeButton?.found),
    commentBox: Boolean(commentBox?.found),
  };

  const payload = {
    runAt: new Date().toISOString(),
    tabId,
    passed: passedRequired,
    required: {
      searchBoxFound: Boolean(searchBox?.found),
      firstResultFound: Boolean(firstResult?.found),
      videoPlayerFound: Boolean(videoPlayer?.found),
    },
    optional,
    steps,
  };

  const resultPath = path.join(outputDir, 'result.json');
  const summaryPath = path.join(outputDir, 'summary.txt');

  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8');
  const summary = [
    `passed: ${passedRequired}`,
    `tabId: ${tabId}`,
    `searchBoxFound: ${payload.required.searchBoxFound}`,
    `firstResultFound: ${payload.required.firstResultFound}`,
    `videoPlayerFound: ${payload.required.videoPlayerFound}`,
    `optional.playPauseButton: ${optional.playPauseButton}`,
    `optional.likeButton: ${optional.likeButton}`,
    `optional.subscribeButton: ${optional.subscribeButton}`,
    `optional.commentBox: ${optional.commentBox}`,
    `result: ${resultPath}`,
  ].join('\n');
  fs.writeFileSync(summaryPath, summary, 'utf8');

  console.log('\nDONE');
  console.log(summary);

  if (!passedRequired) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('\nFAILED');
  console.error(error.message);
  process.exit(1);
});
