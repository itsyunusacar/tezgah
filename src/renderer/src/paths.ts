/** A path as the shell would want it typed: backslash-escaped on macOS/Linux (like dropping a file
 *  on Terminal.app), double-quoted on Windows when it has spaces or special characters. */
export function shellPath(p: string, windows: boolean): string {
  if (windows) return /[\s&()^%!;,]/.test(p) ? `"${p}"` : p
  return p.replace(/([^A-Za-z0-9_\-.,:/@+=%~])/g, '\\$1')
}

/** Normalizes what someone typed in an address bar: "localhost:3000" → http, "example.com" → https. */
export function normalizeUrl(input: string): string {
  const t = input.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^(about|data):/i.test(t)) return t
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/.test(t)) return `http://${t}`
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(t)) return `https://${t}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(t)}`
}
