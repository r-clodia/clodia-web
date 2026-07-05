# Clodia WebUI v2

A **SvelteKit** SPA that runs alongside the existing webui as a client of
the Clodia **agent-server** (default `http://localhost:7842`).

Fase 8 ships the **write actions and polish** on top of the previous
read-only foundation: AGENTS reload, JOBS full CRUD (+ run-now), global
SSE-driven live state, toasts, modals, confirmations, and
disabled-while-submitting buttons everywhere a mutation can happen. See
`CHANGELOG-fase8.md` for the full diff vs. the base.

## Stack

- **SvelteKit 2** + **Svelte 5** (TypeScript)
- **`@sveltejs/adapter-static`** — builds to a static SPA with
  `fallback: index.html` (no server runtime required)
- **Vite 5** as the dev/build tool
- Plain CSS (no UI library) — coherence over decoration

*Why SvelteKit?* It's already the stack of the existing webui, so the team
keeps a single mental model and we can lift learnings either direction.
adapter-static keeps the deploy surface trivial (any static host).

## Layout

```
webui-v2/
├─ src/
│  ├─ app.html, app.css, app.d.ts
│  ├─ lib/
│  │  ├─ api/
│  │  │  ├─ client.ts             # apiGet / apiPost / apiSSE + ApiError
│  │  │  └─ types.ts              # Agent, AgentActivity, ConsumerStatus, …
│  │  ├─ stores/
│  │  │  ├─ auth.ts               # session + Claude Max OAuth + dev bypass
│  │  │  └─ consumer-status.ts    # shared poller (visibility-aware)
│  │  └─ components/
│  │     ├─ Sidebar.svelte        # fixed left nav + LOGOUT (wired)
│  │     ├─ Placeholder.svelte    # shared "coming soon" panel
│  │     ├─ AgentAvatar.svelte    # circular initial w/ avatar_color
│  │     ├─ StatusDot.svelte      # idle / running pill
│  │     ├─ AgentCard.svelte      # card used in the AGENTS grid
│  │     └─ Skeleton.svelte       # shimmer placeholder
│  └─ routes/
│     ├─ +layout.svelte           # shell (sidebar + main slot)
│     ├─ +layout.ts               # ssr=false, prerender=false → SPA
│     ├─ +page.svelte             # / → redirects to /agents
│     ├─ login/+page.svelte       # ✅ Claude Max OAuth login (no sidebar)
│     ├─ agents/+page.svelte      # ✅ list (card grid + polling)
│     ├─ agents/[name]/+page.svelte  # ✅ detail (Definition/Logs/Prompt)
│     ├─ jobs/+page.svelte        # ✅ list (table view, read-only)
│     ├─ jobs/[id]/+page.svelte   # ✅ detail (Configurazione + Storico run)
│     ├─ chats/+page.svelte       # 🚧 placeholder
│     ├─ daemons/+page.svelte     # 🚧 placeholder
│     └─ topics/+page.svelte      # 🚧 placeholder
├─ preview/
│  ├─ gen-previews.mjs            # static HTML preview generator
│  └─ out/                        # generated previews (git-ignored)
├─ static/favicon.svg
├─ svelte.config.js             # adapter-static, SPA fallback
├─ vite.config.ts               # dev server on :7843
├─ tsconfig.json
├─ .env.example
└─ package.json
```

## Getting started

```bash
npm install
npm run dev      # serves on http://localhost:7843
```

> The dev port is **7843** (not 7842, which is the agent-server). It's
> pinned in `vite.config.ts` (`strictPort: true`) so a port collision
> fails loudly instead of silently switching.

To build the static SPA:

```bash
npm run build    # writes to ./build/
npm run preview  # serve ./build/ locally for smoke-checking
```

## API base URL

The client resolves the base URL once at startup:

1. **`PUBLIC_API_BASE_URL`** (Vite env, the `PUBLIC_` prefix makes it
   visible to client-side code)
2. **Fallback:** `http://localhost:7842`

To point the SPA at a non-default agent-server, either:

- Copy `.env.example` to `.env` and edit the value, then `npm run dev`
  again — Vite picks up `.env` automatically.
- Or pass it inline for one run:

  ```bash
  PUBLIC_API_BASE_URL=http://192.168.1.10:7842 npm run dev
  ```

- Or set it at build time:

  ```bash
  PUBLIC_API_BASE_URL=https://api.example.com npm run build
  ```

The value is **baked in at build time**. Re-build to change it in
production artifacts.

## API client

`src/lib/api/client.ts` exports:

