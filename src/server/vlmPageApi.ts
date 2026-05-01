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
  return await tab.view.webContents.executeJavaScript(pageScript(fn, args), true);
}

function logAction(tab: TabMetadata, type: string, target: unknown, value: unknown, success: boolean, reason: string, evidence: unknown) {
  try {
    db.prepare(`
      INSERT INTO actions (id, tab_id, profile_id, type, target, value, success, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      tab.id,
      tab.profileId,
      type,
      target == null ? null : JSON.stringify(target),
      value == null ? null : String(value),
      success ? 1 : 0,
      reason || JSON.stringify(evidence || {})
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

export const vlmPageApi = {
  async getHtml(tabId: string) {
    const tab = getTabOrThrow(tabId);
    const html = await runInPage(tab, () => document.documentElement.outerHTML);
    return {
      tabId,
      url: tab.view.webContents.getURL(),
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

    const elements = await runInPage(tab, (input: { selector: string; xpath: string; limit: number }) => {
      function allByXPath(expression: string) {
        const result = document.evaluate(expression, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        return Array.from({ length: Math.min(result.snapshotLength, input.limit) }, (_, index) => result.snapshotItem(index) as Element).filter(Boolean);
      }

      const matches = input.selector
        ? Array.from(document.querySelectorAll(input.selector)).slice(0, input.limit)
        : allByXPath(input.xpath);

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

    return { selector: selector || undefined, xpath: xpath || undefined, count: elements.length, elements };
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
      const image = await tab.view.webContents.capturePage();
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

    const elements = await runInPage(tab, (input: { selector: string; properties: string[] }) => {
      return Array.from(document.querySelectorAll(input.selector)).slice(0, 100).map((el, index) => {
        const computed = window.getComputedStyle(el);
        const styles: Record<string, string> = {};
        for (const property of input.properties) {
          styles[property] = computed.getPropertyValue(property);
        }
        return { index, styles };
      });
    }, [{ selector, properties }]);

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
    const beforeUrl = tab.view.webContents.getURL();
    const beforeDomHash = tab.domHash;
    const point = await resolvePoint(tab, body);

    tabManager.focusTab(tabId);
    tab.view.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
    tab.view.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    tab.view.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 });

    const evidence = { beforeUrl, afterUrl: tab.view.webContents.getURL(), beforeDomHash, afterDomHash: tab.domHash, resolvedX: point.x, resolvedY: point.y };
    logAction(tab, 'click', point, null, true, 'CLICK_SENT', evidence);
    return { ok: true, resolvedX: point.x, resolvedY: point.y };
  },

  async type(tabId: string, body: any) {
    const tab = getTabOrThrow(tabId);
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
      tab.view.webContents.sendInputEvent({ type: 'char', keyCode: char });
    }

    for (const key of keys) {
      const keyCode = keyForElectron(key);
      tab.view.webContents.sendInputEvent({ type: 'keyDown', keyCode });
      tab.view.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    }

    logAction(tab, 'type', { selector, xpath, keys }, body?.targetType === 'password' ? '[MASKED]' : text, true, 'TYPE_SENT', {});
    return { ok: true, typed: text.length, keys };
  },

  async scroll(tabId: string, body: any) {
    const tab = getTabOrThrow(tabId);
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
      tab.view.webContents.sendInputEvent({ type: 'mouseWheel', x, y, deltaX, deltaY });
    }

    logAction(tab, 'scroll', { selector, xpath, x: body?.x, y: body?.y }, JSON.stringify({ deltaX, deltaY }), true, 'SCROLL_SENT', {});
    return { ok: true, deltaX, deltaY };
  },

  async navigate(tabId: string, body: any) {
    const url = typeof body?.url === 'string' ? normalizeUrl(body.url) : '';
    if (!url) {
      throw new Error('URL_REQUIRED');
    }

    const tab = getTabOrThrow(tabId);
    await tabManager.navigateTab(tabId, url);
    logAction(tab, 'navigate', { url }, url, true, 'NAVIGATION_LOADED', { afterUrl: tab.view.webContents.getURL() });
    return { ok: true, url: tab.view.webContents.getURL() };
  },

  async wait(tabId: string, body: any) {
    const tab = getTabOrThrow(tabId);
    const selector = typeof body?.selector === 'string' ? body.selector : '';
    const until = typeof body?.until === 'string' ? body.until : 'present';
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

    const result = await tab.view.webContents.executeJavaScript(script, true);
    logAction(tab, 'evaluate', null, script, true, 'EVALUATE_COMPLETED', {});
    return { ok: true, result };
  },
};
