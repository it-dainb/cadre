import { monthKey } from './dates.mjs'
// entries: [{ at: Date | ISO string, cents: number }]
export const total = entries => entries.reduce((n, e) => n + e.cents, 0)
export function byMonth(entries) {
  const m = {}; for (const e of entries) { const k = monthKey(e.at); m[k] = (m[k] ?? 0) + e.cents }
  return Object.fromEntries(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : 1)))
}
