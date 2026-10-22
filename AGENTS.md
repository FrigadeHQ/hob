# AGENTS.md

Guide for anyone (person or coding agent) working on this repository: what Garth is, how it's put together, how to run and test it, and the rules the code follows. User-facing docs live in [README.md](README.md) and [docs/](docs/README.md).

## What Garth is

A desktop AI assistant that runs entirely on the user's computer (Mac, Windows, Linux). It picks the best open model the machine can run, downloads it once, and then works offline. Like a cloud coworker app, it can work with the user's files and folders, run Python, make charts, read and fill PDFs, look at images, search the web (optional), and connect to other apps through MCP. Chats, files and models never leave the machine.

Mascot and brand: Garth, a neutral pixel-art face on an illustrated body (`app/src/renderer/src/components/Mascot.tsx`, face in `app/src/shared/mascot.ts`). The UI is a warm, light/dark theme; text is Hanken Grotesk (bundled, OFL). MIT licensed.

## Repository layout

```
app/                 the Electron app (everything users run)
  src/main/          main process: setup, agent loop, tools, plugins, storage, IPC
  src/engine/        the model worker (node-llama-cpp in a utility process)
  src/renderer/src/  React UI (screens, components, styles)
  src/shared/        types and pure logic used by both sides
  src/preload/       the window.garth bridge (contextIsolation)
  plugins/           built-in plugins (code, pdf, web, mac-apps), plain folders
  native/            Swift helpers for macOS (garth-pdf: PDFKit + Vision; garth-mac: Calendar via EventKit, Mail permission)
  resources/         things shipped next to the app (built helpers in resources/bin, licenses)
  build/             icons, installer art, entitlements, render scripts
  scripts/           native build, icon/brand generation, Mac release
  test/              unit tests (vitest)
  e2e/               end-to-end tests (Playwright driving Electron)
packages/picker/     picks the best model for the hardware (pure, tested)
catalog/             catalog.json: the models Garth can offer, pinned files and checksums
docs/                user and plugin-author docs, README assets
.github/workflows/   ci.yml (tests on Mac, Windows, Linux), release.yml (installers on v* tags)
```

## How it works

