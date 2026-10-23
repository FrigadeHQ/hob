import { app } from 'electron'
import { matchLocale } from '../shared/i18n'

/** The computer's language, among Hob's. HOB_SYSTEM_LANGUAGES stands in for the computer's list (tests) */
export const systemLocale = () => matchLocale(process.env.HOB_SYSTEM_LANGUAGES?.split(',') ?? app.getPreferredSystemLanguages())
