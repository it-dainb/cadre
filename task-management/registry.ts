// Task-type registry (DESIGN 3.1) + pipeline validation. Config key `types` (init stage 6) overrides the defaults.
import type { Kind } from '../types'

export interface TypeSpec {
  commit: string | null                 // Conventional Commit type; null = never merges
  changelog: string | null              // KAC category, null = none
  pipeline: string[]
  contract: 'required' | 'none'
  kind?: Kind                           // custom types may declare it
}
export type TypeRegistry = Record<string, TypeSpec>

export const STEPS = ['tester', 'red', 'worker', 'green', 'reviewer', 'merge', 'explorer', 'report']

export const defaults = (): TypeRegistry => ({
  feature: { commit: 'feat', changelog: 'Added', pipeline: ['tester', 'red', 'worker', 'green', 'reviewer', 'merge'], contract: 'required' },
  bug: { commit: 'fix', changelog: 'Fixed', pipeline: ['tester', 'red', 'worker', 'green', 'reviewer', 'merge'], contract: 'required' },
  refactor: { commit: 'refactor', changelog: null, pipeline: ['worker', 'green', 'reviewer', 'merge'], contract: 'required' },
  docs: { commit: 'docs', changelog: null, pipeline: ['worker', 'reviewer', 'merge'], contract: 'none' },
  test: { commit: 'test', changelog: null, pipeline: ['tester', 'reviewer', 'merge'], contract: 'none' },
  spike: { commit: null, changelog: null, pipeline: ['explorer', 'report'], contract: 'none' },
})

// Allowed orders: red directly after tester; green directly after worker; merge last and after reviewer;
// explorer -> report alone; each step at most once. Returns an error string, or null when legal.
export function validatePipeline(p: readonly string[]): string | null {
  if (!p.length) return 'pipeline is empty'
  const bad = p.find(s => !STEPS.includes(s)); if (bad) return `unknown step "${bad}"`
  const dup = p.find((s, i) => p.indexOf(s) !== i); if (dup) return `step "${dup}" appears twice`
  const i = (s: string) => p.indexOf(s)
  if (p.includes('red') && (!p.includes('tester') || i('red') !== i('tester') + 1)) return '"red" must come directly after "tester"'
  if (p.includes('green') && (!p.includes('worker') || i('green') !== i('worker') + 1)) return '"green" must come directly after "worker"'
  if (p.includes('merge') && (!p.includes('reviewer') || i('merge') !== p.length - 1 || i('merge') < i('reviewer'))) return '"merge" must be last and after "reviewer"'
  const spike = p.includes('explorer') || p.includes('report')
  if (spike && p.join() !== 'explorer,report') return '"explorer -> report" must stand alone'
  return null
}

export const validate = (reg: TypeRegistry): string[] =>
  Object.entries(reg).flatMap(([t, s]) => { const e = validatePipeline(s.pipeline); return e ? [`types.${t}: ${e}`] : [] })

export const kindOf = (s: TypeSpec): Kind => s.kind ?? (s.pipeline.includes('explorer') ? 'spike' : s.commit === 'docs' ? 'docs' : 'code')
export const merges = (s: TypeSpec): boolean => s.pipeline.includes('merge')
// Pipeline lookup for the machine; unknown type -> []. Lane 'lite' (ADR 0011): no tester/red where a worker writes the change ('lite+tdd' keeps them)
export const pipeOf = (reg: TypeRegistry) => (type: string, lane?: string): readonly string[] => { const p = reg[type]?.pipeline ?? []; return lane === 'lite' && p.includes('worker') ? p.filter(s => s !== 'tester' && s !== 'red') : p }
