import { describe, expect, it } from 'vitest'
import { accelerator, label, shortcuts, type Command } from '../src/shared/shortcuts'

describe('shortcuts', () => {
  for (const mac of [true, false]) {
    it(`has no duplicates on ${mac ? 'macOS' : 'Windows/Linux'}`, () => {
      const used = (Object.keys(shortcuts) as Command[]).map((c) => accelerator(c, mac)).filter(Boolean)
      expect(new Set(used).size).toBe(used.length)
    })
  }

  it('never takes plain Ctrl+letter on Windows/Linux (those belong to the shell)', () => {
    for (const c of Object.keys(shortcuts) as Command[]) {
      const acc = accelerator(c, false)
      if (acc) expect(acc).not.toMatch(/^Ctrl\+[A-Z]$/)
    }
  })

  it('formats macOS labels with symbols', () => {
    expect(label('new-shell', true)).toBe('⇧⌘T')
    expect(label('new-worktree', true)).toBe('⌥⌘T')
    expect(label('new-claude', false)).toBe('Ctrl+Shift+T')
  })
})

import { plural, resolveLanguage, setLanguage, t } from '../src/shared/i18n'

describe('i18n', () => {
  it('follows the system language unless one is chosen', () => {
    expect(resolveLanguage('system', 'tr-TR')).toBe('tr')
    expect(resolveLanguage('system', 'en-US')).toBe('en')
    expect(resolveLanguage('en', 'tr-TR')).toBe('en')
  })

  it('translates with placeholders and falls back to English', () => {
    setLanguage('tr')
    expect(t('Close “{title}”?', { title: 'Shell 2' })).toBe('“Shell 2” kapatılsın mı?')
    expect(plural(3, '{n} note', '{n} notes')).toBe('3 not')
    expect(t('Something not translated')).toBe('Something not translated')
    setLanguage('en')
    expect(t('Close “{title}”?', { title: 'x' })).toBe('Close “x”?')
  })
})
