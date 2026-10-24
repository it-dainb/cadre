import { describe, expect, test } from 'claude-code/testing'
import { MAIN_TOOLS, ROLES, TOOLS, TTL, allowlist, file, spec } from '../agents/index'
import { REG, defaults, resolve } from '../config/index'
import { fixedRules, ROLES_DEFAULT, EXIT, exitIssue, writes } from '../core/roles'
import { routeOf } from '../core/admission'
import { REPORTS } from '../core/validate'
import { fence } from '../policy/guards'
import { fence as frozen } from './fixtures/fence-v0.15.0'
import GOLD from './fixtures/roles-golden'
import { fakeHost, task } from './support'
import type { Role } from '../types'

// ---- the differential: the v0.15.0 fence() (frozen fixture) against the live one, role x tool x path x task state x locks/core ----
const norm = (p: string) => { const o: string[] = []; for (const s of p.split('/')) { if (s === '..') o.pop(); else if (s && s !== '.') o.push(s) } return '/' + o.join('/') }
const DIRS = ['/', '/x', '/x/repo', '/x/bd-a1', '/x/bd-a1.view', '/x/bd-a1/src', '/x/bd-a1/.git', '/x/bd-a1/.cadre', '/x/bd-a1/.claude', '/x/bd-a1/.claude/plugins', '/x/bd-a1/.claude/plugins/store', '/x/bd-a2', '/etc', '/tmp', '/home', '/hm/u', '/hm/u/.claude']
const FILES = ['/x/bd-a1/src/a.ts', '/x/bd-a1/src/b.ts', '/x/bd-a1.view/t.test.ts', '/etc/passwd', '/x/repo/a.ts', '/x/bd-a1/CHANGELOG.md', '/hm/u/.claude.json']
const PATHS = ['/x/bd-a1/src/a.ts', '/x/bd-a1/src/b.ts', '/x/bd-a1/src/new.ts', '/x/bd-a1/deep/er/new.ts', 'src/a.ts', 'src/../../bd-a2/x.ts', '/x/bd-a1', '/x/bd-a1/.git/hooks/x', '/x/bd-a1/.cadre/config.json', '/x/bd-a1/.claude/settings.json', '/x/bd-a1/.claude/plugins/store/p/a.md',
  '/x/bd-a1.view/t.test.ts', '/x/bd-a1.view/new.test.ts', '/x/bd-a2/z.ts', '/x/repo/a.ts', '/x/repo/new.ts', '/tmp/scratch', '/etc/passwd', '/hm/u/.claude.json', '/hm/u/.claude/settings.json', '/x/bd-a1/CHANGELOG.md', '/nowhere/x', '/x/bd-a1/src/..', '']
const TOOLS_ALL = ['Read', 'Write', 'Edit', 'NotebookEdit', 'Grep', 'Glob', 'Bash', 'TodoWrite', 'mcp__cadre__report', 'mcp__cadre__inspect', 'Agent']
const bind = (role: Role, worktree: string) => ({ taskId: 'bd-a1', role, step: 'worker', worktree, sessionId: 's', ctxTokens: 0, startedAt: 0 })
async function host() {
  const h = fakeHost({ env: { TMPDIR: '/tmp' } })
  h.stat = async (p, o) => { const r = norm(p); return DIRS.includes(r) || FILES.includes(r) ? { kind: 'file', realPath: o?.resolve ? r : undefined } : undefined }
  return h
}
const input = (tool: string, p: string) => (tool === 'NotebookEdit' ? { notebook_path: p } : tool === 'Glob' ? { pattern: p, path: p } : tool === 'Grep' ? { path: p } : { file_path: p })