### Start-up and models
- `main/setup.ts` (SetupController) probes the hardware (`hardware.ts`, via the engine), loads the catalog (`catalog.ts`, remote with a bundled fallback) and asks `@garth/picker` for a recommendation.
- First run: a small **starter** model (Gemma 4 E4B) downloads first so chat opens in minutes, then the recommended model downloads in the background ("Getting smarter… N%") and replaces it. A pick smaller than the starter downloads on its own.
- **Models:** Gemma 4 (E2B, E4B, 26B A4B) and gpt-oss (20B, 120B), plus Qwen3 1.7B only for 8 GB computers without a graphics card. They were chosen with a local eval of everyday tasks on each model (`e2e/zz-models-real.spec.ts`, gitignored like all `zz-` files; `GARTH_LOCAL_CATALOG=1` tries models in `catalog.json` before it's published). Sampling follows each family's makers (`engine/sampling.ts`), and Gemma's control tags that leak into text are removed (`engine/control.ts`).
- Downloads (`downloader.ts`) resume, restart stalled connections, and are checked against a pinned sha256. They can be cancelled from Settings.
- `main/engine.ts` talks to `src/engine/worker.ts` (a separate process running node-llama-cpp). Loads, unloads and chats never overlap (`engine/serial.ts`).
- **Speed:**
  - The worker keeps one sequence for the model's whole life, so a request that starts like the last one only reads what's new.
  - Garth reads ahead whatever the user is looking at (`chat:warm`, `readAhead` in `agent/turn.ts`): at start-up, when a chat opens, after each reply, and for a new chat before it exists, in the folder it will get. Anything that changes the system prompt or tool list early (a different chat folder, a different tool set) means reading ~3,000 tokens again (about 4 s on gpt-oss-20b), so keep what a reply sends and what is read ahead identical (`conversation()`).
  - With plenty of memory to spare (about 48 GB and up), the starter model stays loaded next to the big one for naming chats (`loadSide`), so that doesn't push the conversation out. On 32 GB a second model slowed the first reply about fivefold.
  - Thinking starts short and grows once the model calls a tool (`thoughtBudgetWithTools`), so it works the same in any language.

### A chat turn (`main/agent/turn.ts`)
1. The user message is stored (`store.ts`, node:sqlite), and the system prompt is built (`agent/prompt.ts`): the chat's folder, project folders and instructions, skills, plugin lines, and an "About Garth" section so it can answer questions about itself.
2. The model streams tokens and calls tools. Each tool call goes through:
   - `tool.refuse` (e.g. no saving skills after reading web pages);
   - the permission gate `agent/permissions.ts` `decide()`: chat folder automatic; project folders read automatically, new files automatic, changes ask; elsewhere asks for access or is denied; system and hidden folders are never offered;
   - an approval card when the gate says "ask" (`agent/approvals.ts`);
   - then the tool runs. File changes are journaled for Undo (`agent/journal.ts`).
3. Web content, emails and calendar notes mark the turn **untrusted**, which makes changes ask again.
4. Guards against small-model failure modes: repeated loops (`agent/repeat.ts`), claims of work not done (`agent/claims.ts`), an empty reply after tools, and folder names with spaces (paths are quoted; cut-off names get "did you mean").
5. Replies keep going when the user switches chats (`agent/live.ts`), and a message typed meanwhile is queued in the UI.

### Tools (`main/tools/`)
- `files.ts`: list, read (a tagged annual report, `.xhtml` iXBRL, as tables of figures via `report.ts`; other web pages as text), write, move (batch moves from a JSON list), delete (to the Trash), open in the file manager.
- `python.ts`: run Python, run a skill's script, install PyPI packages.
- `chart.ts` (Recharts charts drawn by the UI), `pdf.ts` (read and fill, via the native helper), `photos.ts` (EXIF), `web.ts` (search and fetch), `vision.ts` (look at images), `mac.ts` (calendar and email tools).
- Calendar & email (`main/accounts/`): the tools use whichever source is connected.
  - A Google or Microsoft account, via the desktop OAuth flow (PKCE, loopback redirect). Tokens are encrypted with the OS keychain (`accounts.bin`).
  - Otherwise, on a Mac, the Calendar and Mail apps.
  - Client IDs live in `accounts/providers.ts`; a provider without one isn't offered.

### Python (`main/python/`)
- A pinned python-build-standalone runtime is installed into app data on first use (`runtime.ts`), with a fixed package set.
- Extra packages go into a venv layered on top (`packages.ts`, wheels only).
- All model-written code is **sandboxed** (`run.ts`). It writes only to the chat folder and temp, has no network unless asked, and can't start other programs:
  - macOS: sandbox-exec, with metadata reads allowed on parent folders so SQLite works;
  - Linux: Landlock (`landlock.ts`);
  - Windows: a low-integrity copy of python.exe.

### Images (`main/vision/`)
- A small Qwen3-VL model (4B when it fits on the GPU next to the main model, else 2B) and llama.cpp's own `llama-server` are downloaded after the main model.
- The server starts on first use (localhost, random port and key) and stops after 5 idle minutes.
- `look_at_image` shrinks images to 768 px, sends them, and returns text. Never probe the engine while a turn is running: it's busy and would deadlock.

### Plugins (`main/plugins/`)
- A plugin is a folder with `garth-plugin.json` (`manifest.ts`). It can carry:
  - skills (`skills/<name>/SKILL.md`, Agent Skills format);
  - Python tools;
  - MCP servers: stdio (`mcp.ts`), HTTP with OAuth (`mcpHttp.ts`, `oauth.ts`), and `.mcpb` bundles (`mcpb.ts`).
- `registry.ts` loads built-in, installed and linked plugins and builds the tool list. Built-ins can reference native tools and set `platforms`.
- The user's own skills live in a "my-skills" plugin. There are no built-in skills; built-in plugins put their how-to in `prompt`.
- The UI calls them Skills, Connectors (MCP-only plugins) and Plugins (bundles), all under Settings.

### UI (`renderer/src/`)
- `App.tsx`:
  - onboarding or the main layout (sidebar, chat view, Settings overlay);
  - back/forward history and keyboard shortcuts.
- `screens/`:
  - `Chat.tsx`: streaming reply with word fade-in, work log, approval cards, file cards and previews;
  - `Onboarding.tsx`;
  - `Settings.tsx`: its sections;
  - `Plugins.tsx`: the Skills, Connectors and Plugins pages.
- `components/SettingsOverlay.tsx` holds General, Model, Privacy, Files & storage, and Customize.
- Styling is Tailwind v4 with tokens in `styles.css` (light and dark). The interface and replies use Hanken Grotesk (bundled, OFL).
- Dictation runs Whisper in a web worker (`speech/`), fully local.

### Data on disk
- App data: `~/Library/Application Support/Garth` (or the OS equivalent). It holds `garth.db`, `settings.json`, models, python, vision, plugins and speech.
- Chat files: a folder per chat under `~/Documents/Garth` (configurable).
- `migrate.ts` moves data over from the app's earlier names.
- `GARTH_USER_DATA=<dir>` uses a separate profile (tests do this).

## Commands

Requires Node.js 24 and pnpm 10. From the repo root:

```sh
pnpm install
pnpm dev                      # run the app
pnpm -C app typecheck
pnpm -C app test              # unit tests (vitest)
pnpm -C app e2e               # builds, then end-to-end tests with a stand-in model
pnpm -C app native            # rebuild the Swift helpers (Mac)
sh app/scripts/make-icons.sh  # regenerate icon and logo from the pixel art
```

- **Test mode:** `GARTH_FAKE=1` swaps in a fake engine, fake downloads, a fake image model and fake Calendar/Mail, so the whole app runs without models. Messages starting with `__tools__ [[name, args], …]` make the fake model call those tools; see `main/fake.ts` for other triggers (`__slow__`, `__think__`, …).
- **Hidden window:** `GARTH_BACKGROUND=1` hides the window. Playwright sets it locally; CI shows windows, because hidden ones pause animation frames on Linux and Windows.
- **Local-only evals:** files named `e2e/zz-*.spec.ts` are gitignored. They're for evals against real models (`GARTH_REAL=1`) and screenshots, never in CI.

## Releasing

- **CI:** `ci.yml` runs typecheck, unit and e2e tests on macOS, Windows and Linux for every push to main.
- **Releases:** push a tag `vX.Y.Z` matching `app/package.json`. `release.yml` builds `Garth-mac-arm64.dmg`, `Garth-windows-x64.exe` and `Garth-linux-x86_64.AppImage`, signs and notarizes the Mac one with repository secrets, and publishes a GitHub release. The README download links point at the latest release.
- **A signed Mac build by hand:** `sh app/scripts/release-mac.sh`. It needs the Developer ID certificate and a notarytool profile.
- **electron-builder gotchas:**
  - Build into `dist/` only; another output folder makes it pack the whole project.
  - The Mac-level `files` list replaces the top-level one, so it must repeat it.
  - The release script checks that `app.asar` contains no source folders. To build while a copy from `dist/` is running, use a separate git worktree.

## Conventions

- **Plain words:** the audience is mainstream, young, non-technical users. Interface text is plain and friendly, never condescending, with no jargon and no emojis. Icons are lucide-react.
- **Privacy first:** nothing leaves the machine unless the user turned it on (Web access, connectors). The model's code is sandboxed. Changes to the user's files ask first unless they're new files in their project, and Undo exists for changes.
- **Cross-platform:** every feature must work, or degrade clearly, on Mac, Windows and Linux. Mac-only features (PDF helper, Calendar & Mail) are marked as such.
- **Pinned dependencies:** dependencies, models and binaries are pinned to exact versions at least two weeks old, with checksums.
- **Tests with changes:**
  - Write the test first, watch it fail, then make it pass.
  - Unit-test pure logic; e2e-test user flows.
  - Anything that needs a real model goes in a local `zz-` eval.
- **Comments:** short, and say why, in plain sentences. Match the surrounding style: small focused files, `data-testid` on things tests touch.
- **No backward compatibility** is kept for stored data before 1.0, beyond the profile move in `migrate.ts`.
- **Small models are the norm:** prefer code that removes failure modes (quoted paths, defaults that do the right thing, plain-language hints in tool results) over longer prompts.
