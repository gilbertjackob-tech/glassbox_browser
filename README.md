# GlassBox Browser

GlassBox is a Windows-first Electron browser shell built for visible, verifiable browser automation. It keeps the real page on screen inside an Electron `BrowserView`, exposes a local API for DOM/query/action workflows, and records action evidence in local SQLite storage.

The project is designed around one rule:

```txt
No success without evidence.
```

Actions are not treated as successful just because an input event was sent. GlassBox resolves a target, performs the action, verifies the resulting state change, and stores the result locally.

## Current scope

Implemented and live in the repo:

- Visible Electron browser tabs with profile-isolated sessions
- Local Express API for tab control, DOM inspection, action execution, skills, site packs, and room-aware suggestions
- Target resolution flow: memory -> starter pack -> scan
- Verified action execution by target
- Sequential action chains
- Micro-skill save, list, and replay
- Site-room detection and room-specific suggestions
- Safe suggestion execution through saved skills only
- Fast packs for:
  - Google Search
  - YouTube
  - GitHub
  - ChatGPT
  - Gemini

## Stack

- Electron
- React
- TypeScript
- Vite
- Express
- SQLite via `better-sqlite3`

## Project layout

- [src/main/main.ts](p:/Hasnat/mirror_browser/src/main/main.ts): Electron entrypoint and shell wiring
- [src/main/apiServer.ts](p:/Hasnat/mirror_browser/src/main/apiServer.ts): local HTTP API
- [src/server/tabManager.ts](p:/Hasnat/mirror_browser/src/server/tabManager.ts): BrowserView tab lifecycle and profile session handling
- [src/server/vlmPageApi.ts](p:/Hasnat/mirror_browser/src/server/vlmPageApi.ts): DOM/query/action/skill/site-room server logic
- [src/server/sitePacks](p:/Hasnat/mirror_browser/src/server/sitePacks): starter packs for supported sites
- [src/server/siteRooms](p:/Hasnat/mirror_browser/src/server/siteRooms): room detectors and room suggestions
- [src/server/skillService.ts](p:/Hasnat/mirror_browser/src/server/skillService.ts): micro-skill persistence and rendering
- [src/server/targetMemoryService.ts](p:/Hasnat/mirror_browser/src/server/targetMemoryService.ts): target memory
- [src/main/memoryDb.ts](p:/Hasnat/mirror_browser/src/main/memoryDb.ts): SQLite schema and DB bootstrap
- [src/App.tsx](p:/Hasnat/mirror_browser/src/App.tsx): React shell

## Local storage

GlassBox stores everything locally.

- Database path: `data/glassbox.sqlite`
- Profile/browser runtime data: `userData/`, `Partitions/`, `Cookies`, `Local Storage/`, `IndexedDB/`, `Session Storage/`
- Encrypted full-profile backup extension: `.gbprofile`

Stored data includes:

- profiles
- tabs
- browsing history
- downloads metadata
- saved credentials
- action logs
- target memory
- micro-skills

To reset local memory, remove `data/glassbox.sqlite`. To clear a profile’s browser state, remove its persisted Electron profile storage.

## Profiles

Profiles are isolated Electron session partitions.

- cookies and session state stay separated by profile
- history, downloads, action logs, and saved credentials are profile-scoped
- the default profile can exist without an attached email
- non-default profiles can detect a Google account email after manual login

Important:

- GlassBox profiles are not Chrome profiles
- Chrome sync/import is not implemented
- login persistence depends on the website and its own security rules

## Running locally

Install dependencies:

```powershell
npm install
```

Run the renderer dev server only:

```powershell
npm run renderer:dev
```

Run the full Electron app in dev mode:

```powershell
npm run electron:dev
```

Build:

```powershell
npm run build
```

Typecheck:

```powershell
npm run lint
```

## Local API

The local API is served by the Electron main process on `http://127.0.0.1:3000`.

### Profiles and settings

- `GET /api/profiles`
- `POST /api/profiles`
- `PATCH /api/profiles/:id`
- `DELETE /api/profiles/:id`
- `POST /api/profiles/:id/open`
- `POST /api/profiles/:id/detect-email`
- `POST /api/profiles/export-full`
- `POST /api/profiles/import-full`
- `GET /api/settings`
- `PUT /api/settings`

