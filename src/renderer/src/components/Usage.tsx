import { t } from '../../../shared/i18n'
import { useState } from 'react'
import { usageProviders, type ProviderUsage, type UsageLimit } from '../../../shared/types'
import { store, useStore } from '../store'
import { ContextMenu, type MenuItem } from './Overlays'

// Plan limits at the bottom of the sidebar, one compact row per agent: "5h 34%  Week 21%  Fable 18%",
// each over a thin bar. Hover a limit for when it resets and how far into its window you are.

/** "5-hour" → "5h", "Weekly" → "Week", "Weekly · Fable" → "Fable". */
export function shortLabel(label: string): string {
  if (label === '5-hour') return '5h'
  if (label === 'Weekly') return 'Week'
  if (label.startsWith('Weekly · ')) return label.slice('Weekly · '.length)
  if (label === 'Monthly') return 'Month'
  return label.replace(/^(\d+)-hour$/, '$1h').replace(/^(\d+)-day$/, '$1d')
}

const level = (p: number) => (p >= 90 ? 'full' : p >= 70 ? 'warn' : '')

/** How far into its window a limit is, 0–1, when we know the window. */
function elapsed(l: UsageLimit): number | undefined {
  if (!l.resetsAt || !l.windowMinutes) return undefined
  return Math.min(1, Math.max(0, 1 - (l.resetsAt - Date.now()) / (l.windowMinutes * 60000)))
}

function untilReset(at: number): string {
  const min = Math.max(0, Math.round((at - Date.now()) / 60000))
  if (min < 60) return `in ${min}m`
  if (min < 24 * 60) return `in ${Math.floor(min / 60)}h ${min % 60}m`
  return new Date(at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function ago(at: number): string {
  const m = Math.round((Date.now() - at) / 60000)
  if (m < 60) return t('{n}m ago', { n: Math.max(1, m) })
  if (m < 1440) return t('{n}h ago', { n: Math.round(m / 60) })
  return t('{n}d ago', { n: Math.round(m / 1440) })
}

export function Usage() {
  const usage = useStore((s) => s.usage)
  const hidden = useStore((s) => s.settings.hiddenUsage)
  const [menu, setMenu] = useState<{ x: number; y: number }>()
  const shown = usage.filter((p) => !hidden.includes(p.id) && p.limits.length)
  if (!shown.length) return null

  // Right-click: pick which agents' limits to show.
  const items: MenuItem[] = [
    ...usageProviders
      .filter((p) => !p.unavailable)
      .map((p) => {
        const on = !hidden.includes(p.id)
        const has = usage.some((u) => u.id === p.id)
        return {
          label: `${on ? '✓' : '   '} ${p.name}${has ? '' : ' (no data)'}`,
          run: () => store().setSettings({ hiddenUsage: on ? [...hidden, p.id] : hidden.filter((x) => x !== p.id) }),
        }
      }),
    'divider',
    { label: t('Limit Settings…'), run: () => store().setUI({ settings: true }) },
  ]
  return (
    <div
      className="sidebar-bottom limits"
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      {shown.map((p) => (
        <Provider key={p.id} usage={p} named={shown.length > 1 || p.id !== 'claude'} />
      ))}
      {menu && <ContextMenu {...menu} items={items} onClose={() => setMenu(undefined)} />}
    </div>
  )
}

function Provider({ usage, named }: { usage: ProviderUsage; named: boolean }) {
  // Claude refreshes every few minutes, so its numbers are dated only when a fetch has failed;
  // Codex's come from its last run and are dated once they're over an hour old.
  const stale = !usage.live && Date.now() - usage.asOf > (usage.id === 'claude' ? 300_000 : 3_600_000)
  const staleTip =
    usage.id === 'codex'
      ? t("Codex's last report, from {when}. It updates when you use Codex.", { when: new Date(usage.asOf).toLocaleString() })
      : t("Couldn't refresh; these are from {when}.", { when: new Date(usage.asOf).toLocaleString() })
  return (
    <div className="provider">
      {(named || stale) && (
        <div className="provider-head">
          <span className="name">{usage.name}</span>
          {usage.plan && <span className="plan">{usage.plan}</span>}
          {stale && <span className="asof" title={staleTip}>{ago(usage.asOf)}</span>}
        </div>
      )}
      <div className="limit-row">
        {usage.limits.slice(0, 4).map((l) => (
          <Limit key={l.label} limit={l} provider={usage.name} />
        ))}
      </div>
    </div>
  )
}

function Limit({ limit, provider }: { limit: UsageLimit; provider: string }) {
  const pace = elapsed(limit)
  const pct = Math.round(limit.percent)
  const tip = [
    `${provider} · ${limit.label}: ${pct}% used`,
    limit.resetsAt ? t('Resets {when}', { when: untilReset(limit.resetsAt) }) : undefined,
    pace !== undefined ? `The tick: ${Math.round(pace * 100)}% of the window has gone by. Past it, you're using it faster than it renews.` : undefined,
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <div className="limit" title={tip}>
      <div className={`line ${level(limit.percent)}`}>
        <span>{shortLabel(limit.label)}</span> <b>{pct}%</b>
      </div>
      <div className="bar">
        <i className={level(limit.percent)} style={{ width: `${Math.min(100, Math.max(limit.percent, limit.percent > 0 ? 3 : 0))}%` }} />
        {pace !== undefined && pace > 0.03 && pace < 0.97 && <s style={{ left: `${pace * 100}%` }} />}
      </div>
    </div>
  )
}
