# X Audience Screenshot Extension — Design

## Goal
A personal-use Chrome extension (Manifest V3, plain JavaScript, no backend, no build step). Clicking the extension icon opens a popup with a **Capture** button. On click, the extension screenshots `https://x.com/i/account_analytics/audience` using the user's existing logged-in X session and displays the image in the popup.

## Assumptions
- The user is analysing their own X account and is already logged in to x.com in this Chrome profile.
- Loaded unpacked; not published to the Chrome Web Store.

## Approach
Debugger-based capture in a background tab (chosen over `captureVisibleTab` in a temporary window, which steals focus and closes the popup).

## Files
| File | Responsibility |
|---|---|
| `manifest.json` | MV3 manifest. Permissions: `tabs`, `debugger`, `storage`, `unlimitedStorage`. Host permission: `https://x.com/*`. Action popup: `popup.html`. Service worker: `background.js`. |
| `background.js` | Service worker. Owns the capture flow; receives `capture` message from popup; returns result. |
| `lib.js` | Pure helpers (e.g. `isLoginUrl(url)`), shared by background (via `importScripts`) and unit-testable in Node. |
| `popup.html` / `popup.css` / `popup.js` | UI: Capture button, status line, screenshot preview, Download PNG button. |

## Capture flow
1. Popup sends `{type: "capture"}` to the service worker and shows status updates (service worker reports progress via `chrome.runtime.sendMessage` or a port).
2. Service worker creates an inactive tab at the analytics URL.
3. Wait for tab `status === "complete"`, then wait for network idle (CDP `Page.lifecycleEvent` `networkIdle`) with a 15 s overall timeout, plus a short settle delay (~1.5 s) for the SPA to render charts.
4. Inspect the tab's final URL. If `isLoginUrl(url)` (path starts with `/i/flow/login` or `/login`), abort with error `NOT_LOGGED_IN`.
5. Attach `chrome.debugger` (protocol 1.3), call `Emulation.setFocusEmulationEnabled` and `Page.captureScreenshot` (`format: "png"`, `captureBeyondViewport: true` for full page), then detach.
6. Close the temporary tab (always, in a `finally`).
7. Return the PNG as a data URL to the popup and persist `{dataUrl, capturedAt}` in `chrome.storage.local` under key `lastCapture`.

## Popup behaviour
- On open: read `lastCapture` from storage; if present, show it with its timestamp.
- Capture button disabled while a capture is running. Status text: *Opening page → Waiting for page to load → Capturing → Done*.
- Download PNG button saves the current image as `x-audience-<ISO timestamp>.png`.

## Error handling
Each error surfaces as a message in the popup; the temp tab is always closed and the debugger always detached.
- `NOT_LOGGED_IN` — "Log in to X in this browser, then try again."
- `UNEXPECTED_REDIRECT` — the tab ended on a non-login URL outside `/i/account_analytics` (e.g. an upsell page); message includes the final URL.
- `TIMEOUT` — page did not finish loading within 15 s (neither `networkIdle` nor `load` seen). If `networkIdle` never fires but `load` did, proceed anyway — X keeps connections open.
- `ATTACH_FAILED` — debugger could not attach (e.g. DevTools already open on that tab).
- `CAPTURE_FAILED` — CDP call returned an error (message included).

## Testing
- Unit tests (Node's built-in `node:test`) for `lib.js` helpers: login-URL detection.
- Manual verification: load unpacked at `chrome://extensions`, run a capture while logged in (expect the audience page image), and while logged out (expect `NOT_LOGGED_IN`).

## Out of scope
Scheduling, capture history, extracting numeric values from the page, Web Store packaging, other browsers.
