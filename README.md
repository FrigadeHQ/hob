<p align="center">
  <img src="docs/assets/hob-logo.png" width="128" height="128" alt="Hob">
</p>

<h1 align="center">Hob</h1>

<p align="center">
  <b>The full AI coworker experience. None of the cloud.</b><br>
  Tell Hob what you need done. It works on your files, figures out the steps,<br>
  and hands back finished work, all on your own computer using the most capable open-weight models.<br><br>
  Free, open source, and nothing ever leaves your machine.
</p>

<br>

<p align="center">
  <a href="https://github.com/FrigadeHQ/hob/releases/latest/download/Hob-mac-arm64.dmg"><img alt="Download for Mac" src="https://img.shields.io/badge/Download_for_Mac-1c1917?style=for-the-badge&logo=apple&logoColor=white"></a>&nbsp;&nbsp;
  <a href="https://github.com/FrigadeHQ/hob/releases/latest/download/Hob-windows-x64.exe"><img alt="Download for Windows" src="https://img.shields.io/badge/Download_for_Windows-1c1917?style=for-the-badge&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0zIDUuMSAxMC40IDR2Ny4xSDNWNS4xWm0wIDEzLjggNy40IDEuMXYtN0gzdjUuOVpNMTEuMyAzLjkgMjEgMi41djguNmgtOS43VjMuOVptMCAxNi4yIDkuNyAxLjR2LTguNWgtOS43djcuMVoiLz48L3N2Zz4="></a>&nbsp;&nbsp;
  <a href="https://github.com/FrigadeHQ/hob/releases/latest/download/Hob-linux-x86_64.AppImage"><img alt="Download for Linux" src="https://img.shields.io/badge/Download_for_Linux-1c1917?style=for-the-badge&logo=linux&logoColor=white"></a>
</p>

<p align="center">
  <sub>Mac with Apple Silicon · Windows 10 and 11 · Linux x64 &nbsp;·&nbsp; <a href="https://github.com/FrigadeHQ/hob/releases">All releases</a> &nbsp;·&nbsp; <a href="LICENSE">MIT license</a></sub>
</p>

---

<p align="center">
  <img src="docs/assets/screenshot.png" width="900" alt="Hob reading a sales spreadsheet in a project, charting revenue by region and summing up what stands out">
</p>

### Why Hob

Desktop AI apps like Claude and ChatGPT work on your files, run code, search the web and ask before changing anything. Existing solutions that run AI locally mostly give you a raw chat sandbox with no tools and requires you to understand which models are most compatible with your system.

Hob strives to work with the same quality and functionality as Claude and ChatGPT, except running its models entirely on your own computer.

- **No setup.** Hob checks your hardware and downloads the best model it can run well. No account or model understanding required.
- **Works on your files.** Projects, folders, spreadsheets, PDFs, photos, and much more.
- **Safe by default.** Approval confirmations before anything in your folders changes, Undo for every task, and code runs in a sandbox.
- **Free and open source.** [MIT licensed](LICENSE). No account, no subscription, no limits.

*A hob is a household spirit from English folklore that quietly helps with the chores.*

### Private

The model runs on your computer with [llama.cpp](https://github.com/ggml-org/llama.cpp) (Metal on Mac, CUDA or Vulkan elsewhere). Chats and files stay on your machine, and there is no telemetry. Hob only goes online to download models and check for new ones, to search the web for you (Web access can be turned off in Settings), and for app connections you add.

### Models

Hob picks from a curated list of open models, from Qwen3 for 8 GB laptops up to gpt-oss 120B for workstations. Models are ranked on agent work (multi-step tasks and tool use), and split between graphics and system memory when that's faster. You can switch models any time.

### What it can do

| Feature | What Hob does |
|---|---|
| Files and projects | Work on attached files, or on folders grouped into projects with their own instructions |
| Code | Python with pandas, numpy, openpyxl, python-docx, pypdf and Pillow, sandboxed to the chat's folder |
| Charts | Interactive charts in the chat, downloadable as PNG |
| PDFs | Read PDFs, including scans, and fill in forms (Mac) |
| Web | Search and read pages through a metasearch engine that runs on your computer |
| Dictation | Speech to text, on your computer |
| Plugins | Skills, Python tools and MCP app connections |

### Plugins

A plugin is a folder with a `hob-plugin.json`. It can add [skills](docs/plugins/skills.md) in the open [Agent Skills](https://agentskills.io) format, [Python tools](docs/plugins/python-tools.md), and [app connections](docs/plugins/app-connections.md) to any MCP server, including `.mcpb` bundles. Hob's own web search, code and PDF features are plugins too, in [`app/plugins/`](app/plugins).

See the [plugin guide](docs/plugins/README.md) and the [reference](docs/plugins/reference.md).

### Building

Requires Node.js 24 and pnpm 10.

```sh
pnpm install
pnpm dev              # run Hob
pnpm -C app test      # unit tests
pnpm -C app e2e       # end-to-end tests (hidden window, stand-in model)
pnpm -C app dist      # installer for this computer
```

To release, bump `version` in `app/package.json` and push a matching tag (`v0.2.0`). [GitHub Actions](.github/workflows/release.yml) builds and publishes Mac, Windows and Linux.

### License

[MIT](LICENSE)

---

<p align="center">
  <b>Hob is made by <a href="https://frigade.com?utm_source=github&utm_medium=readme&utm_campaign=hob">Frigade</a>.</b><br>
  We make an AI assistant that lives inside your product and helps your users get things done.<br>
  <a href="https://frigade.com?utm_source=github&utm_medium=readme&utm_campaign=hob">Check it out</a>.
</p>
