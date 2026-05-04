import { strict as assert } from 'node:assert';

import { parseSmartTaskIntent, runSmartTask } from '../src/server/tasks/smartTaskOrchestrator.ts';

function createMockDeps(options: {
  roomByTab: Record<string, string>;
  activeTabId: string;
  activeChatText?: string;
  profileId?: string;
  resolveTargetsFound?: boolean;
  sendUpdatesDom?: boolean;
  forceFileSendNotVerified?: boolean;
  learningInsertFails?: boolean;
}) {
  const stateByTab = new Map<string, any>();
  for (const tabId of Object.keys(options.roomByTab)) {
    stateByTab.set(tabId, { domHash: `${tabId}-before`, url: `https://example.test/${tabId}` });
  }

  let roomByTab = { ...options.roomByTab };
  let activeChatText = options.activeChatText || '';
  const resolveTargetsFound = options.resolveTargetsFound !== false;
  const sendUpdatesDom = options.sendUpdatesDom !== false;
  const forceFileSendNotVerified = options.forceFileSendNotVerified === true;

  const allTabs = [
    {
      tabId: options.activeTabId,
      profileId: options.profileId || 'default',
      url:
        roomByTab[options.activeTabId]?.startsWith('whatsapp') ? 'https://web.whatsapp.com' :
        roomByTab[options.activeTabId]?.startsWith('chatgpt') ? 'https://chatgpt.com' :
        roomByTab[options.activeTabId]?.startsWith('gemini') ? 'https://gemini.google.com' :
        'https://github.com/example/repo',
      title: 'Mock Tab',
      domHash: `${options.activeTabId}-hash`,
    },
  ];

  return {
    profileStore: {
      getActiveId: () => options.profileId || 'default',
      resolveId: (value: string) => value || 'default',
      setActive: () => null,
    },
    tabManager: {
      getAllTabs: () => allTabs,
      getActiveTabId: () => options.activeTabId,
      focusTab: () => null,
      createTabSync: () => 'created-tab',
      getTab: () => ({
        profileId: options.profileId || 'default',
        webContents: {
          getURL: () => 'https://example.test/final',
        },
      }),
    },
    vlmPageApi: {
      getSiteRoom: async (tabId: string) => ({
        ok: true,
        room: roomByTab[tabId] || 'unknown',
        confidence: 0.95,
        url: allTabs[0].url,
      }),
      getState: async (tabId: string) => stateByTab.get(tabId) || { domHash: 'unknown', url: 'https://example.test' },
      getWhatsAppActiveChat: async () => ({
        ok: true,
        text: activeChatText,
        normalized: activeChatText.toLowerCase(),
      }),
      getWhatsAppFilePreview: async () => ({ ok: true, previewVisible: true, fileNameSeen: true }),
      openWhatsAppChat: async () => ({
        ok: true,
        reason: 'WHATSAPP_CHAT_OPENED',
      }),
      runMicroSkill: async (_tabId: string, body: any) => {
        if (body.skill === 'github_open_issues') {
          roomByTab[options.activeTabId] = 'github_issues';
        }
        stateByTab.set(options.activeTabId, { domHash: `${options.activeTabId}-${body.skill}-after`, url: 'https://example.test/after' });
        return { ok: true, skill: body.skill };
      },
      actionResolveAndAct: async () => {
        if (sendUpdatesDom) {
          stateByTab.set(options.activeTabId, { domHash: `${options.activeTabId}-send-after`, url: 'https://example.test/after' });
        }
        return { ok: true, reason: 'CLICK_SENT' };
      },
      evaluate: async (_tabId: string, body: any) => {
        const script = String(body?.script || '');
        if (script.includes('footer div[contenteditable')) {
          return { result: { text: '' } };
        }
        return { result: {} };
      },
      resolveTarget: async (_tabId: string, body: any) => {
        if (body.targetKey === 'last_user_message' || body.targetKey === 'last_assistant_message' || body.targetKey === 'last_model_response') {
          return { found: resolveTargetsFound };
        }
        return { found: false };
      },
      sendWhatsAppFile: async () => {
        if (forceFileSendNotVerified) {
          return { ok: true, reason: 'WHATSAPP_FILES_SEND_NOT_VERIFIED' };
        }
        return { ok: true, reason: 'WHATSAPP_FILES_SENT' };
      },
    },
    db: options.learningInsertFails
      ? {
          prepare: () => ({
            run: () => {
              throw new Error('mock learning insert failed');
            },
          }),
        }
      : {},
  } as any;
}

