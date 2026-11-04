import { browsable } from '../../shared/open'

/** A path as the shell would want it typed: backslash-escaped on macOS/Linux (like dropping a file
 *  on Terminal.app), double-quoted on Windows when it has spaces or special characters. */
export function shellPath(p: string, windows: boolean): string {
  if (windows) return /[\s&()^%!;,]/.test(p) ? `"${p}"` : p
  return p.replace(/([^A-Za-z0-9_\-.,:/@+=%~])/g, '\\$1')
}

/** Normalizes what someone typed in an address bar: "localhost:3000" → http, "example.com" → https;
 *  a scheme a browser pane doesn't open (x://…) becomes a search. */
export function normalizeUrl(input: string): string {
  const t = input.trim()
  if (browsable(t)) return t
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/.test(t)) return `http://${t}`
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(t)) return `https://${t}`
  return `https://www.google.com/search?q=${encodeURIComponent(t)}`
}
