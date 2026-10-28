import { app, net } from 'electron'

// Is there a newer Tezgah? One unauthenticated request to GitHub's releases API at launch and every
// six hours (Settings can turn it off). Nothing is downloaded or installed; the sidebar offers the page.

export interface Update {
  version: string
  url: string
}

/** Compares "1.0.0-alpha.2" style versions; prereleases sort before their release. */
export function newer(candidate: string, current: string): boolean {
  const parse = (v: string) => {
    const [core, pre = ''] = v.replace(/^v/, '').split('-')
    return { nums: core.split('.').map((n) => Number(n) || 0), pre }
  }
  const a = parse(candidate)
  const b = parse(current)
  for (let i = 0; i < 3; i++) if ((a.nums[i] ?? 0) !== (b.nums[i] ?? 0)) return (a.nums[i] ?? 0) > (b.nums[i] ?? 0)
  if (a.pre === b.pre) return false
  if (!a.pre) return true
  if (!b.pre) return false
  // alpha.2 vs alpha.10: compare the parts, numbers as numbers.
  const pa = a.pre.split('.')
  const pb = b.pre.split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === pb[i]) continue
    if (pa[i] === undefined) return false
    if (pb[i] === undefined) return true
    const na = Number(pa[i])
    const nb = Number(pb[i])
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na > nb
    return pa[i] > pb[i]
  }
  return false
}

export async function check(): Promise<Update | null> {
  try {
    const res = await net.fetch('https://api.github.com/repos/itsyunusacar/tezgah/releases?per_page=5', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Tezgah/${app.getVersion()}` },
    })
    if (!res.ok) return null
    const releases = (await res.json()) as { tag_name: string; html_url: string; draft: boolean; prerelease: boolean }[]
    // Someone on a prerelease hears about prereleases too; someone on a release only about releases.
    const onPre = app.getVersion().includes('-')
    const latest = releases.find((r) => !r.draft && (onPre || !r.prerelease))
    if (!latest || !newer(latest.tag_name, app.getVersion())) return null
    return { version: latest.tag_name.replace(/^v/, ''), url: latest.html_url }
  } catch {
    return null
  }
}
