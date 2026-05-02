# GlassBox Browser (MVP)

An automation-native browser shell where the agent is the user. GlassBox provides deep transparency into DOM, session memory, and action verification.

## 🚀 Key Features
- **Native Browser Control**: Each tab is a visible Electron BrowserView. The agent controls the live GUI window - nothing runs headlessly.
- **GlassBox DOM**: Every element is inspected for role, text, and bounding box.
- **Action Contracts**: "No success without evidence". Every action (click/type) is verified and logged to a SQLite memory database.
- **Profile Partitioning**: SQLite-driven profiles with isolated sessions.
- **Shortcut Registry**: Keyboard shortcuts are grouped by Navigation, Tabs, Profiles, Settings, Utility Panels, Automation, Safety, and Command, with a CLI-equivalent string for each command.
- **Technical UI**: A high-density "Mission Control" interface for monitoring automation.

## 📁 Architecture
- `src/main/main.ts`: Electron entry point and visible window lifecycle.
- `src/main/apiServer.ts`: Local Express API server.
- `src/server/tabManager.ts`: Lifecycle management for visible Electron BrowserView tabs.
- `src/server/vlmPageApi.ts`: Glass-box perception and VLM action API.
- `src/main/memoryDb.ts`: Core SQLite persistence for GlassBox memory.
- `src/lib/shortcuts.ts`: Default shortcut registry, parser, formatter, and conflict detection helpers.
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
GlassBox profiles are Electron profiles, not real Chrome profiles. Login cookies and session data persist per GlassBox profile, but Chrome browser sync/import is not implemented.

## Keyboard Shortcuts
GlassBox includes a registry-backed keyboard shortcut system with command IDs and CLI-equivalent strings for future routing parity.

- Open `Settings -> Keyboard Shortcuts` to search, filter, edit, reset individual shortcuts, or reset all shortcuts.
- Shortcuts are stored locally first in `localStorage` under `gb-shortcuts`.
- Conflicts are detected before replacing an existing shortcut.

Default shortcut groups:
- Navigation: `Ctrl+L`, `Ctrl+K`, `Alt+Left`, `Alt+Right`, `Ctrl+R`, `Ctrl+Shift+R`, `Esc`
- Tabs: `Ctrl+T`, `Ctrl+W`, `Ctrl+Shift+T`, `Ctrl+Tab`, `Ctrl+Shift+Tab`, `Alt+1..9`
- Profiles: `Ctrl+Shift+P`, `Ctrl+Alt+P`, `Ctrl+Alt+E`, `Ctrl+Alt+B`, `Ctrl+Alt+N`, `Ctrl+Alt+0`
- Settings: `Ctrl+,`, `Ctrl+Alt+1..8`
- Utility Panels: `Ctrl+Shift+M`, `Ctrl+Shift+H`, `Ctrl+Shift+J`, `Ctrl+Shift+O`, `Ctrl+Shift+A`, `Ctrl+Shift+U`
- Automation: `Ctrl+Alt+D`, `Ctrl+Alt+H`, `Ctrl+Alt+S`, `Ctrl+Alt+A`, `Ctrl+Alt+Q`, `Ctrl+Alt+X`, `Ctrl+Alt+C`, `Ctrl+Alt+V`, `Ctrl+Alt+R`, `Ctrl+Alt+L`
- Safety: `Ctrl+Alt+Esc`, `Ctrl+Alt+Space`, `Ctrl+Alt+Backspace`, `Ctrl+Alt+Z`
- Command palette: `Ctrl+Shift+K`

## Command Palette
Press `Ctrl+Shift+K` to open the command palette. It lets you search and run registered commands such as:

- `new tab`
- `detect profile email`
- `capture dom`
- `backup profile`
- `open settings`

## Browser Zoom
GlassBox applies zoom to the whole visible browsing surface, including Electron `BrowserView` tabs.

- `Shift + +`: zoom in
- `Shift + -`: zoom out
- `Ctrl + mouse wheel`: zoom in or out
- `Ctrl/Cmd + 0`: reset zoom

## Full Profile Backup
GlassBox supports encrypted full profile backups using `.gbprofile` files.

A full backup can include:
- profile metadata
- history
- downloads metadata
- saved GlassBox passwords
- action logs
- tabs metadata
- Electron persistent session files where possible, including cookies/localStorage/IndexedDB/cache/service workers

Backups are encrypted with a user-supplied password.

Warning:
- Full backups may contain login cookies and session tokens.
- Anyone with the file and password may access logged-in accounts.
- Some websites may still force re-login due to device, IP, 2FA, or risk checks.
- This is not Chrome Sync. It restores GlassBox/Electron profile sessions.

## Profile Identity Rule
GlassBox has one local fallback profile:

- `Default` can be used without an email.

For non-default profiles:

- A profile can be created without email.
- After logging into Google/Gmail in that profile, use `Detect email` to attach account identity.
- The profile name can be renamed.
- The email is used as the profile identity caption and is not editable from Rename.
- If you do not want to attach an email, use the Default profile.

This email is metadata for organizing isolated profiles. It does not automatically prove login or sync Chrome/Google account data.

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