### Skills and site packs

- `GET /api/skills`
- `POST /api/skills`
- `GET /api/site-packs`
- `GET /api/site-packs/:host`
- `POST /api/site-packs/:host/install-skills`

### Tabs and inspection

- `GET /api/tabs`
- `POST /api/tabs`
- `DELETE /api/tabs/:id`
- `PUT /api/tabs/:id/focus`
- `GET /api/tabs/:id/dom`
- `GET /api/tabs/:id/html`
- `POST /api/tabs/:id/query`
- `GET /api/tabs/:id/screenshot`
- `POST /api/tabs/:id/style`
- `GET /api/tabs/:id/a11y`
- `GET /api/tabs/:id/action-targets`
- `GET /api/tabs/:id/state`
- `POST /api/tabs/:id/action/evaluate`

### Target resolution and verified actions

- `POST /api/tabs/:id/resolve-target`
- `POST /api/tabs/:id/action/by-target`
- `POST /api/tabs/:id/action/resolve-and-act`
- `POST /api/tabs/:id/action/run-chain`
- `POST /api/tabs/:id/skills/run`
- `POST /api/tabs/:id/site-room/run-suggestion`
- `POST /api/tabs/:id/memory/resolve-target`
- `POST /api/tabs/:id/action/click`
- `POST /api/tabs/:id/action/type`
- `POST /api/tabs/:id/action/scroll`
- `POST /api/tabs/:id/action/navigate`
- `POST /api/tabs/:id/action/wait`
- `POST /api/actions`

### Room awareness and suggestions

- `GET /api/tabs/:id/site-room`
- `GET /api/tabs/:id/site-room/suggestions`

### Memory and credentials

- `GET /api/memory/targets`
- `GET /api/memory/search`
- `GET /api/memory/history`
- `DELETE /api/memory/history`
- `GET /api/memory/downloads`
- `DELETE /api/memory/downloads`
- `GET /api/memory/logs`
- `GET /api/passwords`
- `POST /api/passwords`
- `DELETE /api/passwords/:id`

## Verified action model

GlassBox separates these layers:

1. Target discovery
2. Target memory
3. Starter-pack fallback
4. Safe action execution
5. Post-action verification
6. Evidence logging

Current important flows:

- `resolveTarget()`:
  - target memory first
  - starter pack second
  - generic scan fallback last
- `actionResolveAndAct()`:
  - resolves target
  - executes action
  - verifies outcome
- `runActionChain()`:
  - validates all steps first
  - runs sequentially
  - stops on failure by default
- `runMicroSkill()`:
  - loads a saved skill
  - renders placeholders from runtime inputs
  - replays it through `runActionChain()`

## Starter packs

Starter packs are hints, not blind automation rules.

Each pack defines:

- target aliases/selectors
- allowed action shapes
- starter micro-skills

Current packs:

- Google Search
- YouTube
- GitHub
- ChatGPT
- Gemini

Starter packs are used only after target memory fails. A pack target must still be verified against the live DOM before use.

## Site rooms

GlassBox can classify supported sites into room/page types and then suggest safe next steps.

### Google

- `google_home`
- `google_search_results`
- `google_unknown`

Safe skills:

- `google_search`
- `google_open_first_result`
- `google_search_and_open_first`

### YouTube

- `youtube_home`
- `youtube_search_results`
- `youtube_watch_page`
- `youtube_channel_page`
- `youtube_unknown`

Safe skills:

- `youtube_search`
- `youtube_open_first_result`
- `youtube_search_and_open_first`
- `youtube_pause_or_play_video`

Guarded targets:

- `like_button`
- `subscribe_button`
- `comment_box`

### GitHub

- `github_home`
- `github_repo`
- `github_search_results`
- `github_issues`
- `github_pulls`
- `github_unknown`

Safe skills:

- `github_search`
- `github_open_issues`
- `github_open_pulls`
- `github_open_first_search_result`

Guarded/disabled for the fast pack:

- issue creation
- PR creation
- comments
- merges
- stars/follows
- deletes

### ChatGPT

- `chatgpt_auth`
- `chatgpt_home`
- `chatgpt_chat`
- `chatgpt_unknown`

