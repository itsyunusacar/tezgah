import { useEffect, useState } from 'react'
import { t } from '../../../shared/i18n'
import { store, useStore } from '../store'
import { Mark } from './Icons'

// The first-run tour: a few short scenes, each a small animated piece of Tezgah itself (CSS, so the
// words in it are translated and it follows the theme). Skippable at any point; Settings replays it.

interface Scene {
  title: string
  text: string
  stage: () => React.ReactNode
}

const scenes: Scene[] = [
  {
    title: 'Welcome to Tezgah',
    text: 'A terminal for working with AI coding agents. Your projects on the left, every agent in them, and what each one is doing.',
    stage: Welcome,
  },
  {
    title: 'Every agent at a glance',
    text: 'Claude, Codex, Grok and others report what they are doing. Working, needs you, done: you see it without opening each one.',
    stage: Sessions,
  },
  {
    title: 'Answer without switching',
    text: 'When an agent asks for permission, allow or deny it right from the sidebar. A notification finds you when you are elsewhere.',
    stage: Answer,
  },
  {
    title: 'A browser your agents can use',
    text: 'Open your app beside the terminal. Agents read the page, click, fill forms and take screenshots to check their own work.',
    stage: Browser,
  },
  {
    title: 'Review, commit, ship',
    text: 'See every change, leave notes for Claude on any line, then commit, push and open a pull request from the same panel.',
    stage: Ship,
  },
]

export function Intro() {
  const open = useStore((s) => s.ui.intro)
  const [i, setI] = useState(0)
  const done = () => {
    store().setSettings({ introSeen: true })
    store().setUI({ intro: false })
    setI(0)
  }
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done()
      if (e.key === 'ArrowRight' || e.key === 'Enter') setI((n) => (n < scenes.length - 1 ? n + 1 : (done(), n)))
      if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1))
      e.stopPropagation()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  })
  if (!open) return null
  const scene = scenes[i]
  const last = i === scenes.length - 1
  const Stage = scene.stage
  return (
    <div className="intro-scrim">
      <div className="intro">
        <div className="stage" key={i}>
          <Stage />
        </div>
        <div className="copy">
          <div className="steps">
            {scenes.map((_, n) => (
              <button key={n} className={n === i ? 'on' : ''} onClick={() => setI(n)} aria-label={String(n + 1)} />
            ))}
          </div>
          <h1>{t(scene.title)}</h1>
          <p>{t(scene.text)}</p>
          <div className="buttons">
            <button className="pill ghost" onClick={done}>{t('Skip')}</button>
            <span className="grow" />
            {i > 0 && <button className="pill" onClick={() => setI(i - 1)}>{t('Back')}</button>}
            <button className="pill primary" autoFocus onClick={() => (last ? done() : setI(i + 1))}>
              {last ? t('Get Started') : t('Next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Scenes. Class names are animated in styles.css (.intro …).

function Welcome() {
  return (
    <div className="scene welcome">
      <div className="mark"><Mark size={84} /></div>
      <div className="word">tezgah</div>
      <div className="chips">
        <span>Claude</span>
        <span>Codex</span>
        <span>Grok</span>
        <span>Gemini</span>
      </div>
    </div>
  )
}

function MiniRow({ title, lines, dot }: { title: string; lines: string[]; dot: string }) {
  return (
    <div className="mini-row">
      <span className={`dot cycle ${dot}`} />
      <div>
        <b>{title}</b>
        <div className="lines">
          {lines.map((l, n) => (
            <span key={n} style={{ animationDelay: `${n * -2}s` }}>{l}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

function Sessions() {
  return (
    <div className="scene sessions">
      <div className="mini-sidebar">
        <div className="mini-project">tezgah</div>
        <MiniRow title={t('Fix the login bug')} dot="a" lines={[t('Working · Edit auth.ts'), t('Needs you · Bash npm test'), t('Done')]} />
        <MiniRow title={t('Dark mode')} dot="b" lines={[t('Done'), t('Working · 2 agents'), t('Working · Read theme.css')]} />
        <MiniRow title="Codex" dot="c" lines={[t('Needs you · apply_patch'), t('Done'), t('Working…')]} />
        <div className="mini-project">api</div>
        <MiniRow title="Grok" dot="d" lines={[t('Working…'), t('Working…'), t('Done')]} />
      </div>
    </div>
  )
}

function Answer() {
  return (
    <div className="scene answer">
      <div className="mini-sidebar">
        <div className="mini-row ask">
          <span className="dot blocked" />
          <div>
            <b>{t('Fix the login bug')}</b>
            <div className="sub">{t('Needs you · Bash npm test')}</div>
            <div className="pills">
              <span className="pill small primary allow">{t('Allow')}</span>
              <span className="pill small">{t('Deny')}</span>
            </div>
          </div>
        </div>
        <div className="mini-row after">
          <span className="dot working" />
          <div>
            <b>{t('Fix the login bug')}</b>
            <div className="sub">{t('Working · Bash npm test')}</div>
          </div>
        </div>
      </div>
      <div className="cursor" />
      <div className="toast-note">
        <b>{t('Dark mode')}</b>
        <span>{t('Finished')}</span>
      </div>
    </div>
  )
}

function Browser() {
  return (
    <div className="scene browser">
      <div className="mini-term">
        <span className="c1">$ tezgah browser open localhost:5173</span>
        <span className="c2">$ tezgah browser fill text=Email ada@example.com</span>
        <span className="c3">$ tezgah browser click "text=Sign in"</span>
        <span className="c4">✓ {t('Signed in as ada@example.com')}</span>
      </div>
      <div className="mini-browser">
        <div className="bar"><i /><i /><i /><span>localhost:5173</span></div>
        <div className="page">
          <b>{t('Sign in')}</b>
          <div className="input-mock"><span className="typed">ada@example.com</span></div>
          <div className="btn">{t('Sign in')}</div>
          <div className="ok">✓ {t('Signed in as ada@example.com')}</div>
        </div>
      </div>
    </div>
  )
}

function Ship() {
  return (
    <div className="scene ship">
      <div className="mini-diff">
        <div className="file">src/auth.ts <span className="add">+12</span> <span className="del">−3</span></div>
        <div className="ln del">- if (token) return user</div>
        <div className="ln add">+ if (!token || expired(token)) return null</div>
        <div className="ln add">+ return refresh(user)</div>
        <div className="note">{t('Also handle the offline case')}</div>
        <div className="foot">
          <span className="msg">{t('Fix expired sessions')}</span>
          <span className="pill small primary commit">{t('Commit All')}</span>
          <span className="pill small pr">{t('Pull request #{n}', { n: 42 })}</span>
        </div>
      </div>
    </div>
  )
}
