import { t } from '../../../shared/i18n'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usageProviders, type ProviderUsage, type UsageLimit } from '../../../shared/types'
import { limitsFor, store, useStore } from '../store'
import { ContextMenu, type MenuItem } from './Overlays'

// Plan limits at the bottom of the sidebar, one compact row per agent: "5h 34%  Week 21%  Fable 18%",
// each over a thin bar. Hover (or focus) them for a card with when each resets, how far into its window
// you are and how fresh the numbers are.

/** "5-hour" → "5h", "Weekly" → "Week", "Weekly · Fable" → "Fable". */
export function shortLabel(label: string): string {
  if (label === '5-hour') return '5h'
  if (label === 'Weekly') return t('Week')
  if (label.startsWith('Weekly · ')) return label.slice('Weekly · '.length)
  if (label === 'Monthly') return t('Month')
  return label.replace(/^(\d+)-hour$/, '$1h').replace(/^(\d+)-day$/, '$1d')
}

/** "Weekly · Fable" → "Haftalık · Fable" in Turkish. */
const longLabel = (label: string) => (label.startsWith('Weekly · ') ? t('Weekly') + label.slice('Weekly'.length) : t(label))

const level = (p: number) => (p >= 90 ? 'full' : p >= 70 ? 'warn' : '')

/** How far into its window a limit is, 0–1, when we know the window. */
export function elapsed(l: UsageLimit, now: number): number | undefined {
  if (!l.resetsAt || !l.windowMinutes) return undefined
  return Math.min(1, Math.max(0, 1 - (l.resetsAt - now) / (l.windowMinutes * 60000)))
}

/** "in 2h 14m", "in 3d 4h". */
export function countdown(at: number, now: number): string {
  const min = Math.max(1, Math.floor((at - now) / 60000))
  if (min < 60) return t('in {n}m', { n: min })
  if (min < 24 * 60) return t('in {h}h {m}m', { h: Math.floor(min / 60), m: min % 60 })
  return t('in {d}d {h}h', { d: Math.floor(min / 1440), h: Math.floor((min % 1440) / 60) })
}

/** "15:30" today, "Mon 15:30" this week, a date after that. */
function clock(at: number, now: number): string {
  const d = new Date(at)
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === new Date(now).toDateString()) return time
  if (at - now < 6 * 86_400_000) return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function ago(at: number, now: number): string {
  const m = Math.floor((now - at) / 60000)
  if (m < 1) return t('just now')
  if (m < 60) return t('{n}m ago', { n: m })
  if (m < 1440) return t('{n}h ago', { n: Math.round(m / 60) })
  return t('{n}d ago', { n: Math.round(m / 1440) })
}

/** Claude refreshes every few minutes, so its numbers are old only when a fetch has failed; Codex's come
 *  from its last run and are old once they're over an hour old. */
const isStale = (u: ProviderUsage, now: number) => !u.live && now - u.asOf > (u.id === 'claude' ? 300_000 : 3_600_000)

/** The time now, drawn again every `ms` so the elapsed-time marks and countdowns move on their own. */
function useNow(ms: number): number {
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), ms)
    return () => clearInterval(timer)
  }, [ms])
  return Date.now()
}

