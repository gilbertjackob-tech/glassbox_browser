# GlassBox Browser Verification Checklist

## Dependency checks

```bash
npm ls playwright playwright-core @playwright/test playwright-chromium
```

Expected: no installed Playwright packages.

```bash
grep -R "playwright\|chromium.launch\|newContext\|newPage" -n src scripts package.json README.md
```

Expected: no runtime Playwright control code.

## Server ownership

```bash
grep -R "app.listen\|createServer" src scripts *.ts
```

Expected: only `src/main/apiServer.ts` owns `app.listen`.

## Build checks

```bash
npm install
npm run lint
npm run build
```

Expected: all pass.

## GUI check

```bash
npm run electron:dev
```

Expected:

* Electron window is visible.
* Default tab appears inside the visible window.
* BrowserView is not zero-sized.

## Profile isolation check

1. Create profile `Work`.
2. Open a site and log in.
3. Switch/create `Default` profile.
4. Same site should not share login state.

## Perception endpoint checks

Use real tab id from:

```bash
curl http://127.0.0.1:3000/api/tabs
```

HTML:

```bash
curl http://127.0.0.1:3000/api/tabs/<tabId>/html
```

Query:

```bash
curl -X POST http://127.0.0.1:3000/api/tabs/<tabId>/query ^
  -H "Content-Type: application/json" ^
  -d "{\"selector\":\"a\",\"limit\":5}"
```

Screenshot:

```bash
curl http://127.0.0.1:3000/api/tabs/<tabId>/screenshot --output shot.png
```

Style:

```bash
curl -X POST http://127.0.0.1:3000/api/tabs/<tabId>/style ^
  -H "Content-Type: application/json" ^
  -d "{\"selector\":\"body\",\"properties\":[\"display\",\"font-family\"]}"
```

## Action endpoint checks

Click:

```bash
curl -X POST http://127.0.0.1:3000/api/tabs/<tabId>/action/click ^
  -H "Content-Type: application/json" ^
  -d "{\"selector\":\"a\"}"
```

Type:

```bash
curl -X POST http://127.0.0.1:3000/api/tabs/<tabId>/action/type ^
  -H "Content-Type: application/json" ^
  -d "{\"selector\":\"input\",\"text\":\"hello\",\"clearFirst\":true}"
```

Wait present:

```bash
curl -X POST http://127.0.0.1:3000/api/tabs/<tabId>/action/wait ^
  -H "Content-Type: application/json" ^
  -d "{\"selector\":\"body\",\"until\":\"present\",\"timeoutMs\":3000}"
```

Wait absent timeout regression:

```bash
curl -i -X POST http://127.0.0.1:3000/api/tabs/<tabId>/action/wait ^
  -H "Content-Type: application/json" ^
  -d "{\"selector\":\"body\",\"until\":\"absent\",\"timeoutMs\":1000}"
```

Expected:

* HTTP `408`
* JSON `{ "ok": false, "reason": "timeout", ... }`

## Action log check

After actions, inspect SQLite `actions` table.

Expected columns should be populated where possible:

* `before_url`
* `after_url`
* `before_dom_hash`
* `after_dom_hash`
* `evidence_json`

SPA pages should still get DOM hash fallback from `document.documentElement.outerHTML`.
