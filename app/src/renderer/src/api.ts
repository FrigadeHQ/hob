import type { MabelApi } from '../../shared/types'
declare global { interface Window { mabel: MabelApi } }
export const mabel = window.mabel
