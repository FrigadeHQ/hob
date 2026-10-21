/** How replies look: this computer's choice, kept in the browser's storage and applied to <html>. */
export type ChatFont = 'serif' | 'sans'
export type TextSize = 'small' | 'medium' | 'large'

const get = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const set = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private window: this session only */ } }

export const appearance = {
  chatFont: (): ChatFont => (get('hob-chat-font') === 'sans' ? 'sans' : 'serif'),
  textSize: (): TextSize => { const v = get('hob-text-size'); return v === 'small' || v === 'large' ? v : 'medium' },
  setChatFont(f: ChatFont) { set('hob-chat-font', f); apply() },
  setTextSize(s: TextSize) { set('hob-text-size', s); apply() },
}

export function apply() {
  document.documentElement.dataset.chatFont = appearance.chatFont()
  document.documentElement.dataset.textSize = appearance.textSize()
}
