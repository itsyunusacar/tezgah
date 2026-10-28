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

import { defaultAccelerator, fromKeyEvent, setOverrides } from '../src/shared/shortcuts'

describe('custom shortcuts', () => {
  const key = (k: string, code: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({ key: k, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods })

  it('turns key presses into accelerators', () => {
    expect(fromKeyEvent(key('k', 'KeyK', { metaKey: true, shiftKey: true }), true)).toBe('Cmd+Shift+K')
    expect(fromKeyEvent(key('˚', 'KeyK', { metaKey: true, altKey: true }), true)).toBe('Cmd+Alt+K')
    expect(fromKeyEvent(key('ArrowDown', 'ArrowDown', { ctrlKey: true, shiftKey: true }), false)).toBe('Ctrl+Shift+Down')
    expect(fromKeyEvent(key('Shift', 'ShiftLeft', { shiftKey: true }), true)).toBeUndefined()
  })

  it('lets your own win, and "" turn one off', () => {
    setOverrides({ 'new-claude': 'Cmd+N', inbox: '' })
    expect(accelerator('new-claude', true)).toBe('Cmd+N')
    expect(accelerator('inbox', true)).toBeUndefined()
    expect(defaultAccelerator('new-claude', true)).toBe('Cmd+T')
    setOverrides({})
    expect(accelerator('new-claude', true)).toBe('Cmd+T')
  })
})
