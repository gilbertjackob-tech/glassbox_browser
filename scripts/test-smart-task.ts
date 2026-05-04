import { strict as assert } from 'node:assert';

import { parseSmartTaskIntent, runSmartTask } from '../src/server/tasks/smartTaskOrchestrator.ts';

function createMockDeps(options: {
  roomByTab: Record<string, string>;
  activeTabId: string;
  activeChatText?: string;
  profileId?: string;
}) {
  const stateByTab = new Map<string, any>();
  for (const tabId of Object.keys(options.roomByTab)) {
    stateByTab.set(tabId, { domHash: `${tabId}-before`, url: `https://example.test/${tabId}` });
  }

  let roomByTab = { ...options.roomByTab };
  let activeChatText = options.activeChatText || '';

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
        stateByTab.set(options.activeTabId, { domHash: `${options.activeTabId}-send-after`, url: 'https://example.test/after' });
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
          return { found: true };
        }
        return { found: false };
      },
      sendWhatsAppFile: async () => ({ ok: true, reason: 'WHATSAPP_FILES_SENT' }),
    },
    db: {},
  } as any;
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
  assert.equal(whatsappFile.status, 'SUCCESS');

  const chatGptPrompt = await runSmartTask(
    { goal: 'ask ChatGPT: explain DBMS normalization' },
    createMockDeps({
      roomByTab: { 'cgpt-tab': 'chatgpt_chat' },
      activeTabId: 'cgpt-tab',
    }),
  );
  assert.equal(chatGptPrompt.status, 'SUCCESS');

  const githubIssues = await runSmartTask(
    { goal: 'open issues in this GitHub repo' },
    createMockDeps({
      roomByTab: { 'gh-tab': 'github_issues' },
      activeTabId: 'gh-tab',
    }),
  );
  assert.equal(githubIssues.status, 'SUCCESS');
  assert.ok(githubIssues.skippedSteps.some((step) => step.step === 'open_github_issues'));

  const authRequired = await runSmartTask(
    { goal: 'ask ChatGPT: explain DBMS normalization' },
    createMockDeps({
      roomByTab: { 'auth-tab': 'chatgpt_auth' },
      activeTabId: 'auth-tab',
    }),
  );
  assert.equal(authRequired.status, 'NEEDS_AUTH');

  const dryRun = await runSmartTask(
    { goal: 'send this file to Bihi on WhatsApp', filePath: 'C:\\Users\\DELL\\Downloads\\a.pdf', allowExternalSend: true, dryRun: true },
    createMockDeps({
      roomByTab: { 'dry-tab': 'whatsapp_home' },
      activeTabId: 'dry-tab',
      activeChatText: '',
    }),
  );
  assert.equal(dryRun.status, 'DRY_RUN');

  console.log('smart-task smoke tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
