# Architecture & Tech Stack

General product concept lives in `IDEA.md`.

This is a static, browser-only collection of small tools.

## Tech Stack

- **Framework**: **Svelte 5** (Runes: `$state`, `$derived`, `$effect`) with **SvelteKit** and **TypeScript**.
  - One route per tool, so SvelteKit emits a separate JS chunk per tool. The landing page must not import those chunks.
  - Fine-grained reactivity keeps the two panes in sync.
- **Styling**: **Tailwind CSS v4** plus a small set of CSS custom properties for the shared accent palette.
  - Friendly, slightly colorful, professional, and minimal.
  - Desktop first. Split-pane tools should fill the viewport instead of sitting in a narrow column.
- **Build & Package Manager**: **Vite** + **pnpm**.
- **Output**: `@sveltejs/adapter-static` with prerendering. Every route is known at build time, so the production build is a set of static files.
- **WebAssembly**: allowed when it is the right tool for the job — heavy local computation, or a library that already compiles to Wasm. Prefer ordinary TypeScript when that stays small and clear. The `.wasm` module is a same-origin asset of that tool, imported only from `frontend/src/lib/tools/<slug>/`, so the landing page never downloads it. Input stays in the browser; Wasm does not justify a server.

Do not add a backend. If a tool cannot be done locally in the browser (including Wasm), stop and ask.

## Modular Structure

Share chrome across tools. Keep each tool extractable: its route, its module, and its thumbnail should be the only places that know it exists, plus one metadata entry.

1. **Tool registry (`frontend/src/lib/tools.ts`)**
   - Data only: `slug`, `title`, `description`, `tags`, thumbnail path.
   - The landing page filters this list for search. It must not import anything under `frontend/src/lib/tools/<slug>/`.
2. **Core (`frontend/src/lib/core/`)**
   - Shared UI so tools do not invent their own controls: gallery card, search field, split pane (horizontal or vertical), copy-to-clipboard button, info-hint icon, local file open/save.
   - Hints go behind the info icon. Do not put instructional paragraphs on the tool canvas.
   - `InfoHint` draws its own tooltip (shown instantly on hover, focus or tap, `position: fixed` so panes cannot clip it). Do not use the native `title` attribute for hints; it appears only after a delay.
3. **One module per tool (`frontend/src/lib/tools/<slug>/`)**
   - UI, conversion logic, and any Wasm module live here. Heavy dependencies (parsers, highlighters, `.wasm`) are imported only from this module so they stay in that route's chunk.
   - Route: `frontend/src/routes/<slug>/+page.svelte`, which imports that module and nothing from other tools.
   - Thumbnail: a small static SVG at `frontend/static/tools/<slug>.svg`, referenced by the registry. Not a screenshot and not a live render of the tool.

Tool names are the source of truth. The slug is the kebab-case form of the name in `IDEA.md`, and the route, module folder, and thumbnail follow it (see `AGENTS.md`).

Planned tools (behavior is specified in `IDEA.md`):

