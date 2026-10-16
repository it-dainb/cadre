// 3-way merge (DESIGN 11.4 step 3), pure. Per field: `l`/`r` = fnv64 of the local/remote value at the last sync. Beads wins a conflict.
import { fnv1a64 } from '../../core/board'

export const HUMAN = ['title', 'description', 'acceptance', 'priority']   // pulled; everything else is push-only (status: remote change = drift)
export type Base = { l: Record<string, string>; r: Record<string, string> }
export const hash = (v: unknown): string => fnv1a64(String(v ?? ''))

export function merge(local: Record<string, string>, remote: Record<string, string | undefined>, base: Base) {
  const conflict: string[] = [], pull: Record<string, string> = {}, l = { ...base.l }, r = { ...base.r }; let drift = false
  for (const f of Object.keys(local)) {
    const lh = hash(local[f]), lc = lh !== base.l[f], rv = remote[f], rh = rv === undefined ? base.r[f] : hash(rv), rc = rv !== undefined && rh !== base.r[f]
    if (!HUMAN.includes(f)) {
      if (f === 'status' && rc && rh !== lh) { drift = true; r[f] = rh; delete l[f] }   // local wins: resend; flag drift
      continue
    }
    if (rc && rh === lh) { l[f] = r[f] = lh } else if (rc && lc) { conflict.push(f); r[f] = rh } else if (rc) { pull[f] = rv!; l[f] = r[f] = rh }
  }
  return { pull, conflict, drift, next: { l, r } as Base }
}
