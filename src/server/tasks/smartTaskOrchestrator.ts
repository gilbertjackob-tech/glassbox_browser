import { v4 as uuidv4 } from 'uuid';

import { recordSiteLearningEvent } from '../learning/siteLearningService.js';
import { assertCanSendToWhatsAppChat, listStaticWhatsAppChats } from '../whatsappService.js';

type SmartTaskStatus = 'SUCCESS' | 'FAILED' | 'NEEDS_AUTH' | 'AMBIGUOUS' | 'DRY_RUN';

export interface SmartTaskInput {
  goal: string;
  profileId?: string;
  site?: string;
  chatName?: string;
  message?: string;
  filePath?: string;
  allowExternalSend?: boolean;
  dryRun?: boolean;
}

export interface SmartTaskResult {
  ok: boolean;
  status: SmartTaskStatus;
  goal: string;
  detectedIntent: Record<string, unknown>;
  initialWorldStateSummary: Record<string, unknown>;
  skippedSteps: Array<Record<string, unknown>>;
  executedSteps: Array<Record<string, unknown>>;
  verification: Record<string, unknown>;
  learnedEvents: Array<Record<string, unknown>>;
  failureReason?: string;
  evidence: Record<string, unknown>;
}

type SmartIntentType =
  | 'whatsapp_send_message'
  | 'whatsapp_send_file'
  | 'chatgpt_prompt'
  | 'gemini_prompt'
  | 'github_open_issues'
  | 'unknown';

type SmartIntent = {
  type: SmartIntentType;
  site?: string;
  chatName?: string;
  message?: string;
  prompt?: string;
  filePath?: string;
};

type WorldTabSummary = {
  tabId: string;
  profileId: string;
  url: string;
  host: string;
  title: string;
  room: string;
  focused: boolean;
};

type SmartTaskDeps = {
  profileStore: any;
  tabManager: any;
  vlmPageApi: any;
  db: any;
};

async function getDefaultDeps(): Promise<SmartTaskDeps> {
  const [{ default: db }, { profileStore }, { tabManager }, { vlmPageApi }] = await Promise.all([
    import('../../main/memoryDb.js'),
    import('../../main/profileStore.js'),
    import('../tabManager.js'),
    import('../vlmPageApi.js'),
  ]);

  return {
    profileStore,
    tabManager,
    vlmPageApi,
    db,
  };
}

function extractHost(url: string) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value: string) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function confidenceFor(found: boolean, value = 0.95) {
  return found ? value : Math.max(0.1, value - 0.35);
}

export function parseSmartTaskIntent(input: SmartTaskInput): SmartIntent {
  const goal = String(input.goal || '').trim();
  const lowered = goal.toLowerCase();
  const knownChats = listStaticWhatsAppChats().map((item) => item.name);
  const goalChat = knownChats.find((name) => lowered.includes(name.toLowerCase()));

  if ((input.filePath || /\bfile\b/.test(lowered)) && lowered.includes('whatsapp')) {
    return {
      type: 'whatsapp_send_file',
      site: 'whatsapp',
      chatName: input.chatName || goalChat || '',
      filePath: input.filePath || '',
    };
  }

  const whatsappMessageMatch = goal.match(/^send\s+(.+?)\s+to\s+(.+?)\s+on\s+whatsapp$/i);
  if (lowered.includes('whatsapp') && (input.message || whatsappMessageMatch)) {
    return {
      type: 'whatsapp_send_message',
      site: 'whatsapp',
      chatName: input.chatName || whatsappMessageMatch?.[2]?.trim() || goalChat || '',
      message: input.message || whatsappMessageMatch?.[1]?.trim() || '',
    };
  }

  const chatGptPromptMatch = goal.match(/^ask\s+chatgpt:\s*(.+)$/i);
  if (input.site === 'chatgpt' || chatGptPromptMatch) {
    return {
      type: 'chatgpt_prompt',
      site: 'chatgpt',
      prompt: input.message || chatGptPromptMatch?.[1]?.trim() || '',
    };
  }

  const geminiPromptMatch = goal.match(/^ask\s+gemini:\s*(.+)$/i);
  if (input.site === 'gemini' || geminiPromptMatch) {
    return {
      type: 'gemini_prompt',
      site: 'gemini',
      prompt: input.message || geminiPromptMatch?.[1]?.trim() || '',
    };
  }

  if (input.site === 'github' || /open issues in (this )?github repo/i.test(goal)) {
    return {
      type: 'github_open_issues',
      site: 'github',
    };
  }

  return {
    type: 'unknown',
  };
}

