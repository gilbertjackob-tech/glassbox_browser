// Usage:
//   node scripts/test-get-viewport-html.mjs
//   node scripts/test-get-viewport-html.mjs <tabId>
//
// Output:
//   debug-viewport-html-output/tab-<tabId>-viewport-response.json
//   debug-viewport-html-output/tab-<tabId>-viewport.html
//   debug-viewport-html-output/tab-<tabId>-summary.txt
//   debug-viewport-html-output/tab-<tabId>-source-fullscreen.png

import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const outputDir = path.resolve('debug-viewport-html-output');

async function requestJson(url, options) {
  const res = await fetch(url, options);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} from ${url}\n${text}`);
  }

  return res.json();
}

async function requestBinary(url, options) {
  const res = await fetch(url, options);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} from ${url}\n${text}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

async function getFirstTabId() {
  const tabs = await requestJson(`${API_BASE}/api/tabs`);

  if (!Array.isArray(tabs) || tabs.length === 0) {
    throw new Error('No tabs found. Open GlassBox and load a page first.');
  }

  return tabs[0].tabId || tabs[0].id;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const tabId = process.argv[2] || await getFirstTabId();

  const script = `
    (() => {
      function isElementVisible(el) {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);

        const inViewport =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom >= 0 &&
          rect.right >= 0 &&
          rect.top <= window.innerHeight &&
          rect.left <= window.innerWidth;

        const visibleStyle =
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0";

        return inViewport && visibleStyle;
      }

      function clipRectToViewport(rect) {
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

      function cssPath(el) {
        if (el.id) return "#" + CSS.escape(el.id);

        const parts = [];
        let node = el;

        while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
          let part = node.tagName.toLowerCase();

          const name = node.getAttribute("name");
          const aria = node.getAttribute("aria-label");
          const placeholder = node.getAttribute("placeholder");

          if (name) {
            part += '[name="' + name.replace(/"/g, '\\\\\\"') + '"]';
            parts.unshift(part);
            break;
          }

          if (aria) {
            part += '[aria-label="' + aria.replace(/"/g, '\\\\\\"') + '"]';
            parts.unshift(part);
            break;
          }

          if (placeholder) {
            part += '[placeholder="' + placeholder.replace(/"/g, '\\\\\\"') + '"]';
            parts.unshift(part);
            break;
          }

          const parent = node.parentElement;
          if (parent) {
            const sameTag = Array.from(parent.children).filter(
              (child) => child.tagName === node.tagName
            );

            if (sameTag.length > 1) {
              part += ":nth-of-type(" + (sameTag.indexOf(node) + 1) + ")";
            }
          }

          parts.unshift(part);
          node = parent;
        }

        return parts.join(" > ");
      }

      function shortHtml(el) {
        const clone = el.cloneNode(true);
        const html = clone.outerHTML || "";
        return html.length > 2000 ? html.slice(0, 2000) + "\\n<!-- clipped -->" : html;
      }

      const importantSelector = [
        "input",
        "textarea",
        "button",
        "a",
        "select",
        "[role]",
        "[aria-label]",
        "[placeholder]",
        "[title]",
        "[contenteditable='true']",
        "img",
        "svg",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6"
      ].join(",");

      const elements = Array.from(document.querySelectorAll(importantSelector))
        .filter(isElementVisible)
        .slice(0, 500)
        .map((el, index) => {
          const rect = el.getBoundingClientRect();
          const input = el;

          return {
            index,
            tag: el.tagName.toLowerCase(),
            id: el.id || null,
            name: el.getAttribute("name"),
            role: el.getAttribute("role"),
            type: input.type || null,
            text: (el.innerText || el.textContent || "").trim().slice(0, 300),
            placeholder: el.getAttribute("placeholder"),
            ariaLabel: el.getAttribute("aria-label"),
            title: el.getAttribute("title"),
            href: el.getAttribute("href"),
            selector: cssPath(el),
            bbox: clipRectToViewport(rect),
            outerHTML: shortHtml(el),
          };
        });

      const clippedHtml = [
        "<!-- GlassBox viewport HTML snapshot -->",
        "<!-- URL: " + location.href + " -->",
        "<!-- TITLE: " + document.title + " -->",
        "<!-- VIEWPORT: " + window.innerWidth + "x" + window.innerHeight + " scroll=" + window.scrollX + "," + window.scrollY + " -->",
        "",
        ...elements.map((el) => {
          return [
            "<!--",
            "index: " + el.index,
            "tag: " + el.tag,
            "selector: " + el.selector,
            "bbox: " + JSON.stringify(el.bbox),
            "text: " + (el.text || "").replace(/-->/g, ""),
            "-->",
            el.outerHTML,
            ""
          ].join("\\n");
        })
      ].join("\\n");

      return {
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        capturedAt: Date.now(),
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          scrollX: window.scrollX,
          scrollY: window.scrollY
        },
        elementCount: elements.length,
        elements,
        clippedHtml
      };
    })();
  `;

  const data = await requestJson(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/action/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script }),
  });
  const screenshotBuffer = await requestBinary(`${API_BASE}/api/tabs/${encodeURIComponent(tabId)}/screenshot`);

  const result = data.result;

  const jsonPath = path.join(outputDir, `tab-${tabId}-viewport-response.json`);
  const htmlPath = path.join(outputDir, `tab-${tabId}-viewport.html`);
  const summaryPath = path.join(outputDir, `tab-${tabId}-summary.txt`);
  const screenshotPath = path.join(outputDir, `tab-${tabId}-source-fullscreen.png`);

  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(htmlPath, result.clippedHtml || '', 'utf8');
  fs.writeFileSync(screenshotPath, screenshotBuffer);

  const summary = [
    `tabId: ${tabId}`,
    `url: ${result.url}`,
    `title: ${result.title}`,
    `readyState: ${result.readyState}`,
    `viewport: ${result.viewport.width}x${result.viewport.height}`,
    `scroll: ${result.viewport.scrollX},${result.viewport.scrollY}`,
    `elementCount: ${result.elementCount}`,
    '',
    `JSON output: ${jsonPath}`,
    `Viewport HTML output: ${htmlPath}`,
    `Fullscreen screenshot: ${screenshotPath}`,
  ].join('\n');

  fs.writeFileSync(summaryPath, summary, 'utf8');

  console.log('\\nDONE');
  console.log(summary);
}

main().catch((error) => {
  console.error('\\nFAILED');
  console.error(error.message);
  process.exit(1);
});
