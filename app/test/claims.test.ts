import { expect, it } from 'vitest'
import { asksToProceed, claimsFileChanges, missingFiles, unbackedFiles } from '../src/main/agent/claims'
import { pythonHint } from '../src/main/tools/python'

it('spots replies that say files were changed', () => {
  for (const t of [
    'The files have been renamed. I used the file modification dates.',
    'Done! I moved all 20 photos into Holidays.',
    'I deleted the duplicates from your Downloads folder.',
    'All set: I organized them into folders by year.',
  ]) expect(claimsFileChanges(t), t).toBe(true)
})

it("doesn't count plans, offers, questions or honest failures", () => {
  for (const t of [
    "I haven't renamed anything yet.",
    'Here is how they would be renamed:',
    'Want me to move them into a folder?',
    "I couldn't move the files because Hob doesn't have access.",
    'Once you allow it, the files will be renamed.',
    'Should these be deleted?',
    'Here are the new names:\n```\nIMG_1.jpg → renamed.jpg\n```',
    'I made a chart of your sales.',
  ]) expect(claimsFileChanges(t), t).toBe(false)
})

it('explains blocked code in plain next steps', () => {
  expect(pythonHint("PermissionError: [Errno 1] Operation not permitted: '/Users/eric/Desktop/hob-test/IMG_1.jpg'")).toContain('move_files')
  expect(pythonHint("FileNotFoundError: [Errno 2] No such file or directory: '~/Desktop/hob-test'")).toContain("doesn't understand ~")
  expect(pythonHint('all good')).toBe('')
})

it('spots replies that stop to ask "shall I go ahead?"', () => {
  for (const t of [
    "Here's what I plan to do: read the dates, then rename.\n\nLet me know if you'd like me to proceed.",
    'Do you want me to run it now? If yes, just reply “yes” and I’ll execute it.',
    'Shall I rename them?',
    'Want me to go ahead?',
    'Please approve this request. Once I have the file list, I’ll rename them.',
  ]) expect(asksToProceed(t), t).toBe(true)
  for (const t of [
    'Renamed 20 files in hob-test.',
    'Which folder do you mean, Desktop or Downloads?',
    'Here are 5 dinner ideas. Enjoy!',
  ]) expect(asksToProceed(t), t).toBe(false)
})

it('code that reads the date taken from the wrong place gets told where it is', () => {
  const code = 'exif = img.getexif()\ndate = exif.get(36867)'
  expect(pythonHint('IMG_1.jpg has no DateTimeOriginal', code)).toContain('get_ifd(0x8769)')
  // done right: no note
  expect(pythonHint('ok', 'img.getexif().get_ifd(0x8769).get(36867)')).toBe('')
})

it('finds files a reply names that do not exist, in any language', () => {
  const none = () => false
  expect(missingFiles('Jeg har gemt filen indkob.txt med din indkøbsliste.', none)).toEqual(['indkob.txt'])
  expect(missingFiles('I saved the report as "Key results 2025.pdf" for you.', none)).toEqual(['Key results 2025.pdf'])
  // files that are there, links, code and file types alone don't count
  expect(missingFiles('Saved notes.txt.', (n) => n === 'notes.txt')).toEqual([])
  expect(missingFiles('See example.com and www.dr.dk, or a PDF file.', none)).toEqual([])
  expect(missingFiles('```python\npd.read_csv("data.csv")\n```\nDone.', none)).toEqual([])
})

it('only a reply that made no files is held to the names it mentions, and names match by file name, not path', () => {
  const inChat = (n: string) => n === 'Annual_Report_Summary.pdf'
  // made a file: a name slip or a path written differently isn't worth sending it back
  expect(unbackedFiles('Saved to ~/Documents/Hob/2026-10-21 22.52/Annual_Report_Summary.pdf', { made: ['/x/Annual_Report_Summary.pdf'], exists: inChat })).toEqual([])
  expect(unbackedFiles('Your summary is in report-summary.pdf.', { made: ['/x/summary.pdf'], exists: () => false })).toEqual([])
  // made nothing: a path with spaces still finds the file that is there
  expect(unbackedFiles('Saved to ~/Documents/Hob/2026-10-21 22.52/Annual_Report_Summary.pdf', { made: [], exists: inChat })).toEqual([])
  // made nothing, and the file isn't anywhere: that's the claim to check
  expect(unbackedFiles('Jeg har gemt filen indkob.txt.', { made: [], exists: () => false })).toEqual(['indkob.txt'])
})
