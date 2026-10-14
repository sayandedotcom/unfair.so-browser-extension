# Browser Front-End (Screenshot Drop Page) — Design

## Goal
A standalone browser web page, separate from the Chrome extension (which stays unchanged), where the user can drop, choose, or paste a screenshot of their X audience page and see it previewed. UI only: no backend, no API key, nothing leaves the browser.

## Assumptions
- The page is for the user's own use, served locally during development.
- A web page cannot capture another site, so the screenshot comes from the user (drop / file picker / paste).
- "Read the numbers off the screenshot" and extension hand-off are explicitly out of scope for this version.

## Approach
Plain HTML, CSS and JS in a `web/` folder. No build step, no dependencies. (Vite and Next.js were considered and rejected as too heavy for a single static page; Next.js can be adopted later if a backend arrives.)

## Files
| File | Responsibility |
|---|---|
| `web/index.html` | Markup: card, lead line, heading, banner, drop zone, preview area, error line, hidden file input. |
| `web/styles.css` | Visual design matching the mockup: light grey page, white rounded card, blue banner, dashed drop zone. Responsive, max card width 640 px. |
| `web/app.js` | Behaviour: drag/drop, click-to-choose, paste, preview, replace/remove, errors, object-URL cleanup. |
| `web/helpers.js` | Pure helpers shared by the page and Node tests (`window.WebHelpers` / `module.exports`): `validateImage(file)`, `formatBytes(n)`. No DOM access. |
| `tests/web-helpers.test.js` | Unit tests for `helpers.js` (`node --test`). |

## Layout and copy
- Lead line: "No screenshot yet. Screenshot your X audience page and drop it here." After an image is accepted: "Screenshot ready." Errors replace the lead line text in the error colour.
- Heading: "Send a screenshot".
- Banner (blue tint): title "Open your X audience page", subtitle "Only you can see it — screenshot the whole tab and we do the rest.", link `open ↗` to `https://x.com/i/account_analytics/audience` (`target="_blank" rel="noopener"`).
- Drop zone (dashed border): image icon, "Drop your screenshot", "or click to choose — paste works too".

## Behaviour
- **Accepting input:** drop an image onto the zone; click (or Enter/Space when focused) to open the file picker (`accept="image/png,image/jpeg,image/webp"`); paste (Ctrl/Cmd+V) an image from the clipboard anywhere on the page.
- **Drag feedback:** while an item is dragged over the zone it gets a highlighted border/background; the highlight clears on leave and drop. Dropping a file anywhere else on the page must not navigate the browser away from the page.
- **Validation (`validateImage`):** accepted types `image/png`, `image/jpeg`, `image/webp`; max size 10 MB (10 * 1024 * 1024 bytes); zero-byte files rejected. A rejected file shows an inline error and leaves the current state (empty or existing preview) unchanged. If several files are dropped, only the first is used.
- **Preview state:** the drop zone is replaced by a framed preview (`<img>` from an object URL, max height ~420 px, scrollable, width 100%), the file name and size (`formatBytes`), and **Replace** (opens the file picker) and **Remove** (returns to the empty state) links.
- **Cleanup:** the previous object URL is revoked whenever the image is replaced or removed.
- **Accessibility:** the drop zone is a `<button>`; status/errors are in an `aria-live="polite"` region; focus returns to the drop zone after Remove.
- **Privacy:** the image is read locally via object URLs only; there is no network request carrying it.

## Error messages
- Wrong type: "That file isn't a PNG, JPEG or WebP image."
- Too large: "That image is over 10 MB. Try a smaller screenshot."
- Empty file: "That file is empty."
- Clipboard paste with no image: ignored silently (plain-text paste must keep working elsewhere).

## Running
`python3 -m http.server 5173 -d web`, then open `http://localhost:5173`. Documented in `README.md`.

## Testing
- Unit tests (`node --test`) for `validateImage` and `formatBytes`, including boundary sizes (exactly 10 MB accepted, 10 MB + 1 rejected), empty file, unknown/missing type, and `formatBytes` for 0, bytes, KB, MB.
- Real-browser checks in headless Chrome against the served page: simulated drop, click-to-choose, and paste each produce the preview; an invalid file shows the error and keeps state; Replace and Remove work; the zone is keyboard-operable. A rendered screenshot of the empty and preview states is compared to the mockup.

## Out of scope
Reading numbers from the screenshot (AI/OCR), any backend or API keys, extension-to-page hand-off, authentication, persistence across reloads, deployment.
