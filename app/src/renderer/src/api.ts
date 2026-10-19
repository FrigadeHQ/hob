import type { HobApi } from '../../shared/types'
declare global { interface Window { hob: HobApi } }
export const hob = window.hob
