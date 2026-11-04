// `tezgah browser eval`: the agent's script as an expression or statements, run once in the page.

const AsyncFunction = (async () => undefined).constructor as new (body: string) => unknown

/** Whether `body` compiles as an async function body (compiled only, never run). */
function compiles(body: string): Error | undefined {
  try {
    new AsyncFunction(body)
  } catch (e) {
    return e as Error
  }
}

/**
 * The script to run in the page for `script`: its value when it is an expression (`document.title`),
 * what it returns when it is statements. The form is decided here, before anything runs, so a script
 * that throws runs once. The page script resolves to `{ value }` or `{ error }` with the real message;
 * values that can't cross to the app (elements, functions, windows…) come back as readable text.
 */
export function pageScript(script: string): string {
  const expression = !compiles(`return (${script}\n)`)
  if (!expression) {
    const err = compiles(`${script}\n`)
    if (err) throw new Error(`${err.name}: ${err.message}`)
  }
  const run = expression ? `async () => (${script}\n)` : `async () => {\n${script}\n}`
  return `(async () => {
  const show = (v) => {
    if (v === undefined) return 'undefined'
    if (typeof v === 'function') return String(v).slice(0, 500)
    if (typeof Node !== 'undefined' && v instanceof Node) return v.outerHTML !== undefined ? v.outerHTML.slice(0, 2000) : v.nodeName
    try {
      structuredClone(v)
      return v
    } catch {}
    try {
      const json = JSON.stringify(v)
      if (json !== undefined) return json
    } catch {}
    return String(v)
  }
  try {
    return { value: show(await (${run})()) }
  } catch (e) {
    return { error: e instanceof Error ? e.name + ': ' + e.message : 'threw ' + String(e) }
  }
})()`
}

/** The page script's outcome → the value, or the page's error thrown here. */
export function pageResult(out: unknown): unknown {
  const r = out as { value?: unknown; error?: string } | undefined
  if (r?.error !== undefined) throw new Error(r.error)
  return r?.value
}