function assertBaseShape(result: any) {
  assert.ok(result && typeof result === 'object');
  assert.ok('detectedIntent' in result, 'missing detectedIntent');
  assert.ok('skippedSteps' in result, 'missing skippedSteps');
  assert.ok('executedSteps' in result, 'missing executedSteps');
  assert.ok('verification' in result, 'missing verification');
  assert.ok('evidence' in result, 'missing evidence');
  assert.ok(Array.isArray(result.skippedSteps), 'skippedSteps must be array');
  assert.ok(Array.isArray(result.executedSteps), 'executedSteps must be array');
}

function assertSuccessIsVerified(result: any) {
  if (result.status === 'SUCCESS') {
    assert.equal(Boolean(result.verification?.ok), true, 'SUCCESS must include verification.ok=true');
  }
}

async function main() {
  const messageIntent = parseSmartTaskIntent({ goal: 'send hello to Bihi on WhatsApp' });
  assert.equal(messageIntent.type, 'whatsapp_send_message');

  const fileIntent = parseSmartTaskIntent({ goal: 'send this file to Bihi on WhatsApp', filePath: 'C:\\Users\\DELL\\Downloads\\a.pdf' });
  assert.equal(fileIntent.type, 'whatsapp_send_file');

  const whatsappMessage = await runSmartTask(
    { goal: 'send hello to Bihi on WhatsApp', allowExternalSend: true },
    createMockDeps({
      roomByTab: { 'wa-tab': 'whatsapp_chat' },
      activeTabId: 'wa-tab',
      activeChatText: 'Bihi',
    }),
  );
  assertBaseShape(whatsappMessage);
  assertSuccessIsVerified(whatsappMessage);
  assert.equal(whatsappMessage.status, 'SUCCESS');
  assert.ok(whatsappMessage.skippedSteps.some((step) => step.step === 'open_chat'));

  const whatsappFile = await runSmartTask(
    { goal: 'send this file to Bihi on WhatsApp', filePath: 'C:\\Users\\DELL\\Downloads\\a.pdf', allowExternalSend: true },
    createMockDeps({
      roomByTab: { 'wa-file': 'whatsapp_chat' },
      activeTabId: 'wa-file',
      activeChatText: 'Bihi',
    }),
  );
  assertBaseShape(whatsappFile);
  assertSuccessIsVerified(whatsappFile);
  assert.equal(whatsappFile.status, 'SUCCESS');

  const chatGptPrompt = await runSmartTask(
    { goal: 'ask ChatGPT: explain DBMS normalization' },
    createMockDeps({
      roomByTab: { 'cgpt-tab': 'chatgpt_chat' },
      activeTabId: 'cgpt-tab',
    }),
  );
  assertBaseShape(chatGptPrompt);
  assertSuccessIsVerified(chatGptPrompt);
  assert.equal(chatGptPrompt.status, 'SUCCESS');

  const geminiPrompt = await runSmartTask(
    { goal: 'ask Gemini: explain DBMS normalization' },
    createMockDeps({
      roomByTab: { 'gem-tab': 'gemini_chat' },
      activeTabId: 'gem-tab',
    }),
  );
  assertBaseShape(geminiPrompt);
  assertSuccessIsVerified(geminiPrompt);
  assert.equal(geminiPrompt.status, 'SUCCESS');

  const githubIssues = await runSmartTask(
    { goal: 'open issues in this GitHub repo' },
    createMockDeps({
      roomByTab: { 'gh-tab': 'github_issues' },
      activeTabId: 'gh-tab',
    }),
  );
  assertBaseShape(githubIssues);
  assertSuccessIsVerified(githubIssues);
  assert.equal(githubIssues.status, 'SUCCESS');
  assert.ok(githubIssues.skippedSteps.some((step) => step.step === 'open_github_issues'));

  const authRequired = await runSmartTask(
    { goal: 'ask ChatGPT: explain DBMS normalization' },
    createMockDeps({
      roomByTab: { 'auth-tab': 'chatgpt_auth' },
      activeTabId: 'auth-tab',
    }),
  );
  assertBaseShape(authRequired);
  assert.equal(authRequired.status, 'NEEDS_AUTH');

  const dryRun = await runSmartTask(
    { goal: 'send this file to Bihi on WhatsApp', filePath: 'C:\\Users\\DELL\\Downloads\\a.pdf', allowExternalSend: true, dryRun: true },
    createMockDeps({
      roomByTab: { 'dry-tab': 'whatsapp_home' },
      activeTabId: 'dry-tab',
      activeChatText: '',
    }),
  );
  assertBaseShape(dryRun);
  assert.equal(dryRun.status, 'DRY_RUN');

  // Failure case: resolveTarget never finds response, so chat prompt cannot be SUCCESS.
  const chatGptVerificationFail = await runSmartTask(
    { goal: 'ask ChatGPT: explain DBMS normalization' },
    createMockDeps({
      roomByTab: { 'cgpt-fail': 'chatgpt_chat' },
      activeTabId: 'cgpt-fail',
      resolveTargetsFound: false,
    }),
  );
  assertBaseShape(chatGptVerificationFail);
  assert.notEqual(chatGptVerificationFail.status, 'SUCCESS');

  const geminiVerificationFail = await runSmartTask(
    { goal: 'ask Gemini: explain DBMS normalization' },
    createMockDeps({
      roomByTab: { 'gem-fail': 'gemini_chat' },
      activeTabId: 'gem-fail',
      resolveTargetsFound: false,
    }),
  );
  assertBaseShape(geminiVerificationFail);
  assert.notEqual(geminiVerificationFail.status, 'SUCCESS');

  // Failure case: WhatsApp send action reports ok but no DOM verification evidence -> must not be SUCCESS.
  const whatsappMessageUnverified = await runSmartTask(
    { goal: 'send hello to Bihi on WhatsApp', allowExternalSend: true },
    createMockDeps({
      roomByTab: { 'wa-unverified': 'whatsapp_chat' },
      activeTabId: 'wa-unverified',
      activeChatText: 'Bihi',
      sendUpdatesDom: false,
    }),
  );
  assertBaseShape(whatsappMessageUnverified);
  assert.notEqual(whatsappMessageUnverified.status, 'SUCCESS');

  // Failure case: WhatsApp file flow returns ok=true but reason indicates not verified; result must not be SUCCESS.
  const whatsappFileUnverified = await runSmartTask(
    { goal: 'send this file to Bihi on WhatsApp', filePath: 'C:\\Users\\DELL\\Downloads\\a.pdf', allowExternalSend: true },
    createMockDeps({
      roomByTab: { 'wa-file-unverified': 'whatsapp_chat' },
      activeTabId: 'wa-file-unverified',
      activeChatText: 'Bihi',
      forceFileSendNotVerified: true,
    }),
  );
  assertBaseShape(whatsappFileUnverified);
  assert.notEqual(whatsappFileUnverified.status, 'SUCCESS');

  // Learning insert failure should not fail task execution; it must surface warning.
  const learningInsertFailure = await runSmartTask(
    { goal: 'open issues in this GitHub repo' },
    createMockDeps({
      roomByTab: { 'gh-learning': 'github_repo' },
      activeTabId: 'gh-learning',
      learningInsertFails: true,
    }),
  );
  assertBaseShape(learningInsertFailure);
  assert.equal(learningInsertFailure.status, 'SUCCESS');
  assert.ok(typeof (learningInsertFailure as any).learningWarning === 'string');
  assert.ok((learningInsertFailure as any).learningWarning.includes('LEARNING_INSERT_FAILED'));
  assertSuccessIsVerified(learningInsertFailure);

  console.log('smart-task smoke tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
