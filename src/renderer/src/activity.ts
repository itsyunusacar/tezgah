import type { AgentState } from '../../shared/types'
import * as A from './actions'
import { applyReport } from './osc'
import { store } from './store'
import * as terms from './terminals'

// Status for agents that don't report their own (Grok, Gemini, Codex, Aider…), read from what they do:
// output streaming while they work (their spinners too), a question on screen when they need you,
// quiet when they're done. Claude Code reports its state itself (OSC 7501) and isn't watched here.

interface Watch {
  agent: string
  lastOutput: number
  lastInput: number
  workingSince?: number
  state?: AgentState
}

const watched = new Map<string, Watch>()
/** Panes whose agent reports through hooks (Codex in Tezgah's wrapper); their output isn't read. */
const hooked = new Set<string>()

/** An agent hook reported for this pane: trust it over reading output. */
export function markHooked(paneId: string): void {
  hooked.add(paneId)
}

/** Prompts agents show when they need a yes or no. */
export const QUESTION = /\(y\/n\)|\[y\/n\]|\by\/n\b|\byes\b.*\bno\b|allow (once|always|this)|approve|permission|do you want to|proceed\?|confirm|waiting for (your )?(approval|input)/i

/** Needs you if a question sits at the bottom of the screen (its last few lines with text), else done.
 *  Older questions further up, already answered, don't count. */
export function decide(screen: string): AgentState {
  const tail = screen.split('\n').filter((l) => l.trim()).slice(-3).join('\n')
  return QUESTION.test(tail) ? 'blocked' : 'done'
}

const NAMES: Record<string, string> = { claude: 'Claude', grok: 'Grok', gemini: 'Gemini', codex: 'Codex', aider: 'Aider', opencode: 'OpenCode', amp: 'Amp', goose: 'Goose', 'cursor-agent': 'Cursor', 'kiro-cli': 'Kiro', qwen: 'Qwen', agy: 'Antigravity' }
export const agentName = (id: string) => NAMES[id] ?? id[0].toUpperCase() + id.slice(1)

function set(paneId: string, w: Watch, state: AgentState): void {
  if (w.state === state) return
  w.state = state
  store().setPane(paneId, (p) => ({
    records: applyReport(p.records, { clear: false, record: { id: '', state, app: w.agent, kind: state === 'blocked' ? 'question' : undefined } }),
  }))
}

function tick(): void {
  const now = Date.now()
  for (const [paneId, w] of watched) {
    if (hooked.has(paneId)) continue
    // Output soon after a keystroke is the agent echoing what you type, not work.
    const busy = now - w.lastOutput < 1200 && w.lastOutput - w.lastInput > 500
    if (busy) {
      w.workingSince ??= now
      if (now - w.workingSince >= 1200) set(paneId, w, 'working')
    } else {
      w.workingSince = undefined
      if (w.state === 'working' && now - w.lastOutput > 2500) set(paneId, w, decide(terms.screenText(paneId, 20)))
    }
  }
}

export function start(): () => void {
  const offAgent = window.tz.onPtyAgent((paneId, agent) => {
    if (!agent) {
      watched.delete(paneId)
      hooked.delete(paneId)
      store().setPane(paneId, (p) => ({ records: p.records.filter((r) => r.id !== '' || r.app === 'claude') }))
      return
    }
    watched.set(paneId, { agent, lastOutput: 0, lastInput: 0, state: undefined })
    const w = watched.get(paneId)!
    if (!hooked.has(paneId)) set(paneId, w, 'idle')
    // A shell session running an agent is named after it, unless you renamed it.
    const s = A.sessionOfPane(paneId)
    if (s && !s.customTitle && A.isDefaultTitle(s.title)) A.adoptTitle(s.id, agentName(agent))
  })
  const offData = window.tz.onPtyData((paneId) => {
    const w = watched.get(paneId)
    if (w) w.lastOutput = Date.now()
  })
  const offInput = terms.onInput((paneId) => {
    const w = watched.get(paneId)
    if (!w || hooked.has(paneId)) return
    w.lastInput = Date.now()
    // Answering a question or starting the next task.
    if (w.state === 'done' || w.state === 'blocked') set(paneId, w, 'idle')
  })
  const t = setInterval(tick, 500)
  return () => {
    offAgent()
    offData()
    offInput()
    clearInterval(t)
  }
}
