import { useStore } from '../store'

function resetIn(at?: number): string {
  if (!at) return ''
  const min = Math.max(0, Math.round((at - Date.now()) / 60000))
  if (min < 60) return `resets in ${min}m`
  if (min < 48 * 60) return `resets in ${Math.floor(min / 60)}h ${min % 60}m`
  return `resets in ${Math.round(min / 1440)}d`
}

/** Claude plan limits (5-hour, weekly) under the sidebar. Hidden when not signed in. */
export function Usage() {
  const usage = useStore((s) => s.usage)
  if (!usage?.length) return null
  return (
    <div className="sidebar-bottom">
      <div className="usage">
        {usage.slice(0, 3).map((l) => (
          <div className="limit" key={l.label} title={resetIn(l.resetsAt)}>
            <div className="label">
              <span>{l.label}</span>
              <b>{Math.round(l.percent)}%</b>
            </div>
            <div className="bar">
              <i className={l.percent >= 90 ? 'full' : l.percent >= 70 ? 'warn' : ''} style={{ width: `${Math.min(100, l.percent)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
