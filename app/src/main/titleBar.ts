/**
 * Windows and Linux: no title bar or menu bar, like the Mac. The system draws its window buttons over the
 * top-right corner of the page (Window Controls Overlay), in the app's own colours.
 */
export const TITLE_BAR_HEIGHT = 48
export const titleBarColors = (dark: boolean) => (dark ? { color: '#191817', symbolColor: '#f2f1ef' } : { color: '#FAFAFA', symbolColor: '#1c1917' })
