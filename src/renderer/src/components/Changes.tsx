import { plural, t } from '../../../shared/i18n'
import { useEffect, useMemo, useState } from 'react'
import type { Diff, Session } from '../../../shared/types'
import * as A from '../actions'
import { useStore } from '../store'
import { Close, Note, Refresh } from './Icons'

interface Line {
  kind: 'add' | 'del' | 'ctx' | 'hunk'
  text: string
  /** Line number in the new file (old file for deletions). */
  no?: number
}

function parsePatch(patch: string): Line[] {
  const out: Line[] = []
  let oldNo = 0
  let newNo = 0
  let inHunk = false
  for (const raw of patch.split('\n')) {
    const h = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/)
    if (h) {
      oldNo = Number(h[1])
      newNo = Number(h[2])
      inHunk = true
      out.push({ kind: 'hunk', text: raw })
      continue
    }
    if (!inHunk) continue
    if (raw.startsWith('+')) out.push({ kind: 'add', text: raw.slice(1), no: newNo++ })
    else if (raw.startsWith('-')) out.push({ kind: 'del', text: raw.slice(1), no: oldNo++ })
    else if (raw.startsWith(' ')) {
      out.push({ kind: 'ctx', text: raw.slice(1), no: newNo++ })
      oldNo++
    }
  }
  return out
}

interface Notes {
  [key: string]: { file: string; line: number; code: string; text: string }
}

