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
- `POST /api/tabs`: Create a new tab in a profile.
- `GET /api/tabs/:tabId/dom`: Get the latest GlassBox DOM snapshot.
- `POST /api/actions`: Execute an **Action Contract**.
- `GET /api/memory/search?q=...&profileId=...`: Unified memory search across history, tasks, skills, and downloads.

## 📖 How it works
1. **Open a Tab**: Launch an isolated BrowserView session.
2. **Navigate**: Native Electron browsing with deep instrumentation.
3. **Inspect**: Real-time DOM scanning via preload scripts (no `evaluate` overhead).
4. **Interact**: Trigger verified action contracts. The system confirms state shifts before reporting success.
5. **Learn**: Successful tasks are automatically converted into **Skills** for replay.

---
Built with Native Electron, SQLite, React, and Tailwind.
