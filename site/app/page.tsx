import Image from 'next/image'
import { Mascot } from './Mascot'

const RELEASES = 'https://github.com/FrigadeHQ/hob/releases/latest/download'
const DOWNLOADS = [
  { label: 'Download for Mac', href: `${RELEASES}/Hob-mac-arm64.dmg`, primary: true },
  { label: 'Windows', href: `${RELEASES}/Hob-windows-x64.exe` },
  { label: 'Linux', href: `${RELEASES}/Hob-linux-x86_64.AppImage` },
]

// lucide icons, drawn inline
const icon = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
const Download = () => <svg {...icon}><path d="M12 15V3" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /></svg>
const Lock = () => <svg {...icon}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
const Sparkles = () => <svg {...icon}><path d="M9.94 14.06 4 20" /><path d="m14 4 1.5 3.5L19 9l-3.5 1.5L14 14l-1.5-3.5L9 9l3.5-1.5Z" /></svg>
const Chart = () => <svg {...icon}><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></svg>

const FEATURES = [
  { Icon: Lock, title: 'Private by design', text: 'Your chats, your files and the AI itself stay on your computer. It works offline.' },
  { Icon: Sparkles, title: 'Ready in minutes', text: 'Hob picks a model that fits your computer and sets everything up for you.' },
  { Icon: Chart, title: 'Does real work', text: 'Charts from spreadsheets, summaries of documents, PDFs read and filled in.' },
]

export default function Home() {
  return (
    <>
      <main>
        <section className="hero">
          <Mascot />
          <h1>Your private AI,<br />right on your computer.</h1>
          <p className="lede">Hob is a free, open-source assistant. Ask it anything, hand it your files, and it does the work without anything leaving your machine.</p>
          <div className="downloads">
            {DOWNLOADS.map((d) => (
              <a key={d.label} href={d.href} className={d.primary ? 'button primary' : 'button'}>
                {d.primary && <Download />}{d.label}
              </a>
            ))}
          </div>
          <p className="note">Free and open source. Apple silicon Macs, Windows and Linux.</p>
        </section>

        <section className="shot">
          <Image src="/screenshot.png" alt="Hob charting revenue by region from a sales spreadsheet and summing up what stands out" width={2640} height={1960} sizes="(max-width: 1100px) 100vw, 1040px" priority />
        </section>

        <section className="features">
          {FEATURES.map(({ Icon, title, text }) => (
            <div key={title}>
              <Icon />
              <h2>{title}</h2>
              <p>{text}</p>
            </div>
          ))}
        </section>
      </main>
      <footer>
        <a href="https://github.com/FrigadeHQ/hob">GitHub</a>
        <span aria-hidden="true">·</span>
        <a href="https://github.com/FrigadeHQ/hob/blob/main/docs/README.md">Help</a>
        <span aria-hidden="true">·</span>
        <span>Made by <a href="https://frigade.com?utm_source=hob.chat&amp;utm_medium=site&amp;utm_campaign=hob">Frigade</a></span>
      </footer>
    </>
  )
}
