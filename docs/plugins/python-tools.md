# Python tools

A Python tool is a script Hob can call with arguments. It runs in the same sandbox as Hob's own code.

## Add a Python tool

```json
{
  "id": "money",
  "name": "Money",
  "permissions": { "network": true },
  "tools": [{
    "name": "convert_currency",
    "description": "Convert money between currencies at today's rate.",
    "params": { "type": "object", "properties": { "amount": { "type": "number" }, "from": { "type": "string" }, "to": { "type": "string" } }, "required": ["amount", "from", "to"] },
    "run": "tools/convert.py",
    "title": "Converted {amount} {from} to {to}"
  }],
  "prompt": "For converting money between currencies, use convert_currency."
}
```

`tools/convert.py`:
```python
import json, sys
args = json.load(sys.stdin)      # the model's arguments
print(f"{args['amount']} {args['from']} is …")   # what you print goes back to Hob
```

**Input**
- Arguments arrive as JSON on stdin.
- Settings arrive as environment variables, along with `HOB_CHAT_DIR` and `HOB_PLUGIN_DIR`.
- You can import modules that sit next to your script.

**Output**
- Plain text, or a JSON object like `{"text": "…", "files": ["chart.png"]}`.
- Files saved in the current folder (the chat folder) show up as file cards.

**Packages:** Python 3.12 with pandas, numpy, matplotlib, openpyxl, python-docx, pypdf and Pillow.

**Sandbox:**
- Writes only to the chat folder.
- Reads only the chat folder, your plugin folder and folders the user granted.
- No internet unless `"permissions": { "network": true }`, and only while the user has Web access on.
- 60-second limit.

`title` is the step title shown in the chat. `{arg}` placeholders are filled from the arguments.

[Plugins overview](README.md) · [Skills](skills.md) · [Python tools](python-tools.md) · [App connections (MCP)](app-connections.md) · [Reference](reference.md)
