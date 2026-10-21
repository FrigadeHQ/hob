# Python tools

A Python tool is a script Mabel can call with arguments. It runs in the same sandbox as Mabel's own code.

## Add a Python tool

```json
{
  "id": "text-stats",
  "name": "Text stats",
  "tools": [{
    "name": "count_words",
    "description": "Count the words and sentences in a text file.",
    "params": { "type": "object", "properties": { "file": { "type": "string" } }, "required": ["file"] },
    "run": "tools/count.py",
    "title": "Counted the words in {file}"
  }],
  "prompt": "To count words in a file, use count_words."
}
```

`tools/count.py`:
```python
import json, re, sys
args = json.load(sys.stdin)      # the model's arguments
text = open(args['file'], encoding='utf-8').read()
print(f"{len(text.split())} words, {len(re.findall(r'[.!?]+', text))} sentences")   # what you print goes back to Mabel
```

A tool that needs the internet adds `"permissions": { "network": true }`.

**Input**
- Arguments arrive as JSON on stdin.
- Settings arrive as environment variables, along with `MABEL_CHAT_DIR` and `MABEL_PLUGIN_DIR`.
- You can import modules that sit next to your script.

**Output**
- Plain text, or a JSON object like `{"text": "…", "files": ["chart.png"]}`.
- Files saved in the current folder (the chat folder) show up as file cards.

**Packages:** Python 3.12 with pandas, numpy, matplotlib, openpyxl, python-docx, pypdf and Pillow, plus any package Mabel installed from PyPI with `install_packages`.

**Sandbox:**
- Writes only to the chat folder.
- Reads only the chat folder, your plugin folder and folders the user granted.
- No internet unless `"permissions": { "network": true }`, and only while the user has Web access on.
- 60-second limit.

`title` is the step title shown in the chat. `{arg}` placeholders are filled from the arguments.

[Plugins overview](README.md) · [Skills](skills.md) · [Python tools](python-tools.md) · [Connectors (MCP)](connectors.md) · [Reference](reference.md)
