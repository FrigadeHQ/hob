/** How big replies are: this computer's choice, kept in the browser's storage and applied to <html>. */
export type TextSize = 'small' | 'medium' | 'large'

const get = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const set = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private window: this session only */ } }

export const appearance = {
  textSize: (): TextSize => { const v = get('garth-text-size'); return v === 'small' || v === 'large' ? v : 'medium' },
  setTextSize(s: TextSize) { set('garth-text-size', s); apply() },
}

export function apply() {
  document.documentElement.dataset.textSize = appearance.textSize()
}