describe('roles as data: zero behaviour change', () => {
  test('differential: live fence() = the frozen v0.15.0 fence() on every reachable call', { timeoutMs: 60_000 }, async () => {   // ~5 s idle: a loaded machine must not flake it
    const h = await host(); let n = 0
    for (const locks of [undefined, { 'bd-a1': ['/x/bd-a1/src/a.ts'] }]) for (const core of [undefined, { 'bd-a1': ['/x/bd-a1/src/b.ts'] }]) for (const home of [undefined, '/hm/u'])
      for (const state of ['active', 'blocked', 'review']) for (const step of ['worker', 'tester', 'green']) for (const kind of [undefined, 'init', 'setup']) for (const guide of [undefined, '/x/repo/.cadre/guide.md']) {
        const pol = { repo: '/x/repo', wtRoot: '/x', home, locks, core, changelog: 'CHANGELOG.md' }, t = task('bd-a1', { state: state as any, step })
        const who = (role: Role | 'main', wt: string) => role === 'main' ? { b: undefined, task: undefined, main: true, role: 'explorer' as const, owner: false } : { b: bind(role, wt), task: t, main: false, role, owner: state === 'active' }
        for (const role of ['main', ...ROLES] as const) for (const tool of TOOLS_ALL) {
          if (role !== 'main' && !allowlist(role as Role, ['mcp__a__b']).includes(tool)) continue   // L1 refuses it before the fence: unreachable
          for (const wt of role === 'tester' ? ['/x/bd-a1.view', '/x/bd-a1'] : ['/x/bd-a1'])
            for (const p of PATHS) {
              const w = who(role, wt), a = String(await frozen(h, w, tool, input(tool, p), pol, guide, kind)), b = String(await fence(h, w as any, tool, input(tool, p), pol, guide, kind)); n++
              if (a !== b) expect({ role, tool, p, state, step, locks: !!locks, core: !!core, guide: !!guide, kind, old: a }).toEqual({ role, tool, p, state, step, locks: !!locks, core: !!core, guide: !!guide, kind, old: b })
            }
        }
      }
    expect(n).toBeGreaterThan(100_000)
  })
  test('golden: spec(), allowlist(), file(), TTL, MAIN_TOOLS, TOOLS, REPORTS, roster', async () => {
    const base = defaults(), mod = structuredClone(base)
    mod.mcpAllow = ['mcp__a__b']; mod.roles.worker.byRisk.standard = { ...mod.roles.worker.byRisk.standard, model: 'opus', effort: 'xhigh' }; mod.roles.explorer = { model: 'sonnet', effort: 'default' }
    for (const [n, c] of Object.entries({ base, mod })) for (const r of ROLES) expect(spec(r, { roles: c.roles, mcpAllow: c.mcpAllow })).toEqual(GOLD.spec[`${n}/${r}`])
    for (const r of ROLES) { expect(allowlist(r)).toEqual(GOLD.allow[r]); expect(allowlist(r, ['mcp__a__b'])).toEqual(GOLD.allow[`${r}+mcp`]); expect(file(r)).toBe(GOLD.file[r]) }
    expect(TTL).toEqual(GOLD.ttl); expect(ROLES).toEqual(GOLD.roles); expect([...MAIN_TOOLS]).toEqual(GOLD.main); expect(TOOLS).toEqual(GOLD.tools)
    expect(JSON.parse(JSON.stringify(REPORTS))).toEqual(GOLD.reports)
  })
  test('golden: routeOf over role x risk x round x unit routing', async () => {
    const d = { cfg: defaults() } as any
    for (const r of ROLES) for (const t of ['light', 'standard', 'thorough', 'core'] as const) for (const n of [0, 1, 2]) for (const unit of [undefined, { root: 'u', routing: { [r]: { model: 'opus' } } }])
      expect(JSON.parse(JSON.stringify(routeOf(d, r, t, n, unit)))).toEqual(GOLD.routes[`${r}/${t}/${n}/${unit ? 'unit' : '-'}`])
  })
  test('golden: fixture configs resolve unchanged (roles.custom is the one new key)', async () => {
    const L = (name: string, trust: 'user' | 'repo', value: unknown) => ({ name, trust, value })
    const sets: Record<string, any[]> = { none: [], user: [L('u', 'user', { mcpAllow: ['mcp__a__b'], concurrency: { default: 2 }, roles: { worker: { byRisk: { light: { model: 'sonnet' } } } } })],
      both: [L('u', 'user', { mcpAllow: ['mcp__a__b'], units: [{ root: 'a', knownRed: ['x', 'y'] }] }), L('r', 'repo', { strictness: 'strict', roles: { tester: { byRisk: { core: { effort: 'low' } } } }, units: [{ root: 'a', knownRed: ['x', 'z'] }], bogus: 1 })] }
    for (const [n, s] of Object.entries(sets)) {
      const r = resolve(s), { custom, ...roles } = r.config.roles
      expect(custom).toEqual({}); expect(JSON.parse(JSON.stringify({ config: { ...r.config, roles }, diagnostics: r.diagnostics }))).toEqual(GOLD.resolved[n])
    }
  })
  test('write scope: globs under the tree; built-ins are ** or none', async () => {
    expect(ROLES.map(r => ROLES_DEFAULT[r].write)).toEqual([['**'], ['**'], [], [], []])
    expect([writes(ROLES_DEFAULT.worker, ''), writes(ROLES_DEFAULT.worker, 'a/b/c.ts'), writes(ROLES_DEFAULT.reviewer, 'a.ts')]).toEqual([true, true, false])
    const s = { ...ROLES_DEFAULT.worker, write: ['src/**', '*.md'] }
    expect([writes(s, 'src/a/b.ts'), writes(s, 'README.md'), writes(s, 'docs/README.md'), writes(s, 'a.ts')]).toEqual([true, true, false, false])
  })
})

