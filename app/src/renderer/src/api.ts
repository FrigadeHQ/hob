import type { GarthApi } from '../../shared/types'
declare global { interface Window { garth: GarthApi } }
export const garth = window.garth
