import type { AgentState, StatusRecord } from '../../shared/types'

// OSC 7501: programs such as Claude Code report what they are doing.
//   ESC ] 7501 ; state=working:id=agent-1:app=claude:title=<b64>:msg=<b64> BEL
// `?` asks whether the terminal understands it; we answer so Claude Code starts reporting.
// `state=clear` removes a record (an empty id clears all of them).

const STATES: AgentState[] = ['idle', 'working', 'done', 'blocked', 'error']
const KINDS = ['permission', 'question', 'auth'] as const

export type OscReport = { clear: true; id: string } | { clear: false; record: StatusRecord }

function decode(b64: string, limit: number): string | undefined {
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    // Plain text only: drop control characters and bidi overrides.
    return text.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ').slice(0, limit)
  } catch {
    return undefined
  }
}

const validId = (id: string) => id.length <= 128 && id.split('/').length <= 8 && id.split('/').every((s) => /^[A-Za-z0-9_.+-]{1,32}$/.test(s))

export function parseOsc7501(data: string): OscReport | undefined {
  if (data.length > 4087) return undefined
  const fields: Record<string, string> = {}
  for (const pair of data.split(':')) {
    const eq = pair.indexOf('=')
    if (eq < 0) continue
    const key = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (!/^[a-z]{1,16}$/.test(key)) continue
    if (key === 'id' && !validId(value)) return undefined
    fields[key] = value
  }
  const id = fields.id ?? ''
  if (fields.state === 'clear') return { clear: true, id }
  const state = STATES.find((s) => s === fields.state)
  if (!state) return undefined
  const kind = state === 'blocked' ? KINDS.find((k) => k === fields.kind) : undefined
  return {
    clear: false,
    record: {
      id,
      state,
      kind,
      app: fields.app && /^[A-Za-z0-9_.+-]{1,32}$/.test(fields.app) ? fields.app : undefined,
      title: fields.title ? decode(fields.title, 192) : undefined,
      message: fields.msg ? decode(fields.msg, 2048) : undefined,
    },
  }
}

/** Applies a report to a pane's records. Clearing an id also clears its descendants. */
export function applyReport(records: StatusRecord[], report: OscReport): StatusRecord[] {
  if (report.clear) {
    const id = report.id
    return id ? records.filter((r) => r.id !== id && !r.id.startsWith(id + '/')) : []
  }
  return [...records.filter((r) => r.id !== report.record.id), report.record].slice(-256)
}
