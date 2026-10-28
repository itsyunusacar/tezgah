import { describe, expect, it } from 'vitest'
import { agentOf, agentsByTty } from '../src/main/agents'

describe('agent detection', () => {
  it('recognizes agents run directly or through a runtime', () => {
    expect(agentOf('grok')).toBe('grok')
    expect(agentOf('/opt/homebrew/bin/grok-macos-aarch64 --model x')).toBe('grok')
    expect(agentOf('node /usr/local/lib/node_modules/@google/gemini-cli/dist/index.js')).toBeUndefined()
    expect(agentOf('node /usr/local/bin/gemini')).toBe('gemini')
    expect(agentOf('python3.12 /Users/me/.local/bin/aider')).toBe('aider')
    expect(agentOf('codex resume')).toBe('codex')
    expect(agentOf('/bin/bash /Applications/cmux.app/Contents/Resources/bin/grok')).toBe('grok')
  })

  it('ignores shells, editors and Claude', () => {
    expect(agentOf('-zsh')).toBeUndefined()
    expect(agentOf('bash')).toBeUndefined()
    expect(agentOf('zsh -c make test')).toBeUndefined()
    expect(agentOf('vim notes.md')).toBeUndefined()
    expect(agentOf('claude --resume x')).toBeUndefined()
    expect(agentOf('node server.js')).toBeUndefined()
  })

  it('takes foreground processes only, keyed by terminal', () => {
    const map = agentsByTty('ttys012 Ss   -zsh\nttys012 S+   grok\nttys013 S    gemini\npts/3    Sl+  node /usr/bin/gemini\n')
    expect([...map]).toEqual([['ttys012', 'grok'], ['pts/3', 'gemini']])
  })
})