async function summarizeWorldState(selectedProfileId: string, deps: SmartTaskDeps) {
  const activeTabId = deps.tabManager.getActiveTabId?.() || '';
  const rawTabs = deps.tabManager.getAllTabs()
    .filter((tab) => !selectedProfileId || tab.profileId === selectedProfileId);

  const tabs: WorldTabSummary[] = [];
  for (const raw of rawTabs) {
    let room = 'unknown';
    try {
      const detected = await deps.vlmPageApi.getSiteRoom(raw.tabId);
      room = String(detected?.room || 'unknown');
    } catch {
      room = 'unknown';
    }

    tabs.push({
      tabId: raw.tabId,
      profileId: raw.profileId,
      url: raw.url,
      host: extractHost(raw.url),
      title: raw.title,
      room,
      focused: raw.tabId === activeTabId,
    });
  }

  return {
    profileId: selectedProfileId,
    activeProfileId: deps.profileStore.getActiveId(),
    activeTabId: activeTabId || null,
    tabCount: tabs.length,
    tabs,
  };
}

function addSkipped(
  skippedSteps: Array<Record<string, unknown>>,
  step: string,
  reason: string,
  confidence: number,
  evidence: Record<string, unknown> = {},
) {
  skippedSteps.push({ step, reason, confidence, evidence });
}

function addExecuted(
  executedSteps: Array<Record<string, unknown>>,
  step: string,
  result: Record<string, unknown>,
) {
  executedSteps.push({ step, ...result });
}

async function recordVerifiedLearning(
  deps: SmartTaskDeps,
  profileId: string,
  tabId: string,
  actionType: string,
  targetKey: string | undefined,
  goal: string,
  verification: Record<string, unknown>,
  learnedEvents: Array<Record<string, unknown>>,
) {
  const tabState = deps.tabManager.getTab(tabId);
  if (!tabState) return;

  const beforeHash = String((verification.beforeState as any)?.domHash || 'unknown');
  const afterHash = String((verification.afterState as any)?.domHash || 'unknown');
  const room = String((verification.finalRoom as any)?.room || '');
  const url = tabState.webContents.getURL();
  const event = {
    id: uuidv4(),
    profileId,
    host: extractHost(url),
    urlPattern: url,
    room,
    actionType,
    targetKey,
    targetLabel: String((verification as any)?.chat || (verification as any)?.prompt || ''),
    selector: undefined,
    role: undefined,
    textSignature: goal,
    beforeHash,
    afterHash,
    success: true,
    confidence: 0.95,
    createdAt: new Date().toISOString(),
  };

  if (deps.db && typeof deps.db.prepare === 'function') {
    recordSiteLearningEvent(deps.db as any, event);
  }
  learnedEvents.push(event);
}

async function ensureSiteTab(
  site: string,
  profileId: string,
  url: string,
  world: Awaited<ReturnType<typeof summarizeWorldState>>,
  skippedSteps: Array<Record<string, unknown>>,
  executedSteps: Array<Record<string, unknown>>,
  deps: SmartTaskDeps,
) {
  const preferred = world.tabs.find((tab) => tab.host === site || tab.host.endsWith(`.${site}`) || (
    site === 'web.whatsapp.com' && tab.host === 'web.whatsapp.com'
  ));

  if (preferred) {
    deps.tabManager.focusTab(preferred.tabId);
    addSkipped(skippedSteps, `open_${site}`, 'Existing site tab found', confidenceFor(true), {
      tabId: preferred.tabId,
      room: preferred.room,
      url: preferred.url,
    });
    return preferred.tabId;
  }

  const tabId = deps.tabManager.createTabSync(profileId, url);
  await sleep(1500);
  addExecuted(executedSteps, `open_${site}`, {
    ok: true,
    tabId,
    url,
  });
  return tabId;
}

