<p align="center">
  <img src="docs/assets/hob-logo.png" width="128" height="128" alt="Hob">
</p>

<h1 align="center">Hob</h1>

<p align="center">
  <b>The full AI coworker experience. None of the cloud.</b><br>
  It works on your files, runs code, searches the web and makes charts, all on your own computer.<br>
  Free, open source, and nothing leaves your machine.
</p>

<p align="center">
  <a href="https://github.com/FrigadeHQ/hob/releases/latest/download/Hob-mac-arm64.dmg"><img alt="Download for Mac" src="https://img.shields.io/badge/Download_for_Mac-Apple_Silicon-c2410c?style=for-the-badge&logo=apple&logoColor=white"></a>
  <a href="https://github.com/FrigadeHQ/hob/releases/latest/download/Hob-windows-x64.exe"><img alt="Download for Windows" src="https://img.shields.io/badge/Download_for_Windows-preview-c2410c?style=for-the-badge&logo=windows&logoColor=white"></a>
  <a href="https://github.com/FrigadeHQ/hob/releases/latest/download/Hob-linux-x86_64.AppImage"><img alt="Download for Linux" src="https://img.shields.io/badge/Download_for_Linux-preview-c2410c?style=for-the-badge&logo=linux&logoColor=white"></a>
  <br>
  <a href="https://github.com/FrigadeHQ/hob/releases">All releases</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-c2410c"></a>
  <a href="https://github.com/FrigadeHQ/hob/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/FrigadeHQ/hob?color=c2410c"></a>
</p>

---

## What's a hob?

In English folklore, a **hob** is a small household spirit. It lives by the hearth and quietly helps with the chores, and it asks for nothing in return. In British kitchens, the hob is also the stove top: the warm middle of the home.

That's the idea. Hob is a helper that lives in your house, not in someone else's data center. The little flame in the logo is the hob.

## Why Hob exists

The best AI apps today are cloud apps. Claude and ChatGPT on the desktop don't just chat. They read and change your files, run code, search the web, draw charts, fill in forms and connect to your other apps. They ask before doing anything risky, and you never have to think about which model is running.

The apps that run AI on your own computer were mostly built for tinkerers. You browse model hubs, compare file formats and settings, and you get a chat box. Working on your files, running code, plugins, approvals and undo are left for you to assemble.

Hob gives you the polished, agentic experience of the cloud apps with everything running locally:

- **No setup decisions.** Hob checks your computer and picks the best model it can run well. It's one download and one click, with no model hub and no settings.
- **A real toolkit out of the box.** Files, folders, code, charts, PDFs, web search, weather, dictation, skills and app connections are all built in and working on day one.
- **Made for everyone.** Plain-English approval cards before anything changes, Undo for everything Hob does, and deleted files go to the Trash.
- **Free and open source, for good.** Hob is [MIT licensed](LICENSE): use it at home or at work, read every line, change it, ship it in your own product. No subscription, no account, no usage limits.

## Private by design

