/** Past-tense claims that files on the computer were changed: "The files have been renamed." */
const CLAIM = /\b(renamed|moved|deleted|trashed|reorgani[sz]ed|organi[sz]ed (?:them |the files |everything )?into|sorted (?:them |the files |everything )?into)\b/i
/** plans, offers, questions and denials aren't claims */
const NOT_A_CLAIM = /\b(not|never|no|couldn't|can't|cannot|unable|would|will|could|should|can|if|want|wants|ready|plan|planned|suggest|haven't|hasn't|didn't|wasn't|weren't|isn't|aren't|before|once|after you|let me know)\b|n't\b|\?\s*$/i

export function claimsFileChanges(text: string): boolean {
  const prose = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, 'X')
  return prose.split(/(?<=[.!?])\s+|\n+/).some((s) => CLAIM.test(s) && !NOT_A_CLAIM.test(s))
}

/** Sent back to the model, as a note from Garth, when it said it changed files but nothing changed. */
export const claimCheck = (ran: string[]) =>
  `[Note from Garth, not from the user: your reply says files were renamed, moved or deleted, but no file was changed in this reply. What actually ran: ${ran.length ? ran.join('; ') : 'nothing'}. Do the change now with the tools (move_files for renames and moves, delete_file to delete), then say what you did. If you can't, tell the user plainly that it isn't done and why. Don't claim it again unless a tool result shows it worked.]`

export const NOTHING_CHANGED = "*Garth didn't change any files in this reply.*"

/** "Let me know if you'd like me to proceed." The user already asked; small models stop here anyway. */
const ASKS_TO_PROCEED = /\bplease (approve|confirm|allow)\b|\b(proceed|go ahead|carry on|continue|run it|do it|start|execute|rename them|move them)\b[^.!?\n]*\?|\b(let me know|tell me|just (reply|say))\b[^.!?\n]*\b(proceed|go ahead|continue|start|run|yes)\b|\b(shall|should) I\b[^.!?\n]*\?|\bwant me to\b[^.!?\n]*\?/i

export function asksToProceed(text: string): boolean {
  const end = text.replace(/```[\s\S]*?```/g, ' ').trim().slice(-400)
  return ASKS_TO_PROCEED.test(end)
}

export const proceedCheck = () =>
  "[Note from Garth, not from the user: the user already asked you to do this, so don't ask whether to go ahead or show a plan first. Do it now with the tools, start to finish; Garth shows the user an approval card before anything in their folders changes. Then say briefly what you did.]"

/** The reply ended empty after doing some of the work: small models run out of steam mid-task. */
export const unfinishedCheck = (ran: string[]) =>
  `[Note from Garth, not from the user: you stopped before finishing, without a word to the user. What ran so far: ${ran.join('; ')}. Carry on from where you stopped and finish the task with the tools (if code saved a list of moves, call move_files with that file). Then tell the user briefly what you did, or plainly what isn't done and why.]`
