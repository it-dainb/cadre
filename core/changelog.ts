// KAC 1.1.0 changelog (DESIGN 3.9): validate / insert / cut. Pure text in, text out; every write validates first and refuses with the line.
export const KAC = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']
export const skeleton = (): string => `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
`
const UNREL = '## [Unreleased]', REL = /^## \[\d+\.\d+\.\d+\] - \d{4}-\d\d-\d\d( \[YANKED\])?$/, REF = /^\[[^\]]+\]: \S+/

// null when valid, else "line N: why".
export function validate(text: string): string | null {
  const ls = text.split('\n'); let seen = false, cur: string | null = null, last = -1, ent = false
  const first = ls.findIndex(l => l.trim()); if (first < 0 || ls[first] !== '# Changelog') return `line ${first + 1}: must start with "# Changelog"`
  for (let i = first + 1; i < ls.length; i++) {
    const l = ls[i], n = i + 1
    if (l.startsWith('## ')) {
      if (l === UNREL) { if (seen) return `line ${n}: duplicate [Unreleased]`; seen = true }
      else if (!seen) return `line ${n}: "## [Unreleased]" must come first`
      else if (!REL.test(l)) return `line ${n}: release heading must be "## [x.y.z] - YYYY-MM-DD"`
      cur = null; last = -1; ent = false
    } else if (l.startsWith('### ')) {
      if (!seen) return `line ${n}: section before [Unreleased]`
      const c = l.slice(4), k = KAC.indexOf(c)
      if (k < 0) return `line ${n}: "${c}" is not a KAC category (${KAC.join(', ')})`
      if (k <= last) return `line ${n}: "${c}" is out of KAC order or duplicated`
      cur = c; last = k; ent = false
    } else if (REF.test(l)) { cur = null }
    else if (l.trim() && cur !== null) { if (l.startsWith('- ')) ent = true; else if (!ent || !/^\s+\S/.test(l)) return `line ${n}: entries must be "- text"` }
    else if (l.trim() && seen && cur === null && !REF.test(l)) return `line ${n}: text outside a ### category`
  }
  return seen ? null : 'no "## [Unreleased]" section'
}

type Region = { head: string[]; pre: string[]; sec: Map<string, string[]>; tail: string[] }
// Split at the Unreleased heading: lines before (incl. heading), its categories, everything from the next release / link refs on.
function split(text: string): Region {
  const ls = text.split('\n'), u = ls.indexOf(UNREL)
  let end = ls.findIndex((l, i) => i > u && (l.startsWith('## ') || REF.test(l))); if (end < 0) end = ls.length
  const sec = new Map<string, string[]>(); let cur: string[] | null = null
  const pre: string[] = []
  for (const l of ls.slice(u + 1, end)) {
    if (l.startsWith('### ')) { cur = []; sec.set(l.slice(4), cur) } else if (cur) { if (l.trim()) cur.push(l) } else if (l.trim()) pre.push(l)
  }
  return { head: ls.slice(0, u + 1), pre, sec, tail: ls.slice(end) }
}
const body = (sec: Map<string, string[]>): string[] =>
  KAC.filter(c => sec.has(c)).flatMap(c => ['', `### ${c}`, '', ...sec.get(c)!])

function checked(text: string): string { const e = validate(text); if (e) throw new Error(`changelog invalid: ${e}`); return text }

export function insert(text: string, category: string, entry: string, id: string): string {
  checked(text)
  if (!KAC.includes(category)) throw new Error(`changelog: "${category}" is not a KAC category`)
  if (/[\r\n]/.test(entry)) throw new Error('changelog: entry must be one line')
  const r = split(text); const s = r.sec.get(category) ?? []; s.push(`- ${entry} (${id})`); r.sec.set(category, s)
  const out = [...r.head, ...r.pre, ...body(r.sec), '', ...r.tail].join('\n').replace(/\n{3,}/g, '\n\n')
  return checked(out)
}

// Move [Unreleased] into a release; refuses when it is empty ("nothing to release").
export function cut(text: string, version: string, date: string): string {
  checked(text)
  const r = split(text); if (![...r.sec.values()].some(v => v.length)) throw new Error('nothing to release')
  const rel = `## [${version}] - ${date}`
  if (!REL.test(rel)) throw new Error(`changelog: bad version/date "${version}" "${date}"`)
  const out = [...r.head, ...r.pre, '', rel, ...body(r.sec), '', ...r.tail].join('\n').replace(/\n{3,}/g, '\n\n')
  return checked(out)
}
