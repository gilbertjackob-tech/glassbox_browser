import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import db from '../main/memoryDb.js';
import { normalizeUrl } from '../lib/urlUtils.js';
import { tabManager } from './tabManager.js';
import {
  canonicalTargetKey,
  listTargetMemory,
  markTargetMemoryFailure,
  rememberSuccessfulTarget,
  targetMatchesKey,
} from './targetMemoryService.js';
import { resolveFromStarterPack } from './sitePackResolver.js';
import {
  getMicroSkill,
  markMicroSkillResult,
  parseSkillSteps,
  renderSkillSteps,
  saveMicroSkill,
} from './skillService.js';
import { detectSiteRoom } from './siteRooms/index.js';
import { getYouTubeRoomSuggestions } from './siteRooms/suggestions.js';

type TabMetadata = NonNullable<ReturnType<typeof tabManager.getTab>>;

interface ResolvedPoint {
  x: number;
  y: number;
  selector?: string;
  xpath?: string;
}

type ActionTarget = {
  targetId: string;
  kind: string;
  label: string;
  selector: string;
  bbox: { x: number; y: number; width: number; height: number };
  visible: boolean;
  enabled: boolean;
  actions: string[];
  text: string;
};

type ActionTargetSnapshot = {
  tabId: string;
  url: string;
  title: string;
  stateHash: string;
  targets: ActionTarget[];
  capturedAt: number;
};

const actionTargetCache = new Map<string, ActionTargetSnapshot>();

type PageStateSnapshot = {
  url: string;
  title: string;
  readyState: string;
  loading: boolean;
  domHash: string;
  activeElement: {
    tag: string | null;
    selector: string | null;
    value: string | null;
  };
};

function getTabOrThrow(tabId: string) {
  const tab = tabManager.getTab(tabId);
  if (!tab) {
    throw new Error('TAB_NOT_FOUND');
  }
  return tab;
}

function pageScript(fn: (...args: any[]) => any, args: any[] = []) {
  return `(${fn.toString()})(...${JSON.stringify(args)})`;
}

async function runInPage<T>(tab: TabMetadata, fn: (...args: any[]) => T, args: any[] = []): Promise<T> {
  return await tab.webContents.executeJavaScript(pageScript(fn, args), true);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getDomHash(tab: TabMetadata): Promise<string> {
  if (tab.domHash) {
    return tab.domHash;
  }

  try {
    const html = await tab.webContents.executeJavaScript(
      'document.documentElement.outerHTML',
      true
    );

    return createHash('sha256').update(String(html || '')).digest('hex');
  } catch {
    return 'unavailable';
  }
}

async function collectActionEvidence(
  tab: TabMetadata,
  before?: { url: string; domHash: string },
  extra: Record<string, unknown> = {}
) {
  return {
    beforeUrl: before?.url ?? null,
    afterUrl: tab.webContents.getURL(),
    beforeDomHash: before?.domHash ?? null,
    afterDomHash: await getDomHash(tab),
    ...extra,
  };
}

async function logAction(tab: TabMetadata, type: string, target: unknown, value: unknown, success: boolean, reason: string, evidence: any) {
  try {
    db.prepare(`
      INSERT INTO actions (
        id,
        tab_id,
        profile_id,
        type,
        target,
        value,
        success,
        reason,
        before_url,
        after_url,
        before_dom_hash,
        after_dom_hash,
        evidence_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      tab.id,
      tab.profileId,
      type,
      target == null ? null : JSON.stringify(target),
      value == null ? null : String(value),
      success ? 1 : 0,
      reason || '',
      evidence?.beforeUrl ?? null,
      evidence?.afterUrl ?? null,
      evidence?.beforeDomHash ?? null,
      evidence?.afterDomHash ?? null,
      JSON.stringify(evidence || {})
    );
  } catch (error) {
    console.warn('Failed to log VLM action', error);
  }
}

async function resolvePoint(tab: TabMetadata, body: any): Promise<ResolvedPoint> {
  if (Number.isFinite(body?.x) && Number.isFinite(body?.y)) {
    return { x: Math.round(body.x), y: Math.round(body.y) };
  }

  const selector = typeof body?.selector === 'string' ? body.selector : undefined;
  const xpath = typeof body?.xpath === 'string' ? body.xpath : undefined;
  if (!selector && !xpath) {
    throw new Error('TARGET_REQUIRED');
  }

  const point = await runInPage(tab, (target: { selector?: string; xpath?: string }) => {
    function firstByXPath(expression: string) {
      return document.evaluate(expression, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue as Element | null;
    }

    const el = target.selector
      ? document.querySelector(target.selector)
      : firstByXPath(target.xpath || '');

    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };
  }, [{ selector, xpath }]);

  if (!point) {
    throw new Error('ELEMENT_NOT_FOUND');
  }

  return { ...point, selector, xpath };
}

function keyForElectron(key: string) {
  const aliases: Record<string, string> = {
    Enter: 'Enter',
    Tab: 'Tab',
    Escape: 'Escape',
    Esc: 'Escape',
    Backspace: 'Backspace',
    Delete: 'Delete',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
  };

  return aliases[key] || key;
}

async function getTargetSnapshot(tabId: string): Promise<ActionTargetSnapshot> {
  const cached = actionTargetCache.get(tabId);
  if (cached && Date.now() - cached.capturedAt < 5000) {
    return cached;
  }
  return await vlmPageApi.actionTargets(tabId) as ActionTargetSnapshot;
}

async function verifyTargetInPage(tab: TabMetadata, target: ActionTarget) {
  return await runInPage(tab, (selector: string) => {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) {
      return {
        ok: false,
        reason: 'ELEMENT_NOT_FOUND',
      };
    }

    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);

    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= window.innerHeight &&
      rect.left <= window.innerWidth &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      !el.hidden;

    const enabled =
      !(el as any).disabled &&
      style.pointerEvents !== 'none' &&
      el.getAttribute('aria-disabled') !== 'true';

    return {
      ok: visible && enabled,
      reason: !visible ? 'ELEMENT_NOT_VISIBLE' : !enabled ? 'ELEMENT_DISABLED' : 'OK',
      bbox: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      value: (el as HTMLInputElement).value ?? '',
      text: (el.innerText || el.textContent || '').trim().slice(0, 300),
    };
  }, [target.selector]);
}

async function scrollTargetIntoView(tab: TabMetadata, selector: string) {
  return await runInPage(tab, (targetSelector: string) => {
    const el = document.querySelector(targetSelector) as HTMLElement | null;
    if (!el) return false;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    return true;
  }, [selector]);
}

async function verifyTargetWithVisibilityRecovery(
  tab: TabMetadata,
  target: ActionTarget,
  action: string
) {
  let verification = await verifyTargetInPage(tab, target);
  let recoveredByScroll = false;

  if (!verification.ok && verification.reason === 'ELEMENT_NOT_VISIBLE' && action === 'click') {
    const scrolled = await scrollTargetIntoView(tab, target.selector).catch(() => false);
    if (scrolled) {
      await sleep(180);
      verification = await verifyTargetInPage(tab, target);
      recoveredByScroll = verification.ok;
    }
  }

  return {
    verification,
    recoveredByScroll,
  };
}

async function getPageStateSnapshot(tab: TabMetadata): Promise<PageStateSnapshot> {
  const pageState = await runInPage(tab, () => {
    function selectorFor(el: Element | null): string | null {
      if (!el) return null;
      if ((el as HTMLElement).id) {
        return `#${CSS.escape((el as HTMLElement).id)}`;
      }

      const htmlEl = el as HTMLElement;
      const name = htmlEl.getAttribute('name');
      if (name) return `${el.tagName.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`;

      const ariaLabel = htmlEl.getAttribute('aria-label');
      if (ariaLabel) return `${el.tagName.toLowerCase()}[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`;

      const parent = el.parentElement;
      if (!parent) return el.tagName.toLowerCase();
      const sameTag = Array.from(parent.children).filter((child) => child.tagName === el.tagName);
      const index = sameTag.indexOf(el) + 1;
      return `${el.tagName.toLowerCase()}:nth-of-type(${Math.max(1, index)})`;
    }

    const active = document.activeElement as HTMLElement | null;
    const activeValue = active && 'value' in active ? String((active as HTMLInputElement).value ?? '') : null;
    return {
      title: document.title || '',
      readyState: document.readyState || 'unknown',
      activeElement: {
        tag: active?.tagName?.toLowerCase() ?? null,
        selector: selectorFor(active),
        value: activeValue,
      },
    };
  });

  return {
    url: tab.webContents.getURL(),
    title: pageState.title,
    readyState: pageState.readyState,
    loading: tab.webContents.isLoading(),
    domHash: await getDomHash(tab),
    activeElement: pageState.activeElement,
  };
}

