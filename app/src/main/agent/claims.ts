/** Past-tense claims that files on the computer were changed: "The files have been renamed." */
const CLAIM = /\b(renamed|moved|deleted|trashed|reorgani[sz]ed|organi[sz]ed (?:them |the files |everything )?into|sorted (?:them |the files |everything )?into)\b/i
/** plans, offers, questions and denials aren't claims */
const NOT_A_CLAIM = /\b(not|never|no|couldn't|can't|cannot|unable|would|will|could|should|can|if|want|wants|ready|plan|planned|suggest|haven't|hasn't|didn't|wasn't|weren't|isn't|aren't|before|once|after you|let me know)\b|n't\b|\?\s*$/i

export function claimsFileChanges(text: string): boolean {
  const prose = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, 'X')
  return prose.split(/(?<=[.!?])\s+|\n+/).some((s) => CLAIM.test(s) && !NOT_A_CLAIM.test(s))
}

/** Sent back to the model, as a note from Hob, when it said it changed files but nothing changed. */
export const claimCheck = (ran: string[]) =>
  `[Note from Hob, not from the user: your reply says files were renamed, moved or deleted, but no file was changed in this reply. What actually ran: ${ran.length ? ran.join('; ') : 'nothing'}. Do the change now with the tools (move_files for renames and moves, delete_file to delete), then say what you did. If you can't, tell the user plainly that it isn't done and why. Don't claim it again unless a tool result shows it worked.]`

export const NOTHING_CHANGED = "*Hob didn't change any files in this reply.*"

/** "Let me know if you'd like me to proceed." The user already asked; small models stop here anyway. */
const ASKS_TO_PROCEED = /\bplease (approve|confirm|allow)\b|\b(proceed|go ahead|carry on|continue|run it|do it|start|execute|rename them|move them)\b[^.!?\n]*\?|\b(let me know|tell me|just (reply|say))\b[^.!?\n]*\b(proceed|go ahead|continue|start|run|yes)\b|\b(shall|should) I\b[^.!?\n]*\?|\bwant me to\b[^.!?\n]*\?/i

export function asksToProceed(text: string): boolean {
  const end = text.replace(/```[\s\S]*?```/g, ' ').trim().slice(-400)
  return ASKS_TO_PROCEED.test(end)
}

export const proceedCheck = () =>
  "[Note from Hob, not from the user: the user already asked you to do this, so don't ask whether to go ahead or show a plan first. Do it now with the tools, start to finish; Hob shows the user an approval card before anything in their folders changes. Then say briefly what you did.]"

/** The reply ended empty after doing some of the work: small models run out of steam mid-task. */
export const unfinishedCheck = (ran: string[]) =>
  `[Note from Hob, not from the user: you stopped before finishing, without a word to the user. What ran so far: ${ran.join('; ')}. Carry on from where you stopped and finish the task with the tools (if code saved a list of moves, call move_files with that file). Then tell the user briefly what you did, or plainly what isn't done and why.]`

const EXT = 'txt|md|csv|tsv|json|pdf|docx?|xlsx?|pptx?|png|jpe?g|svg|html?|py|zip'
// "Key results 2025.pdf" in quotes may have spaces; bare names and paths may not
const QUOTED = new RegExp(`["“'«]([^"”'»\\n]{1,80}\\.(?:${EXT}))["”'»]`, 'gi')
const BARE = new RegExp(`(?<![\\w./~-])((?:~|/)?[\\w./~-]*[\\w-]\\.(?:${EXT}))(?![\\w])`, 'gi')

/**
 * File names a reply mentions that aren't on disk: "Jeg har gemt filen indkob.txt" with nothing saved.
 * Small models do this; checking the files instead of the words works in any language.
 */
export function missingFiles(reply: string, exists: (name: string) => boolean): string[] {
  const prose = reply.replace(/```[\s\S]*?```/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/`/g, '')
  const names = [...prose.matchAll(QUOTED)].map((m) => m[1])
  const rest = prose.replace(QUOTED, ' ')
  names.push(...[...rest.matchAll(BARE)].map((m) => m[1]))
  return [...new Set(names)].filter((n) => !exists(n))
}

/**
 * Names a reply mentions that it didn't back with a file. Only a reply that made no files at all is held to
 * them: one that made something and got a name slightly wrong isn't worth minutes of redoing. A name counts as
 * there when its file name is (paths are written in many ways: "~/…", with spaces, half of one).
 */
export function unbackedFiles(reply: string, o: { made: string[]; exists: (fileName: string) => boolean }): string[] {
  if (o.made.length) return []
  return missingFiles(reply, (n) => o.exists(n.split(/[\\/]/).pop() ?? n))
}

export const missingCheck = (names: string[]) =>
  `[Note from Hob, not from the user: your reply names ${names.join(', ')}, but that file doesn't exist. If you meant to make it, make it now with the tools (write_file for text, run_python for PDFs, spreadsheets and images), then say what you did. If you only mentioned the name, give your answer again without saying it was saved.]`
