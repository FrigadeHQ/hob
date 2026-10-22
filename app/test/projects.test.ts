import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { ProjectInput } from '../src/shared/agent'
import { checkFolders, cleanProject, withMissing } from '../src/main/projects'

const home = mkdtempSync(join(tmpdir(), 'hob-proj-'))
const trip = join(home, 'Trip'); const notes = join(home, 'Notes')
mkdirSync(trip); mkdirSync(notes); writeFileSync(join(trip, 'big.mov'), 'x')

it('a picked file stands for its folder; duplicates go; problems say why', () => {
  expect(checkFolders([join(trip, 'big.mov'), trip, home], home)).toEqual([
    { path: trip },
    { path: home, problem: 'Pick a folder inside your home folder, not the whole thing.' },
  ])
})

it('cleans what the dialog sends: needs a name, drops folders Hob cannot use, keeps ones that are only missing', () => {
  expect(cleanProject({ name: '  ', folders: [] }, home)).toEqual({ error: 'Give the project a name.' })
  expect(cleanProject({ name: ' Trip ', instructions: 'Be brief', folders: [trip, home, notes] }, home)).toEqual({ name: 'Trip', instructions: 'Be brief', folders: [trip, notes] })
  // an unplugged drive stays in the project it was already in
  const gone = join(home, 'USB')
  expect((cleanProject({ name: 'T', folders: [gone, trip] }, home, [], [gone]) as ProjectInput).folders).toEqual([gone, trip])
  expect((cleanProject({ name: 'T', folders: [gone] }, home) as ProjectInput).folders).toEqual([])
  expect(cleanProject({ name: 'x'.repeat(200), folders: [] }, home)).toMatchObject({ name: 'x'.repeat(80) })
})

it('marks folders that cannot be found right now', () => {
  expect(withMissing({ id: 'p', name: 'P', instructions: '', folders: [trip, join(home, 'gone')] }).missing).toEqual([join(home, 'gone')])
})
