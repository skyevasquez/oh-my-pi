# oh-my-browser

omp-native Chromium desktop browser. Electron provides multi-tab WebContents; a Bun host embeds `createAgentSession()` from `@oh-my-pi/pi-coding-agent` so tabs, local files/shell, and the primary UI all share one omp brain (`~/.omp` auth/models/sessions).

## Requirements

- Bun ≥ 1.3.14
- Display (for the GUI). Headless smoke does not need Electron/display.
- Optional: prior `omp /login` so a model is available

## Run

From the monorepo root (or this package):

```bash
bun install
bun --cwd packages/oh-my-browser run start
```

Dev (same entry today):

```bash
bun --cwd packages/oh-my-browser run dev
```

## Smoke (no Electron)

Loads the session bridge, control WebSocket (IPC ping), static prompts, and documents the CDP `connected` path for Eval `browser.goto` / `observe` / `click`:

```bash
bun --cwd packages/oh-my-browser run smoke
```

## Architecture

| Layer | Role |
| --- | --- |
| Bun host (`src/host`) | `createAgentSession`, approvals UI context, Guard policy, control WS |
| Electron main (`src/main`) | Window, tab state, `--remote-debugging-port`, IPC bridge |
| Renderer (`src/ui`) | Aside-like left rail, NTP Ask AI, omnibox, side panel |
| CDP `connected` | Shell publishes `http://127.0.0.1:<port>`; host sets `browser.cdpUrl` so Eval `browser.*` drives in-app tabs |

Permission modes in the composer map to omp `tools.approvalMode`:

| UI | omp |
| --- | --- |
| Read | `always-ask` |
| Guard (default) | `write` |
| Full | `yolo` |

Prompts live only in `src/prompts/*.md` (Handlebars system template + desktop append).

## Package scripts

| Script | Purpose |
| --- | --- |
| `start` / `dev` | Build Electron bundles and launch host + shell |
| `smoke` | Session + IPC + prompts without GUI |
| `build:electron` | Bundle main/preload/UI |
| `check` | oxlint + oxfmt + `tsgo` |