async function waitForPageStable(tab: TabMetadata, timeoutMs = 1000, quietMs = 300) {
  const started = Date.now();
  let lastMarker = '';
  let lastChangeAt = Date.now();

  while (Date.now() - started < timeoutMs) {
    const snapshot = await runInPage(tab, () => ({
      readyState: document.readyState,
      url: location.href,
      marker: `${document.readyState}|${location.href}|${document.title}|${document.documentElement?.innerHTML?.length ?? 0}`,
    }));
    const loading = tab.webContents.isLoading();

    if (snapshot.marker !== lastMarker) {
      lastMarker = snapshot.marker;
      lastChangeAt = Date.now();
    }

    const quietFor = Date.now() - lastChangeAt;
    if (!loading && snapshot.readyState === 'complete' && quietFor >= quietMs) {
      return { loadingStable: true, elapsedMs: Date.now() - started };
    }

    await sleep(100);
  }

  return { loadingStable: false, elapsedMs: Date.now() - started };
}

async function buildActionVerification(
  tab: TabMetadata,
  before: { url: string; domHash: string },
  options: { beforeValue?: string | null; expectFocusSelector?: string | null } = {}
) {
  const stable = await waitForPageStable(tab);
  const after = await getPageStateSnapshot(tab);
  const beforeValue = options.beforeValue ?? null;
  const afterValue = after.activeElement.value ?? null;
  const focusSelector = options.expectFocusSelector ?? null;

  return {
    urlChanged: before.url !== after.url,
    domChanged: before.domHash !== after.domHash,
    valueChanged: beforeValue !== null ? beforeValue !== afterValue : null,
    focusConfirmed: focusSelector ? after.activeElement.selector === focusSelector : null,
    loadingStable: stable.loadingStable,
    stableElapsedMs: stable.elapsedMs,
    beforeValue,
    afterValue,
  };
}

async function resolveMemorySelectorOnPage(tab: TabMetadata, selector: string) {
  return await runInPage(tab, (targetSelector: string) => {
    let el: HTMLElement | null = null;

    try {
      el = document.querySelector(targetSelector) as HTMLElement | null;
    } catch {
      return {
        found: false,
        reason: 'INVALID_SELECTOR',
      };
    }

    if (!el) {
      return {
        found: false,
        reason: 'ELEMENT_NOT_FOUND',
      };
    }

    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);

    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= window.innerHeight &&
      rect.left <= window.innerWidth &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      !el.hidden;

    const enabled =
      !(el as any).disabled &&
      !(el as any).readOnly &&
      style.pointerEvents !== 'none' &&
      el.getAttribute('aria-disabled') !== 'true';

    const label =
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      (el.innerText || el.textContent || '').trim();

    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const type = ((el as HTMLInputElement).type || '').toLowerCase();

    let kind = 'card';
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || role === 'textbox' || role === 'searchbox') {
      kind = 'input';
    } else if (tag === 'button' || role === 'button' || type === 'button' || type === 'submit') {
      kind = 'button';
    } else if (tag === 'a' || role === 'link') {
      kind = 'link';
    }

    const actions = !enabled ? [] : kind === 'input' ? ['focus', 'type', 'clear'] : ['click'];

    return {
      found: visible && enabled,
      reason: !visible ? 'ELEMENT_NOT_VISIBLE' : !enabled ? 'ELEMENT_DISABLED' : 'OK',
      target: {
        kind,
        label: String(label || '').slice(0, 240),
        selector: targetSelector,
        bbox: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        visible,
        enabled,
        actions,
        text: (el.innerText || el.textContent || '').trim().slice(0, 300),
      },
    };
  }, [selector]);
}

