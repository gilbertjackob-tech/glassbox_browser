# GlassBox Browser (MVP)

An automation-native browser shell where the agent is the user. GlassBox provides deep transparency into DOM, session memory, and action verification.

## 🚀 Key Features
- **Remote Headless Control**: Playwright-powered engine running on the server.
- **GlassBox DOM**: Every element is inspected for role, text, and bounding box.
- **Action Contracts**: "No success without evidence". Every action (click/type) is verified and logged to a SQLite memory database.
- **Profile Partitioning**: SQLite-driven profiles with isolated sessions.
- **Technical UI**: A high-density "Mission Control" interface for monitoring automation.

## 📁 Architecture
- `src/main/main.ts`: Electron entry point and API server.
- `src/server/tabManager.ts`: Lifecycle management for BrowserTabs (via Electron BrowserView).
- `src/server/actionExecutor.ts`: Strategic engine for performing and verifying actions.
- `src/main/memoryDb.ts`: Core SQLite persistence for GlassBox memory.
- `src/App.tsx`: React-based control shell.

## 💾 Local Memory (SQLite)
GlassBox uses a local SQLite database for persistent intelligence. No cloud or remote storage is used.

- **Database Path**: `data/glassbox.sqlite`
- **How to Reset**: Delete the `data/glassbox.sqlite` file to clear all history, profiles, skills, and logs.
- **What is stored**:
  - Profiles & Tab sessions
  - Navigation History (URL, Title, Visit Count)
  - DOM Snapshots (only when changes occur)
  - Action Logs (Verified successes and failure reasons)
  - Tasks & Skills (Learned sequences based on successful tasks)
  - Downloads metadata

## 🛠️ API Endpoints
- `GET /api/tabs`: List active browser tabs.
- `POST /api/tabs`: Create a new tab in a profile, with optional `{ profileId, url }`.
- `PUT /api/tabs/:tabId/focus`: Bring a tab to the visible BrowserView.
- `GET /api/tabs/:tabId/dom`: Get the latest GlassBox DOM snapshot.
- `GET /api/tabs/:tabId/html`: Get the live page HTML from `document.documentElement.outerHTML`.
- `POST /api/tabs/:tabId/query`: Query live elements by CSS selector or XPath with bounding boxes.
- `GET /api/tabs/:tabId/screenshot`: Capture the visible page as PNG.
- `POST /api/tabs/:tabId/style`: Read selected computed styles.
- `GET /api/tabs/:tabId/a11y`: Get a lightweight semantic accessibility-style snapshot.
- `POST /api/tabs/:tabId/action/*`: Click, type, scroll, navigate, wait, or evaluate in a tab.
- `POST /api/actions`: Execute an **Action Contract**.
- `GET /api/memory/search?q=...&profileId=...`: Unified memory search across history, tasks, skills, and downloads.

## CLI Control
Use the local CLI for profile-based automation:

```powershell
npm run gb -- profile list
npm run gb -- profile create "Work" --id work
npm run gb -- open --profile work --url https://example.com
npm run gb -- query --tab <tabId> --sel "button"
npm run gb -- click --tab <tabId> --sel "button.login"
npm run gb -- type --tab <tabId> --sel "input[name='email']" --text "user@example.com"
```

Profiles are local-only and isolated by Electron persistent session partition. Existing old partition data is not auto-migrated.

## 📖 How it works
1. **Open a Tab**: Launch an isolated BrowserView session.
2. **Navigate**: Native Electron browsing with deep instrumentation.
3. **Inspect**: Real-time DOM scanning via preload scripts (no `evaluate` overhead).
4. **Interact**: Trigger verified action contracts. The system confirms state shifts before reporting success.
5. **Learn**: Successful tasks are automatically converted into **Skills** for replay.

---
Built with Native Electron, SQLite, React, and Tailwind.

how to push?
git add -A ; git commit -m "commit msg default" ; git push origin main
