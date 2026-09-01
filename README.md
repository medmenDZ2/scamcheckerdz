# SCAMCHECK — Browser Extension (MVP)

A Manifest V3 extension for Chrome, Edge, Brave, and Opera (all Chromium —
same install steps, same code). It checks the current page's URL
automatically, offers a deeper "Full check" that also sends page content,
and lets you paste any text or link to check on demand.

It ships with **no backend included** — you plug in your own API.

## Install (load unpacked)

Works the same in Chrome, Edge, Brave, and Opera:

1. Go to the extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
   - Opera: `opera://extensions`
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `scamcheck-extension` folder.
4. Click the SCAMCHECK icon in the toolbar → the gear icon → enter your
   backend's API URL.

## What's included

```
manifest.json     MV3 manifest
background.js     badges each tab after a lightweight URL check
content.js        extracts page text/links/forms ONLY when asked (passive)
popup.html/js/css current-page result + manual paste checker + QR upload
options.html/js/css  backend URL, API key, auto-check toggle
qr-scanner.html/js/css  full-tab live camera QR scanner
lib/api.js        shared fetch client + response validation
icons/            toolbar icons
```

## QR codes

Two ways to check a QR code, both decode locally in the browser using the
native `BarcodeDetector` API — no external library, nothing uploaded to
decode it:

- **Upload QR image** (in the popup) — pick an image file containing a QR
  code; it's decoded on your device, then the destination is sent to your
  backend for a normal check.
- **Scan with camera** (in the popup) — opens a dedicated tab with a live
  camera view, since browsers close extension popups when the camera
  permission prompt steals focus. Same decode-locally, check-after
  behavior.

In both paths the destination is always shown and never opened
automatically — you have to click "Open destination" (or "Open anyway" if
it was flagged), and a high-risk result asks for one more confirmation
before opening.

`BarcodeDetector` is supported in Chrome, Edge, and Opera by default.
Support in Brave can vary depending on the user's shields/fingerprinting
settings; if it's unavailable, both QR entry points show a plain message
saying so rather than failing silently.

## How data flows

- **Nothing is sent anywhere until you set an API URL** in settings.
- Automatic per-page checks (toggle in settings) send only the **URL** of
  each page you visit to your backend, to badge the toolbar icon.
- **Full check** additionally sends the page's title, meta description, a
  capped excerpt of visible text, links, and form metadata (e.g. whether a
  form has a password field) — only when you click the button.
- The paste box sends only what you paste.
- The extension itself stores no history; it holds the last result per open
  tab in memory (cleared when the tab closes) and your settings in
  `chrome.storage.sync`.

## Backend API contract

Your backend must implement two endpoints. CORS: allow the extension's
origin, or simply allow the methods below from any origin, since the
request is coming from the browser's extension context, not a web page.

### `GET /v1/health`
Return any `2xx` response. Used by the "Test connection" button.

### `POST /v1/check`

Request:
```json
{
  "type": "url",
  "content": "https://example.com/reset-password?id=8213",
  "pageContext": {
    "url": "https://example.com/reset-password?id=8213",
    "title": "Verify your account",
    "metaDescription": "",
    "excerptText": "Your account will be permanently deleted in 30 minutes unless you verify now...",
    "links": [{ "href": "https://example.com/verify", "text": "Verify now" }],
    "forms": [{ "action": "/submit", "hasPasswordField": true, "hasPaymentField": false }]
  }
}
```
`pageContext` is present only for on-page checks (and only for "Full
check"); it's absent for pasted text/links. `type` is `"url"` or `"text"`.

Response:
```json
{
  "riskLevel": "high",
  "summary": "This page impersonates an account-verification flow and pressures immediate action.",
  "warningSigns": ["Creates urgency", "Requests a password", "Lookalike domain"],
  "evidence": [
    { "quote": "permanently deleted in 30 minutes", "reason": "Urgency/manipulation" }
  ],
  "recommendedActions": {
    "avoid": ["Don't enter your password here", "Don't click the verify link"],
    "do": ["Go to the official site directly and log in from there"]
  },
  "category": "phishing",
  "confidence": 0.86
}
```
`riskLevel` must be `"low"`, `"suspicious"`, or `"high"`. Anything else is
treated as unknown and rendered neutrally in the UI — if your model isn't
confident, return `"low"` with a summary that says so explicitly (per the
spec: never fabricate evidence, never overstate certainty). All other
fields are optional; the extension only renders what's present.

A minimal reference implementation (rule-based, no AI dependency — good for
testing the extension end-to-end) is in [`example-backend/`](../example-backend).

## Permissions, explained

- `storage` — save your backend URL/key and the auto-check toggle.
- `activeTab`, `tabs` — read the current tab's URL to check it and show a
  badge.
- `scripting` — reserved for future in-page highlighting of flagged text.
- content script on `<all_urls>` — passive; it only responds when the
  popup/background explicitly asks it for page text, and never runs network
  requests itself.
- `optional_host_permissions: <all_urls>` — requested narrowly, only for
  the specific backend origin you enter in settings, the first time you
  save or test it. The extension never has broad host access until then.

## Known MVP limits (see the full spec for the roadmap)

- No screenshot upload or QR scanner yet (Phases 2–3 in the product spec).
- No local/offline detection layer — every check requires your backend to
  be reachable.
- No user accounts or history — by design, per the spec's "MVP works
  without registration" requirement.
