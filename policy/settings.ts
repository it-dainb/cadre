// Init stage 5 settings write (DESIGN 13.1 L2): deep-merge into .claude/settings.local.json, diff, re-read, .bak. fs is injected (the kit has none).
type J = Record<string, any>
const isObj = (v: unknown): v is J => !!v && typeof v === 'object' && !Array.isArray(v)

// Objects merge key by key; arrays union (order kept, no dupes); scalars: patch wins.
export const deepMerge = (base: any, patch: any): any =>
  isObj(base) && isObj(patch) ? Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(patch)])].map(k => [k, k in patch ? deepMerge(base[k], patch[k]) : base[k]]))
  : Array.isArray(base) && Array.isArray(patch) ? [...base, ...patch.filter(x => !base.some(y => JSON.stringify(y) === JSON.stringify(x)))]
  : patch

// Human-readable diff lines: `+ a.b: v`, `~ a.b: old -> new`, `+ a.c[]: item` for array additions.
export function diff(before: any, after: any, path = ''): string[] {
  if (isObj(after)) return Object.keys(after).flatMap(k => diff(isObj(before) ? before[k] : undefined, after[k], path ? `${path}.${k}` : k))
  const j = JSON.stringify
  if (Array.isArray(after)) { const old = Array.isArray(before) ? before : []; return after.filter(x => !old.some(y => j(y) === j(x))).map(x => `+ ${path}[]: ${j(x)}`) }
  return j(before) === j(after) ? [] : before === undefined ? [`+ ${path}: ${j(after)}`] : [`~ ${path}: ${j(before)} -> ${j(after)}`]
}

export interface Fs { readText(p: string): Promise<string | null>; writeText(p: string, t: string): Promise<void> }
// Plan = merged result + diff (shown to the human first). Apply = .bak of the old bytes, write, re-read and verify the merge landed.
export async function plan(fs: Pick<Fs, 'readText'>, path: string, patch: J): Promise<{ next: J; lines: string[]; old: string | null }> {
  const old = await fs.readText(path)
  let cur: J = {}
  if (old !== null) { try { cur = JSON.parse(old) } catch { throw new Error(`${path}: not valid JSON; refusing to overwrite`) } if (!isObj(cur)) throw new Error(`${path}: not an object`) }
  const next = deepMerge(cur, patch)
  return { next, lines: diff(cur, next), old }
}
export async function apply(fs: Fs, path: string, patch: J): Promise<{ lines: string[] }> {
  const { next, lines, old } = await plan(fs, path, patch)
  if (!lines.length) return { lines }
  if (old !== null) await fs.writeText(`${path}.bak`, old)
  await fs.writeText(path, JSON.stringify(next, null, 2) + '\n')
  const back = await fs.readText(path)
  if (back === null || diff(JSON.parse(back), next).length) throw new Error(`${path}: re-read does not match what was written`)
  return { lines }
}