| Slug | Route | Architectural notes |
| --- | --- | --- |
| `markshift` | `/markshift` | **Markshift** (implemented). Markdown, HTML, and rich text; each pane picks its format. `marked` (MD→HTML), `turndown` + gfm plugin (HTML→MD), own small highlighter (textarea over `<pre>`), own HTML sanitizer. Route is `ssr = false` (DOMParser, contenteditable). Horizontal or vertical split. |
| `base64-encoder-decoder` | `/base64-encoder-decoder` | **Base64 Encoder / Decoder** (implemented). Text and binary (file open / download). Horizontal split only: Base64/URL left, decoded right. JSON is pretty-printed with a small local highlighter; encoding always uses the minified form. Payload lives in the URL hash (`#...`), never the query string. Pasted links can embed Base64 in a path segment, query value, hash, or data URL: that segment is decoded and rewritten in place (URL-safe / padding style preserved). Open-URL when the left pane (or decoded text) is a URL. Segments may carry a short dot-separated version prefix (e.g. `z1.<base64>`); only the Base64 part is rewritten. Optional compression layer (`compress.ts`): gzip, zlib, or raw deflate (pako's `deflate`/`deflateRaw` output) is detected by trying each codec and keeping the reading whose UTF-8 text scores highest on a plausibility check (share of non-control characters, bonus for parseable JSON); compressed readings must score ≥ 0.95 and beat the uncompressed one. A Compression menu overrides it and re-encodes from the text. Platform `btoa`/`atob` + `TextEncoder`/`TextDecoder`; `fflate` for (de)compression because it is small and synchronous, which keeps keystroke-level pane sync simple (`DecompressionStream` is async-only). Route is `ssr = false`. |
| `json-formatter-validator` | `/json-formatter-validator` | **JSON Formatter, Validator**. Format, validate, minify, or pretty-print. Local file open/save and clipboard. Horizontal or vertical split. |
| `gpx-cleaner` | `/gpx-cleaner` | **GPX Cleaner** (implemented). No dependencies. `DOMParser` reads the file; export clones the original document and writes one `<trk>`/`<trkseg>` from cloned `<trkpt>` elements, so `<time>`, `<ele>`, `<extensions>`, waypoints and metadata survive. Maps are canvases in Web Mercator scaled to meters at the track's latitude, so OSM raster tiles (`tile.openstreetmap.org`) line up. Tiles are **opt-in** ("Map background" switch, off by default, remembered in `localStorage`) because they reveal the viewed area and IP to the OSM Foundation; attribution is shown on each map while they are on. Pipeline in `pipeline.ts`: transit change-point on the last 20 % → profile from V95 / climb rate → spike filter (angle + acceleration) → stay-point clustering for pauses (running centroid, tolerates two stray fixes; entry and exit points kept at the centroid) → RDP between pause anchors. Route is `ssr = false`. Mobile-friendly: below `md` the panes and the bottom panel stack and the page scrolls. Touch: two fingers pinch-zoom and pan the maps; one finger scrolls the page when stacked (`touch-action: pan-y`) and pans the map side by side. |
| `driveway-planner` | `/driveway-planner` | **Driveway Planner** (implemented). World units are meters (plan top-left origin, y down); the plan image is drawn at `pixels × metersPerPixel`, and changing the scale rescales everything drawn so it stays on the plan. Car = kinematic bicycle model; max steering is derived from published turning circles (`cars.ts`). Path finding (`planner.ts`) is Hybrid A* over rear-axle poses with forward/reverse arc primitives, a Reeds-Shepp + obstacle-aware Dijkstra heuristic and cost-ranked Reeds-Shepp finishing shots; gear changes cost extra, so K-turns appear only when needed. It runs in a module Web Worker. An optional via point per route is driven through, not stopped at: the first leg ends at any pose within `VIA_TOLERANCE` of it (front axle within 40 cm, heading within 20°; no exact Reeds-Shepp finish), the second leg starts from that pose in the same gear (`startGear`, so turning back costs a gear change), and the two fitted splines are joined. The check flags a path that no longer passes the via point; moving the via marker re-plans. The area outline is edited in Area mode (drag, double-click an edge to add, Delete to remove); Select mode only edits markers and the path. The editable path is a Catmull-Rom spline through **front-axle** points, split at gear changes (cusps); the rear axle is derived from it by integrating the tractrix (`spline.ts`), so planner output and manual edits go through the same check (steering limit, footprint + buffer inside the area, end heading). The planner keeps a little slack (88 % steering, +5 cm clearance) and the fit adds points until its own result passes. Swept area = union of convex hulls of consecutive footprints: drawn as one nonzero fill while editing, exact union/area/export via `polygon-clipping`. PDF plans via `pdfjs-dist`, imported dynamically only when a PDF is opened (page 1 at 150 dpi). Export: SVG in meters (plan embedded) and PNG at plan resolution, both from the same scene (`render.ts`). Sharing (`share.ts`): the whole state except the background image lives in the URL hash as `#v1.<Base64url(raw deflate(compact JSON))>` (fflate, coordinates rounded to mm), kept current with `history.replaceState` and copyable via “Copy link”. Only the plan's name and pixel size travel; opening a plan with the same pixel size keeps the drawing and scale, any other plan resets them. Start page examples (`examples.ts`) are generated SVG plans in meters (1:100 at 96 dpi) with an area and routes; they load through the normal plan import and the shared-state path, and every route without a path is planned automatically. Save/Open: “Save” downloads readable JSON `{ format: 'driveway-planner', version: 1, state, image }` with the same state as the link plus the background as a Base64 data URL (PDFs as the rendered PNG); “Open plan…” and drag & drop accept it and validate every field. Route is `ssr = false`. Desktop only. |
| `json-diff` | `/json-diff` | **JSON Diff**. Two JSON panes, beautified on load. Recursive key sort and ignore-case are local view options. Horizontal or vertical split. |

## SvelteKit 3 notes

- Config lives in `frontend/vite.config.ts` (`sveltekit({ adapter })`); there is no `svelte.config.js`.
- `$lib` is gone: use the subpath import `#lib/...` (mapped in `frontend/package.json` `imports`).
- TypeScript is pinned to 5.x; SvelteKit 3.1 does not work with TypeScript 7 yet.

## Pane Sync

Tools with two panes treat either side as editable.

- A change on one side recomputes the other.
- Guard the update so the write-back does not loop.
- Invalid input stays visible in the pane that has it. The other pane shows the error and does not present a successful conversion.
- Only syntax errors that make the conversion meaningless (e.g. unbalanced HTML tags) are `error`s and block the sync; softer problems are `warning`s. The rich-text pane sanitizes everything it emits.
- Syntax highlighting is local and light, and it marks errors inline. Do not load a highlighter from a CDN.

Clipboard and files use browser APIs only (`navigator.clipboard`, `<input type="file">`, download, or the File System Access API). Nothing is uploaded.

## Coding Conventions

- Keep the root `Makefile` up to date. `make dev` installs if needed and starts the Vite dev server. `make check` runs `svelte-check`. `make build` runs the production build.
- Desktop layout by default. A tool is mobile-friendly only when `IDEA.md` says so.
- Prefer small dependencies. A tool that can use the platform (Base64, `JSON.parse`, clipboard, files) should not take on a library or a Wasm module for that. Use Wasm when the local work is heavy enough, or when the useful implementation is already Wasm.
- Shared controls come from `frontend/src/lib/core/`. A one-off control stays inside the tool module.
- The landing page states that data never leaves the browser.
- Landing pages end with a small footer linking "by jakob-r" to https://www.jakob-r.de/coding/ (which carries the legal notice). Tool pages have no footer.

## Production

One image: Node builds the SvelteKit static site, nginx serves the `build/` output.

On the VPS the container sits next to an existing [nginx-proxy](https://github.com/nginx-proxy/nginx-proxy) with acme-companion. It joins the proxy Docker network and sets `VIRTUAL_HOST`, `VIRTUAL_PORT`, `LETSENCRYPT_HOST`, and `LETSENCRYPT_EMAIL`. Leave the proxy's Compose file alone and don't edit nginx by hand. DNS for `VIRTUAL_HOST` must already point at the VPS.

`docker compose up -d --build` (and `make docker-up`) builds and starts that static site. Redeploy with `git pull` and the same command.
