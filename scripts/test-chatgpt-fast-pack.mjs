import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const outputDir = path.resolve('debug-chatgpt-fast-pack-output');

async function requestJson(url, options, allowError = false) {
  const res = await fetch(url, options);
  const text = await res.text();

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok && !allowError) {
    throw new Error(`HTTP ${res.status} from ${url}\n${JSON.stringify(data, null, 2)}`);
  }

  return allowError
    ? { ok: res.ok, status: res.status, data }
    : data;
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

async function installChatGptSkills() {
  return requestJson(`${API_BASE}/api/site-packs/chatgpt.com/install-skills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

async function resolveTarget(tabId, body) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/resolve-target`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function runSkill(tabId, body, allowError = false) {
  return requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/skills/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, allowError);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const tabId = await getOrCreateTabId();

  await navigate(tabId, 'https://chatgpt.com');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  const room = await getSiteRoom(tabId);
  const suggestions = await getSuggestions(tabId);
  const installResult = await installChatGptSkills();

  const promptBox = await resolveTarget(tabId, {
    targetKey: 'prompt_box',
    kind: 'input',
  });

  const sendButton = await resolveTarget(tabId, {
    targetKey: 'send_button',
    kind: 'button',
  });

  const hasSendPromptSuggestion = suggestions.suggestions?.some(
    (item) => item.name === 'chatgpt_send_prompt' && item.safe === true
  );
  const authRequired =
    room.reason === 'AUTH_REQUIRED' ||
    suggestions.reason === 'AUTH_REQUIRED' ||
    suggestions.suggestions?.some((item) =>
      item.guarded === true && /requires login/i.test(String(item.reason || ''))
    );

  let sendPromptResult = null;
  if (promptBox.found && sendButton.found) {
    sendPromptResult = await runSkill(tabId, {
      skill: 'chatgpt_send_prompt',
      inputs: {
        prompt: 'Say exactly: GlassBox ChatGPT fast pack test.',
      },
      stopOnFailure: true,
    }, true);
  }

  const roomOk =
    room.room === 'chatgpt_home' ||
    room.room === 'chatgpt_chat' ||
    authRequired;

  const promptBoxFound = Boolean(promptBox.found);
  const installOk = Boolean(installResult.ok);
  const suggestionOk = authRequired
    ? Boolean(suggestions.ok)
    : Boolean(hasSendPromptSuggestion);

  const sendAttemptSafe =
    sendPromptResult === null ||
    sendPromptResult.ok === true ||
    sendPromptResult.status >= 400;

  const passed =
    Boolean(room.ok || authRequired) &&
    roomOk &&
    installOk &&
    suggestionOk &&
    (authRequired || promptBoxFound) &&
    sendAttemptSafe;

  const payload = {
    runAt: new Date().toISOString(),
    tabId,
    passed,
    checks: {
      roomOk,
      detectedRoom: room.room,
      authRequired,
      promptBoxFound,
      sendButtonFound: Boolean(sendButton.found),
      installOk,
      suggestionOk,
      sendAttempted: sendPromptResult !== null,
      sendAttemptSafe,
    },
    room,
    suggestions,
    installResult: {
      ok: installResult.ok,
      installedCount: installResult.installedCount,
    },
    promptBox,
    sendButton,
    sendPromptResult,
  };

  const resultPath = path.join(outputDir, 'result.json');
  const summaryPath = path.join(outputDir, 'summary.txt');

  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8');

  const summary = [
    `passed: ${passed}`,
    `tabId: ${tabId}`,
    `roomOk: ${roomOk}`,
    `detectedRoom: ${room.room}`,
    `authRequired: ${authRequired}`,
    `promptBoxFound: ${promptBoxFound}`,
    `sendButtonFound: ${Boolean(sendButton.found)}`,
    `installOk: ${installOk}`,
    `suggestionOk: ${suggestionOk}`,
    `sendAttempted: ${sendPromptResult !== null}`,
    `sendAttemptSafe: ${sendAttemptSafe}`,
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
