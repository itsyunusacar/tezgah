/** A path as the shell would want it typed: backslash-escaped on macOS/Linux (like dropping a file
 *  on Terminal.app), double-quoted on Windows when it has spaces or special characters. */
export function shellPath(p: string, windows: boolean): string {
  if (windows) return /[\s&()^%!;,]/.test(p) ? `"${p}"` : p
  return p.replace(/([^A-Za-z0-9_\-.,:/@+=%~])/g, '\\$1')
}