async function getMessageBoxText(tabId: string, deps: SmartTaskDeps) {
  const result = await deps.vlmPageApi.evaluate(tabId, {
    script: `
      (() => {
        const el = document.querySelector('footer div[contenteditable="true"][data-tab], footer [role="textbox"][contenteditable="true"], div[aria-label*="Type a message"][contenteditable="true"], div[title*="Type a message"][contenteditable="true"]');
        return {
          text: (el?.textContent || '').trim()
        };
      })();
    `,
  }).catch(() => ({ result: { text: '' } }));
  return String(result?.result?.text || '');
}

async function verifyWhatsAppMessageSent(tabId: string, message: string, beforeHash: string, deps: SmartTaskDeps) {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    const state = await deps.vlmPageApi.getState(tabId);
    const messageBoxText = await getMessageBoxText(tabId, deps);
    if (String(state?.domHash || '') !== beforeHash && normalizeText(messageBoxText) !== normalizeText(message)) {
      return {
        ok: true,
        evidence: 'Message box changed after send',
        afterState: state,
      };
    }
    await sleep(300);
  }

  return {
    ok: false,
    evidence: 'Message verification timed out',
  };
}

async function runWhatsAppMessageFlow(
  input: SmartTaskInput,
  intent: SmartIntent,
  skippedSteps: Array<Record<string, unknown>>,
  executedSteps: Array<Record<string, unknown>>,
  evidence: Record<string, unknown>,
  deps: SmartTaskDeps,
  profileId: string,
): Promise<SmartTaskResult> {
  const chatName = String(intent.chatName || input.chatName || '').trim();
  const message = String(intent.message || input.message || '').trim();
  if (!chatName || !message) {
    return {
      ok: false,
      status: 'AMBIGUOUS',
      goal: input.goal,
      detectedIntent: intent,
      initialWorldStateSummary: {},
      skippedSteps,
      executedSteps,
      verification: { ok: false },
      learnedEvents: [],
      failureReason: 'WHATSAPP_CHAT_OR_MESSAGE_MISSING',
      evidence,
    };
  }

  const policy = assertCanSendToWhatsAppChat({
    chat: chatName,
    allowExternalSend: input.allowExternalSend === true,
  });
  if (!policy.ok) {
    return {
      ok: false,
      status: 'FAILED',
      goal: input.goal,
      detectedIntent: intent,
      initialWorldStateSummary: {},
      skippedSteps,
      executedSteps,
      verification: { ok: false, policy },
      learnedEvents: [],
      failureReason: String(policy.reason || 'BLOCKED_EXTERNAL_SEND'),
      evidence,
    };
  }

  const world = await summarizeWorldState(profileId, deps);
  const tabId = await ensureSiteTab('web.whatsapp.com', profileId, 'https://web.whatsapp.com', world, skippedSteps, executedSteps, deps);
  evidence.selectedTabId = tabId;

  const initialRoom = await deps.vlmPageApi.getSiteRoom(tabId);
  if (initialRoom.room === 'whatsapp_auth') {
    return {
      ok: false,
      status: 'NEEDS_AUTH',
      goal: input.goal,
      detectedIntent: intent,
      initialWorldStateSummary: world,
      skippedSteps,
      executedSteps,
      verification: { ok: false, room: initialRoom },
      learnedEvents: [],
      failureReason: 'WHATSAPP_AUTH_REQUIRED',
      evidence,
    };
  }

  const activeChat = await deps.vlmPageApi.getWhatsAppActiveChat(tabId).catch(() => ({ ok: false, normalized: '' }));
  if (initialRoom.room === 'whatsapp_chat' && normalizeText(String(activeChat?.normalized || '')).includes(normalizeText(chatName))) {
    addSkipped(skippedSteps, 'open_chat', `Target chat ${chatName} already active`, confidenceFor(true, 0.93), activeChat);
  } else {
    if (input.dryRun) {
      addExecuted(executedSteps, 'open_chat', { dryRun: true, chat: chatName });
      return {
        ok: true,
        status: 'DRY_RUN',
        goal: input.goal,
        detectedIntent: intent,
        initialWorldStateSummary: world,
        skippedSteps,
        executedSteps,
        verification: { ok: true, planned: true },
        learnedEvents: [],
        evidence,
      };
    }

    const openChat = await deps.vlmPageApi.openWhatsAppChat({ tabId, chat: chatName });
    addExecuted(executedSteps, 'open_chat', openChat);
    if (!openChat.ok) {
      return {
        ok: false,
        status: 'FAILED',
        goal: input.goal,
        detectedIntent: intent,
        initialWorldStateSummary: world,
        skippedSteps,
        executedSteps,
        verification: openChat,
        learnedEvents: [],
        failureReason: 'WHATSAPP_CHAT_OPEN_FAILED',
        evidence,
      };
    }
  }

  const currentDraft = await getMessageBoxText(tabId, deps);
  if (normalizeText(currentDraft) === normalizeText(message)) {
    addSkipped(skippedSteps, 'type_message', 'Message text already prepared', confidenceFor(true, 0.9), {
      currentDraft,
    });
  } else if (input.dryRun) {
    addExecuted(executedSteps, 'type_message', { dryRun: true, message });
    addExecuted(executedSteps, 'send_message', { dryRun: true });
    return {
      ok: true,
      status: 'DRY_RUN',
      goal: input.goal,
      detectedIntent: intent,
      initialWorldStateSummary: world,
      skippedSteps,
      executedSteps,
      verification: { ok: true, planned: true },
      learnedEvents: [],
      evidence,
    };
  } else {
    const draft = await deps.vlmPageApi.runMicroSkill(tabId, {
      skill: 'whatsapp_prepare_message',
      inputs: { message },
      stopOnFailure: true,
    });
    addExecuted(executedSteps, 'type_message', draft);
    if (!draft.ok) {
      return {
        ok: false,
        status: 'FAILED',
        goal: input.goal,
        detectedIntent: intent,
        initialWorldStateSummary: world,
        skippedSteps,
        executedSteps,
        verification: draft,
        learnedEvents: [],
        failureReason: 'WHATSAPP_MESSAGE_DRAFT_FAILED',
        evidence,
      };
    }
  }

  const beforeState = await deps.vlmPageApi.getState(tabId);
  const send = await deps.vlmPageApi.actionResolveAndAct(tabId, {
    targetKey: 'send_button',
    kind: 'button',
    action: 'click',
  });
  addExecuted(executedSteps, 'send_message', send);
  const verification = await verifyWhatsAppMessageSent(tabId, message, String(beforeState?.domHash || ''), deps);
  const finalRoom = await deps.vlmPageApi.getSiteRoom(tabId);
  const learnedEvents: Array<Record<string, unknown>> = [];

  if (send.ok && verification.ok) {
    await recordVerifiedLearning(deps, profileId, tabId, 'smart_whatsapp_send_message', 'send_button', input.goal, {
      beforeState,
      afterState: verification.afterState,
      finalRoom,
      chat: chatName,
    }, learnedEvents);
  }

  return {
    ok: Boolean(send.ok && verification.ok),
    status: send.ok && verification.ok ? 'SUCCESS' : 'FAILED',
    goal: input.goal,
    detectedIntent: intent,
    initialWorldStateSummary: world,
    skippedSteps,
    executedSteps,
    verification: {
      ok: Boolean(send.ok && verification.ok),
      sent: Boolean(send.ok && verification.ok),
      evidence: verification.evidence,
      beforeState,
      afterState: verification.afterState,
      finalRoom,
    },
    learnedEvents,
    failureReason: send.ok && verification.ok ? undefined : 'WHATSAPP_MESSAGE_NOT_VERIFIED',
    evidence,
  };
}

