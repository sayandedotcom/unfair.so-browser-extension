# X Audience Screenshot

Capture your **X (Twitter) audience analytics** page with one click and see the screenshots in a small web page. Everything runs in your own browser, using your existing X login. There is no backend and nothing is uploaded.

```
 Chrome extension ──captures──▶ x.com/i/account_analytics/audience
        │
        └──sends the screenshots──▶ front-end page (http://localhost:5173)
```

## What it does

- Opens your X audience page in a temporary background tab, using your logged-in session.
- Takes **two screenshots**: the top of the page, then the page **scrolled all the way down**.
- Captures at the size of your current browser tab, so X shows the same full layout you see.
- Shows both screenshots in the front-end page, with **Capture**, **Recapture** and **Clear** buttons.

## Quick start

You need Google Chrome, Python 3 (to serve the page), and to be logged in to x.com in Chrome.

**1. Get the code and start the front-end**

```bash
git clone https://github.com/sayandedotcom/unfair.so-browser-extension.git
cd unfair.so-browser-extension
python3 -m http.server 5173 -d web
```

Already have the folder? Just `cd` into it. Leave the server running and open <http://localhost:5173>.

**2. Install the extension**

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and select the project folder (the one containing `manifest.json`).
3. Optional: pin **X Audience Screenshot** from the puzzle-piece menu.

**3. Capture**

- In the front-end page, click **Capture your screenshot** (or **Recapture** once you have one), **or** click the extension icon and press **Capture**.
- Wait about 5–20 seconds. A temporary tab opens and closes by itself.
- The screenshots appear in the page. **Clear** removes them.

> While capturing, Chrome shows **"X Audience Screenshot started debugging this browser"**. That is expected: the extension uses Chrome's debugger to screenshot a background tab. Don't click **Cancel** on it, or the capture stops.

After changing any extension file (`manifest.json`, `background.js`, `content.js`, `lib.js`, `popup.*`), click the reload icon on the extension's card in `chrome://extensions`, then refresh the front-end page.

## How it works

| Piece | File(s) | Job |
|---|---|---|
| Service worker | `background.js`, `lib.js` | Opens the X page in a background tab, drives it through the Chrome debugger (`Page.captureScreenshot`), scrolls to the bottom for the second shot, saves the result, and sends it to the front-end. |
| Content script | `content.js` | Runs only on `http://localhost:5173`. Bridges the page and the extension: relays Capture/Clear clicks and delivers screenshots. |
| Popup | `popup.html`, `popup.css`, `popup.js` | Quick Capture button and preview from the toolbar icon. |
| Front-end | `web/` | The page that displays the screenshots. Accepts only PNG data from the extension. |

If the front-end isn't open when a capture finishes, the extension opens it and the page asks for the latest capture.

## Troubleshooting

| You see | Do this |
|---|---|
| "Log in to X in this browser, then try again." | Log in to x.com in this Chrome profile, then capture again. |
| "X sent the tab somewhere other than the analytics page…" | Your account may not have access to Analytics (it can need Premium). Open the page yourself with the **open ↗** link to check. |
| "Can't reach the extension…" in the front-end | Reload the extension on `chrome://extensions`, refresh the page, try again. |
| New tab says "can't connect" | The front-end server isn't running. Start it (step 1). The capture is still in the extension popup. |
| Layout looks compact / different from your window | Press Capture from a normal-sized, maximised tab. The capture uses that tab's size (limited to 1280–2560 × 600–1600). |
| Second screenshot isn't at the very bottom | X may lazy-load more content. Increase the 1200 ms wait in `background.js`. |

To serve the front-end from another address, change `FRONTEND_URL` / `FRONTEND_MATCH` in `lib.js` and `content_scripts.matches` in `manifest.json` (a unit test keeps them in sync).

## Development

```bash
node --test                      # unit tests
node tests/browser-check.mjs     # front-end page in headless Chrome (screenshots go to $SHOT_DIR, default /tmp/web-shots)
node tests/e2e-check.mjs         # extension → page, end to end in headless Chrome (the X screenshot step is stubbed)
```

Use bare `node --test` (passing a directory fails on Node 22). The browser checks need Chrome (`google-chrome`, or set `CHROME=/path/to/chrome`).

Design notes and implementation plans live in `docs/superpowers/`.
