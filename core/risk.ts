// Risk-sized review (ADR 0016): the reviewer's depth and model follow the change's size and the paths it touches. Pure; the numbers come from config review.tiers.
import { matches } from './specview'

export type Tier = 'light' | 'standard' | 'thorough'
export interface Tiers { light: { files: number; lines: number }; thorough: { files: number; lines: number }; risky: string[] }

// `git diff --numstat` -> changed paths and total lines (binary `-` counts 0; a rename shows its new path)
export function parseNumstat(out: string): { paths: string[]; lines: number } {
  const rows = out.split('\n').map(l => l.split('\t')).filter(r => r.length >= 3)
  return { paths: rows.map(r => r[2].replace(/\{[^}]*=> ([^}]*)\}/, '$1').replace(/^.* => /, '').replace(/\/\//g, '/')), lines: rows.reduce((n, r) => n + (+r[0] || 0) + (+r[1] || 0), 0) }
}
export function reviewTier(c: Tiers, st: { paths: string[]; lines: number }, deepLabel: boolean, core: string[] = []): Tier {
  const n = st.paths.length
  if (deepLabel || n > c.thorough.files || st.lines > c.thorough.lines || st.paths.some(p => matches([...c.risky, ...core], p))) return 'thorough'
  return n < c.light.files && st.lines < c.light.lines ? 'light' : 'standard'
}
// what the reviewer is told to check, in task language (no tier names)
export const FOCUS: Record<Tier, string> = {
  light: 'Small change: confirm each scenario has a test that really checks it, and that nothing outside the task changed.',
  standard: '',
  thorough: 'Large or sensitive change: besides the scenarios, check security (input handling, permissions, secrets, unsafe defaults) and fit with the existing structure (boundaries, duplicated logic, public contracts, migrations).',
}
