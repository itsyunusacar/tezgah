import { useState } from 'react'
import type { ProviderUsage, UsageLimit } from '../../../shared/types'
import { useStore } from '../store'
import { Chevron } from './Icons'

// Plan limits of the agents you use, at the bottom of the sidebar: one block per agent, each limit
// with how much is used, when it resets, and a tick for how far into its window you are.

const DAY = 86_400_000

/** "18m", "3h 20m", "Fri 09:00", "Nov 26". */
function untilReset(at: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((at - now) / 60000))
  if (min < 60) return `${min}m`
  if (min < 24 * 60) return `${Math.floor(min / 60)}h ${min % 60}m`
  const d = new Date(at)
  if (at - now < 6 * DAY) return d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 60) return `${Math.max(1, m)}m ago`
  if (m < 1440) return `${Math.round(m / 60)}h ago`
  return `${Math.round(m / 1440)}d ago`
}

const level = (p: number) => (p >= 90 ? 'full' : p >= 70 ? 'warn' : '')

/** How far into its window a limit is, 0–1, when we know the window. */
function elapsed(l: UsageLimit): number | undefined {
  if (!l.resetsAt || !l.windowMinutes) return undefined
  const span = l.windowMinutes * 60000
  return Math.min(1, Math.max(0, 1 - (l.resetsAt - Date.now()) / span))
}

function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem('tezgah.usage.collapsed') ?? '{}')
  } catch {
    return {}
  }
}

export function Usage() {
  const usage = useStore((s) => s.usage)
  const hidden = useStore((s) => s.settings.hiddenUsage)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const shown = usage.filter((p) => !hidden.includes(p.id))
  if (!shown.length) return null

  const toggle = (id: string) => {
    const next = { ...collapsed, [id]: !collapsed[id] }
    setCollapsed(next)
    try {
      localStorage.setItem('tezgah.usage.collapsed', JSON.stringify(next))
    } catch {
      // Not saved; fine.
    }
  }

  return (
    <div className="sidebar-bottom limits">
      {shown.map((p) => (
        <Provider key={p.id} usage={p} collapsed={!!collapsed[p.id]} onToggle={() => toggle(p.id)} />
      ))}
    </div>
  )
}

function Provider({ usage, collapsed, onToggle }: { usage: ProviderUsage; collapsed: boolean; onToggle: () => void }) {
  const top = usage.limits.reduce((a, b) => (b.percent > a.percent ? b : a), usage.limits[0])
  // Claude refreshes every few minutes; say how old the numbers are only when a fetch has failed.
  // Codex's come from its last run, so they're dated once they're over an hour old.
  const stale = !usage.live && Date.now() - usage.asOf > (usage.id === 'claude' ? 300_000 : 3_600_000)
  return (
    <div className={`provider ${collapsed ? 'collapsed' : ''}`}>
      <button className="provider-head" onClick={onToggle} title={collapsed ? 'Show all limits' : 'Show only the highest'}>
        <span className="name">{usage.name}</span>
        {usage.plan && <span className="plan">{usage.plan}</span>}
        <span className="grow" />
        {stale && (
          <span className="asof" title={
              usage.id === 'codex'
                ? `Codex's last report, from ${new Date(usage.asOf).toLocaleString()}. It updates when you use Codex.`
                : `Couldn't refresh; these are from ${new Date(usage.asOf).toLocaleString()}.`
            }>
            {ago(usage.asOf)}
          </span>
        )}
        {collapsed && <b className={`pct ${level(top.percent)}`}>{Math.round(top.percent)}%</b>}
        <span className={`chev ${collapsed ? 'closed' : ''}`}>
          <Chevron size={9} />
        </span>
      </button>
      {(collapsed ? [top] : usage.limits).map((l) => (
        <LimitRow key={l.label} limit={l} compact={collapsed} />
      ))}
    </div>
  )
}

function LimitRow({ limit, compact }: { limit: UsageLimit; compact: boolean }) {
  const pace = elapsed(limit)
  const pct = Math.round(limit.percent)
  const tip = [
    `${limit.label}: ${pct}% used`,
    limit.resetsAt ? `Resets ${new Date(limit.resetsAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : undefined,
    pace !== undefined ? `The tick marks ${Math.round(pace * 100)}% of the window gone by; past it, you're using it faster than it renews.` : undefined,
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <div className="limit-row" title={tip}>
      {!compact && (
        <div className="line">
          <span className="label">{limit.label}</span>
          {limit.resetsAt && <span className="reset">{untilReset(limit.resetsAt)}</span>}
          <b className={level(limit.percent)}>{pct}%</b>
        </div>
      )}
      <div className="bar">
        <i className={level(limit.percent)} style={{ width: `${Math.min(100, Math.max(limit.percent, limit.percent > 0 ? 2 : 0))}%` }} />
        {pace !== undefined && pace > 0.02 && pace < 0.98 && <s style={{ left: `${pace * 100}%` }} />}
      </div>
    </div>
  )
}