/** The session's diff with line notes you can send to Claude in one message. */
export function ChangesPanel({ session, diff, onRefresh }: { session: Session; diff: Diff | null; onRefresh: () => void }) {
  const setUI = useStore((s) => s.setUI)
  const [file, setFile] = useState<string>()
  const [notes, setNotes] = useState<Notes>({})
  const [editing, setEditing] = useState<string>()

  useEffect(() => setNotes({}), [session.id])
  useEffect(() => {
    if (diff && (!file || !diff.patches[file])) setFile(diff.files[0]?.path)
  }, [diff, file])

  const lines = useMemo(() => (file && diff?.patches[file] ? parsePatch(diff.patches[file]) : []), [diff, file])
  const noteCount = Object.values(notes).filter((n) => n.text.trim()).length

  const send = () => {
    const items = Object.values(notes).filter((n) => n.text.trim())
    if (!items.length) return
    const text = [
      'Review notes on the current changes:',
      ...items.map((n) => `- ${n.file}:${n.line} (\`${n.code.trim().slice(0, 80)}\`): ${n.text.trim()}`),
    ].join('\n')
    A.sendToClaude(session.id, text)
    setNotes({})
  }

  const split = (p: string) => {
    const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
    return i < 0 ? ['', p] : [p.slice(0, i), p.slice(i + 1)]
  }

  return (
    <div className="changes">
      <div className="changes-head">
        <span className="t">
          Changes<span className="vs">{diff ? (session.worktree ? `vs ${session.worktree.base}` : 'uncommitted') : ''}</span>
        </span>
        <button className="icon-btn" title={t('Refresh')} onClick={onRefresh}><Refresh /></button>
        <button className="icon-btn" title={t('Close')} onClick={() => setUI({ changes: false })}><Close /></button>
      </div>

      {!diff ? (
        <div className="muted">{t('Not a git repository.')}</div>
      ) : !diff.files.length ? (
        <div className="muted">{t('No changes yet.')}</div>
      ) : (
        <>
          <div className="file-list">
            {diff.files.map((f) => {
              const [dir, name] = split(f.path)
              const has = Object.values(notes).some((n) => n.file === f.path && n.text.trim())
              return (
                <div key={f.path} className={`file ${file === f.path ? 'selected' : ''}`} onClick={() => setFile(f.path)}>
                  <span className={`st ${f.status}`}>{f.status}</span>
                  <span className="n">
                    {name} <span className="dir">{dir}</span>
                  </span>
                  {has && <Note size={12} />}
                  <span className="counts">
                    {f.added > 0 && <span className="add">+{f.added}</span>}
                    {f.removed > 0 && <span className="del">−{f.removed}</span>}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="diff">
            {lines.map((l, i) => {
              const key = `${file}:${l.kind}:${l.no}`
              const note = notes[key]
              return (
                <div key={i}>
                  <div
                    className={`ln ${l.kind}`}
                    title={l.kind === 'hunk' ? undefined : t('Click to leave a note')}
                    onClick={() => {
                      if (l.kind === 'hunk' || !file || l.no === undefined) return
                      setNotes((n) => (n[key] ? n : { ...n, [key]: { file, line: l.no!, code: l.text, text: '' } }))
                      setEditing(key)
                    }}
                  >
                    <span className="no">{l.kind === 'hunk' ? '' : l.no}</span>
                    <span>{l.kind === 'add' ? '+ ' : l.kind === 'del' ? '− ' : l.kind === 'ctx' ? '  ' : ''}{l.text}</span>
                  </div>
                  {note && (
                    <div className="note">
                      <Note />
                      <textarea
                        autoFocus={editing === key}
                        value={note.text}
                        placeholder={t('Note for Claude…')}
                        onChange={(e) => setNotes((n) => ({ ...n, [key]: { ...note, text: e.target.value } }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
                        }}
                      />
                      <button className="icon-btn small" title={t('Remove note')} onClick={() => setNotes((n) => {
                        const next = { ...n }
                        delete next[key]
                        return next
                      })}>
                        <Close size={10} />
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      <GitBar session={session} diff={diff} onChange={onRefresh} />
      <div className="changes-foot">
        <span className="grow">{noteCount ? plural(noteCount, '{n} note', '{n} notes') : diff?.files.length ? t('Click a line to leave a note') : ''}</span>
        {noteCount > 0 && <button className="pill primary" onClick={send}>{t('Send to Claude')}</button>}
        {session.worktree && diff && diff.files.length > 0 && (
          <button className="pill" onClick={() => A.mergeWorktree(session.id)}>{t('Merge into {base}', { base: session.worktree.base })}</button>
        )}
      </div>
    </div>
  )
}

type RepoStatus = Awaited<ReturnType<typeof window.tz.gitStatus>>

/** Commit what's here, push it, open a pull request: the steps after reviewing. */
function GitBar({ session, diff, onChange }: { session: Session; diff: Diff | null; onChange: () => void }) {
  const cwd = session.worktree?.path ?? A.project(session.projectId)?.path ?? ''
  const pr = useStore((s) => s.meta[session.id]?.pr)
  const [status, setStatus] = useState<RepoStatus>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<string>()

  useEffect(() => {
    if (cwd) window.tz.gitStatus(cwd).then(setStatus)
  }, [cwd, diff])

  if (!status) return null
  const run = async (what: string, job: () => Promise<unknown>, done: (r: never) => string) => {
    setBusy(what)
    try {
      const r = await job()
      A.toast(done(r as never))
      onChange()
      setStatus(await window.tz.gitStatus(cwd))
    } catch (e) {
      A.toast(A.errorText(e))
    } finally {
      setBusy(undefined)
    }
  }
  const commit = () =>
    run('commit', () => window.tz.gitCommit(cwd, message), (hash: string) => {
      setMessage('')
      return t('Committed {hash} on {branch}.', { hash, branch: status.branch })
    })
  const canPush = status.remote && (status.ahead === null || status.ahead > 0)
  const canPr = status.remote && !pr && status.ahead === 0 && !!status.branch && status.branch !== status.defaultBranch && status.branch !== 'HEAD'

  return (
    <div className="git-bar">
      {status.dirty && (
        <div className="commit-row">
          <input
            className="field"
            value={message}
            placeholder={t('Commit message')}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && message.trim() && !busy && commit()}
          />
          <button className="pill primary" disabled={!message.trim() || !!busy} onClick={commit}>
            {busy === 'commit' ? t('Committing…') : t('Commit All')}
          </button>
        </div>
      )}
      <div className="sync-row">
        <span className="where">
          {status.branch}
          {status.ahead ? ` · ${t('{n} to push', { n: status.ahead })}` : status.ahead === null && status.remote ? ` · ${t('not pushed yet')}` : ''}
        </span>
        {canPush && (
          <button className="pill small" disabled={!!busy} onClick={() => run('push', () => window.tz.gitPush(cwd), () => t('Pushed {branch}.', { branch: status.branch }))}>
            {busy === 'push' ? t('Pushing…') : t('Push')}
          </button>
        )}
        {canPr && (
          <button
            className="pill small"
            disabled={!!busy}
            onClick={() =>
              run('pr', () => window.tz.gitCreatePr(cwd), (url: string) => {
                if (url.startsWith('http')) window.tz.openExternal(url)
                return t('Pull request opened.')
              })
            }
          >
            {busy === 'pr' ? t('Opening…') : t('Open Pull Request')}
          </button>
        )}
        {pr && (
          <button className="pill small" onClick={() => window.tz.openExternal(pr.url)}>
            {t('Pull request #{n}', { n: pr.number })}
          </button>
        )}
      </div>
    </div>
  )
}
