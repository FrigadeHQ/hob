import { useEffect } from 'react'
import {
  BookOpen, Briefcase, Calculator, Calendar, Camera, ChartColumn, ChefHat, Clock, CloudSun, Code, Coins, Dumbbell, FileText, Gamepad2, Globe,
  GraduationCap, Heart, Languages, Leaf, Lightbulb, ListChecks, Mail, Map, MessageCircle, Music, Newspaper, NotebookPen, Palette, PenLine, Plane, Plug,
  Puzzle, ShoppingCart, Sparkles, Star, Sun, Wrench, X, Zap, type LucideIcon,
} from 'lucide-react'

/** Square icon-only button with an accessible label and a native tooltip. */
export function IconButton({ icon: Icon, label, onClick, active, disabled, testId, size = 16, small }: {
  icon: LucideIcon; label: string; onClick?: () => void; active?: boolean; disabled?: boolean; testId?: string; size?: number; small?: boolean
}) {
  return (
    <button
      type="button" data-testid={testId} aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className={`no-drag inline-flex ${small ? 'size-7' : 'size-8'} items-center justify-center rounded-control transition-colors disabled:opacity-40 ${active ? 'bg-line text-ink' : 'text-ink-soft hover:bg-line/70 hover:text-ink'}`}
    >
      <Icon size={size} strokeWidth={1.75} />
    </button>
  )
}

export const button = {
  primary: 'inline-flex items-center gap-1.5 rounded-control bg-ink px-3 py-1.5 text-ui font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-40',
  secondary: 'inline-flex items-center gap-1.5 rounded-control border border-line-strong bg-surface px-3 py-1.5 text-ui font-medium text-ink transition-colors hover:bg-line/50 disabled:opacity-40',
  quiet: 'inline-flex items-center gap-1.5 rounded-control px-2 py-1.5 text-ui text-ink-soft transition-colors hover:bg-line/60 hover:text-ink',
  danger: 'inline-flex items-center gap-1.5 rounded-control bg-danger/10 px-3 py-1.5 text-ui font-medium text-danger transition-colors hover:bg-danger/15',
}

export function Switch({ on, onChange, label, testId }: { on: boolean; onChange(on: boolean): void; label: string; testId?: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label} data-testid={testId} onClick={(e) => { e.stopPropagation(); onChange(!on) }}
      className={`h-6 w-10 shrink-0 rounded-full p-0.5 transition-colors ${on ? 'bg-ink' : 'bg-line-strong'}`}
    >
      <span className={`block size-5 rounded-full bg-paper shadow-sm transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  )
}

/** Icons plugins may name in hob-plugin.json ("icon": "map"); anything else shows a puzzle piece. */
export const PLUGIN_ICONS: Record<string, LucideIcon> = {
  puzzle: Puzzle, globe: Globe, 'cloud-sun': CloudSun, 'chart-column': ChartColumn, map: Map, 'graduation-cap': GraduationCap, coins: Coins,
  sparkles: Sparkles, plug: Plug, 'book-open': BookOpen, calendar: Calendar, music: Music, camera: Camera, code: Code, mail: Mail,
  'notebook-pen': NotebookPen, 'chef-hat': ChefHat, dumbbell: Dumbbell, heart: Heart, briefcase: Briefcase, palette: Palette, wrench: Wrench,
  'file-text': FileText, calculator: Calculator, 'shopping-cart': ShoppingCart, sun: Sun, leaf: Leaf, 'gamepad-2': Gamepad2, plane: Plane,
  newspaper: Newspaper, languages: Languages, 'pen-line': PenLine, 'list-checks': ListChecks, lightbulb: Lightbulb, 'message-circle': MessageCircle,
  clock: Clock, star: Star, zap: Zap,
}
export function PluginIcon({ name, size = 16, className = '' }: { name: string; size?: number; className?: string }) {
  const Icon = PLUGIN_ICONS[name] ?? Puzzle
  return <Icon size={size} strokeWidth={1.75} className={className} />
}

/** Centered dialog; Escape or a click outside closes it. */
export function Dialog({ title, onClose, children, testId }: { title: string; onClose(): void; children: React.ReactNode; testId?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fade-in fixed inset-0 z-40 flex items-center justify-center bg-black/25 p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div data-testid={testId} role="dialog" aria-label={title} className="w-full max-w-lg rounded-[16px] border border-line bg-surface p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-body font-semibold">{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  )
}

export const field = 'w-full rounded-control border border-line-strong bg-paper px-3 py-2 text-ui outline-none transition-colors placeholder:text-muted focus:border-muted'
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-ui font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-meta text-muted">{hint}</span>}
    </label>
  )
}
