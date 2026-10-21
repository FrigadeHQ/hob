/** Which microphone and language dictation uses: this computer's choice, kept in the browser's storage. */
export type Language = { id: string; label: string }
/** Whisper's names for the languages it knows best; '' = work it out from the speech */
export const LANGUAGES: Language[] = [
  { id: '', label: 'Auto' }, { id: 'english', label: 'English' }, { id: 'spanish', label: 'Spanish' }, { id: 'french', label: 'French' },
  { id: 'german', label: 'German' }, { id: 'italian', label: 'Italian' }, { id: 'portuguese', label: 'Portuguese' }, { id: 'dutch', label: 'Dutch' },
  { id: 'danish', label: 'Danish' }, { id: 'swedish', label: 'Swedish' }, { id: 'norwegian', label: 'Norwegian' }, { id: 'polish', label: 'Polish' },
  { id: 'turkish', label: 'Turkish' }, { id: 'russian', label: 'Russian' }, { id: 'ukrainian', label: 'Ukrainian' }, { id: 'arabic', label: 'Arabic' },
  { id: 'hindi', label: 'Hindi' }, { id: 'japanese', label: 'Japanese' }, { id: 'korean', label: 'Korean' }, { id: 'chinese', label: 'Chinese' },
]
const get = (k: string) => { try { return localStorage.getItem(k) ?? '' } catch { return '' } }
const set = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private window: just for this session */ } }
export const prefs = {
  mic: () => get('garth-mic') || 'default',
  setMic: (id: string) => set('garth-mic', id),
  language: () => get('garth-dictation-language'),
  setLanguage: (id: string) => set('garth-dictation-language', id),
}