- **The AI runs on your computer.** Hob uses [llama.cpp](https://github.com/ggml-org/llama.cpp) with your graphics chip (Metal on Mac, CUDA or Vulkan elsewhere). There's no account and no API key, and no AI cloud is involved.
- **Your chats and files stay on your computer.** Chats are stored in a local database, and Hob's own files are in a normal folder you can open.
- **No telemetry.** Hob doesn't track you or phone home.
- **Hob only goes online when you'd expect it to:**
  - downloading a model, and the dictation model;
  - checking for an updated list of models;
  - searching the web and reading pages for you (switch **Web access** off in Settings to stop this);
  - using an app connection you added.

  Web searches go through a metasearch engine that runs on your computer, so no single search company sees all of your questions.

## Picks the best model for your computer

When you first open Hob, it checks your memory, your graphics card (or Apple chip) and your free disk space. Then it recommends the strongest modern open model that will run there at a comfortable reading speed.

- A curated list of open models, from small ones for 8 GB laptops up to big ones for workstations. They include Qwen3, gpt-oss 20B and gpt-oss 120B.
- Models are ranked by how well they handle agent work: following multi-step tasks and using tools, not just chatting.
- Models are split between graphics memory and system memory when that's faster.
- The model downloads in the background. You can start chatting before it's finished.
- You can always choose a different model from the list. The list explains each choice in plain words.

## What Hob can do

| | |
|---|---|
| **Work on your files** | Drop in documents, spreadsheets, PDFs and photos. Hob reads them, summarizes, finds typos, renames, sorts and converts. |
| **Projects** | Group chats around your folders and give each project its own instructions. Hob can read the folders and saves new files in the first one. |
| **Run code** | Python with pandas, numpy, openpyxl, python-docx, pypdf and Pillow. On Mac it runs in a sandbox that can only write to the chat's own folder. |
| **Charts** | Clean, interactive charts drawn right in the chat, in light and dark mode. Download any chart as a PNG. |
| **PDFs** | Reads PDFs, including scanned pages, and fills in PDF forms (Mac). |
| **Web** | Searches the web and reads pages, on by default and easy to switch off. |
| **Dictation** | Talk instead of typing. Speech is turned into text on your computer. |
| **Skills and app connections** | Add skills, Python tools and any MCP server. See [Plugins](#plugins). |
| **Safety net** | Plain-English approval cards before Hob changes your files, Undo for every task, and nothing is ever deleted for good. |

## Plugins

Everything beyond chat is a plugin, including Hob's own web search, weather, code, charts and PDF features. A plugin is a folder with a `hob-plugin.json` that can add:

- **[Skills](docs/plugins/skills.md):** plain-English instructions for a kind of task, in the open [Agent Skills](https://agentskills.io) format. Skills written for other agents work too. Type `/name` to use one.
- **[Python tools](docs/plugins/python-tools.md):** small scripts Hob can call, run in Hob's sandbox.
- **[App connections](docs/plugins/app-connections.md):** any [MCP](https://modelcontextprotocol.io) server, on your computer or online. Sign-in is supported, and `.mcpb` bundles install with a double-click.

Start with the **[plugin guide](docs/plugins/README.md)**: your first skill takes about five minutes. Every field is listed in the **[reference](docs/plugins/reference.md)**. The built-in plugins in [`app/plugins/`](app/plugins) are good examples.

## Install

| | |
|---|---|
| **Mac** | Apple Silicon (M1 or newer). Open the `.dmg` and drag Hob to Applications. Signed and notarized by Apple. |
| **Windows** | Windows 10 or 11, 64-bit. Run the installer. *Preview: the agent's code sandbox is Mac-only for now.* |
| **Linux** | x64 AppImage. Make it executable (`chmod +x`) and run it. *Preview, same note as Windows.* |

More memory means bigger, smarter models. 16 GB or more is a good start, and Hob still works on 8 GB with a smaller model.

## Build from source

Requires Node.js 24 and pnpm 10.

```sh
pnpm install
pnpm dev                    # run Hob in development
pnpm -C app test            # unit tests
pnpm -C app e2e             # end-to-end tests (Hob runs hidden, with a stand-in model)
pnpm -C app dist            # build an installer for this computer
```

**Releases:** bump `version` in `app/package.json`, then push a matching tag (`git tag v0.2.0 && git push --tags`). GitHub Actions builds Mac, Windows and Linux and publishes the release, and the download links above update by themselves. See [`.github/workflows/release.yml`](.github/workflows/release.yml) for the signing secrets.

### Repository layout

| | |
|---|---|
| `app/` | The desktop app (Electron, React, TypeScript) |
| `app/plugins/` | Built-in plugins |
| `packages/picker/` | Hardware detection and model picking |
| `catalog/` | The curated model list |
| `docs/plugins/` | Plugin guide |

## License

[MIT](LICENSE) © 2026 Frigade

---

<p align="center">
  <b>Hob is made by <a href="https://frigade.com?utm_source=github&utm_medium=readme&utm_campaign=hob">Frigade</a>.</b><br>
  We make an AI assistant that lives inside your product and helps your users get things done.<br>
  <a href="https://frigade.com?utm_source=github&utm_medium=readme&utm_campaign=hob">Check it out</a>.
</p>
