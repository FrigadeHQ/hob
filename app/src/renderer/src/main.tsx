import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { apply } from './appearance'
import { hob } from './api'
import { applyLanguage } from './i18n'

apply()

// the first screen is already in the user's language
const render = () => createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
hob.settings.get().then((s) => applyLanguage(s.locale), () => {}).finally(render)
