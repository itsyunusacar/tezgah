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