function checkExpectedVerification(result: any, expected: any = {}) {
  const verification = result?.verification || {};
  const failures: string[] = [];

  function checkBool(key: string) {
    if (typeof expected[key] === 'boolean' && verification[key] !== expected[key]) {
      failures.push(`${key}_EXPECTED_${expected[key]}_GOT_${verification[key]}`);
    }
  }

  checkBool('urlChanged');
  checkBool('domChanged');
  checkBool('valueChanged');
  checkBool('focusConfirmed');
  checkBool('loadingStable');

  if (typeof expected.urlIncludes === 'string' && expected.urlIncludes) {
    const actualUrl = String(result?.evidence?.afterUrl || result?.afterUrl || '');
    if (!actualUrl.includes(expected.urlIncludes)) {
      failures.push(`URL_DOES_NOT_INCLUDE_${expected.urlIncludes}`);
    }
  }

  if (typeof expected.titleIncludes === 'string' && expected.titleIncludes) {
    const actualTitle = String(result?.state?.title || result?.title || '');
    if (!actualTitle.toLowerCase().includes(expected.titleIncludes.toLowerCase())) {
      failures.push(`TITLE_DOES_NOT_INCLUDE_${expected.titleIncludes}`);
    }
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

export const vlmPageApi = {
  async getState(tabId: string) {
    const tab = getTabOrThrow(tabId);
    return await getPageStateSnapshot(tab);
  },

  async getSiteRoom(tabId: string) {
    const tab = getTabOrThrow(tabId);
    const url = tab.webContents.getURL();
    const title = tab.title;

    const result = await detectSiteRoom({
      url,
      title,
      resolveTarget: async (targetKey: string, kind?: string) => {
        return await this.resolveTarget(tabId, {
          targetKey,
          kind,
        });
      },
      evaluate: async (script: string) => {
        return await this.evaluate(tabId, { script });
      },
    });

    if (!result) {
      return {
        ok: false,
        host: (() => {
          try {
            return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
          } catch {
            return 'unknown';
          }
        })(),
        site: 'unknown',
        room: 'unknown',
        confidence: 0,
        url,
        title,
        signals: {},
        landmarks: [],
        reason: 'NO_SITE_ROOM_DETECTOR',
      };
    }

    return result;
  },

  async getSiteRoomSuggestions(tabId: string) {
    const room = await this.getSiteRoom(tabId);

    if (!room.ok) {
      return {
        ok: false,
        room,
        suggestions: [],
        reason: room.reason || 'ROOM_NOT_DETECTED',
      };
    }

    if (room.site === 'youtube') {
      return {
        ok: true,
        site: room.site,
        room: room.room,
        confidence: room.confidence,
        url: room.url,
        suggestions: getYouTubeRoomSuggestions(room),
        landmarks: room.landmarks,
      };
    }

    return {
      ok: true,
      site: room.site,
      room: room.room,
      confidence: room.confidence,
      url: room.url,
      suggestions: [],
      landmarks: room.landmarks,
    };
  },

  async resolveTarget(tabId: string, body: any) {
    const tab = getTabOrThrow(tabId);

    const rawTargetKey =
      typeof body?.targetKey === 'string'
        ? body.targetKey
        : typeof body?.query === 'string'
          ? body.query
          : typeof body?.description === 'string'
            ? body.description
            : '';

    if (!rawTargetKey) {
      throw new Error('TARGET_KEY_REQUIRED');
    }

    const targetKey = canonicalTargetKey(rawTargetKey);
    const requestedKind = typeof body?.kind === 'string' ? body.kind.toLowerCase() : undefined;
    const host = (() => {
      try {
        return new URL(tab.webContents.getURL()).hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        return 'unknown';
      }
    })();

    const attempts: any[] = [];

    const memoryCandidates = (listTargetMemory(tab.profileId, host) as any[])
      .filter((memory) => memory.target_key === targetKey)
      .sort((a, b) => {
        const confidenceDelta = Number(b.confidence || 0) - Number(a.confidence || 0);
        if (confidenceDelta !== 0) return confidenceDelta;
        return Number(b.success_count || 0) - Number(a.success_count || 0);
      });

    for (const memory of memoryCandidates) {
      const resolved = await resolveMemorySelectorOnPage(tab, memory.selector);

      attempts.push({
        source: 'memory',
        selector: memory.selector,
        targetKey: memory.target_key,
        found: resolved.found,
        reason: resolved.reason,
        confidence: memory.confidence,
      });

      if (resolved.found && resolved.target) {
        if (requestedKind && resolved.target.kind !== requestedKind) {
          continue;
        }

        return {
          found: true,
          source: 'memory',
          targetKey,
          host,
          target: {
            targetId: `memory_${targetKey}`,
            ...resolved.target,
          },
          memory: {
            id: memory.id,
            confidence: memory.confidence,
            success_count: memory.success_count,
            failure_count: memory.failure_count,
            last_worked: memory.last_worked,
          },
          attempts,
        };
      }

      if (resolved.reason === 'ELEMENT_NOT_FOUND' || resolved.reason === 'ELEMENT_NOT_VISIBLE' || resolved.reason === 'ELEMENT_DISABLED') {
        markTargetMemoryFailure(memory.id);
      }
    }

    const starterPackResult = await resolveFromStarterPack({
      tabUrl: tab.webContents.getURL(),
      targetKey,
      kind: requestedKind,
      runQuery: async (selector: string) => {
        return await this.query(tabId, {
          selector,
          limit: 1,
        });
      },
    });

    attempts.push({
      source: 'starter_pack',
      found: starterPackResult.found,
      reason: starterPackResult.reason,
      host: (starterPackResult as any).host,
    });

    if (starterPackResult.found) {
      return {
        found: true,
        source: 'starter_pack',
        targetKey,
        host,
        target: starterPackResult.target,
        starterTarget: (starterPackResult as any).starterTarget,
        attempts,
      };
    }

    const snapshot = await this.actionTargets(tabId);
    const targets = Array.isArray(snapshot.targets) ? snapshot.targets : [];

    const match = targets.find((target) =>
      target.visible &&
      target.enabled &&
      targetMatchesKey(target, targetKey, requestedKind)
    );

    if (match) {
      return {
        found: true,
        source: 'scan',
        targetKey,
        host,
        target: match,
        stateHash: snapshot.stateHash,
        fallbackReason: memoryCandidates.length > 0 ? 'MEMORY_NOT_RESOLVED' : 'NO_MEMORY_FOR_TARGET_KEY',
        attempts,
      };
    }

    return {
      found: false,
      targetKey,
      host,
      reason: 'TARGET_NOT_FOUND',
      attempts,
      scannedTargetCount: targets.length,
    };
  },

  async getHtml(tabId: string) {
    const tab = getTabOrThrow(tabId);
    const html = await runInPage(tab, () => document.documentElement.outerHTML);
    return {
      tabId,
      url: tab.webContents.getURL(),
      title: tab.title,
      html,
      capturedAt: Date.now(),
    };
  },

  async query(tabId: string, body: any) {
    const tab = getTabOrThrow(tabId);
    const selector = typeof body?.selector === 'string' ? body.selector : '';
    const xpath = typeof body?.xpath === 'string' ? body.xpath : '';
    const limit = Math.max(1, Math.min(Number(body?.limit) || 10, 200));
    if (!selector && !xpath) {
      throw new Error('SELECTOR_OR_XPATH_REQUIRED');
    }

    const elements: any = await runInPage(tab, (input: { selector: string; xpath: string; limit: number }) => {
      function allByXPath(expression: string) {
        const result = document.evaluate(expression, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        return Array.from({ length: Math.min(result.snapshotLength, input.limit) }, (_, index) => result.snapshotItem(index) as Element).filter(Boolean);
      }

      let matches: Element[] = [];

      try {
        matches = input.selector
          ? Array.from(document.querySelectorAll(input.selector)).slice(0, input.limit)
          : allByXPath(input.xpath);
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
          elements: [],
        };
      }

      return matches.map((el, index) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const attrs: Record<string, string> = {};
        for (const attr of Array.from(el.attributes || [])) {
          attrs[attr.name] = attr.value;
        }

        const inputEl = el as HTMLInputElement;
        const visible = rect.width > 0 && rect.height > 0 && !(el as HTMLElement).hidden && style.display !== 'none' && style.visibility !== 'hidden';
        const interactable = visible
          && !(inputEl as any).disabled
          && !(inputEl as any).readOnly
          && el.getAttribute('aria-disabled') !== 'true'
          && style.pointerEvents !== 'none';

        return {
          index,
          tag: el.tagName,
          text: (el.textContent || '').trim().slice(0, 500),
          attributes: attrs,
          bbox: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          visible,
          interactable,
        };
      });
    }, [{ selector, xpath, limit }]);

    if ((elements as any)?.error) {
      throw new Error(`QUERY_FAILED: ${(elements as any).error}`);
    }

    return {
      selector: selector || undefined,
      xpath: xpath || undefined,
      count: Array.isArray(elements) ? elements.length : 0,
      elements,
    };
  },

  async actionTargets(tabId: string) {
    const tab = getTabOrThrow(tabId);

    const targets = await runInPage(tab, () => {
      function visible(rect: DOMRect, style: CSSStyleDeclaration, el: HTMLElement) {
        if (rect.width <= 0 || rect.height <= 0) return false;
        if (rect.bottom < 0 || rect.right < 0) return false;
        if (rect.top > window.innerHeight || rect.left > window.innerWidth) return false;
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        if (el.hidden) return false;
        return true;
      }

      function clipRect(rect: DOMRect) {
        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        const right = Math.min(window.innerWidth, rect.right);
        const bottom = Math.min(window.innerHeight, rect.bottom);
        return {
          x: Math.round(left),
          y: Math.round(top),
          width: Math.round(Math.max(0, right - left)),
          height: Math.round(Math.max(0, bottom - top)),
        };
      }

      function selectorFor(el: HTMLElement) {
        if (el.id) return `#${CSS.escape(el.id)}`;

        const name = el.getAttribute('name');
        if (name) return `${el.tagName.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`;

        const aria = el.getAttribute('aria-label');
        if (aria) return `${el.tagName.toLowerCase()}[aria-label="${aria.replace(/"/g, '\\"')}"]`;

        const placeholder = el.getAttribute('placeholder');
        if (placeholder) return `${el.tagName.toLowerCase()}[placeholder="${placeholder.replace(/"/g, '\\"')}"]`;

        const role = el.getAttribute('role');
        if (role) return `${el.tagName.toLowerCase()}[role="${role.replace(/"/g, '\\"')}"]`;

        const parent = el.parentElement;
        if (!parent) return el.tagName.toLowerCase();

        const sameTag = Array.from(parent.children).filter((child) => child.tagName === el.tagName);
        const idx = sameTag.indexOf(el) + 1;
        return `${el.tagName.toLowerCase()}:nth-of-type(${Math.max(1, idx)})`;
      }

      function kindFor(el: HTMLElement) {
        const tag = el.tagName.toLowerCase();
        const role = (el.getAttribute('role') || '').toLowerCase();
        const type = ((el as HTMLInputElement).type || '').toLowerCase();

        if (tag === 'input' || tag === 'textarea' || tag === 'select' || role === 'textbox' || role === 'searchbox') {
          return 'input';
        }
        if (tag === 'button' || role === 'button' || type === 'button' || type === 'submit') {
          return 'button';
        }
        if (tag === 'a' || role === 'link') {
          return 'link';
        }
        return 'card';
      }

      function actionsFor(el: HTMLElement, kind: string, isEnabled: boolean) {
        if (!isEnabled) return [];
        if (kind === 'input') return ['focus', 'type', 'clear'];
        if (kind === 'button' || kind === 'link') return ['click'];
        return ['click'];
      }

      function labelFor(el: HTMLElement) {
        const aria = el.getAttribute('aria-label');
        const placeholder = el.getAttribute('placeholder');
        const title = el.getAttribute('title');
        const text = (el.innerText || el.textContent || '').trim();
        return (aria || placeholder || title || text || '').slice(0, 240);
      }

      const selector = [
        'input',
        'textarea',
        'select',
        'button',
        'a',
        '[role="button"]',
        '[role="link"]',
        '[role="textbox"]',
        '[role="searchbox"]',
        '[aria-label]',
        '[placeholder]',
        '[title]',
        '[contenteditable="true"]',
        'article',
        '[role="article"]',
        '[role="listitem"]',
        '.card',
      ].join(',');

      const elements = Array.from(document.querySelectorAll(selector))
        .filter((node) => node instanceof HTMLElement)
        .map((node) => node as HTMLElement)
        .slice(0, 1200);

      let serial = 1;
      const targets = elements
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const isVisible = visible(rect, style, el);
          const isEnabled = !(el as any).disabled && style.pointerEvents !== 'none' && el.getAttribute('aria-disabled') !== 'true';
          if (!isVisible) return null;

          const kind = kindFor(el);
          const label = labelFor(el);
          if (!label && kind === 'card') return null;

          return {
            targetId: `t_${serial++}`,
            kind,
            label: label || `${kind}:${el.tagName.toLowerCase()}`,
            selector: selectorFor(el),
            bbox: clipRect(rect),
            visible: isVisible,
            enabled: isEnabled,
            actions: actionsFor(el, kind, isEnabled),
            text: (el.innerText || el.textContent || '').trim().slice(0, 300),
          };
        })
        .filter(Boolean)
        .slice(0, 400);

      return targets;
    });

    const snapshot: ActionTargetSnapshot = {
      tabId,
      url: tab.webContents.getURL(),
      title: tab.title,
      stateHash: await getDomHash(tab),
      targets: targets as ActionTarget[],
      capturedAt: Date.now(),
    };

    actionTargetCache.set(tabId, snapshot);
    return snapshot;
  },

  async actionByTarget(tabId: string, body: any) {
    const tab = getTabOrThrow(tabId);
    const targetId = typeof body?.targetId === 'string' ? body.targetId : '';
    const action = typeof body?.action === 'string' ? body.action : '';

    if (!targetId) {
      throw new Error('TARGET_ID_REQUIRED');
    }
    if (!action) {
      throw new Error('ACTION_REQUIRED');
    }

    const allowedActions = new Set(['click', 'type', 'focus', 'clear', 'press']);
    if (!allowedActions.has(action)) {
      throw new Error('UNSUPPORTED_TARGET_ACTION');
    }

    const before = {
      url: tab.webContents.getURL(),
      domHash: await getDomHash(tab),
    };

    const snapshot = await getTargetSnapshot(tabId);
    if (typeof body?.stateHash === 'string' && body.stateHash && body.stateHash !== snapshot.stateHash) {
      return {
        ok: false,
        reason: 'STATE_CHANGED',
        needsRefresh: true,
        currentStateHash: snapshot.stateHash,
        providedStateHash: body.stateHash,
      };
    }

    const target = snapshot.targets.find((item) => item.targetId === targetId);
    if (!target) {
      return {
        ok: false,
        reason: 'TARGET_ID_NOT_FOUND',
        needsRefresh: true,
        stateHash: snapshot.stateHash,
      };
    }

    if (!target.enabled || !target.visible) {
      return {
        ok: false,
        reason: !target.visible ? 'TARGET_NOT_VISIBLE' : 'TARGET_DISABLED',
        target,
        stateHash: snapshot.stateHash,
      };
    }

    const { verification, recoveredByScroll } = await verifyTargetWithVisibilityRecovery(tab, target, action);
    if (!verification.ok) {
      return {
        ok: false,
        reason: verification.reason,
        target,
        stateHash: snapshot.stateHash,
        recoveredByScroll,
      };
    }

    const beforeValue = typeof verification.value === 'string' ? verification.value : null;
    const focusSelector = target.selector;

    if (action === 'click') {
      const result = await this.click(tabId, {
        selector: target.selector,
      });
      const actionVerification = await buildActionVerification(tab, before, {
        beforeValue,
        expectFocusSelector: focusSelector,
      });
      const memoryRecord = rememberSuccessfulTarget({
        profileId: tab.profileId,
        url: tab.webContents.getURL(),
        action,
        target,
        verification: actionVerification,
      });

      const evidence = await collectActionEvidence(tab, before, {
        targetId,
        action,
        target,
        verification,
        recoveredByScroll,
        clickResult: result,
        actionVerification,
      });

      await logAction(tab, 'target.click', { targetId, selector: target.selector }, null, true, 'TARGET_CLICK_SENT', evidence);
      return {
        ok: true,
        action,
        targetId,
        target,
        result,
        verification: actionVerification,
        memoryRecord,
        evidence,
      };
    }

    if (action === 'type') {
      const text = typeof body?.text === 'string' ? body.text : '';
      const keys = Array.isArray(body?.keys) ? body.keys.filter((key: unknown) => typeof key === 'string') : [];
      if (!text && keys.length === 0) {
        throw new Error('TEXT_OR_KEYS_REQUIRED');
      }

      const result = await this.type(tabId, {
        selector: target.selector,
        text,
        keys,
        clearFirst: Boolean(body?.clearFirst),
        targetType: body?.targetType,
      });

      const afterValue = await runInPage(tab, (selector: string) => {
        const el = document.querySelector(selector) as HTMLInputElement | null;
        return el ? (el.value ?? '') : null;
      }, [target.selector]).catch(() => null);
      const actionVerification = await buildActionVerification(tab, before, {
        beforeValue,
        expectFocusSelector: focusSelector,
      });
      const memoryRecord = rememberSuccessfulTarget({
        profileId: tab.profileId,
        url: tab.webContents.getURL(),
        action,
        target,
        verification: actionVerification,
      });

      const evidence = await collectActionEvidence(tab, before, {
        targetId,
        action,
        target,
        verification,
        typedLength: text.length,
        keys,
        afterValue,
        actionVerification,
      });

      await logAction(
        tab,
        'target.type',
        { targetId, selector: target.selector },
        body?.targetType === 'password' ? '[MASKED]' : text,
        true,
        'TARGET_TYPE_SENT',
        evidence
      );

      return {
        ok: true,
        action,
        targetId,
        target,
        typed: text.length,
        keys,
        afterValue,
        result,
        verification: actionVerification,
        memoryRecord,
        evidence,
      };
    }

    if (action === 'focus') {
      const focused = await runInPage(tab, (selector: string) => {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el) return false;
        el.focus();
        return document.activeElement === el;
      }, [target.selector]);
      const actionVerification = await buildActionVerification(tab, before, {
        beforeValue,
        expectFocusSelector: focusSelector,
      });
      const memoryRecord = rememberSuccessfulTarget({
        profileId: tab.profileId,
        url: tab.webContents.getURL(),
        action,
        target,
        verification: actionVerification,
      });

      const evidence = await collectActionEvidence(tab, before, {
        targetId,
        action,
        target,
        verification,
        focused,
        actionVerification,
      });

      await logAction(tab, 'target.focus', { targetId, selector: target.selector }, null, Boolean(focused), focused ? 'TARGET_FOCUSED' : 'FOCUS_NOT_CONFIRMED', evidence);
      return {
        ok: Boolean(focused),
        action,
        targetId,
        target,
        focused,
        verification: actionVerification,
        memoryRecord,
        evidence,
      };
    }

    if (action === 'clear') {
      const cleared = await runInPage(tab, (selector: string) => {
        const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
        if (!el) return false;

        el.focus();

        if ('value' in el) {
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return el.value === '';
        }

        return false;
      }, [target.selector]);
      const actionVerification = await buildActionVerification(tab, before, {
        beforeValue,
        expectFocusSelector: focusSelector,
      });
      const memoryRecord = rememberSuccessfulTarget({
        profileId: tab.profileId,
        url: tab.webContents.getURL(),
        action,
        target,
        verification: actionVerification,
      });

      const evidence = await collectActionEvidence(tab, before, {
        targetId,
        action,
        target,
        verification,
        cleared,
        actionVerification,
      });

      await logAction(tab, 'target.clear', { targetId, selector: target.selector }, null, Boolean(cleared), cleared ? 'TARGET_CLEARED' : 'CLEAR_FAILED', evidence);
      return {
        ok: Boolean(cleared),
        action,
        targetId,
        target,
        cleared,
        verification: actionVerification,
        memoryRecord,
        evidence,
      };
    }

    if (action === 'press') {
      const keys = Array.isArray(body?.keys)
        ? body.keys.filter((key: unknown) => typeof key === 'string')
        : (typeof body?.key === 'string' ? [body.key] : []);

      if (keys.length === 0) {
        throw new Error('KEY_REQUIRED');
      }

      const result = await this.type(tabId, {
        selector: target.selector,
        keys,
      });
      const actionVerification = await buildActionVerification(tab, before, {
        beforeValue,
        expectFocusSelector: focusSelector,
      });
      const memoryRecord = rememberSuccessfulTarget({
        profileId: tab.profileId,
        url: tab.webContents.getURL(),
        action,
        target,
        verification: actionVerification,
      });

      const evidence = await collectActionEvidence(tab, before, {
        targetId,
        action,
        target,
        verification,
        keys,
        result,
        actionVerification,
      });

      await logAction(tab, 'target.press', { targetId, selector: target.selector }, keys.join('+'), true, 'TARGET_PRESS_SENT', evidence);
      return {
        ok: true,
        action,
        targetId,
        target,
        keys,
        result,
        verification: actionVerification,
        memoryRecord,
        evidence,
      };
    }

    throw new Error('UNREACHABLE_ACTION');
  },

  async actionResolveAndAct(tabId: string, body: any) {
    const action = typeof body?.action === 'string' ? body.action : '';
    if (!action) {
      throw new Error('ACTION_REQUIRED');
    }

    const allowedActions = new Set(['click', 'type', 'focus', 'clear', 'press']);
    if (!allowedActions.has(action)) {
      throw new Error('UNSUPPORTED_TARGET_ACTION');
    }

    const resolved = await this.resolveTarget(tabId, body);
    if (!resolved?.found || !resolved?.target) {
      return {
        ok: false,
        reason: 'TARGET_NOT_RESOLVED',
        resolve: resolved,
      };
    }

    if (resolved.source === 'scan') {
      const delegated = await this.actionByTarget(tabId, {
        targetId: resolved.target.targetId,
        action,
        text: body?.text,
        keys: body?.keys,
        key: body?.key,
        clearFirst: body?.clearFirst,
        targetType: body?.targetType,
      });

      return {
        ...delegated,
        resolve: resolved,
      };
    }

    const tab = getTabOrThrow(tabId);
    const target: ActionTarget = {
      targetId: typeof resolved.target.targetId === 'string' ? resolved.target.targetId : `memory_${resolved.targetKey || 'target'}`,
      kind: String(resolved.target.kind || 'card'),
      label: String(resolved.target.label || ''),
      selector: String(resolved.target.selector || ''),
      bbox: resolved.target.bbox || { x: 0, y: 0, width: 0, height: 0 },
      visible: Boolean(resolved.target.visible),
      enabled: Boolean(resolved.target.enabled),
      actions: Array.isArray(resolved.target.actions) ? resolved.target.actions : [],
      text: String(resolved.target.text || ''),
    };

    const before = {
      url: tab.webContents.getURL(),
      domHash: await getDomHash(tab),
    };

    const { verification, recoveredByScroll } = await verifyTargetWithVisibilityRecovery(tab, target, action);
    if (!verification.ok) {
      return {
        ok: false,
        reason: verification.reason,
        target,
        resolve: resolved,
        recoveredByScroll,
      };
    }

    const beforeValue = typeof verification.value === 'string' ? verification.value : null;
    const focusSelector = target.selector;

    if (action === 'click') {
      const result = await this.click(tabId, { selector: target.selector });
      const actionVerification = await buildActionVerification(tab, before, {
        beforeValue,
        expectFocusSelector: focusSelector,
      });
      const memoryRecord = rememberSuccessfulTarget({
        profileId: tab.profileId,
        url: tab.webContents.getURL(),
        action,
        target,
        verification: actionVerification,
      });
      const evidence = await collectActionEvidence(tab, before, {
        targetId: target.targetId,
        action,
        target,
        verification,
        recoveredByScroll,
        clickResult: result,
        actionVerification,
        resolve: resolved,
      });
      await logAction(tab, 'resolve_and_act.click', { targetId: target.targetId, selector: target.selector }, null, true, 'RESOLVE_AND_ACT_CLICK_SENT', evidence);
      return {
        ok: true,
        action,
        source: 'memory',
        targetId: target.targetId,
        target,
        result,
        verification: actionVerification,
        memoryRecord,
        resolve: resolved,
        evidence,
      };
    }

    if (action === 'type') {
      const text = typeof body?.text === 'string' ? body.text : '';
      const keys = Array.isArray(body?.keys) ? body.keys.filter((key: unknown) => typeof key === 'string') : [];
      if (!text && keys.length === 0) {
        throw new Error('TEXT_OR_KEYS_REQUIRED');
      }

      const result = await this.type(tabId, {
        selector: target.selector,
        text,
        keys,
        clearFirst: Boolean(body?.clearFirst),
        targetType: body?.targetType,
      });
      const afterValue = await runInPage(tab, (selector: string) => {
        const el = document.querySelector(selector) as HTMLInputElement | null;
        return el ? (el.value ?? '') : null;
      }, [target.selector]).catch(() => null);
      const actionVerification = await buildActionVerification(tab, before, {
        beforeValue,
        expectFocusSelector: focusSelector,
      });
      const memoryRecord = rememberSuccessfulTarget({
        profileId: tab.profileId,
        url: tab.webContents.getURL(),
        action,
        target,
        verification: actionVerification,
      });
      const evidence = await collectActionEvidence(tab, before, {
        targetId: target.targetId,
        action,
        target,
        verification,
        typedLength: text.length,
        keys,
        afterValue,
        actionVerification,
        resolve: resolved,
      });
      await logAction(tab, 'resolve_and_act.type', { targetId: target.targetId, selector: target.selector }, body?.targetType === 'password' ? '[MASKED]' : text, true, 'RESOLVE_AND_ACT_TYPE_SENT', evidence);
      return {
        ok: true,
        action,
        source: 'memory',
        targetId: target.targetId,
        target,
        typed: text.length,
        keys,
        afterValue,
        result,
        verification: actionVerification,
        memoryRecord,
        resolve: resolved,
        evidence,
      };
    }

    if (action === 'focus') {
      const focused = await runInPage(tab, (selector: string) => {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el) return false;
        el.focus();
        return document.activeElement === el;
      }, [target.selector]);
      const actionVerification = await buildActionVerification(tab, before, {
        beforeValue,
        expectFocusSelector: focusSelector,
      });
      const memoryRecord = rememberSuccessfulTarget({
        profileId: tab.profileId,
        url: tab.webContents.getURL(),
        action,
        target,
        verification: actionVerification,
      });
      const evidence = await collectActionEvidence(tab, before, {
        targetId: target.targetId,
        action,
        target,
        verification,
        focused,
        actionVerification,
        resolve: resolved,
      });
      await logAction(tab, 'resolve_and_act.focus', { targetId: target.targetId, selector: target.selector }, null, Boolean(focused), focused ? 'RESOLVE_AND_ACT_FOCUSED' : 'RESOLVE_AND_ACT_FOCUS_NOT_CONFIRMED', evidence);
      return {
        ok: Boolean(focused),
        action,
        source: 'memory',
        targetId: target.targetId,
        target,
        focused,
        verification: actionVerification,
        memoryRecord,
        resolve: resolved,
        evidence,
      };
    }

    if (action === 'clear') {
      const cleared = await runInPage(tab, (selector: string) => {
        const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
        if (!el) return false;
        el.focus();
        if ('value' in el) {
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return el.value === '';
        }
        return false;
      }, [target.selector]);
      const actionVerification = await buildActionVerification(tab, before, {
        beforeValue,
        expectFocusSelector: focusSelector,
      });
      const memoryRecord = rememberSuccessfulTarget({
        profileId: tab.profileId,
        url: tab.webContents.getURL(),
        action,
        target,
        verification: actionVerification,
      });
      const evidence = await collectActionEvidence(tab, before, {
        targetId: target.targetId,
        action,
        target,
        verification,
        cleared,
        actionVerification,
        resolve: resolved,
      });
      await logAction(tab, 'resolve_and_act.clear', { targetId: target.targetId, selector: target.selector }, null, Boolean(cleared), cleared ? 'RESOLVE_AND_ACT_CLEARED' : 'RESOLVE_AND_ACT_CLEAR_FAILED', evidence);
      return {
        ok: Boolean(cleared),
        action,
        source: 'memory',
        targetId: target.targetId,
        target,
        cleared,
        verification: actionVerification,
        memoryRecord,
        resolve: resolved,
        evidence,
      };
    }

    if (action === 'press') {
      const keys = Array.isArray(body?.keys)
        ? body.keys.filter((key: unknown) => typeof key === 'string')
        : (typeof body?.key === 'string' ? [body.key] : []);
      if (keys.length === 0) {
        throw new Error('KEY_REQUIRED');
      }

      const result = await this.type(tabId, {
        selector: target.selector,
        keys,
      });
      const actionVerification = await buildActionVerification(tab, before, {
        beforeValue,
        expectFocusSelector: focusSelector,
      });
      const memoryRecord = rememberSuccessfulTarget({
        profileId: tab.profileId,
        url: tab.webContents.getURL(),
        action,
        target,
        verification: actionVerification,
      });
      const evidence = await collectActionEvidence(tab, before, {
        targetId: target.targetId,
        action,
        target,
        verification,
        keys,
        result,
        actionVerification,
        resolve: resolved,
      });
      await logAction(tab, 'resolve_and_act.press', { targetId: target.targetId, selector: target.selector }, keys.join('+'), true, 'RESOLVE_AND_ACT_PRESS_SENT', evidence);
      return {
        ok: true,
        action,
        source: 'memory',
        targetId: target.targetId,
        target,
        keys,
        result,
        verification: actionVerification,
        memoryRecord,
        resolve: resolved,
        evidence,
      };
    }

    throw new Error('UNREACHABLE_ACTION');
  },

  async runActionChain(tabId: string, body: any) {
    const tab = getTabOrThrow(tabId);

    const steps = Array.isArray(body?.steps) ? body.steps : [];
    const stopOnFailure = body?.stopOnFailure !== false;
    const maxSteps = Math.max(1, Math.min(Number(body?.maxSteps) || 10, 10));

    if (steps.length === 0) {
      throw new Error('CHAIN_STEPS_REQUIRED');
    }
    if (steps.length > maxSteps) {
      throw new Error('CHAIN_TOO_LONG');
    }

    const allowedActions = new Set(['click', 'type', 'focus', 'clear', 'press']);
    const results: any[] = [];
    const chainStartedAt = Date.now();

    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index] || {};
      const name = typeof step.name === 'string' ? step.name : `step_${index + 1}`;
      const targetKey = typeof step.targetKey === 'string' ? step.targetKey : '';
      const action = typeof step.action === 'string' ? step.action : '';

      if (!targetKey) {
        const failed = { index, name, ok: false, reason: 'TARGET_KEY_REQUIRED' };
        results.push(failed);
        return {
          ok: false,
          tabId,
          stepCount: steps.length,
          completedCount: results.filter((item) => item.ok).length,
          failedAt: index,
          reason: 'TARGET_KEY_REQUIRED',
          results,
        };
      }

      if (!action || !allowedActions.has(action)) {
        const failed = {
          index,
          name,
          targetKey,
          ok: false,
          reason: 'UNSUPPORTED_CHAIN_ACTION',
          action,
        };
        results.push(failed);
        return {
          ok: false,
          tabId,
          stepCount: steps.length,
          completedCount: results.filter((item) => item.ok).length,
          failedAt: index,
          reason: 'UNSUPPORTED_CHAIN_ACTION',
          results,
        };
      }

      const startedAt = Date.now();
      let actionResult: any;

      try {
        actionResult = await this.actionResolveAndAct(tabId, {
          targetKey,
          kind: typeof step.kind === 'string' ? step.kind : undefined,
          action,
          text: typeof step.text === 'string' ? step.text : undefined,
          key: typeof step.key === 'string' ? step.key : undefined,
          keys: Array.isArray(step.keys) ? step.keys : undefined,
          clearFirst: Boolean(step.clearFirst),
          targetType: step.targetType,
        });
      } catch (error: any) {
        const failed = {
          index,
          name,
          targetKey,
          action,
          ok: false,
          reason: error?.message || String(error),
          elapsedMs: Date.now() - startedAt,
        };
        results.push(failed);
        return {
          ok: false,
          tabId,
          stepCount: steps.length,
          completedCount: results.filter((item) => item.ok).length,
          failedAt: index,
          reason: failed.reason,
          results,
          elapsedMs: Date.now() - chainStartedAt,
        };
      }

      const expectedCheck = checkExpectedVerification(actionResult, step.verify || {});
      const stepOk = Boolean(actionResult?.ok) && expectedCheck.ok;

      const stepResult = {
        index,
        name,
        targetKey,
        action,
        ok: stepOk,
        source: actionResult?.source || actionResult?.resolve?.source || null,
        reason: stepOk ? 'OK' : (actionResult?.reason || 'VERIFY_FAILED'),
        verificationFailures: expectedCheck.failures,
        verification: actionResult?.verification || null,
        resolve: actionResult?.resolve || null,
        target: actionResult?.target
          ? {
              targetId: actionResult.target.targetId,
              kind: actionResult.target.kind,
              label: actionResult.target.label,
              selector: actionResult.target.selector,
              bbox: actionResult.target.bbox,
            }
          : null,
        elapsedMs: Date.now() - startedAt,
      };

      results.push(stepResult);

      if (!stepOk && stopOnFailure) {
        return {
          ok: false,
          tabId,
          stepCount: steps.length,
          completedCount: results.filter((item) => item.ok).length,
          failedAt: index,
          reason: stepResult.reason,
          results,
          elapsedMs: Date.now() - chainStartedAt,
        };
      }
    }

    const ok = results.every((item) => item.ok);
    let savedSkill: any = null;

    if (ok && body?.saveAsSkill && typeof body.saveAsSkill === 'object') {
      savedSkill = saveMicroSkill({
        profileId: tab.profileId,
        name: body.saveAsSkill.name,
        queryPattern: typeof body.saveAsSkill.queryPattern === 'string'
          ? body.saveAsSkill.queryPattern
          : body.saveAsSkill.name,
        steps,
      });
    }

    return {
      ok,
      tabId,
      stepCount: steps.length,
      completedCount: results.filter((item) => item.ok).length,
      failedAt: ok ? null : results.findIndex((item) => !item.ok),
      results,
      savedSkill,
      elapsedMs: Date.now() - chainStartedAt,
    };
  },

  async runMicroSkill(tabId: string, body: any) {
    const tab = getTabOrThrow(tabId);

    const skillNameOrId =
      typeof body?.skill === 'string'
        ? body.skill
        : typeof body?.skillId === 'string'
          ? body.skillId
          : typeof body?.name === 'string'
            ? body.name
            : '';

    if (!skillNameOrId) {
      throw new Error('SKILL_REQUIRED');
    }

    const skill = getMicroSkill(tab.profileId, skillNameOrId);
    if (!skill) {
      throw new Error('SKILL_NOT_FOUND');
    }

    const rawSteps = parseSkillSteps(skill);
    const inputs = body?.inputs && typeof body.inputs === 'object' ? body.inputs : {};
    const renderedSteps = renderSkillSteps(rawSteps, inputs);

    const chainResult = await this.runActionChain(tabId, {
      steps: renderedSteps,
      stopOnFailure: body?.stopOnFailure !== false,
      maxSteps: Math.max(1, Math.min(Number(body?.maxSteps) || 10, 10)),
    });

    const updatedSkill = markMicroSkillResult(skill.id, Boolean(chainResult.ok));

    return {
      ok: Boolean(chainResult.ok),
      tabId,
      skill: {
        id: skill.id,
        name: skill.name,
        query_pattern: skill.query_pattern,
      },
      inputs,
      renderedStepCount: renderedSteps.length,
      chainResult,
      updatedSkill,
    };
  },

  async screenshot(tabId: string, options: { selector?: string; highlight?: boolean }) {
    const tab = getTabOrThrow(tabId);
    const selector = options.selector;
    const highlight = options.highlight && selector;

    if (highlight) {
      await runInPage(tab, (targetSelector: string) => {
        document.querySelectorAll('[data-gb-vlm-highlight="true"]').forEach((node) => node.remove());
        document.querySelectorAll(targetSelector).forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
          const box = document.createElement('div');
          box.setAttribute('data-gb-vlm-highlight', 'true');
          box.style.position = 'fixed';
          box.style.left = `${rect.left}px`;
          box.style.top = `${rect.top}px`;
          box.style.width = `${rect.width}px`;
          box.style.height = `${rect.height}px`;
          box.style.border = '3px solid #ff2d55';
          box.style.background = 'rgba(255, 45, 85, 0.12)';
          box.style.zIndex = '2147483647';
          box.style.pointerEvents = 'none';
          document.documentElement.appendChild(box);
        });
      }, [selector]);
    }

    try {
      const image = await tab.webContents.capturePage();
      const size = image.getSize();
      return { png: image.toPNG(), width: size.width, height: size.height };
    } finally {
      if (highlight) {
        await runInPage(tab, () => {
          document.querySelectorAll('[data-gb-vlm-highlight="true"]').forEach((node) => node.remove());
        }).catch(() => undefined);
      }
    }
  },

  async style(tabId: string, body: any) {
    const tab = getTabOrThrow(tabId);
    const selector = typeof body?.selector === 'string' ? body.selector : '';
    const properties = Array.isArray(body?.properties)
      ? body.properties.filter((property: unknown) => typeof property === 'string').slice(0, 100)
      : [];
    if (!selector) {
      throw new Error('SELECTOR_REQUIRED');
    }

    const elements: any = await runInPage(tab, (input: { selector: string; properties: string[] }) => {
      let matches: Element[] = [];
      try {
        matches = Array.from(document.querySelectorAll(input.selector)).slice(0, 100);
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
          elements: [],
        };
      }

      return matches.map((el, index) => {
        const computed = window.getComputedStyle(el);
        const styles: Record<string, string> = {};
        for (const property of input.properties) {
          styles[property] = computed.getPropertyValue(property);
        }
        return { index, styles };
      });
    }, [{ selector, properties }]);

    if ((elements as any)?.error) {
      throw new Error(`STYLE_FAILED: ${(elements as any).error}`);
    }

    return { selector, elements };
  },

  async a11y(tabId: string) {
    const tab = getTabOrThrow(tabId);
    const tree = await runInPage(tab, () => {
      function nameFor(el: Element) {
        return el.getAttribute('aria-label')
          || el.getAttribute('alt')
          || el.getAttribute('title')
          || (el as HTMLInputElement).placeholder
          || (el.textContent || '').trim().slice(0, 120);
      }

      function roleFor(el: Element) {
        if (el.getAttribute('role')) return el.getAttribute('role');
        const tag = el.tagName.toLowerCase();
        if (tag === 'button') return 'button';
        if (tag === 'a') return 'link';
        if (tag === 'input' || tag === 'textarea') return 'textbox';
        if (tag === 'select') return 'combobox';
        if (/^h[1-6]$/.test(tag)) return 'heading';
        return tag;
      }

      const nodes = Array.from(document.querySelectorAll('button, a, input, textarea, select, [role], [aria-label], h1, h2, h3, h4, h5, h6'))
        .slice(0, 500)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            role: roleFor(el),
            name: nameFor(el),
            value: (el as HTMLInputElement).value || '',
            focusable: typeof (el as HTMLElement).focus === 'function',
            bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          };
        });

      return { role: 'rootWebArea', children: nodes };
    });

    return { tree };
  },

  async click(tabId: string, body: any) {
    const tab = getTabOrThrow(tabId);
    const before = {
      url: tab.webContents.getURL(),
      domHash: await getDomHash(tab),
    };

    const point = await resolvePoint(tab, body);

    tabManager.focusTab(tabId);
    tab.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
    tab.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    tab.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 });

    await sleep(250);

    const evidence = await collectActionEvidence(tab, before, {
      resolvedX: point.x,
      resolvedY: point.y,
      selector: point.selector,
      xpath: point.xpath,
    });

    await logAction(tab, 'click', point, null, true, 'CLICK_SENT', evidence);
    return { ok: true, resolvedX: point.x, resolvedY: point.y };
  },

  async type(tabId: string, body: any) {
    const tab = getTabOrThrow(tabId);
    const before = {
      url: tab.webContents.getURL(),
      domHash: await getDomHash(tab),
    };
    const text = typeof body?.text === 'string' ? body.text : '';
    const keys = Array.isArray(body?.keys) ? body.keys.filter((key: unknown) => typeof key === 'string') : [];
    if (!text && keys.length === 0) {
      throw new Error('TEXT_OR_KEYS_REQUIRED');
    }

    const selector = typeof body?.selector === 'string' ? body.selector : undefined;
    const xpath = typeof body?.xpath === 'string' ? body.xpath : undefined;
    if (selector || xpath) {
      const focused = await runInPage(tab, (input: { selector?: string; xpath?: string; clearFirst?: boolean }) => {
        function firstByXPath(expression: string) {
          return document.evaluate(expression, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue as HTMLInputElement | null;
        }

        const el = input.selector
          ? document.querySelector(input.selector) as HTMLInputElement | null
          : firstByXPath(input.xpath || '');
        if (!el) return false;
        el.focus();
        if (input.clearFirst && typeof el.select === 'function') {
          el.select();
          document.execCommand('delete');
        }
        return true;
      }, [{ selector, xpath, clearFirst: Boolean(body?.clearFirst) }]);

      if (!focused) {
        throw new Error('ELEMENT_NOT_FOUND');
      }
    }

    tabManager.focusTab(tabId);
    for (const char of text) {
      tab.webContents.sendInputEvent({ type: 'char', keyCode: char });
    }

    for (const key of keys) {
      const keyCode = keyForElectron(key);
      tab.webContents.sendInputEvent({ type: 'keyDown', keyCode });
      tab.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    }

    await sleep(100);

    const evidence = await collectActionEvidence(tab, before, {
      selector,
      xpath,
      typedLength: text.length,
      keys,
    });

    await logAction(
      tab,
      'type',
      { selector, xpath, keys },
      body?.targetType === 'password' ? '[MASKED]' : text,
      true,
      'TYPE_SENT',
      evidence
    );
    return { ok: true, typed: text.length, keys };
  },

  async scroll(tabId: string, body: any) {
    const tab = getTabOrThrow(tabId);
    const before = {
      url: tab.webContents.getURL(),
      domHash: await getDomHash(tab),
    };
    const deltaX = Number(body?.deltaX) || 0;
    const deltaY = Number(body?.deltaY) || 0;
    const selector = typeof body?.selector === 'string' ? body.selector : undefined;
    const xpath = typeof body?.xpath === 'string' ? body.xpath : undefined;

    if (selector || xpath) {
      const scrolled = await runInPage(tab, (input: { selector?: string; xpath?: string; deltaX: number; deltaY: number }) => {
        function firstByXPath(expression: string) {
          return document.evaluate(expression, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue as Element | null;
        }

        const el = input.selector
          ? document.querySelector(input.selector)
          : firstByXPath(input.xpath || '');
        if (!el) return false;
        el.dispatchEvent(new WheelEvent('wheel', { deltaX: input.deltaX, deltaY: input.deltaY, bubbles: true, cancelable: true }));
        (el as HTMLElement).scrollBy?.(input.deltaX, input.deltaY);
        return true;
      }, [{ selector, xpath, deltaX, deltaY }]);
      if (!scrolled) throw new Error('ELEMENT_NOT_FOUND');
    } else {
      const x = Number.isFinite(body?.x) ? Math.round(body.x) : 0;
      const y = Number.isFinite(body?.y) ? Math.round(body.y) : 0;
      tab.webContents.sendInputEvent({ type: 'mouseWheel', x, y, deltaX, deltaY });
    }

    await sleep(100);

    const evidence = await collectActionEvidence(tab, before, {
      selector,
      xpath,
      x: body?.x,
      y: body?.y,
      deltaX,
      deltaY,
    });

    await logAction(tab, 'scroll', { selector, xpath, x: body?.x, y: body?.y }, JSON.stringify({ deltaX, deltaY }), true, 'SCROLL_SENT', evidence);
    return { ok: true, deltaX, deltaY };
  },

  async navigate(tabId: string, body: any) {
    const url = typeof body?.url === 'string' ? normalizeUrl(body.url) : '';
    if (!url) {
      throw new Error('URL_REQUIRED');
    }

    const tab = getTabOrThrow(tabId);
    const before = {
      url: tab.webContents.getURL(),
      domHash: await getDomHash(tab),
    };
    await tabManager.navigateTab(tabId, url);
    const evidence = await collectActionEvidence(tab, before, { requestedUrl: url });
    await logAction(tab, 'navigate', { url }, url, true, 'NAVIGATION_LOADED', evidence);
    return { ok: true, url: tab.webContents.getURL() };
  },

  async wait(tabId: string, body: any) {
    const tab = getTabOrThrow(tabId);
    const selector = typeof body?.selector === 'string' ? body.selector : '';
    const allowedUntil = new Set(['present', 'absent', 'visible', 'hidden']);
    const requestedUntil = typeof body?.until === 'string' ? body.until : 'present';
    const until = allowedUntil.has(requestedUntil) ? requestedUntil : 'present';
    const timeoutMs = Math.max(100, Math.min(Number(body?.timeoutMs) || 5000, 60000));
    if (!selector) {
      throw new Error('SELECTOR_REQUIRED');
    }

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const state = await runInPage(tab, (targetSelector: string) => {
        const elements = Array.from(document.querySelectorAll(targetSelector));
        const visible = elements.some((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        });
        return { count: elements.length, visible };
      }, [selector]);

      const done = until === 'absent'
        ? state.count === 0
        : until === 'visible'
          ? state.visible
          : until === 'hidden'
            ? !state.visible
            : state.count > 0;

      if (done) {
        return { ok: true, elapsedMs: Date.now() - started };
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    return { ok: false, reason: 'timeout', elapsedMs: Date.now() - started };
  },

  async evaluate(tabId: string, body: any) {
    const tab = getTabOrThrow(tabId);
    const script = typeof body?.script === 'string' ? body.script : '';
    if (!script) {
      throw new Error('SCRIPT_REQUIRED');
    }

    const before = {
      url: tab.webContents.getURL(),
      domHash: await getDomHash(tab),
    };
    const result = await tab.webContents.executeJavaScript(script, true);
    const evidence = await collectActionEvidence(tab, before, {});
    await logAction(tab, 'evaluate', null, script, true, 'EVALUATE_COMPLETED', evidence);
    return { ok: true, result };
  },
};
