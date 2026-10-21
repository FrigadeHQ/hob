# Skills

A skill is a `SKILL.md` file: a name, a one-line description, and the steps in plain English. Hob picks it up when a request matches, or when someone types `/name`.

## Try it in 5 minutes: your first skill

1. Make a folder anywhere, e.g. `~/Code/recipe-helper`.
2. Add `hob-plugin.json`:
   ```json
   { "id": "recipe-helper", "name": "Recipe Helper", "icon": "chef-hat", "description": "Recipes from what's in your fridge." }
   ```
3. Add `skills/fridge/SKILL.md`. This is the [Agent Skills](https://agentskills.io) format, so skills written for Claude or Codex work too:
   ```markdown
   ---
   name: fridge
   description: Suggest recipes from ingredients the user already has.
   ---
   1. List what they have; assume salt, oil and pepper.
   2. Suggest 3 recipes under 30 minutes, the one needing fewest extra items first.
   3. For each: time, the missing ingredients, then short numbered steps.
   ```
4. In Hob, open **Settings → Plugins → Add plugin → Link a folder** and pick the folder.
5. Type `/fridge eggs, spinach, feta` in a chat.

Linked folders reload as you edit, so you see changes on your next message.

## Save a skill from a chat

Once Hob has done something you'll want again, say "save this as a skill". After a longer task that used code, Hob also offers a **Save as a skill** button under its reply.

- Hob writes the steps, keeps the code that worked as script files next to `SKILL.md`, and pins the packages it used.
- You see everything first: the steps and each file's code, with Allow or Deny.
- Saved skills show under **Settings → Skills**, each on its own card, where you can edit or delete them.
- Hob won't save a skill in a message where it read web pages: ask again in a new message.

## Skills with scripts

Put Python files next to `SKILL.md` and tell Hob in the steps to run them:

```markdown
---
name: spending
description: Monthly spending chart from a bank CSV.
---
1. Run the script with run_python: script "spending/make_report.py", args: the CSV's full path.
2. Show the chart it saves and sum up the biggest categories.
```

- The script gets its inputs as `sys.argv[1:]` and runs in the chat folder, so files it saves show up in the chat.
- It can read files next to it (templates, lookup tables) and folders the user gave Hob.
- It can use packages from PyPI: list them in the frontmatter, pinned, e.g. `packages: yfinance==0.2.54`. Hob installs missing ones the first time the skill runs (Web access must be on).
- It runs in the same sandbox as Hob's own code. No internet, unless the skill's frontmatter says `network: true` and Web access is on. For a plugin's skills, the plugin must also ask for `"permissions": { "network": true }`.

How Hob uses skills:
- Hob's instructions list each skill's name and description.
- When a request matches, Hob loads the full text with `use_skill`.
- Typing `/name` attaches the skill to that message directly.
- Files next to `SKILL.md` (templates, examples, scripts) are readable by the skill's scripts.

[Plugins overview](README.md) · [Skills](skills.md) · [Python tools](python-tools.md) · [Connectors (MCP)](connectors.md) · [Reference](reference.md)
