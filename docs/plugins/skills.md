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
4. In Hob, open **Plugins → Add → Link a folder** and pick the folder.
5. Type `/fridge eggs, spinach, feta` in a chat.

Linked folders reload as you edit, so you see changes on your next message.

How Hob uses skills:
- Hob's instructions list each skill's name and description.
- When a request matches, Hob loads the full text with `use_skill`.
- Typing `/name` attaches the skill to that message directly.
- Files next to `SKILL.md` (templates, examples, scripts) are readable by Hob's code.

[Plugins overview](README.md) · [Skills](skills.md) · [Python tools](python-tools.md) · [App connections (MCP)](app-connections.md) · [Reference](reference.md)
