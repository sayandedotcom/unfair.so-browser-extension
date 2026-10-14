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

A standalone browser page (separate from the extension) where you drop, choose, or paste a screenshot of your X audience page and see it previewed. Nothing is uploaded; it all stays in your browser.

```
python3 -m http.server 5173 -d web
```

Then open <http://localhost:5173>.

- Drop an image on the dashed box, click it to choose a file, or paste with Ctrl/Cmd+V. PNG, JPEG and WebP up to 10 MB.
- **Replace** and **Remove** appear under the preview.

Checks:

```
node --test                      # unit tests
node tests/browser-check.mjs     # real-browser checks (needs Chrome); screenshots go to $SHOT_DIR
```
