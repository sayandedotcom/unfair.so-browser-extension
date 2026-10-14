# X Audience Screenshot

Chrome extension (MV3) that screenshots `https://x.com/i/account_analytics/audience` using your logged-in X session and shows it in the popup.

## Install (unpacked)

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Log in to x.com in this Chrome profile.
4. Click the extension icon, then **Capture**.

While capturing, Chrome shows a "started debugging this browser" banner on a temporary background tab. That is expected — the extension uses the Chrome debugger to take screenshots of background tabs. The tab closes when the capture finishes.

## Tests

```
node --test
```

## Manual verification checklist

- [ ] Logged in: Capture → status steps through Opening → Waiting → Capturing → Done; the audience page appears in the popup; the temp tab is gone afterwards.
- [ ] Download PNG saves `x-audience-<timestamp>.png` and the image opens correctly.
- [ ] Close and reopen the popup: the last capture is shown with its timestamp.
- [ ] Logged out (e.g. in a profile with no X session): message "Log in to X in this browser, then try again."
- [ ] Double-click Capture: only one capture runs; no leftover tabs.
- [ ] Close the popup mid-capture, wait ~10 s, reopen: the finished capture is shown; no leftover tabs.
- [ ] Open DevTools on another tab and capture: still works. (To test `ATTACH_FAILED`, it's enough to confirm the error text is readable if it ever occurs.)
- [ ] Charts blank in the screenshot? Increase `SETTLE_MS` in `lib.js` (default 1500).
- [ ] Popup opened for the first time (clear storage via `chrome.storage.local.clear()` in the service-worker console): shows "No reading yet…" with the dashed Capture box and no broken image.

## Web front-end

A browser page (in `web/`) that shows the screenshot as soon as the extension captures it. No backend: the image goes from the extension straight into the page in your browser.

```
python3 -m http.server 5173 -d web
```

Keep that running, open <http://localhost:5173>, then click the extension icon and press **Capture**.

- If the page is open, the capture appears there and its tab is brought to the front.
- If it isn't open, the extension opens it and the page shows the latest capture.
- To serve it from another address, change `FRONTEND_URL` / `FRONTEND_MATCH` in `lib.js` and the `content_scripts` `matches` in `manifest.json` (a unit test keeps them in sync), then reload the extension.

Checks:

```
node --test                      # unit tests
node tests/browser-check.mjs     # the page in headless Chrome; screenshots go to $SHOT_DIR (default /tmp/web-shots)
node tests/e2e-check.mjs         # extension -> page, end to end in headless Chrome (X screenshot step stubbed)
```