async function runWhatsAppFileFlow(
  input: SmartTaskInput,
  intent: SmartIntent,
  skippedSteps: Array<Record<string, unknown>>,
  executedSteps: Array<Record<string, unknown>>,
  evidence: Record<string, unknown>,
  deps: SmartTaskDeps,
  profileId: string,
): Promise<SmartTaskResult> {
  const chatName = String(intent.chatName || input.chatName || '').trim();
  const filePath = String(intent.filePath || input.filePath || '').trim();
  if (!chatName || !filePath) {
    return {
      ok: false,
      status: 'AMBIGUOUS',
      goal: input.goal,
      detectedIntent: intent,
      initialWorldStateSummary: {},
      skippedSteps,
      executedSteps,
      verification: { ok: false },
      learnedEvents: [],
      failureReason: 'WHATSAPP_CHAT_OR_FILE_MISSING',
      evidence,
    };
  }

  const policy = assertCanSendToWhatsAppChat({
    chat: chatName,
    allowExternalSend: input.allowExternalSend === true,
  });
  if (!policy.ok) {
    return {
      ok: false,
      status: 'FAILED',
      goal: input.goal,
      detectedIntent: intent,
      initialWorldStateSummary: {},
      skippedSteps,
      executedSteps,
      verification: { ok: false, policy },
      learnedEvents: [],
      failureReason: String(policy.reason || 'BLOCKED_EXTERNAL_SEND'),
      evidence,
    };
  }

  const world = await summarizeWorldState(profileId, deps);
  const tabId = await ensureSiteTab('web.whatsapp.com', profileId, 'https://web.whatsapp.com', world, skippedSteps, executedSteps, deps);
  evidence.selectedTabId = tabId;

  const initialRoom = await deps.vlmPageApi.getSiteRoom(tabId);
  if (initialRoom.room === 'whatsapp_auth') {
    return {
      ok: false,
      status: 'NEEDS_AUTH',
      goal: input.goal,
      detectedIntent: intent,
      initialWorldStateSummary: world,
      skippedSteps,
      executedSteps,
      verification: { ok: false, room: initialRoom },
      learnedEvents: [],
      failureReason: 'WHATSAPP_AUTH_REQUIRED',
      evidence,
    };
  }

  const activeChat = await deps.vlmPageApi.getWhatsAppActiveChat(tabId).catch(() => ({ ok: false, normalized: '' }));
  if (initialRoom.room === 'whatsapp_chat' && normalizeText(String(activeChat?.normalized || '')).includes(normalizeText(chatName))) {
    addSkipped(skippedSteps, 'open_chat', `Target chat ${chatName} already active`, confidenceFor(true, 0.93), activeChat);
  } else if (input.dryRun) {
    addExecuted(executedSteps, 'open_chat', { dryRun: true, chat: chatName });
    addExecuted(executedSteps, 'send_file', { dryRun: true, filePath });
    return {
      ok: true,
      status: 'DRY_RUN',
      goal: input.goal,
      detectedIntent: intent,
      initialWorldStateSummary: world,
      skippedSteps,
      executedSteps,
      verification: { ok: true, planned: true },
      learnedEvents: [],
      evidence,
    };
  } else {
    const openChat = await deps.vlmPageApi.openWhatsAppChat({ tabId, chat: chatName });
    addExecuted(executedSteps, 'open_chat', openChat);
    if (!openChat.ok) {
      return {
        ok: false,
        status: 'FAILED',
        goal: input.goal,
        detectedIntent: intent,
        initialWorldStateSummary: world,
        skippedSteps,
        executedSteps,
        verification: openChat,
        learnedEvents: [],
        failureReason: 'WHATSAPP_CHAT_OPEN_FAILED',
        evidence,
      };
    }
  }

  const previewState = await deps.vlmPageApi.getWhatsAppFilePreview(tabId, {
    fileNames: [filePath.split(/[\\/]/).pop() || filePath],
  }).catch(() => ({ ok: false }));
  if (previewState.ok) {
    addSkipped(skippedSteps, 'attach_file', 'Same file preview already visible', confidenceFor(true, 0.9), previewState);
  }

  const beforeState = await deps.vlmPageApi.getState(tabId);
  const sendFile = input.dryRun
    ? { ok: true, dryRun: true, filePath }
    : await deps.vlmPageApi.sendWhatsAppFile({
        tabId,
        chat: chatName,
        filePath,
        caption: '',
        allowExternalSend: input.allowExternalSend === true,
      });
  addExecuted(executedSteps, 'send_file', sendFile);
  const afterState = await deps.vlmPageApi.getState(tabId);
  const finalRoom = await deps.vlmPageApi.getSiteRoom(tabId);
  const learnedEvents: Array<Record<string, unknown>> = [];

  if (!input.dryRun && sendFile.ok) {
    await recordVerifiedLearning(deps, profileId, tabId, 'smart_whatsapp_send_file', 'message_box', input.goal, {
      beforeState,
      afterState,
      finalRoom,
      chat: chatName,
    }, learnedEvents);
  }

  return {
    ok: input.dryRun ? true : Boolean(sendFile.ok),
    status: input.dryRun ? 'DRY_RUN' : (sendFile.ok ? 'SUCCESS' : 'FAILED'),
    goal: input.goal,
    detectedIntent: intent,
    initialWorldStateSummary: world,
    skippedSteps,
    executedSteps,
    verification: {
      ok: input.dryRun ? true : Boolean(sendFile.ok),
      sent: input.dryRun ? false : Boolean(sendFile.ok),
      evidence: typeof (sendFile as any)?.reason === 'string' ? (sendFile as any).reason : '',
      beforeState,
      afterState,
      finalRoom,
    },
    learnedEvents,
    failureReason: input.dryRun || sendFile.ok ? undefined : 'WHATSAPP_FILE_NOT_VERIFIED',
    evidence,
  };
}

