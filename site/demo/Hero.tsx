import React, { useLayoutEffect, useRef } from 'react'
import { ArrowLeft, ArrowRight, PanelLeft, Paperclip, Search, Sparkles, X } from 'lucide-react'
import { Sidebar } from './upstream/app/src/renderer/src/components/Sidebar'
import { AttachmentChip, Composer } from './upstream/app/src/renderer/src/components/Composer'
import { Mascot } from './upstream/app/src/renderer/src/components/Mascot'
import { ThinkingIndicator, WorkLog } from './upstream/app/src/renderer/src/components/WorkLog'
import { ChartCard } from './upstream/app/src/renderer/src/components/ChartCard'
import { CopyButton } from './upstream/app/src/renderer/src/components/CopyButton'
import { IconButton, PluginIcon } from './upstream/app/src/renderer/src/components/ui'
import { pickStarters } from './upstream/app/src/renderer/src/starters'
import { ATTACHMENT, PROMPT, REPLY, frameAt, type DemoFrame } from './sequence'

const noop = () => {}

// App/Chat's real composition and components, driven by the recorded example instead of Electron.
export function Hero({ frame = frameAt(0), paused = false }: { frame?: DemoFrame; paused?: boolean }) {
  const composerBox = useRef<HTMLDivElement>(null)
  const previous = useRef<DOMRect | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const thinking = useRef(frame.thought)
  thinking.current = frame.thought
  useLayoutEffect(() => {
    const node = composerBox.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    if (previous.current && frame.sent && !frame.reduced) {
      node.animate([{ transform: `translateY(${previous.current.top - rect.top}px)` }, { transform: 'translateY(0)' }],
        { duration: 320, easing: 'cubic-bezier(.22,1,.36,1)' })
    }
    previous.current = rect
  }, [frame.sent, frame.attached, frame.reduced])
  useLayoutEffect(() => {
    if (!frame.chart || !scroller.current) return
    scroller.current.scrollTo({ top: scroller.current.scrollHeight, behavior: frame.reduced ? 'instant' : 'smooth' })
  }, [frame.chart, frame.replyWords, frame.summary, frame.done, frame.reduced])

  const composer = <div ref={composerBox} className={`demo-composer ${frame.pressing ? 'is-pressing' : ''}`}>
    <div className="mb-1.5 flex min-h-7 items-center" />
    <Composer value={frame.value} onChange={noop} onSend={noop} onStop={noop} onAttach={noop}
      running={frame.running} pending={frame.attached ? [ATTACHMENT] : []} onRemovePending={noop} inputRef={{ current: null }}
      dictation={{ listening: false, busy: false, toggle: noop, cancel: noop, level: () => 0 }} />
    {!frame.sent && <span className="demo-caret" aria-hidden style={{ top: frame.attached ? 91 : 49 }}><span>{frame.value}</span><i /></span>}
  </div>

  return <div id="root" inert data-phase={frame.phase} data-paused={paused} data-fading={frame.fading} data-reduced={frame.reduced}>
    <div className="relative h-full flex">
      <Sidebar state={{ phase: 'ready', model: { name: 'Gemma 4' } } as any}
        selected={frame.sent ? 'chart-demo' : null} refreshKey={Number(frame.sent) + Number(frame.done) * 2} screen="chat" draftProject={null}
        onSelect={noop} onNew={noop} onNewInProject={noop} onEditProject={noop} onSettings={noop} />
      <main className="relative flex min-w-0 flex-1 flex-col bg-paper">
        <div className="drag h-12 shrink-0" />
        <div ref={scroller} className="demo-scroller flex-1 overflow-y-auto">
          <div className={`mx-auto max-w-[768px] px-6 sm:px-8 ${!frame.sent ? 'flex min-h-full flex-col justify-center pb-16' : 'space-y-8 pb-10'}`}>
            {!frame.sent && <div className="chat-greeting pt-6 text-center demo-home">
              <div className="mb-[23px] flex justify-center"><Mascot size={48} alive={!paused} playful /></div>
              <h1 className="text-[clamp(24px,4vw,32px)] font-semibold leading-[1.2] tracking-[-.95px]">What are we working on?</h1>
              <p className="mt-2 text-[14px] leading-[22px] text-ink-soft">Private, on your computer. Drop in files, or{' '}
                <button className="underline underline-offset-2 hover:text-ink">give Hob a folder to work in</button>.</p>
              <div className="mt-6 text-left">{composer}</div>
              <div className="mt-5 px-1 text-left">
                {pickStarters([], 40, { connect: true }).map(s => <button key={s.title} data-testid="suggestion"
                  className="group flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-body text-muted transition-colors hover:bg-line/50 hover:text-ink">
                  <PluginIcon name={s.icon} className="shrink-0 text-muted transition-colors group-hover:text-ink-soft" />
                  <span className="min-w-0 flex-1 truncate text-left">{s.title}</span>
                  {s.file && <Paperclip size={14} strokeWidth={1.75} className="shrink-0 text-muted" />}
                </button>)}
              </div>
            </div>}
            {frame.sent && <>
              <div className="demo-message flex flex-col items-end gap-1.5">
                <div className="flex flex-wrap items-end justify-end gap-2"><AttachmentChip a={ATTACHMENT} /></div>
                <div data-testid="message-user" className="max-w-[85%] whitespace-pre-wrap [overflow-wrap:anywhere] rounded-[18px] bg-selection px-4 py-2.5 text-body">{PROMPT}</div>
              </div>
              <div className="demo-response">
                <WorkLog steps={frame.steps as any} running={frame.running} writing={frame.replyWords > 0} thinking={thinking} workedMs={33000} />
                {!frame.steps.length && <ThinkingIndicator thinking={thinking} />}
                {frame.chart && <div className="demo-chart mb-3 overflow-hidden rounded-card border border-line bg-surface"><ChartCard path="sales-by-region.chart.json" /></div>}
                <div data-testid="message-assistant" className="reply prose max-w-none [overflow-wrap:anywhere]">
                  {frame.replyWords > 0 && <p>{REPLY.split(' ').slice(0, frame.replyWords).map((word, i) => <React.Fragment key={i}><span className="fw">{word}</span>{' '}</React.Fragment>)}</p>}
                  {frame.summary && <div className="fade-in"><h3>Summary:</h3><ul><li><strong>File used:</strong> <code>q3-sales.xlsx</code></li><li><strong>Chart created:</strong> Sales by Region (Q3)</li></ul></div>}
                </div>
                {frame.done && <div className="fade-in mt-1.5 -ml-1.5 flex items-center gap-1">
                  <CopyButton text={REPLY} /><span className="inline-flex items-center"><button className="inline-flex items-center gap-1.5 rounded-control px-1.5 py-1 text-meta text-muted"><Sparkles size={14} />Save as a skill</button><button className="rounded-control p-1 text-muted"><X size={12} /></button></span>
                </div>}
              </div>
            </>}
          </div>
        </div>
        {frame.sent && <div className="relative mx-auto w-full max-w-[768px] px-6 pb-5 sm:px-8">
          <div className="pointer-events-none absolute inset-x-0 -top-10 h-10 bg-gradient-to-b from-transparent to-paper" />
          {composer}<p className="mt-2 text-center text-meta text-muted">Hob can make mistakes.</p>
        </div>}
        {frame.dropping && <div data-testid="drop-overlay" className="demo-drop pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-composer border-2 border-dashed border-line-strong bg-paper/85 text-body font-medium">
          Drop files to add them
        </div>}
      </main>
      <div className="window-lights" aria-hidden="true"><i /><i /><i /></div>
      <div className="absolute top-2.5 left-[86px] z-40 flex items-center">
        <IconButton icon={PanelLeft} label="Hide sidebar" size={15} small /><IconButton icon={Search} label="Search" size={15} small />
        <IconButton icon={ArrowLeft} label="Back" size={15} small disabled /><IconButton icon={ArrowRight} label="Forward" size={15} small disabled />
      </div>
    </div>
  </div>
}
