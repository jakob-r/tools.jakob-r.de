# AGENTS

General concept lives in `IDEA.md`.
Architecture, patterns, and tech stack live in `ARCHITECTURE.md`.
Agents update `ARCHITECTURE.md` (and this file) as they make decisions.

## Frontend

Desktop first, unless a tool's section in `IDEA.md` says otherwise.

Browser only. There is no backend. User content (pane text, files, clipboard, Base64 payloads) never leaves the browser: no API calls, analytics, or CDN requests that include that content.

One exception: a third-party request derived from user content is allowed only when it is opt-in (off by default), its label says where the request goes, and an info hint says what that party learns. Example: the GPX Cleaner's OpenStreetMap background, which reveals the viewed area and the visitor's IP to the OSM tile servers, never the file.

WebAssembly is fine when a tool needs it (heavy local work, or an existing library that already compiles to Wasm). It still runs in the browser, and only that tool's route loads the module.

Each tool is its own route. The landing page and shared layout load tool metadata only, not tool implementations.

## Local Development (`Makefile`)

Agents should always create or update the root `Makefile` so running the project locally can be done with `make dev`.

## Git

We use git, all on the main branch.
Agents commit and push to the main branch regularly.
If you encounter unstaged changes, commit them when it looks like they were simply left uncommitted. Otherwise ask the user to commit.

## Naming

The Markdown Converter tool is called **Markshift** (slug `markdown`).
