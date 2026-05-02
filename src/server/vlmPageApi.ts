import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import db from '../main/memoryDb.js';
import { normalizeUrl } from '../lib/urlUtils.js';
import { tabManager } from './tabManager.js';

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

export const vlmPageApi = {
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

    const verification = await verifyTargetInPage(tab, target);
    if (!verification.ok) {
      return {
        ok: false,
        reason: verification.reason,
        target,
        stateHash: snapshot.stateHash,
      };
    }

    if (action === 'click') {
      const result = await this.click(tabId, {
        selector: target.selector,
      });

      const evidence = await collectActionEvidence(tab, before, {
        targetId,
        action,
        target,
        verification,
        clickResult: result,
      });

      await logAction(tab, 'target.click', { targetId, selector: target.selector }, null, true, 'TARGET_CLICK_SENT', evidence);
      return {
        ok: true,
        action,
        targetId,
        target,
        result,
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

      const evidence = await collectActionEvidence(tab, before, {
        targetId,
        action,
        target,
        verification,
        typedLength: text.length,
        keys,
        afterValue,
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

      const evidence = await collectActionEvidence(tab, before, {
        targetId,
        action,
        target,
        verification,
        focused,
      });

      await logAction(tab, 'target.focus', { targetId, selector: target.selector }, null, Boolean(focused), focused ? 'TARGET_FOCUSED' : 'FOCUS_NOT_CONFIRMED', evidence);
      return {
        ok: Boolean(focused),
        action,
        targetId,
        target,
        focused,
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

      const evidence = await collectActionEvidence(tab, before, {
        targetId,
        action,
        target,
        verification,
        cleared,
      });

      await logAction(tab, 'target.clear', { targetId, selector: target.selector }, null, Boolean(cleared), cleared ? 'TARGET_CLEARED' : 'CLEAR_FAILED', evidence);
      return {
        ok: Boolean(cleared),
        action,
        targetId,
        target,
        cleared,
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

      const evidence = await collectActionEvidence(tab, before, {
        targetId,
        action,
        target,
        verification,
        keys,
        result,
      });

      await logAction(tab, 'target.press', { targetId, selector: target.selector }, keys.join('+'), true, 'TARGET_PRESS_SENT', evidence);
      return {
        ok: true,
        action,
        targetId,
        target,
        keys,
        result,
        evidence,
      };
    }

    throw new Error('UNREACHABLE_ACTION');
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