```ts
apiGet<T>(path: string, opts?): Promise<T>
apiPost<T>(path: string, body: unknown, opts?): Promise<T>
apiSSE(path: string, onEvent, onError?): () => void   // cleanup fn
class ApiError extends Error { status; body; }
const API_BASE_URL: string
```

- Non-2xx responses throw `ApiError` with a human-readable message
  (`HTTP 503 Service Unavailable — <snippet>`).
- JSON responses are auto-parsed; non-JSON falls back to text.
- `apiSSE` uses the browser-native `EventSource` and returns a cleanup
  function. In SSR / non-browser environments it's a no-op (safe to call
  from `onMount` only — which is the normal pattern).

## What works / what doesn't

| Section | Status      | Notes                                                                             |
| ------- | ----------- | --------------------------------------------------------------------------------- |
| AGENTS  | ✅ read + **reload** | List, detail (Definition / Logs / System Prompt). **+ Nuovo agente** and **Edit prompt** ship as UI but degrade against today's server (POST/PATCH not exposed → 405). **Reload registry** wired to `POST /api/agents/reload`. |
| JOBS    | ✅ **full CRUD** | List + detail + **+ Nuovo**, **Modifica**, **Elimina** (con conferma), **Esegui ora**. |
| CHATS   | ✅ interactive | List + composer + SSE streaming. Create / Delete / Interrupt. |
| DAEMONS | ✅ start/stop + logs | Start/stop with confirm of any failure; logs viewer polls when open. |
| TOPICS  | ✅ read-only | List grouped by classification + summary + file tree + viewer (markdown / raw text). |
| LOGIN   | ✅ Claude Max OAuth | `/login` drives the agent-server `/auth` flow (OAuth URL → return code → session). Dev bypass via `PUBLIC_AUTH_DISABLED`. |
| LOGOUT  | ✅ wired | Sidebar button calls `POST /auth/logout`, clears the session, redirects to `/login`. No-op (with info toast) under dev bypass. |

The pages degrade gracefully: if the agent-server isn't reachable the user
sees a readable error panel that names the URL it tried. Write actions
surface every failure as a non-swallowing toast + (where relevant) inline
error panel. Destructive actions ask for confirmation via
`ConfirmDialog.svelte`.

## AGENTS section (read-only)

### List view — `/agents`

- **Card grid** (responsive `auto-fill, minmax(280px, 1fr)`).
- Each card shows: avatar with `avatar_color`, `display_name` (fallback
  `name`), `description` clamped to 3 lines, a status dot (idle / running)
  alimentato dal polling condiviso, and chips with `trello.inbox_lane` +
  skill count.
