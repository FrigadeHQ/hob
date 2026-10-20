/** what the user calls the app that shows their files */
export const fileManager = (platform: string) => (platform === 'darwin' ? 'Finder' : platform === 'win32' ? 'File Explorer' : 'Files')
