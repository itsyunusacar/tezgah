// Tezgah's interface in English or Turkish. English text is the key; Turkish comes from tr.ts.
// t('Saved layout “{name}”.', { name }) fills {placeholders}. Missing translations fall back to English.

import { tr } from './tr'

export type Language = 'en' | 'tr'

let current: Language = 'en'

/** "system" follows the OS language: Turkish for tr-*, English otherwise. */
export function resolveLanguage(setting: string | undefined, systemLocale: string): Language {
  if (setting === 'en' || setting === 'tr') return setting
  return systemLocale.toLowerCase().startsWith('tr') ? 'tr' : 'en'
}

export function setLanguage(lang: Language): void {
  current = lang
}

export function language(): Language {
  return current
}

export function t(text: string, vars?: Record<string, string | number>): string {
  let out = current === 'tr' ? tr[text] ?? text : text
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v))
  return out
}

/** "1 note", "3 notes" / "1 not", "3 not". */
export function plural(n: number, one: string, many: string): string {
  return t(n === 1 ? one : many, { n })
}