- Click → `/agents/{name}` (the agent's `name` is the URL key).
- Loading shows skeletons that match the card silhouette; errors render
  an inline panel with a retry button.

### Detail view — `/agents/{name}`

Three tabs (single SvelteKit page, lazy panels):

1. **Definition** — pulls `GET /api/agents/{name}`. Shows description,
   model, **inbox lane** (taken from `trello.inbox_lane`; if absent we
   derive it from `name` and mark the field as *derived*), trello binding,
   skills, `can_delegate_to`, sandbox (allow/deny read, allow write,
   shell allow/deny), memory dir, agent dir, plus a `<details>` with the
   raw JSON payload.
2. **Logs** — pulls `GET /api/agents/{name}/activity`. Cronological list
   (newest first) with a human summary per event type
   (`run_started`, `run_done`, `handoff_*` …). Tone color per family.
3. **System Prompt** — see *known gap* below.

### Shared consumer-status store

`src/lib/stores/consumer-status.ts` is a reference-counted writable that
polls `GET /api/agents/consumer/status` every **7 s** while at least one
subscriber is active. It:

- pauses immediately when the page becomes hidden (Page Visibility API)
  and resumes on focus;
- aborts in-flight requests on stop so we don't race state updates;
- exposes a derived `agentRunStates` record (`{name → 'idle' | 'running'}`)
  built from `cards` entries (any `status: "running"` for an agent ⇒
  the agent is running);
- is a no-op in SSR.

Components call `startConsumerStatusPolling()` in `onMount` and release
the lease in the returned cleanup. With reference counting we get a
single network poll regardless of how many cards / pages subscribe.

### Known gap — System Prompt

`GET /api/agents/{name}` returns `system_prompt` as a *filename*
(e.g. `"system-prompt.md"`), **not** the prompt body. Per the read-only
brief we don't fabricate a new endpoint; the System Prompt tab surfaces
the gap transparently and shows the filename + resolved absolute path
for reference. Follow-up suggested for the agent-server team: either
inline the resolved body on the detail endpoint, or add a dedicated
`GET /api/agents/{name}/system_prompt`.

### Static visual previews

`preview/gen-previews.mjs` is a Node script that fetches the live
agent-server endpoints and writes static HTML files to `preview/out/`
mirroring the Svelte components exactly. Useful for review without
running a browser. Run with:

```bash
PUBLIC_API_BASE_URL=http://localhost:7842 node preview/gen-previews.mjs
```

Output:
- `preview/out/index.html` — landing page with links to everything
- `preview/out/agents-list.html` — the card grid
- `preview/out/agent-{name}.html` / `-logs.html` / `-prompt.html` — the
  three detail tabs per agent

These files are NOT part of the production bundle. They exist so the QA
reviewer can inspect the UI without running the dev server.

## TOPICS section (read-only)

### List view — `/topics`

Two-pane layout:

- **Left rail** — topics grouped by `classification` (alphabetical), each
  group sorted by display title. Click a topic to load it on the right.
  The list is sticky while you scroll the viewer.
- **Right pane** — header with the topic title + `classification/name`
  breadcrumb, then a **tabs** strip:
  - **Summary** — renders the markdown returned by
    `GET /topics/{classification}/{name}/summary` (`text/plain; charset=utf-8`).
  - **File: {basename}** — only enabled once a file is picked in the
    tree on the left of the viewer.

### File tree + file viewer

- The tree comes from `GET /topics/{classification}/{name}/tree`. Each
  node is `{ type: 'file' | 'directory', name, path, children? }`. We
  render it with a small recursive component (`_TreeNode.svelte`) — folders
  collapse/expand with a caret, files are clickable. The top-level
  `files/` directory is auto-expanded when present (it's the convention
  the server-side topic registry uses).
- Clicking a file fetches its content via
  `GET /topics/{classification}/{name}/file?path={path}` (the path is
  topic-relative, exactly as it comes back in the tree). Files with a
  `.md` / `.markdown` / `.mdown` / `.mkd` extension render through the
  in-house markdown renderer; **anything else** falls back to a raw
  `<pre>` block — that's the "minimum viable" the brief asked for and
  it keeps the surface zero-dependency.

### Markdown rendering

`src/lib/markdown.ts` is a tiny, dependency-free MD → HTML converter
that covers the subset our content actually uses: ATX headings, fenced
code blocks, bullet/ordered lists, blockquotes, horizontal rules,
inline code, bold/italic, links. It HTML-escapes everything before
emitting any tags, and refuses `javascript:` URLs in links. It is
intentionally NOT a CommonMark conformant parser — adding `marked` or
`markdown-it` would have been heavier than what the brief justifies.

### Shareable URL state

Selection lives in the URL query string: `?cls={classification}&name={name}`
selects a topic (summary view), `&path={file-path}` switches to the file
view. Hitting reload restores the same view, and the URL can be pasted
into chat without losing context. (Tree-expansion state is intentionally
NOT in the URL — it's purely cosmetic.)

### Endpoints consumed

| Method | Path                                                | Returns |
| ------ | --------------------------------------------------- | ------- |
| GET    | `/topics`                                           | `Topic[]` (tolerated: `{ topics: Topic[] }`) |
| GET    | `/topics/{classification}/{name}/summary`           | `text/plain` markdown |
| GET    | `/topics/{classification}/{name}/tree`              | `TopicTree` (root node with `children`) |
| GET    | `/topics/{classification}/{name}/file?path={path}`  | `text/plain` raw content |

The same `apiGet` client used by AGENTS and JOBS handles auth-less
fetches + error normalisation; the four typed wrappers live in
`src/lib/api/client.ts` under the `// TOPICS` section.

## Authentication (Claude Max OAuth)

The WebUI sits behind a login gate backed by the agent-server's `/auth`
surface. The agent-server owns the OAuth dance (it spawns
`claude auth login --claudeai`, captures the OAuth URL, and waits for the
return code); the WebUI only orchestrates it from the browser.

### Flow

1. Any protected route, when no session is established, redirects to
   `/login?next=<original-path>`.
2. **Accedi con Claude Max** → `POST /auth/login` → the server returns the
   OAuth URL. The WebUI opens it in a new tab (with a copy-able fallback
   link) and asks for the **return code**.
3. Paste the code → `POST /auth/code` → the WebUI polls `GET /auth/status`
   (every 1.5s, up to ~30s) until `logged_in: true`, then redirects to
   `next` (default `/agents`).
4. **LOGOUT** (sidebar) → `POST /auth/logout` → clears the cached session
   and returns to `/login`.

Auth state is **server-global** (a single token in `~/.claude`), so the
WebUI "session" is a client-side mirror of `GET /auth/status`. Once a check
succeeds it's cached in `sessionStorage` (`clodia.auth.session`) so in-app
navigation doesn't re-hit the server; the canonical check still runs on
every full load.

### Endpoints consumed

| Method | Path           | Returns |
| ------ | -------------- | ------- |
| GET    | `/auth/status` | `{ logged_in, login_in_progress, login_url, login_error }` |
| POST   | `/auth/login`  | `{ status, url }` (`already_logged_in` ⇒ `url: null`) |
| POST   | `/auth/code`   | `{ status }` (body `{ code }`) |
| POST   | `/auth/logout` | `{ status }` |

### Dev-mode bypass — `PUBLIC_AUTH_DISABLED`

So the app stays **usable locally without a full login**, set
`PUBLIC_AUTH_DISABLED=1` (also accepts `true` / `yes` / `on`). When enabled:

- the guard treats the user as authenticated and **never calls** `/auth/*`;
- `/login` shows a "dev mode" banner with an **Entra nell'app** button;
- LOGOUT becomes a no-op (it won't wipe a real server token) and shows an
  info toast instead.

Unset / `0` / `false` (the **default**) keeps auth fully enabled. Like all
`PUBLIC_` vars the value is baked in at build time — re-build to change it.

```bash
# locally testable without OAuth:
PUBLIC_AUTH_DISABLED=1 npm run dev
```

### Files

- `src/lib/stores/auth.ts` — session store, dev bypass, `refreshAuth` /
  `startLogin` / `submitAuthCode` / `doLogout`.
- `src/routes/login/+page.svelte` — the login screen + code flow.
- `src/routes/+layout.svelte` — the route guard (+ splash) and the
  conditional shell (`/login` renders without the sidebar). The global SSE
  lease is only taken once authenticated.
- `src/lib/api/client.ts` — the four `/auth/*` wrappers.

## Global UX scaffolding (fase 8)

### Toasts

- `src/lib/stores/toasts.ts` exposes `pushToast(...)` and the typed
  shorthands `toastSuccess(msg, hint?)` / `toastError(msg, hint?)` /
  `toastInfo(msg, hint?)`. Auto-dismiss with kind-specific TTLs (3.5s /
  4.5s / 8s), × to close earlier.
- `src/lib/components/Toaster.svelte` is mounted once in the root layout
  and renders the stack bottom-right.

### Live state (SSE multiplexer)

- `src/lib/stores/events-stream.ts` opens **one** `EventSource` to
  `GET /clodia/events` for the lifetime of the SPA (lease in root layout).
  Pages can either subscribe to specific events via `onEventStream(handler)`
  or read the side-channels `agentActivityTick` / `chatLifecycleTick`.
- The root layout uses the stream to throttle-refresh `consumer-status` +
  `bumpJobs()` on every `agent_activity` event — so the AGENTS grid and
  JOBS list reflect lane movements / run-starts without waiting for the
  next 7s poll.
- Auto-reconnects on errors with 1s / 2s / 5s backoff.

### Modals + confirmations

- `Modal.svelte` — generic shell with backdrop, Esc dismissal (gated on
  `dismissable`), focus trap, scroll lock.
- `ConfirmDialog.svelte` — wraps `Modal` with a yes/no question, optional
  `destructive` styling (red confirm button), loading flag that blocks the
  buttons and disables Esc/backdrop while in flight.
- `JobFormDialog.svelte` and `NewAgentDialog.svelte` ship as concrete
  forms on top of `Modal` and use the toast store for success/error
  feedback.

## Constraints respected

- **Does not touch** the existing webui or the agent-server. It's a
  client of the documented REST + SSE surface only.
- Runs on **:7843** — never collides with the agent-server's **:7842**.
- **Auth** is delegated to the agent-server's `/auth` OAuth surface; the
  WebUI never handles credentials directly and adds no server runtime.
- No deploy, no CI — out of scope for this iteration.
- No heavy UI library; CSS is hand-written and small.

## Scripts

| Command            | What it does                                       |
| ------------------ | -------------------------------------------------- |
| `npm run dev`      | Vite dev server on `http://localhost:7843`         |
| `npm run build`    | Static SPA build → `./build/`                      |
| `npm run preview`  | Preview the built SPA locally                      |
| `npm run check`    | `svelte-check` over the project (typecheck pass)   |

## Licenza

GNU AGPL v3 — con opzione di licenza commerciale: vedi [LICENSING.md](LICENSING.md).
Le versioni fino al tag `apache2-final` restano Apache 2.0.
