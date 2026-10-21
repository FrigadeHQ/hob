import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { apply } from './appearance'

apply()

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)

