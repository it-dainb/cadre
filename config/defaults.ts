// Config defaults + key classes (DESIGN 12). S = security (repo may only tighten), U = user-level only, O = ordinary (committed).
import { defaults as typeDefaults } from '../task-management/registry'

export type Cls = 'S' | 'U' | 'O'
export const defaults = () => ({
  strictness: 'strict', mcpAllow: [] as string[],
  jail: 'auto', jailWritable: [] as string[], effectCheck: 'auto',
  changelog: { path: 'CHANGELOG.md' },
  roles: {
    testerView: 'view', tdd: { author: 'separate' },
    worker: { tier: 'standard', effort: 'default' }, tester: { tier: 'standard', effort: 'default' },
    reviewer: { tier: 'standard', effort: 'default' }, explorer: { tier: 'fast', effort: 'low' },
  },
  models: { fast: 'haiku', standard: 'sonnet', deep: 'opus' },
  adapters: {} as Record<string, unknown>,
  store: { kind: 'beads', bin: 'bd', dir: '', timeoutMs: 45000, pollMs: 10000 },
  worktrees: { root: '' },                                    // '' = ${XDG_CACHE_HOME:-$HOME/.cache}/cadre/wt
  drive: { level: 'epic', maxTurns: 100, maxCostUsd: 20, maxWallMinutes: 240, noProgressTurns: 3 },
  cost: { prices: null as unknown, clearHintPct: 40, compactPct: 60 },
  sync: {} as Record<string, unknown>,
  types: typeDefaults() as unknown, packages: [] as { root: string; knownRed?: string[]; [k: string]: unknown }[],
  suites: { integration: 'all' },
  review: { deepLabels: ['security', 'breaking'], maxRework: 3 }, limits: { reportRetries: 3 },
  branches: { main: '', dev: 'dev', epicPrefix: 'epic/' }, release: { onEpicDone: 'propose' },
  ui: { glyphs: 'unicode' },
  maxParallel: 3, maxRows: 6, reuse: { maxContextPct: 60, cacheTtlMs: 3_600_000 },   // 1h: roles ship as agent files with experimental.cacheTtl 1h (A28, ADR 0001 S44)
  disable: false,
})
export type Config = ReturnType<typeof defaults>

// Longest dotted prefix wins. Anything not listed is O.
export const CLASS: Record<string, Cls> = {
  strictness: 'S', mcpAllow: 'S', jail: 'S', jailWritable: 'S', effectCheck: 'S', 'roles.testerView': 'S',
  adapters: 'U', store: 'U', 'store.timeoutMs': 'O', 'store.pollMs': 'O', worktrees: 'U', drive: 'U', 'cost.prices': 'U', disable: 'U',
}
// Free-form subtrees: keys under them are not validated against the defaults.
export const OPEN = ['adapters', 'sync', 'types', 'packages', 'cost.prices']
// Tighten rule per S key (repo layer): bool -> only the strict value; enum -> the stricter (later) value; list -> intersection.
export const TIGHTEN: Record<string, ['bool', boolean] | ['enum', ...string[]] | ['list']> = {
  strictness: ['enum', 'advisory', 'strict'], mcpAllow: ['list'],
  jail: ['enum', 'off', 'auto', 'on'], jailWritable: ['list'], effectCheck: ['enum', 'off', 'auto', 'always'],
  'roles.testerView': ['enum', 'full', 'view'],
}