export function Usage() {
  const usage = useStore((s) => s.usage)
  const hidden = useStore((s) => s.settings.hiddenUsage)
  const [menu, setMenu] = useState<{ x: number; y: number }>()
  const [card, setCard] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const now = useNow(card ? 15_000 : 60_000)
  // One agent's limits, the selected session's (Claude when it runs none we have limits for).
  const agent = useStore((s) => limitsFor(s.ws.sessions.find((x) => x.id === s.ws.selectedSession), s.panes))
  const has = (id: string) => usage.find((p) => p.id === id && !hidden.includes(id) && p.limits.length)
  const one = has(agent) ?? has('claude')
  const shown = one ? [one] : []
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!shown.length) return null

  // Opens a moment after the pointer arrives; stays while it moves over to the card.
  const later = (open: boolean, ms: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCard(open), ms)
  }

  // Right-click: pick which agents' limits to show.
  const items: MenuItem[] = [
    ...usageProviders
      .filter((p) => !p.unavailable)
      .map((p) => {
        const on = !hidden.includes(p.id)
        const has = usage.some((u) => u.id === p.id)
        return {
          label: `${on ? '✓' : '   '} ${p.name}${has ? '' : ' ' + t('(no data)')}`,
          run: () => store().setSettings({ hiddenUsage: on ? [...hidden, p.id] : hidden.filter((x) => x !== p.id) }),
        }
      }),
    'divider',
    { label: t('Limit Settings…'), run: () => store().setUI({ settings: true }) },
  ]
  return (
    <div
      ref={box}
      className="sidebar-bottom limits"
      tabIndex={0}
      aria-label={t('Plan limits')}
      aria-describedby={card ? 'limits-card' : undefined}
      onMouseEnter={() => !menu && later(true, 250)}
      onMouseLeave={() => later(false, 200)}
      onFocus={() => setCard(true)}
      onBlur={() => setCard(false)}
      onKeyDown={(e) => e.key === 'Escape' && setCard(false)}
      onContextMenu={(e) => {
        e.preventDefault()
        clearTimeout(timer.current)
        setCard(false)
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      {shown.map((p) => (
        <Provider key={p.id} usage={p} named={p.id !== 'claude'} now={now} />
      ))}
      {card && box.current && <Card anchor={box.current} usage={shown} now={now} />}
      {menu && <ContextMenu {...menu} items={items} onClose={() => setMenu(undefined)} />}
    </div>
  )
}

function Provider({ usage, named, now }: { usage: ProviderUsage; named: boolean; now: number }) {
  const stale = isStale(usage, now)
  // The head is there or not by how many agents show, never by how fresh the numbers are: a head that
  // came and went with each failed refresh moved the meters up and down.
  return (
    <div className={`provider ${stale ? 'stale' : ''}`}>
      {named && (
        <div className="provider-head">
          <span className="name">{usage.name}</span>
          {usage.plan && <span className="plan">{usage.plan}</span>}
          {stale && <span className="asof">{ago(usage.asOf, now)}</span>}
        </div>
      )}
      <div className="limit-row">
        {usage.limits.slice(0, 4).map((l) => (
          <Limit key={l.label} limit={l} now={now} />
        ))}
      </div>
    </div>
  )
}

function Meter({ limit, now }: { limit: UsageLimit; now: number }) {
  const pace = elapsed(limit, now)
  return (
    <div className="bar">
      <i className={level(limit.percent)} style={{ width: `${Math.min(100, Math.max(limit.percent, limit.percent > 0 ? 3 : 0))}%` }} />
      {pace !== undefined && pace > 0.03 && pace < 0.97 && <s style={{ left: `${pace * 100}%` }} />}
    </div>
  )
}

function Limit({ limit, now }: { limit: UsageLimit; now: number }) {
  return (
    <div className="limit">
      <div className={`line ${level(limit.percent)}`}>
        <span>{shortLabel(limit.label)}</span> <b>{Math.round(limit.percent)}%</b>
      </div>
      <Meter limit={limit} now={now} />
    </div>
  )
}

/** The hover card: every limit with its reset time, how far into its window you are, and where the
 *  numbers come from and how old they are. Above the meters, inside the window. */
function Card({ anchor, usage, now }: { anchor: HTMLElement; usage: ProviderUsage[]; now: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; bottom: number }>()
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect()
    const width = ref.current?.offsetWidth ?? 330
    setPos({ left: Math.max(8, Math.min(r.left + 8, window.innerWidth - width - 8)), bottom: Math.max(8, window.innerHeight - r.top + 6) })
  }, [anchor])
  return (
    <div
      ref={ref}
      id="limits-card"
      role="tooltip"
      className="popover limits-card"
      style={pos ? { left: pos.left, bottom: pos.bottom } : { visibility: 'hidden' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {usage.map((u) => {
        const stale = isStale(u, now)
        const source = u.id === 'codex' ? t('From Codex’s latest session log') : u.live ? t('From your Claude account, refreshed every few minutes') : t('From your Claude account')
        return (
          <section key={u.id}>
            <div className="card-head">
              <b>{u.name}</b>
              {u.plan && <span className="plan">{u.plan}</span>}
              <span className={`age ${stale ? 'stale' : ''}`}>{t('Updated {when}', { when: ago(u.asOf, now) })}</span>
            </div>
            {u.limits.map((l) => {
              const pace = elapsed(l, now)
              const ahead = pace !== undefined && l.percent / 100 > pace + 0.05
              return (
                <div key={l.label} className="card-limit">
                  <div className="top">
                    <span>{longLabel(l.label)}</span>
                    <b className={level(l.percent)}>{t('{n}% used', { n: Math.round(l.percent) })}</b>
                  </div>
                  <Meter limit={l} now={now} />
                  <div className="bottom">
                    <span>{l.resetsAt ? t('Resets {when}', { when: `${clock(l.resetsAt, now)} · ${countdown(l.resetsAt, now)}` }) : t('No window running')}</span>
                    {pace !== undefined && (
                      <span className={ahead ? 'ahead' : ''} title={ahead ? t('Using it faster than it renews') : undefined}>
                        {t('{n}% of window gone', { n: Math.round(pace * 100) })}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
            {stale && (
              <p className="warn">
                {u.id === 'codex'
                  ? t("Codex's last report, from {when}. It updates when you use Codex.", { when: new Date(u.asOf).toLocaleString() })
                  : t("Couldn't refresh; these are from {when}.", { when: new Date(u.asOf).toLocaleString() })}
              </p>
            )}
            <p className="source">{source}</p>
          </section>
        )
      })}
      <p className="legend">{t('The tick on a bar is how much of its window has gone by. A bar past it is using the limit faster than it renews.')}</p>
    </div>
  )
}
