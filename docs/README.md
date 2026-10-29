# Hob

The full AI coworker experience. None of the cloud. Tell Hob what you need done: it works on your files, figures out the steps, and hands back finished work, all on your own computer using open-weight models.

[Download](https://github.com/FrigadeHQ/hob/releases/latest) · [Plugin guide](plugins/README.md) · [Contributing](../CONTRIBUTING.md) · [MIT license](../LICENSE)

## Why Hob

Desktop AI apps like Claude and ChatGPT work on your files, run code, search the web and ask before changing anything. Existing solutions that run AI locally mostly give you a raw chat sandbox with no tools and requires you to understand which models are most compatible with your system.

Hob strives to work with the same quality and functionality as Claude and ChatGPT, except running its models entirely on your own computer.

- **No setup.** Hob checks your hardware and downloads the best model it can run well. No account or model understanding required.
- **Works on your files.** Projects, folders, spreadsheets, PDFs, photos, and much more.
- **Safe by default.** Approval confirmations before anything in your folders changes, Undo for every task, and code runs in a sandbox.
- **In your language.** 32 languages, matching your computer's (change it in Settings). Hob answers in whatever language you write in.
- **Free and open source.** [MIT licensed](../LICENSE). No account, no subscription, no limits.

*A hob is a household spirit from English folklore that quietly helps with the chores.*

## Private

The model runs on your computer with [llama.cpp](https://github.com/ggml-org/llama.cpp) (Metal on Mac, CUDA or Vulkan elsewhere). Chats and files stay on your machine, and there is no telemetry. Hob only goes online to download models and check for new ones, and, while Web access is on, to search the web, let its code fetch data (like stock prices) and install Python packages from PyPI. Turn Web access off in Settings to keep everything offline. Connectors you add also go online.

## Models

Hob picks from a curated list of open models: Google's Gemma 4 for most computers (E4B Compact on 8 GB Macs, E4B on 16 GB, 26B from 24 GB) and OpenAI's gpt-oss 120B for workstations. Models are ranked on agent work (multi-step tasks and tool use), and split between graphics and system memory when that's faster. You can switch models any time.

## What it can do

| Feature | What Hob does |
|---|---|
| Files and projects | Work on attached files, or on folders grouped into projects with their own instructions |
| Chats | Save one as a Markdown file from the sidebar, or with ⌘S / Ctrl+S |
| Code | Python with pandas, numpy, openpyxl, python-docx, pypdf and Pillow, plus any package from PyPI it needs; sandboxed to the chat's folder |
| Images | Looks at photos and screenshots (paste them in): reads receipts, charts and error messages, describes what's there. A small [Qwen3-VL](https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF) model, downloaded after the main one |
| Charts | Interactive charts in the chat, downloadable as PNG |
| PDFs | Read PDFs, including scans, and fill in forms (Mac) |
| Web | Search and read pages through a metasearch engine that runs on your computer |
| Dictation | Speech to text, on your computer |
| Plugins | Skills, Python tools and MCP connectors |

## Where models go

Models take several gigabytes. On a Mac they go in Hob's app data folder. On Windows and Linux you can pick another drive on the first screen (Saves to … → Change…), and Hob puts everything it downloads in a Hob folder there.

## Removing Hob

Go to Settings → Files & storage → Remove Hob. That deletes Hob, its models, your chats and settings. Files your chats made stay in your files folder (Documents/Hob unless you changed it).

- **Windows:** uninstalling Hob from Settings → Apps does the same, except for models saved to another drive during setup (a Hob folder there, which you can delete).
- **Mac and Linux:** dragging Hob to the Trash (or deleting the AppImage) leaves its models behind. Use Remove Hob, or delete Hob's folder yourself: `~/Library/Application Support/Hob` on a Mac, `~/.config/Hob` on Linux.

## Plugins

A plugin is a folder with a `hob-plugin.json`. It can add [skills](plugins/skills.md) in the open [Agent Skills](https://agentskills.io) format, [Python tools](plugins/python-tools.md), and [connectors](plugins/connectors.md) to any MCP server, including `.mcpb` bundles. Hob's own web search, code and PDF features are plugins too, in [`app/plugins/`](../app/plugins).

You don't have to write skills by hand: after Hob does something you'll want again, say "save this as a skill". It keeps the steps and the code that worked, and shows you both before saving.

See the [plugin guide](plugins/README.md) and the [reference](plugins/reference.md).

## Building

Requires Node.js 24 and pnpm 10.

```sh
pnpm install
pnpm dev              # run Hob
pnpm -C app test      # unit tests
pnpm -C app e2e       # end-to-end tests (hidden window, stand-in model)
pnpm -C app dist      # installer for this computer
```

To release, run `sh app/scripts/release.sh 0.2.0`. It sets the version, tags `v0.2.0` and pushes; [GitHub Actions](../.github/workflows/release.yml) builds Mac, Windows and Linux and publishes them as one release. Installed copies download the new version and install it when they quit.

## License

[MIT](../LICENSE)
