import { useEffect, useRef, useState } from 'react'
import { Box, ChevronRight, FolderOpen, Globe, Link, LogIn, LogOut, Pencil, Plug, Plus, ShieldCheck, Sparkles, Trash2, TriangleAlert, X } from 'lucide-react'
import type { NewSkill, PluginInfo, PluginResult, PluginTrust } from '../../../shared/plugins'
import { hob } from '../api'
import { Dialog, Field, PluginIcon, Switch, button, field } from '../components/ui'

const TRUST: Record<PluginTrust, { icon: typeof Box; text: string }> = {
  instructions: { icon: ShieldCheck, text: "Adds know-how. Doesn't run anything." },
  code: { icon: Box, text: "Runs code in Hob's safe space" },
  network: { icon: Globe, text: 'Uses the internet' },
  online: { icon: Globe, text: 'Connects to an online service' },
  full: { icon: TriangleAlert, text: 'Runs its own program with full access to your computer' },
}
const GUIDE = 'https://github.com/FrigadeHQ/hob/blob/main/docs/plugins/README.md'

function SkillDialog({ initial, onClose, onSaved }: { initial?: NewSkill; onClose(): void; onSaved(name: string): void }) {
  const [s, setS] = useState<NewSkill>(initial ?? { name: '', description: '', instructions: '' })
  const [error, setError] = useState('')
  const save = async () => {
    const r = await hob.plugins.saveSkill(s, !!initial)
    if (r.ok) onSaved(s.name)
    else setError(r.error)
  }
  return (
    <Dialog title={initial ? 'Edit skill' : 'New skill'} onClose={onClose} testId="skill-dialog">
      <div className="space-y-4">
        <Field label="Name" hint={s.name ? `Use it by typing /${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : 'Short, like “Weekly report”'}>
          <input data-testid="skill-name" autoFocus={!initial} disabled={!!initial} className={field} value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder="Weekly report" />
        </Field>
        <Field label="When should Hob use it?">
          <input data-testid="skill-description" className={field} value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} placeholder="When I ask for my weekly update for the team" />
        </Field>
        <Field label="Instructions" hint="Write it like you'd explain it to a friend. Steps and examples help.">
          <textarea data-testid="skill-instructions" rows={8} className={`${field} resize-none leading-5`} value={s.instructions} onChange={(e) => setS({ ...s, instructions: e.target.value })}
            placeholder={'1. Start with the three biggest wins.\n2. Then blockers, with who can help.\n3. Keep it under 150 words, friendly tone.'} />
        </Field>
        {error && <p className="text-ui text-accent">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className={button.quiet} onClick={onClose}>Cancel</button>
          <button data-testid="skill-save" className={button.primary} disabled={!s.name.trim() || !s.description.trim() || !s.instructions.trim()} onClick={() => void save()}>Save skill</button>
        </div>
      </div>
    </Dialog>
  )
}

const isLink = (s: string) => /^https?:\/\//i.test(s.trim())

function ConnectDialog({ onClose, onDone }: { onClose(): void; onDone(notice: { text: string; error?: boolean }, id?: string): void }) {
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [env, setEnv] = useState('')
  const [error, setError] = useState('')
  const [connecting, setConnecting] = useState<string | null>(null)
  const json = command.trim().startsWith('{')
  const link = isLink(command)
  const connect = async () => {
    setError('')
    const r = await hob.plugins.connectApp({ name, command, env })
    if (!r.ok) { setError(r.error); return }
    // connect right away: problems show here, and apps that need a sign-in open the browser
    setConnecting(r.id)
    const c = await hob.plugins.connect(r.id)
    setConnecting(null)
    onDone(c.ok ? { text: 'Connected. Hob can use it in your next message.' } : { text: `Added, but it isn't connected yet: ${c.error}`, error: true }, r.id)
  }
  const cancel = () => {
    if (connecting) { void hob.plugins.cancelConnect(connecting); return }
    onClose()
  }
  return (
    <Dialog title="Connect an app" onClose={cancel} testId="connect-dialog">
      {connecting
        ? (
          <div data-testid="connect-waiting" className="space-y-4">
            <p className="flex items-center gap-2 text-body"><span className="size-2 animate-pulse rounded-full bg-ink" />Connecting…</p>
            <p className="text-ui text-ink-soft">If your browser opens, sign in there and allow Hob. Then come back here.</p>
            <div className="flex justify-end"><button className={button.quiet} onClick={cancel}>Cancel</button></div>
          </div>
        )
        : (
          <div className="space-y-4">
            <p className="text-ui text-ink-soft">Add any MCP server, like the ones made for Claude or Cursor: a link to an online one, or a program on this computer.</p>
            <Field label="Name"><input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder={json ? 'Taken from the config' : link ? 'Taken from the link' : 'Notes'} /></Field>
            <Field label="Link, command or config" hint="A link like https://mcp.example.com/mcp, a command like npx -y @modelcontextprotocol/server-memory, or a pasted {“mcpServers”: …} config.">
              <textarea data-testid="connect-command" rows={3} className={`${field} resize-none font-mono text-meta leading-5`} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="https://mcp.example.com/mcp" />
            </Field>
            {!json && (
              <Field label={link ? 'Headers (optional)' : 'Keys and settings (optional)'} hint={link ? 'Only if the app gave you a key. One per line, like Authorization: Bearer abc123' : 'One per line, like API_KEY=abc123'}>
                <textarea data-testid="connect-env" rows={2} className={`${field} resize-none font-mono text-meta leading-5`} value={env} onChange={(e) => setEnv(e.target.value)} />
              </Field>
            )}
            <p className="flex gap-2 rounded-control bg-line/50 p-3 text-ui text-ink-soft">
              {link
                ? <><Globe size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />Hob sends what it needs for a task to this online service. If it asks you to sign in, your browser opens.</>
                : <><TriangleAlert size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />The app connection runs its own program with full access to your computer. Only add ones you trust.</>}
            </p>
            {error && <p className="text-ui text-accent">{error}</p>}
            <div className="flex justify-end gap-2">
              <button className={button.quiet} onClick={onClose}>Cancel</button>
              <button data-testid="connect-save" className={button.primary} disabled={!command.trim()} onClick={() => void connect()}>Connect</button>
            </div>
          </div>
        )}
    </Dialog>
  )
}

function SettingInput({ p, s }: { p: PluginInfo; s: PluginInfo['settings'][number] }) {
  const [v, setV] = useState(s.value ?? '')
  const save = (next: string) => { setV(next); void hob.plugins.setSetting(p.id, s.key, next) }
  const label = s.required ? `${s.label} (needed)` : s.label
  if (s.kind === 'boolean') {
    const on = (s.value ?? s.default ?? 'false') === 'true'
    return (
      <div className="flex items-start justify-between gap-3">
        <span><span className="block text-ui font-medium">{s.label}</span>{s.help && <span className="block text-meta text-muted">{s.help}</span>}</span>
        <Switch on={on} label={s.label} onChange={(x) => save(x ? 'true' : 'false')} />
      </div>
    )
  }
  if (s.kind === 'directory' || s.kind === 'file') {
    const items = (s.value ?? s.default ?? '').split('\n').filter(Boolean)
    const choose = async () => {
      const picked = await hob.plugins.choosePath(s.kind as 'directory' | 'file', s.multiple)
      if (picked.length) save((s.multiple ? [...new Set([...items, ...picked])] : picked.slice(0, 1)).join('\n'))
    }
    return (
      <Field label={label} hint={s.help}>
        {items.length > 0 && (
          <ul className="mb-1.5 space-y-1">
            {items.map((i) => (
              <li key={i} className="flex items-center gap-2 rounded-control bg-line/50 px-2.5 py-1 text-meta text-ink-soft">
                <FolderOpen size={13} strokeWidth={1.75} className="shrink-0" /><span className="min-w-0 flex-1 truncate" title={i}>{i}</span>
                {(s.multiple || s.value) && <button aria-label={`Remove ${i}`} className="text-muted hover:text-ink" onClick={() => save(items.filter((x) => x !== i).join('\n'))}><X size={13} /></button>}
              </li>
            ))}
          </ul>
        )}
        <button type="button" className={button.secondary} onClick={() => void choose()}>
          <FolderOpen size={14} />{items.length ? (s.multiple ? (s.kind === 'file' ? 'Add a file…' : 'Add a folder…') : 'Change…') : s.kind === 'file' ? 'Choose a file…' : 'Choose a folder…'}
        </button>
      </Field>
    )
  }
  return (
    <Field label={label} hint={s.help}>
      <input type={s.secret ? 'password' : s.kind === 'number' ? 'number' : 'text'} className={field} value={v} placeholder={s.secret && s.set ? 'Saved. Type to replace' : s.default ?? ''}
        onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== (s.value ?? '') || (s.secret && v)) void hob.plugins.setSetting(p.id, s.key, v) }} />
      {s.secret && s.set && <button type="button" className="mt-1 text-meta text-muted underline underline-offset-2 hover:text-ink" onClick={() => { setV(''); void hob.plugins.setSetting(p.id, s.key, '') }}>Clear</button>}
    </Field>
  )
}