async function runChatPromptFlow(
  site: 'chatgpt' | 'gemini',
  input: SmartTaskInput,
  intent: SmartIntent,
  skippedSteps: Array<Record<string, unknown>>,
  executedSteps: Array<Record<string, unknown>>,
  evidence: Record<string, unknown>,
  deps: SmartTaskDeps,
  profileId: string,
): Promise<SmartTaskResult> {
  const prompt = String(intent.prompt || input.message || '').trim();
  if (!prompt) {
    return {
      ok: false,
      status: 'AMBIGUOUS',
      goal: input.goal,
      detectedIntent: intent,
      initialWorldStateSummary: {},
      skippedSteps,
      executedSteps,
      verification: { ok: false },
      learnedEvents: [],
      failureReason: `${site.toUpperCase()}_PROMPT_REQUIRED`,
      evidence,
    };
  }

  const url = site === 'chatgpt' ? 'https://chatgpt.com' : 'https://gemini.google.com';
  const world = await summarizeWorldState(profileId, deps);
  const host = site === 'chatgpt' ? 'chatgpt.com' : 'gemini.google.com';
  const tabId = await ensureSiteTab(host, profileId, url, world, skippedSteps, executedSteps, deps);
  evidence.selectedTabId = tabId;

  const room = await deps.vlmPageApi.getSiteRoom(tabId);
  if (`${room.room}`.endsWith('_auth')) {
    return {
      ok: false,
      status: 'NEEDS_AUTH',
      goal: input.goal,
      detectedIntent: intent,
      initialWorldStateSummary: world,
      skippedSteps,
      executedSteps,
      verification: { ok: false, room },
      learnedEvents: [],
      failureReason: `${site.toUpperCase()}_AUTH_REQUIRED`,
      evidence,
    };
  }

  if (room.room === `${site}_home` || room.room === `${site}_chat`) {
    addSkipped(skippedSteps, `open_${site}`, 'Existing prompt composer already available', confidenceFor(true, 0.94), room);
  }

  if (input.dryRun) {
    addExecuted(executedSteps, `send_${site}_prompt`, { dryRun: true, prompt });
    return {
      ok: true,
      status: 'DRY_RUN',
      goal: input.goal,
      detectedIntent: intent,
      initialWorldStateSummary: world,
      skippedSteps,
      executedSteps,
      verification: { ok: true, planned: true },
      learnedEvents: [],
      evidence,
    };
  }

  const beforeState = await deps.vlmPageApi.getState(tabId);
  const skillName = site === 'chatgpt' ? 'chatgpt_send_prompt' : 'gemini_send_prompt';
  const sendPrompt = await deps.vlmPageApi.runMicroSkill(tabId, {
    skill: skillName,
    inputs: { prompt },
    stopOnFailure: true,
  });
  addExecuted(executedSteps, `send_${site}_prompt`, sendPrompt);

  const responseTargetKey = site === 'chatgpt' ? 'last_user_message' : 'last_user_message';
  const verificationTarget = site === 'chatgpt' ? 'last_assistant_message' : 'last_model_response';
  let userMessageFound = await deps.vlmPageApi.resolveTarget(tabId, {
    targetKey: responseTargetKey,
    kind: 'card',
  }).catch(() => ({ found: false }));
  let responseFound = await deps.vlmPageApi.resolveTarget(tabId, {
    targetKey: verificationTarget,
    kind: 'card',
  }).catch(() => ({ found: false }));

  if (!responseFound?.found) {
    await sleep(1200);
    responseFound = await deps.vlmPageApi.resolveTarget(tabId, {
      targetKey: verificationTarget,
      kind: 'card',
    }).catch(() => ({ found: false }));
    userMessageFound = await deps.vlmPageApi.resolveTarget(tabId, {
      targetKey: responseTargetKey,
      kind: 'card',
    }).catch(() => ({ found: false }));
  }

  const afterState = await deps.vlmPageApi.getState(tabId);
  const finalRoom = await deps.vlmPageApi.getSiteRoom(tabId);
  const learnedEvents: Array<Record<string, unknown>> = [];
  const ok = Boolean(sendPrompt.ok && (userMessageFound?.found || responseFound?.found));

  if (ok) {
    await recordVerifiedLearning(deps, profileId, tabId, `smart_${site}_prompt`, 'prompt_box', input.goal, {
      beforeState,
      afterState,
      finalRoom,
      prompt,
    }, learnedEvents);
  }

  return {
    ok,
    status: ok ? 'SUCCESS' : 'FAILED',
    goal: input.goal,
    detectedIntent: intent,
    initialWorldStateSummary: world,
    skippedSteps,
    executedSteps,
    verification: {
      ok,
      evidence: ok ? 'Prompt sent and conversation state updated' : 'Prompt verification failed',
      beforeState,
      afterState,
      finalRoom,
      userMessageFound,
      responseFound,
    },
    learnedEvents,
    failureReason: ok ? undefined : `${site.toUpperCase()}_PROMPT_NOT_VERIFIED`,
    evidence,
  };
}

