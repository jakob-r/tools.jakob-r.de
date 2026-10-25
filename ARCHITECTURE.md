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
| `base64-encoder-decoder` | `/base64-encoder-decoder` | **Base64 Encoder / Decoder** (implemented). Text and binary (file open / download). Horizontal split only. Payload lives in the URL hash (`#...`), never the query string, so it is not sent to the host. Editing either pane updates the hash. Pasted data URLs and links with a Base64 hash are extracted automatically. If the decoded value is a URL, show a link that opens in a new tab. Platform `btoa`/`atob` with UTF-8 via `TextEncoder`/`TextDecoder`; no extra dependency. Route is `ssr = false`. |
| `json-formatter-validator` | `/json-formatter-validator` | **JSON Formatter, Validator**. Format, validate, minify, or pretty-print. Local file open/save and clipboard. Horizontal or vertical split. |
| `gpx-cleaner` | `/gpx-cleaner` | **GPX Cleaner** (implemented). No dependencies. `DOMParser` reads the file; export clones the original document and writes one `<trk>`/`<trkseg>` from cloned `<trkpt>` elements, so `<time>`, `<ele>`, `<extensions>`, waypoints and metadata survive. Maps are canvases in Web Mercator scaled to meters at the track's latitude, so OSM raster tiles (`tile.openstreetmap.org`) line up. Tiles are **opt-in** ("Map background" switch, off by default, remembered in `localStorage`) because they reveal the viewed area and IP to the OSM Foundation; attribution is shown on each map while they are on. Pipeline in `pipeline.ts`: transit change-point on the last 20 % → profile from V95 / climb rate → spike filter (angle + acceleration) → stay-point clustering for pauses (running centroid, tolerates two stray fixes; entry and exit points kept at the centroid) → RDP between pause anchors. Route is `ssr = false`. Mobile-friendly: below `md` the panes and the bottom panel stack and the page scrolls. Touch: two fingers pinch-zoom and pan the maps; one finger scrolls the page when stacked (`touch-action: pan-y`) and pans the map side by side. |
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

## Production

One image: Node builds the SvelteKit static site, nginx serves the `build/` output.

On the VPS the container sits next to an existing [nginx-proxy](https://github.com/nginx-proxy/nginx-proxy) with acme-companion. It joins the proxy Docker network and sets `VIRTUAL_HOST`, `VIRTUAL_PORT`, `LETSENCRYPT_HOST`, and `LETSENCRYPT_EMAIL`. Leave the proxy's Compose file alone and don't edit nginx by hand. DNS for `VIRTUAL_HOST` must already point at the VPS.

`docker compose up -d --build` (and `make docker-up`) builds and starts that static site. Redeploy with `git pull` and the same command.
