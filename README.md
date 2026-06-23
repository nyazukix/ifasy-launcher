# IFASY Launcher

Desktop launcher for **IFASY** (co-op zombie shooter). Login, two game channels
(**LIVE** + **PTB/DEV**), game download and launcher self-update.

- **Stack:** Electron + electron-builder (NSIS Windows installer) + electron-updater.
- **Built on the VPS** (Linux + wine) — `npm run build` / `npm run release`.
- **Repo:** `nyazukix/ifasy-launcher`. Lives on the VPS at `/home/ifasy.launcher`.

## Backend it talks to
- `POST app.ifasy.com/api/login` — auth against `ifasy-live.users` (returns `{ok, token, user{dev,...}}`).
- `GET app.ifasy.com/api/update[?channel=ptb]` — game version manifest.
- `GET app.ifasy.com/download[?channel=ptb]` — game build (later: obscured `downloads.ifasy.com/<code>_live|ptb/`).

## Scripts
- `npm start` — run in dev.
- `npm run build` — build the Windows installer to `dist/`.
- `npm run release` — build + publish to GitHub releases (self-update feed).

## Channels
- **LIVE** — main game build.
- **PTB** — public test / dev build (`user.dev=1` relevant).

Games are downloaded **only via this launcher**.