async function runGitHubIssuesFlow(
  input: SmartTaskInput,
  intent: SmartIntent,
  skippedSteps: Array<Record<string, unknown>>,
  executedSteps: Array<Record<string, unknown>>,
  evidence: Record<string, unknown>,
  deps: SmartTaskDeps,
  profileId: string,
): Promise<SmartTaskResult> {
  const world = await summarizeWorldState(profileId, deps);
  const repoTab = world.tabs.find((tab) => tab.room === 'github_repo' || tab.room === 'github_issues');

  if (!repoTab) {
    return {
      ok: false,
      status: 'AMBIGUOUS',
      goal: input.goal,
      detectedIntent: intent,
      initialWorldStateSummary: world,
      skippedSteps,
      executedSteps,
      verification: { ok: false },
      learnedEvents: [],
      failureReason: 'NO_GITHUB_REPO_CONTEXT',
      evidence,
    };
  }

  deps.tabManager.focusTab(repoTab.tabId);
  evidence.selectedTabId = repoTab.tabId;
  if (repoTab.room === 'github_issues') {
    addSkipped(skippedSteps, 'open_github_issues', 'Already on GitHub Issues page', confidenceFor(true, 0.98), repoTab);
    return {
      ok: true,
      status: 'SUCCESS',
      goal: input.goal,
      detectedIntent: intent,
      initialWorldStateSummary: world,
      skippedSteps,
      executedSteps,
      verification: { ok: true, evidence: 'Issues page already open', finalRoom: repoTab.room },
      learnedEvents: [],
      evidence,
    };
  }

  addSkipped(skippedSteps, 'open_github_repo', 'Existing GitHub repo tab found', confidenceFor(true, 0.94), repoTab);
  if (input.dryRun) {
    addExecuted(executedSteps, 'open_github_issues', { dryRun: true });
    return {
      ok: true,
      status: 'DRY_RUN',
      goal: input.goal,
      detectedIntent: intent,
      initialWorldStateSummary: world,
      skippedSteps,
      executedSteps,
      verification: { ok: true, planned: true },
      learnedEvents: [],
      evidence,
    };
  }

  const beforeState = await deps.vlmPageApi.getState(repoTab.tabId);
  const openIssues = await deps.vlmPageApi.runMicroSkill(repoTab.tabId, {
    skill: 'github_open_issues',
    inputs: {},
    stopOnFailure: true,
  });
  addExecuted(executedSteps, 'open_github_issues', openIssues);
  const finalRoom = await deps.vlmPageApi.getSiteRoom(repoTab.tabId);
  const afterState = await deps.vlmPageApi.getState(repoTab.tabId);
  const learnedEvents: Array<Record<string, unknown>> = [];
  const ok = Boolean(openIssues.ok && finalRoom.room === 'github_issues');

  if (ok) {
    await recordVerifiedLearning(deps, profileId, repoTab.tabId, 'smart_github_open_issues', 'repo_issues_link', input.goal, {
      beforeState,
      afterState,
      finalRoom,
    }, learnedEvents);
  }

  return {
    ok,
    status: ok ? 'SUCCESS' : 'FAILED',
    goal: input.goal,
    detectedIntent: intent,
    initialWorldStateSummary: world,
    skippedSteps,
    executedSteps,
    verification: {
      ok,
      evidence: ok ? 'GitHub Issues page detected' : 'GitHub Issues verification failed',
      beforeState,
      afterState,
      finalRoom,
    },
    learnedEvents,
    failureReason: ok ? undefined : 'GITHUB_ISSUES_NOT_VERIFIED',
    evidence,
  };
}

