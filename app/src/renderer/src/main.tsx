import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// the serif for Garth's replies (SIL Open Font License; bundled, never fetched)
import '@fontsource-variable/source-serif-4/opsz.css'
import '@fontsource-variable/source-serif-4/opsz-italic.css'
import './styles.css'
import { App } from './App'
import { apply } from './appearance'

apply()

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)

