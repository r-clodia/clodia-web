# clodia-web

The **web interface** of a Clodia colony: a SvelteKit single-page app that talks
to the **agent-server** (`http://localhost:7842` by default).

> ### 📍 This is not the entry repository
>
> This repository is a **component** of Clodia Platform, not something you
> install on its own. Installation, quickstart, architecture, licence and the
> **risk warnings** live in:
>
> ### 👉 **[r-clodia/clodia-platform](https://github.com/r-clodia/clodia-platform)**
>
> Do not deploy from here: `clodia-platform` clones the component repositories,
> builds the images and orchestrates the stack. Before installing, read the
> as-is disclaimer and the **known defects** in the platform tracker —
> [open `security` issues](https://github.com/r-clodia/clodia-platform/issues?q=is%3Aissue+is%3Aopen+label%3Asecurity)
> and [`SECURITY.md`](https://github.com/r-clodia/clodia-platform/blob/main/SECURITY.md).
> The software is distributed **AS IS, without warranty**: you run it at your
> own risk.

## Stack

- **SvelteKit 2** + **Svelte 5** (TypeScript)
- **`@sveltejs/adapter-static`** — a static SPA with `fallback: index.html`, so
  there is no server runtime to operate
- **Vite** for dev and build
- Plain CSS, no UI library: coherence over decoration

## What it shows

Chats and channels with the agents; topics — their files, messages,
participants, mounts and rules; agents and their resolved authority; jobs;
packs and skills; tools and their credentials; the colony's providers.

Two things it does that are easy to miss, and that exist for a reason:

- **A gate says what it crosses and who decides.** The card carries the boundary
  the action is about to cross and the person who has standing to unblock it —
  both computed by the backend, from the same rule that then enforces the
  decision. A second copy of that rule written here had already diverged, and
  told an owner they could approve a `system` gate they cannot.
- **The provenance of a credential is always visible, its value never.** A mount
  using the platform's Google credential says so in as many words — *an entire
  Google account, not this folder* — because a silent fallback is how one
  becomes convinced of an isolation that is not there.

The screens themselves are not enumerated here. A list of features in a README
goes stale the week it is written; the running instance is the authority.

## Getting started

```bash
npm install
npm run dev      # http://localhost:7843
```

> The dev port is **7843**, not 7842, which belongs to the agent-server. It is
> pinned in `vite.config.ts` (`strictPort: true`) so a collision fails loudly
> instead of quietly moving.

```bash
npm run build    # static SPA → ./build/
npm run preview  # serve the build locally
npm run check    # svelte-check over the project
```

## API base URL

Resolved once at startup:

1. **`PUBLIC_API_BASE_URL`** — a Vite env var; the `PUBLIC_` prefix is what
   makes it visible to client code
2. otherwise `http://localhost:7842`

Copy `.env.example` to `.env` for development, or pass it inline
(`PUBLIC_API_BASE_URL=http://192.168.1.10:7842 npm run dev`), or set it at build
time. **The value is baked in at build time** — change it and rebuild.

## Licence

Copyright (C) 2026 Davide Carboni.

GNU AGPL v3, with a commercial option: see [LICENSING.md](LICENSING.md).
Releases up to the `apache2-final` tag remain Apache 2.0.