Safe skills:

- `chatgpt_send_prompt`
- `chatgpt_new_chat`

Guarded/disabled:

- login automation
- settings/memory changes
- uploads
- voice mode
- workspace/billing actions

### Gemini

- `gemini_auth`
- `gemini_home`
- `gemini_chat`
- `gemini_unknown`

Safe skills:

- `gemini_send_prompt`
- `gemini_new_chat`

Guarded/disabled:

- login automation
- uploads
- voice/mic actions
- sharing/deletes
- account/workspace/billing actions

## Room-aware suggestions

`GET /api/tabs/:id/site-room/suggestions` returns room-aware suggestions only. It does not act.

`POST /api/tabs/:id/site-room/run-suggestion` executes only suggestions that are:

- `type: "skill"`
- `safe: true`
- not guarded

Guarded targets such as YouTube like/subscribe or auth-only actions are refused.

## Micro-skills

Saved micro-skills are stored in the existing `skills` table.

Supported behavior:

- save a skill directly with `POST /api/skills`
- save a successful chain as a skill
- list saved skills
- fetch and replay a skill by name or id
- render placeholder inputs like `{{query}}` or `{{prompt}}`
- increment `success_count` and `failure_count`

## CLI

The repo includes a local CLI:

```powershell
npm run gb -- profile list
npm run gb -- profile create "Work" --id work
npm run gb -- open --profile work --url https://example.com
npm run gb -- query --tab <tabId> --sel "button"
npm run gb -- click --tab <tabId> --sel "button.login"
npm run gb -- type --tab <tabId> --sel "input[name='email']" --text "user@example.com"
```

## Keyboard shortcuts and shell UX

The app includes:

- editable keyboard shortcuts
- command palette
- settings subpages
- utility panels
- profile creation and email detection
- encrypted full-profile backup/restore
- shell-level address bar, tabs, and navigation controls

## Test scripts

The repo includes API-level verification scripts under [scripts](p:/Hasnat/mirror_browser/scripts).

Core progression scripts:

- `test-action-targets.mjs`
- `test-action-by-target.mjs`
- `test-action-verification.mjs`
- `test-target-memory.mjs`
- `test-memory-first-resolve.mjs`
- `test-resolve-and-act.mjs`
- `test-run-chain.mjs`
- `test-run-chain-failure.mjs`
- `test-save-micro-skill.mjs`
- `test-run-micro-skill.mjs`
- `test-run-micro-skill-failure.mjs`
- `test-run-micro-skill-fail-count.mjs`
- `test-site-packs.mjs`
- `test-site-pack-resolve.mjs`
- `test-site-pack-install-skills.mjs`

Site fast-pack scripts:

- `test-google-fast-pack.mjs`
- `test-youtube-target-map.mjs`
- `test-youtube-watch-actions.mjs`
- `test-youtube-skill-replay.mjs`
- `test-youtube-room-map.mjs`
- `test-youtube-room-suggestions.mjs`
- `test-youtube-run-safe-suggestion.mjs`
- `test-github-fast-pack.mjs`
- `test-chatgpt-fast-pack.mjs`
- `test-gemini-fast-pack.mjs`

Most debug folders are ignored by `.gitignore` through:

```gitignore
debug-*/
*-output/
```

## Safety boundaries

Fast packs intentionally avoid account-changing or public actions by default.

Not automated in the current fast-pack layer:

- login flows
- comments/posts
- issue/PR creation
- merges/deletes
- stars/follows
- account/workspace settings
- uploads and voice flows for LLM chat products

If a site requires login, the expected safe behavior is:

```txt
detect auth room
report auth required
wait for manual login
rerun after prompt surface is available
```

## Known behavior

- `npm run electron:dev` runs Electron against `dist-electron`, so main-process changes require a rebuild plus app restart to take effect reliably.
- The address bar is synced from the active tab model; redirect-heavy pages may require the shell refresh path to catch up after navigation.
- Some sites expose contenteditable prompt surfaces rather than plain `<textarea>` elements, so prompt-target selectors intentionally include both forms.

## Development note

If you change main-process API behavior, do this before validating:

```powershell
npm run build
npm run electron:dev
```

Then run the relevant test script from `scripts/`.