function SignInButton({ p }: { p: PluginInfo }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const go = async () => {
    setBusy(true); setError('')
    const r = await hob.plugins.connect(p.id)
    setBusy(false)
    if (!r.ok && !/stopped/i.test(r.error)) setError(r.error)
  }
  return (
    <span className="mt-2 flex flex-wrap items-center gap-2">
      {busy
        ? <><span className="text-ui text-ink-soft">Sign in in your browser, then come back.</span><button className={button.quiet} onClick={() => void hob.plugins.cancelConnect(p.id)}>Cancel</button></>
        : <button data-testid="plugin-signin" className={button.primary} onClick={() => void go()}><LogIn size={14} />Sign in</button>}
      {error && <span className="text-ui text-accent">{error}</span>}
    </span>
  )
}

function PluginRow({ p, open, onToggleOpen, onEditSkill }: { p: PluginInfo; open: boolean; onToggleOpen(): void; onEditSkill(name: string): void }) {
  const trust = TRUST[p.trust]
  const mine = p.id === 'my-skills'
  return (
    <li data-testid="plugin" data-id={p.id} className="px-4 py-3.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-control bg-line/70 text-ink-soft">
          {p.image ? <img src={p.image} alt="" className="size-full object-cover" /> : <PluginIcon name={p.icon} size={18} />}
        </span>
        <button onClick={onToggleOpen} className="group min-w-0 flex-1 text-left" aria-expanded={open}>
          <span className="flex items-center gap-2">
            <span className="text-body font-medium">{p.name}</span>
            {p.source === 'builtin' && <span className="rounded-full bg-line/80 px-2 text-meta leading-5 text-ink-soft">Built in</span>}
            {p.source === 'linked' && <span className="rounded-full bg-line/80 px-2 text-meta leading-5 text-ink-soft">Linked</span>}
            <ChevronRight size={14} className={`text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
          </span>
          {p.description && <span className="block text-ui text-ink-soft">{p.description}</span>}
          {p.error
            ? <span data-testid="plugin-error" className={`mt-1 block text-ui ${p.signIn ? 'text-ink-soft' : 'text-accent'}`}>{p.error}</span>
            : (
              <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {p.skills.map((s) => <code key={s.name} className="rounded-[6px] bg-line/70 px-1.5 text-meta leading-5 text-ink-soft">/{s.name}</code>)}
                {!mine && <span className="inline-flex items-center gap-1 text-meta text-muted"><trust.icon size={12} strokeWidth={1.75} />{trust.text}</span>}
              </span>
            )}
        </button>
        <Switch on={p.enabled} label={`${p.enabled ? 'Turn off' : 'Turn on'} ${p.name}`} testId="plugin-toggle" onChange={(on) => void hob.plugins.setEnabled(p.id, on)} />
      </div>
      {p.signIn && p.enabled && <div className="ml-12"><SignInButton p={p} /></div>}
      {open && (
        <div className="fade-in mt-3 ml-12 space-y-4">
          {p.skills.length > 0 && (
            <div>
              <p className="mb-1 text-meta font-medium text-muted">Skills</p>
              <ul className="space-y-1">
                {p.skills.map((s) => (
                  <li key={s.name} className="flex items-start gap-2 text-ui">
                    <code className="shrink-0 text-ink">/{s.name}</code>
                    <span className="min-w-0 flex-1 text-ink-soft">{s.description}</span>
                    {mine && <button aria-label={`Edit ${s.name}`} title="Edit" onClick={() => onEditSkill(s.name)} className="text-muted hover:text-ink"><Pencil size={14} /></button>}
                    {mine && <button aria-label={`Delete ${s.name}`} title="Delete" onClick={() => { if (confirm(`Delete the “${s.name}” skill?`)) void hob.plugins.removeSkill(s.name) }} className="text-muted hover:text-ink"><Trash2 size={14} /></button>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p.tools.length > 0 && (
            <div>
              <p className="mb-1 text-meta font-medium text-muted">Tools Hob can use</p>
              <p className="flex flex-wrap gap-1.5">{p.tools.map((t) => <code key={t} className="rounded-[6px] bg-line/70 px-1.5 text-meta leading-5 text-ink-soft">{t}</code>)}</p>
            </div>
          )}
          {p.starters.length > 0 && (
            <div>
              <p className="mb-1 text-meta font-medium text-muted">Try</p>
              <ul className="space-y-0.5 text-ui text-ink-soft">{p.starters.map((s) => <li key={s.title}>“{s.title}”</li>)}</ul>
            </div>
          )}
          {p.settings.length > 0 && <div className="max-w-sm space-y-3">{p.settings.map((s) => <SettingInput key={s.key} p={p} s={s} />)}</div>}
          <div className="flex flex-wrap items-center gap-1 -ml-2 text-meta text-muted">
            {(p.version !== '0.0.0' || p.author) && <span className="px-2">{[p.author, p.version !== '0.0.0' && `v${p.version}`].filter(Boolean).join(' · ')}</span>}
            <button className={button.quiet} onClick={() => void hob.plugins.show(p.id)}><FolderOpen size={14} />Show in Finder</button>
            {p.signedIn && !p.signIn && <button className={button.quiet} onClick={() => void hob.plugins.signOut(p.id)}><LogOut size={14} />Sign out</button>}
            {p.source !== 'builtin' && !mine && (
              <button data-testid="plugin-remove" className={button.quiet} onClick={() => { if (confirm(`Remove “${p.name}”?`)) void hob.plugins.remove(p.id) }}>
                <Trash2 size={14} />{p.source === 'linked' ? 'Unlink' : 'Remove'}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}


export function Plugins({ onClose, opened }: { onClose(): void; opened?: PluginResult | null }) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ kind: 'skill'; edit?: NewSkill } | { kind: 'connect' } | null>(null)
  const [menu, setMenu] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const reload = () => void hob.plugins.list().then(setPlugins)
  useEffect(() => { reload(); return hob.plugins.onChanged(reload) }, [])
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  const added = (r: PluginResult | null) => {
    if (!r) return
    if (r.ok) { setOpen(r.id); setNotice({ text: 'Added. It’s on and ready to use.' }) }
    else setNotice({ text: r.error, error: true })
  }
  // a bundle opened from Finder
  useEffect(() => { if (opened) added(opened) }, [opened])
  const drop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const paths = hob.pathsForFiles(Array.from(e.dataTransfer.files))
    for (const path of paths) added(await hob.plugins.addFile(path))
  }
  const editSkill = async (name: string) => { const s = await hob.plugins.getSkill(name); if (s) setDialog({ kind: 'skill', edit: s }) }
  const mine = plugins.find((p) => p.id === 'my-skills')
  const rest = plugins.filter((p) => p.id !== 'my-skills')

  return (
    <main data-testid="plugins" className={`flex-1 overflow-y-auto transition-colors ${dragging ? 'bg-line/40' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true) } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }}
      onDrop={(e) => void drop(e)}>
      <div className="drag h-12" />
      <div className="mx-auto max-w-2xl space-y-8 px-6 pb-12">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-title font-semibold tracking-tight">Plugins</h1>
            <p className="mt-1 text-body text-ink-soft">Teach Hob new skills and connect it to your apps.</p>
          </div>
          <div className="flex items-center gap-2">
            <div ref={menuRef} className="relative">
              <button data-testid="plugins-add" className={button.secondary} onClick={() => setMenu((m) => !m)} aria-expanded={menu}><Plus size={14} />Add</button>
              {menu && (
                <div className="fade-in absolute right-0 top-full z-30 mt-1 w-64 rounded-card border border-line bg-surface p-1 shadow-lg">
                  {[
                    { icon: FolderOpen, label: 'Add a plugin', hint: 'A folder, .zip or .mcpb bundle', test: 'add-plugin', run: () => void hob.plugins.add().then(added) },
                    { icon: Plug, label: 'Connect an app', hint: 'A link or any MCP server', test: 'connect-app', run: () => setDialog({ kind: 'connect' }) },
                    { icon: Link, label: 'Link a folder', hint: 'For developers: reloads as you edit', test: 'link-plugin', run: () => void hob.plugins.link().then(added) },
                  ].map((i) => (
                    <button key={i.label} data-testid={i.test} onClick={() => { setMenu(false); i.run() }} className="flex w-full items-start gap-2.5 rounded-control px-2.5 py-2 text-left hover:bg-line/60">
                      <i.icon size={16} strokeWidth={1.75} className="mt-0.5 text-ink-soft" />
                      <span><span className="block text-ui font-medium">{i.label}</span><span className="block text-meta text-muted">{i.hint}</span></span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button data-testid="new-skill" className={button.primary} onClick={() => setDialog({ kind: 'skill' })}><Sparkles size={14} />New skill</button>
            <button onClick={onClose} className={button.quiet}>Done</button>
          </div>
        </div>

        {notice && <p data-testid="plugins-notice" className={`fade-in text-ui ${notice.error ? 'text-accent' : 'text-ink-soft'}`}>{notice.text}</p>}

        <section>
          <h2 className="mb-2 text-ui font-medium text-ink-soft">Your skills</h2>
          {mine?.skills.length
            ? <ul className="rounded-card border border-line bg-surface"><PluginRow p={mine} open={open === mine.id} onToggleOpen={() => setOpen(open === mine.id ? null : mine.id)} onEditSkill={(n) => void editSkill(n)} /></ul>
            : (
              <button onClick={() => setDialog({ kind: 'skill' })} className="flex w-full items-center gap-3 rounded-card border border-dashed border-line-strong px-4 py-4 text-left transition-colors hover:bg-line/30">
                <span className="flex size-9 items-center justify-center rounded-control bg-line/70 text-ink-soft"><Sparkles size={18} strokeWidth={1.75} /></span>
                <span>
                  <span className="block text-body font-medium">Teach Hob something</span>
                  <span className="block text-ui text-ink-soft">Write down how you like a task done, then run it any time with /name. You can also just tell Hob “remember how to do this”.</span>
                </span>
              </button>
            )}
        </section>

        <section>
          <h2 className="mb-2 text-ui font-medium text-ink-soft">Plugins</h2>
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {rest.map((p) => <PluginRow key={p.id} p={p} open={open === p.id} onToggleOpen={() => setOpen(open === p.id ? null : p.id)} onEditSkill={(n) => void editSkill(n)} />)}
          </ul>
          <p className="mt-3 text-meta text-muted">
            Drop a plugin or .mcpb bundle here to add it. Make your own: a plugin is a folder with a hob-plugin.json, plus skills, Python tools or an MCP server.{' '}
            <a href={GUIDE} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">Read the guide</a>
          </p>
        </section>
      </div>
      {dialog?.kind === 'skill' && <SkillDialog initial={dialog.edit} onClose={() => setDialog(null)} onSaved={(n) => { setDialog(null); setOpen('my-skills'); setNotice({ text: `Saved. Type /${n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')} in a chat to use it.` }) }} />}
      {dialog?.kind === 'connect' && <ConnectDialog onClose={() => setDialog(null)} onDone={(n, id) => { setDialog(null); setNotice(n); if (id) setOpen(id) }} />}
    </main>
  )
}