describe('exit rule 6: no spec can drop an exit tool', () => {
  test('every built-in passes; naming an exit tool in disallowedTools is refused for each built-in and a custom shape', async () => {
    for (const r of ROLES) { expect(exitIssue(ROLES_DEFAULT[r])).toBeNull(); for (const t of EXIT) expect(exitIssue({ ...ROLES_DEFAULT[r], disallowedTools: [t] })).toContain(t) }
    expect(exitIssue({ tools: ['Read', 'mcp__cadre__report'], disallowedTools: ['Bash', 'StructuredOutput'] })).toContain('StructuredOutput')
  })
  test('a tools list that names some exit tools must name all; one that names none is fine (they are added)', async () => {
    expect(exitIssue({ tools: ['Read', 'SubagentHandback'] })).toContain('StructuredOutput'); expect(exitIssue({ tools: ['Read', ...EXIT] })).toBeNull(); expect(exitIssue({ tools: ['Read'] })).toBeNull()
  })
  test('refused at load: roles.custom with a bad spec is dropped with a diagnostic; a good one loads', async () => {
    const L = (v: unknown) => [{ name: 'u', trust: 'user' as const, value: { roles: { custom: v } } }]
    const bad = resolve(L({ x: { tools: ['Read'], disallowedTools: ['SubagentHandback'] } })); expect(bad.config.roles.custom).toEqual({}); expect(bad.diagnostics.join()).toContain('SubagentHandback')
    expect(resolve(L({ x: { tools: ['Read'] } })).config.roles.custom).toEqual({ x: { tools: ['Read'] } })
    for (const v of [{ x: null }, { x: { tools: {} } }, { x: { disallowedTools: 'Bash' } }, { x: [] }, []]) { const r = resolve(L(v)); expect(r.config.roles.custom).toEqual({}); expect(r.diagnostics.join()).toContain('roles.custom') }
    expect(resolve([{ name: 'r', trust: 'repo', value: { roles: { custom: { x: { tools: ['Read'] } } } } }]).diagnostics.join()).toContain('user-level only')
  })
  test('fixed rows: the exit tools and the write scopes; REG has roles.custom', async () => {
    expect(fixedRules().map(r => r[0])).toEqual(['fixed.exitTools', 'fixed.writeScope']); expect(fixedRules()[1][1]).toBe('worker **, tester **, reviewer none, explorer none, planner none'); expect(REG['roles.custom'].open).toBe(true)
  })
})
