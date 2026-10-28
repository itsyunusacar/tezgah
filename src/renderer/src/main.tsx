import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App'
import { useStore } from './store'
import { defaultSettings } from '../../shared/types'

window.tz.load().then(({ workspace, settings, version }) => {
  useStore.setState({
    ws: { projects: workspace.projects ?? [], sessions: workspace.sessions ?? [], selectedSession: workspace.selectedSession },
    settings: { ...defaultSettings, ...settings },
    version,
    ready: true,
  })
  // First run: the tour, before anything else.
  if (!settings?.introSeen) useStore.getState().setUI({ intro: true })
})

createRoot(document.getElementById('root')!).render(<App />)

// Handles for automated UI checks (driven over the DevTools protocol).
import * as actions from './actions'
import * as terminals from './terminals'
;(window as unknown as { __tezgah: unknown }).__tezgah = { actions, terminals, store: useStore }
