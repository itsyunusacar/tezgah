import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { TerminalLook, TerminalPalette } from '../shared/types'

// Reads a Ghostty config for its font and colors, so Tezgah's terminals can look the same.

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'] as const

const hex = (v: string) => {
  const t = v.trim().replace(/^#?/, '#')
  return /^#[0-9a-f]{6}$/i.test(t) ? t : undefined
}

/** `key = value` lines; repeated keys (palette, font-family) keep every value. */
export function parseGhostty(text: string): [string, string][] {
  const out: [string, string][] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    out.push([line.slice(0, eq).trim(), line.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1')])
  }
  return out
}

export function paletteFrom(entries: [string, string][], base: TerminalPalette = {}): TerminalPalette {
  const p: TerminalPalette = { ...base }
  for (const [k, v] of entries) {
    if (k === 'background') p.background = hex(v) ?? p.background
    else if (k === 'foreground') p.foreground = hex(v) ?? p.foreground
    else if (k === 'cursor-color') p.cursor = hex(v) ?? p.cursor
    else if (k === 'selection-background') p.selectionBackground = hex(v) ?? p.selectionBackground
    else if (k === 'palette') {
      const m = v.match(/^(\d+)\s*=\s*(.+)$/)
      const i = m ? Number(m[1]) : -1
      if (i >= 0 && i < 16 && hex(m![2])) p[ANSI[i]] = hex(m![2])
    }
  }
  return p
}

function configFiles(): string[] {
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  const dirs = [path.join(xdg, 'ghostty')]
  if (process.platform === 'darwin') dirs.push(path.join(os.homedir(), 'Library/Application Support/com.mitchellh.ghostty'))
  return dirs.flatMap((d) => ['config', 'config.ghostty'].map((n) => path.join(d, n))).filter((f) => fs.existsSync(f))
}

function themeFile(name: string): string | undefined {
  if (path.isAbsolute(name)) return fs.existsSync(name) ? name : undefined
  if (name.includes('/') || name.includes('..')) return undefined
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  const candidates = [
    path.join(xdg, 'ghostty', 'themes', name),
    '/Applications/Ghostty.app/Contents/Resources/ghostty/themes/' + name,
    '/usr/share/ghostty/themes/' + name,
    '/usr/local/share/ghostty/themes/' + name,
  ]
  return candidates.find((f) => fs.existsSync(f))
}

function readTheme(name: string): TerminalPalette | undefined {
  const file = themeFile(name.trim())
  if (!file) return undefined
  try {
    return paletteFrom(parseGhostty(fs.readFileSync(file, 'utf8')))
  } catch {
    return undefined
  }
}

/** Ghostty's font and colors, or null when there's no config with any of them. */
export function ghosttyLook(): TerminalLook | null {
  const entries = configFiles().flatMap((f) => {
    try {
      return parseGhostty(fs.readFileSync(f, 'utf8'))
    } catch {
      return []
    }
  })
  if (!entries.length) return null
  const look: TerminalLook = {}
  const family = entries.filter(([k]) => k === 'font-family').map(([, v]) => v).filter(Boolean)
  if (family.length) look.fontFamily = family.map((f) => `"${f}"`).join(', ')
  const size = Number(entries.findLast(([k]) => k === 'font-size')?.[1])
  if (size >= 6 && size <= 48) look.fontSize = Math.round(size)

  // "theme = Name" or "theme = light:Name,dark:Other"; direct colors override the theme.
  const theme = entries.findLast(([k]) => k === 'theme')?.[1]
  let light: TerminalPalette | undefined
  let dark: TerminalPalette | undefined
  if (theme) {
    const parts = Object.fromEntries(theme.split(',').map((p) => p.split(':').map((s) => s.trim())).filter((p) => p.length === 2))
    if (parts.light || parts.dark) {
      light = parts.light ? readTheme(parts.light) : undefined
      dark = parts.dark ? readTheme(parts.dark) : undefined
    } else light = dark = readTheme(theme)
  }
  const own = paletteFrom(entries)
  if (Object.keys(own).length) {
    light = { ...light, ...own }
    dark = { ...dark, ...own }
  }
  if (light && Object.keys(light).length) look.light = light
  if (dark && Object.keys(dark).length) look.dark = dark
  return Object.keys(look).length ? look : null
}