export async function runSmartTask(
  input: SmartTaskInput,
  deps?: SmartTaskDeps,
): Promise<SmartTaskResult> {
  const resolvedDeps = deps || await getDefaultDeps();
  const goal = String(input.goal || '').trim();
  if (!goal) {
    throw new Error('SMART_TASK_GOAL_REQUIRED');
  }

  const profileId = input.profileId
    ? resolvedDeps.profileStore.resolveId(input.profileId)
    : resolvedDeps.profileStore.getActiveId();

  if (input.profileId && resolvedDeps.profileStore.getActiveId() !== profileId) {
    resolvedDeps.profileStore.setActive(profileId);
  }

  const intent = parseSmartTaskIntent(input);
  const skippedSteps: Array<Record<string, unknown>> = [];
  const executedSteps: Array<Record<string, unknown>> = [];
  const evidence: Record<string, unknown> = {
    requestedInput: {
      goal,
      profileId,
      site: input.site || null,
      chatName: input.chatName || null,
      filePath: input.filePath || null,
      dryRun: input.dryRun === true,
    },
  };

  if (intent.type === 'unknown') {
    return {
      ok: false,
      status: 'AMBIGUOUS',
      goal,
      detectedIntent: intent,
      initialWorldStateSummary: {},
      skippedSteps,
      executedSteps,
      verification: { ok: false },
      learnedEvents: [],
      failureReason: 'SMART_INTENT_NOT_RECOGNIZED',
      evidence,
    };
  }

  if (intent.type === 'whatsapp_send_message') {
    return await runWhatsAppMessageFlow(input, intent, skippedSteps, executedSteps, evidence, resolvedDeps, profileId);
  }

  if (intent.type === 'whatsapp_send_file') {
    return await runWhatsAppFileFlow(input, intent, skippedSteps, executedSteps, evidence, resolvedDeps, profileId);
  }

  if (intent.type === 'chatgpt_prompt') {
    return await runChatPromptFlow('chatgpt', input, intent, skippedSteps, executedSteps, evidence, resolvedDeps, profileId);
  }

  if (intent.type === 'gemini_prompt') {
    return await runChatPromptFlow('gemini', input, intent, skippedSteps, executedSteps, evidence, resolvedDeps, profileId);
  }

  if (intent.type === 'github_open_issues') {
    return await runGitHubIssuesFlow(input, intent, skippedSteps, executedSteps, evidence, resolvedDeps, profileId);
  }

  return {
    ok: false,
    status: 'AMBIGUOUS',
    goal,
    detectedIntent: intent,
    initialWorldStateSummary: {},
    skippedSteps,
    executedSteps,
    verification: { ok: false },
    learnedEvents: [],
    failureReason: 'SMART_TASK_NOT_IMPLEMENTED',
    evidence,
  };
}
