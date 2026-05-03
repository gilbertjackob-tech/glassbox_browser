import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const outputDir = path.resolve('debug-whatsapp-fast-pack-output');

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

async function installWhatsAppSkills() {
  return requestJson(`${API_BASE}/api/site-packs/web.whatsapp.com/install-skills`, {
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

  await navigate(tabId, 'https://web.whatsapp.com');
  await new Promise((resolve) => setTimeout(resolve, 8000));

  const room = await getSiteRoom(tabId);
  const suggestions = await getSuggestions(tabId);
  const installResult = await installWhatsAppSkills();

  const authRequired =
    room.reason === 'AUTH_REQUIRED' ||
    suggestions.reason === 'AUTH_REQUIRED' ||
    room.room === 'whatsapp_auth';

  const chatSearch = await resolveTarget(tabId, {
    targetKey: 'chat_search_box',
    kind: 'input',
  }).catch((error) => ({ found: false, reason: error.message }));

  const messageBox = await resolveTarget(tabId, {
    targetKey: 'message_box',
    kind: 'input',
  }).catch((error) => ({ found: false, reason: error.message }));

  const sendButton = await resolveTarget(tabId, {
    targetKey: 'send_button',
    kind: 'button',
  }).catch((error) => ({ found: false, reason: error.message }));

  const hasSearchSuggestion = suggestions.suggestions?.some(
    (item) => item.name === 'whatsapp_search_chat' && item.safe === true
  );

  const hasPrepareMessageSuggestion = suggestions.suggestions?.some(
    (item) => item.name === 'whatsapp_prepare_message' && item.safe === true
  );

  const sendButtonGuarded = suggestions.suggestions?.some(
    (item) => item.targetKey === 'send_button' && item.guarded === true && item.safe === false
  );

  let prepareMessageResult = null;
  if (room.room === 'whatsapp_chat' && messageBox.found) {
    prepareMessageResult = await runSkill(tabId, {
      skill: 'whatsapp_prepare_message',
      inputs: {
        message: 'GlassBox WhatsApp fast pack draft only. Do not send.',
      },
      stopOnFailure: true,
    }, true);
  }

  const roomOk =
    room.room === 'whatsapp_auth' ||
    room.room === 'whatsapp_home' ||
    room.room === 'whatsapp_chat' ||
    authRequired;

  const installOk = Boolean(installResult.ok);

  const suggestionOk =
    authRequired
      ? Boolean(suggestions.ok)
      : room.room === 'whatsapp_home'
        ? Boolean(hasSearchSuggestion)
        : room.room === 'whatsapp_chat'
          ? Boolean(hasPrepareMessageSuggestion && sendButtonGuarded)
          : Boolean(suggestions.ok);

  const prepareAttemptSafe =
    prepareMessageResult === null ||
    prepareMessageResult.ok === true ||
    prepareMessageResult.status >= 400;

  const passed =
    Boolean(room.ok || authRequired) &&
    roomOk &&
    installOk &&
    suggestionOk &&
    prepareAttemptSafe;

  const payload = {
    runAt: new Date().toISOString(),
    tabId,
    passed,
    checks: {
      detectedRoom: room.room,
      authRequired,
      roomOk,
      installOk,
      chatSearchFound: Boolean(chatSearch.found),
      messageBoxFound: Boolean(messageBox.found),
      sendButtonFound: Boolean(sendButton.found),
      hasSearchSuggestion: Boolean(hasSearchSuggestion),
      hasPrepareMessageSuggestion: Boolean(hasPrepareMessageSuggestion),
      sendButtonGuarded: Boolean(sendButtonGuarded),
      prepareAttempted: prepareMessageResult !== null,
      prepareAttemptSafe,
    },
    room,
    suggestions,
    installResult: {
      ok: installResult.ok,
      installedCount: installResult.installedCount,
    },
    chatSearch,
    messageBox,
    sendButton,
    prepareMessageResult,
  };

  const resultPath = path.join(outputDir, 'result.json');
  const summaryPath = path.join(outputDir, 'summary.txt');

  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8');

  const summary = [
    `passed: ${passed}`,
    `tabId: ${tabId}`,
    `detectedRoom: ${room.room}`,
    `authRequired: ${authRequired}`,
    `roomOk: ${roomOk}`,
    `installOk: ${installOk}`,
    `chatSearchFound: ${Boolean(chatSearch.found)}`,
    `messageBoxFound: ${Boolean(messageBox.found)}`,
    `sendButtonFound: ${Boolean(sendButton.found)}`,
    `hasSearchSuggestion: ${Boolean(hasSearchSuggestion)}`,
    `hasPrepareMessageSuggestion: ${Boolean(hasPrepareMessageSuggestion)}`,
    `sendButtonGuarded: ${Boolean(sendButtonGuarded)}`,
    `prepareAttempted: ${prepareMessageResult !== null}`,
    `prepareAttemptSafe: ${prepareAttemptSafe}`,
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
