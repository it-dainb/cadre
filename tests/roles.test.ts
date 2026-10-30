import { describe, expect, mock, test } from 'claude-code/testing'
import { MAIN_TOOLS, ROLES, TOOLS, TTL, allowlist, file, spec } from '../agents/index'
import { defaults, resolve } from '../config/index'
import { fixedRules, ROLES_DEFAULT, EXIT, PROMPT_CAP, agentSpec, customIssue, exitIssue, writes } from '../core/roles'
import { routeOf } from '../core/admission'
import { REPORTS, reportRefusal } from '../core/validate'
import { cachePrefix, fence, guard, setPolicy, shelled } from '../policy/guards'
import { fence as frozen } from './fixtures/fence-v0.15.0'
import GOLD from './fixtures/roles-golden'
import { fakeHost, task } from './support'
import { roles as PROFILE_ROLES, profile as DEFAULT } from '../profiles/default'
import { setProfile } from '../core/pipeline'
import { check } from '../core/profile'
import { SPECS } from '../tools/index'
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
    expect(JSON.parse(JSON.stringify(REPORTS()))).toEqual(GOLD.reports)
  })
  test('golden: routeOf over role x risk x round x unit routing', async () => {
    const d = { cfg: defaults() } as any
    for (const r of ROLES) for (const t of ['light', 'standard', 'thorough', 'core'] as const) for (const n of [0, 1, 2]) for (const unit of [undefined, { root: 'u', routing: { [r]: { model: 'opus' } } }])
      expect(JSON.parse(JSON.stringify(routeOf(d, r, t, n, unit)))).toEqual(GOLD.routes[`${r}/${t}/${n}/${unit ? 'unit' : '-'}`])
  })
  test('golden: fixture configs resolve unchanged (B16: the profile took types, tdd, review, lanes, roles.custom and limits.testerRounds; profile and limits.specAccepts are new)', async () => {
    const L = (name: string, trust: 'user' | 'repo', value: unknown) => ({ name, trust, value })
    const sets: Record<string, any[]> = { none: [], user: [L('u', 'user', { mcpAllow: ['mcp__a__b'], concurrency: { default: 2 }, roles: { worker: { byRisk: { light: { model: 'sonnet' } } } } })],
      both: [L('u', 'user', { mcpAllow: ['mcp__a__b'], units: [{ root: 'a', knownRed: ['x', 'y'] }] }), L('r', 'repo', { strictness: 'strict', roles: { tester: { byRisk: { core: { effort: 'low' } } } }, units: [{ root: 'a', knownRed: ['x', 'z'] }], bogus: 1 })] }
    for (const [n, s] of Object.entries(sets)) {
      const r = resolve(s), { roles, lessons, ...rest } = r.config
      expect(lessons.passesPerDay).toBe(4); expect(JSON.parse(JSON.stringify({ config: { ...rest, roles }, diagnostics: r.diagnostics }))).toEqual(GOLD.resolved[n])
    }
  })
  test('write scope: globs under the tree; built-ins are ** or none', async () => {
    expect(ROLES.map(r => ROLES_DEFAULT[r].write)).toEqual([['**'], ['**'], [], [], [], []])
    expect([writes(ROLES_DEFAULT.worker, ''), writes(ROLES_DEFAULT.worker, 'a/b/c.ts'), writes(ROLES_DEFAULT.reviewer, 'a.ts')]).toEqual([true, true, false])
    const s = { ...ROLES_DEFAULT.worker, write: ['src/**', '*.md'] }
    expect([writes(s, 'src/a/b.ts'), writes(s, 'README.md'), writes(s, 'docs/README.md'), writes(s, 'a.ts')]).toEqual([true, true, false, false])
  })
})

const AUD = { description: 'checks a change for risks', prompt: 'Read the files named and list the risks you see.', tools: ['Read', 'mcp__cadre__inspect', 'mcp__cadre__report'] }
const AUDR = { ...AUD, network: 'off', write: [], ttl: '5m', onSilent: 'block', report: { outcomes: [], fields: { answer: { text: 2000 }, citations: { list: 30 } }, required: ['answer'] } }   // the same role as a profile role (the user layer's inline profile)
describe('exit rule 6: no spec can drop an exit tool', () => {
  test('every built-in passes; naming an exit tool in disallowedTools is refused for each built-in and a custom shape', async () => {
    for (const r of ROLES) { expect(exitIssue(ROLES_DEFAULT[r])).toBeNull(); for (const t of EXIT) expect(exitIssue({ ...ROLES_DEFAULT[r], disallowedTools: [t] })).toContain(t) }
    expect(exitIssue({ tools: ['Read', 'mcp__cadre__report'], disallowedTools: ['Bash', 'StructuredOutput'] })).toContain('StructuredOutput')
  })
  test('a tools list that names some exit tools must name all; one that names none is fine (they are added)', async () => {
    expect(exitIssue({ tools: ['Read', 'SubagentHandback'] })).toContain('StructuredOutput'); expect(exitIssue({ tools: ['Read', ...EXIT] })).toBeNull(); expect(exitIssue({ tools: ['Read'] })).toBeNull()
  })
  test('fixed rows: the exit tools and the write scopes', async () => {
    expect(fixedRules().map(r => r[0])).toEqual(['fixed.exitTools', 'fixed.writeScope']); expect(fixedRules()[1][1]).toBe('worker **, tester **, reviewer none, explorer none, planner none, specifier none')
  })
})

// ---- roles of a profile's own: the load checks (core/roles.customIssue; the closed key set and the layers are tests/profile.test.ts) ----
describe('roles of a profile\'s own: the load checks', () => {
  test('known tools, globs, limits, no built-in name; a good spec passes', async () => {
    expect(customIssue('x', { ...AUD, tools: [...AUD.tools, 'Write'], write: ['src/**'], model: 'sonnet', effort: 'low', maxTurns: 5 })).toBeNull()
    for (const c of [{ tools: [...AUD.tools, 'Nope'] }, { tools: ['Read'] }, { write: ['/etc/*'] }, { write: ['../x'] }, { maxTurns: 0 }, { effort: 'max2' }, { network: 'maybe' }, { tools: [...AUD.tools, 'WebFetch'] }]) expect(customIssue('x', { ...AUD, ...c })).not.toBeNull()
    for (const n of ['worker', 'reviewer', 'explorer']) expect(customIssue(n, AUD)).toContain('built-in')
    expect(customIssue('x', { ...AUD, disallowedTools: ['StructuredOutput'] })).toContain('StructuredOutput'); expect(customIssue('x', { ...AUD, tools: [...AUD.tools, 'SubagentHandback'] })).toContain('StructuredOutput')
    expect(Object.keys(agentSpec('x', { ...AUD, permissionMode: 'bypass' })).sort()).toEqual(['description', 'name', 'prompt', 'tools'])   // the AgentSpec is picked, never spread
    expect(agentSpec('x', AUD).tools).toContain('mcp__cadre__report')
  })
  test('a description over 300 bytes is refused; Bash needs network on and write **', async () => {
    expect(customIssue('x', { ...AUD, description: 'd'.repeat(301) })).toContain('description is over 300 bytes'); expect(customIssue('x', { ...AUD, description: 'd'.repeat(300) })).toBeNull()
    const B = { ...AUD, tools: [...AUD.tools, 'Bash'] }
    for (const c of [{}, { network: 'on' }, { network: 'on', write: ['src/**'] }, { write: ['**'] }]) expect(customIssue('x', { ...B, ...c })).toContain('Bash can reach the network and write anywhere')
    expect(customIssue('x', { ...B, network: 'on', write: ['**'] })).toBeNull()
  })
  test('the prompt: 2 KB passes, 2 KB + 1 byte is refused; a leaky one is refused; the leak list is the model-text one', async () => {
    const at = (n: number) => 'a'.repeat(n)
    expect(customIssue('x', { ...AUD, prompt: at(PROMPT_CAP) })).toBeNull(); expect(customIssue('x', { ...AUD, prompt: at(PROMPT_CAP + 1) })).toContain('over 2048 bytes')
    expect(customIssue('x', { ...AUD, prompt: 'é'.repeat(1025) })).toContain('over 2048 bytes')   // bytes, not characters
    expect(customIssue('x', { ...AUD, prompt: 'See core/say.ts for ADR 0024.' })).toContain('not how the tool works')
  })
})

// ---- registration: session.start -> a rejection retried once on the first turn -> a Doctor line; a role is spawned from a later turn than its register's ----
const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const, ENGINE = { timeoutMs: 30_000 }
async function boot($: any, on: any, reject: number) {
  const regs: any[] = [], spawned: any[] = []; let n = 0
  on('session.start', () => ({ cwd: '/work' })); on('session.cwd', () => ({ value: '/work' })); on('session.root', () => ({ value: '/work' })); on('store.set', () => ({ value: undefined }))
  on('env.get', ($: any, e: any) => ({ value: e.name === 'CADRE_STORE' ? 'memory' : undefined })); on('session.version', () => ({ value: { version: '2.1.299' } })); on('store.get', ($: any, e: any) => ({ value: e.key === 'cadre:setup' ? { cc: '2.1.299' } : undefined }))
  on('fs.read', ($: any, e: any) => ({ value: String(e.path).endsWith('.claude/cadre.json') ? JSON.stringify({ profile: { schema: 2, roles: { auditor: AUDR } } }) : '{}' })); on('fs.stat', () => ({ value: undefined })); on('command.register', () => ({ value: undefined })); on('env.set', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } })); on('fs.write', () => ({ value: undefined })); on('ui.log', () => ({ value: undefined })); on('ui.toast', () => ({ value: undefined })); on('tool.register', () => ({ value: undefined })); on('tool.list', () => ({ value: [] }))
  on('agent.register', ($: any, e: any) => { regs.push(e); if (n++ < reject) throw new Error('not bound yet'); return { value: undefined } })
  on('agent.spawn', ($: any, e: any) => { spawned.push(e); return { model: 'haiku' } }); on('turn.start', ($: any, e: any) => e); mock.clock(on)
  await $.session.start(START)
  const spawn = async () => $.agent.spawn({ prompt: 'check the diff', subagentType: 'cadre:auditor' }) as Promise<any>
  return { regs, spawned, spawn }
}
describe('roles of a profile\'s own: registration and spawn', () => {
  test('registered at session start with the whitelisted fields; a same-turn spawn is denied, one from a later turn is started as cadre:auditor', ENGINE, async ($, on) => {
    const { regs, spawned, spawn } = await boot($, on, 0)
    expect(regs.length).toBe(1); expect(regs[0]).toMatchObject({ name: 'auditor', tools: AUD.tools }); expect(Object.keys(regs[0]).sort()).toEqual(['description', 'name', 'prompt', 'tools'])
    expect((await spawn()).deny).toContain('next turn'); expect(spawned).toEqual([])
    await $.turn.start({ turnId: 't1' }); expect((await spawn()).deny).toBeUndefined(); expect(spawned[0].subagentType).toBe('cadre:auditor'); expect(regs.length).toBe(1)
  })
  test('a rejected register is retried once on the first turn: then it is a Doctor line and nothing spawns', ENGINE, async ($, on) => {
    const { regs, spawned, spawn } = await boot($, on, 99)
    expect(regs.length).toBe(1); await $.turn.start({ turnId: 't1' }); expect(regs.length).toBe(2); await $.turn.start({ turnId: 't2' }); expect(regs.length).toBe(2)
    expect((await spawn()).deny).toContain('not available'); expect(spawned).toEqual([])
  })
  test('a ledger left by an earlier session is cleared at start: the role registers again, and no same-turn spawn follows', ENGINE, async ($, on) => {
    const { regs, spawn } = await boot($, on, 0)
    await $.turn.start({ turnId: 't1' }); expect((await spawn()).deny).toBeUndefined()
    await $.session.start(START); expect(regs.length).toBe(2); expect((await spawn()).deny).toContain('next turn')
  })
  test('a register fulfilled by the retry is spawned only from the turn after it', ENGINE, async ($, on) => {
    const { regs, spawn } = await boot($, on, 1)
    await $.turn.start({ turnId: 't1' }); expect(regs.length).toBe(2); expect((await spawn()).deny).toContain('next turn')
    await $.turn.start({ turnId: 't2' }); expect((await spawn()).deny).toBeUndefined()
  })
  test('rule 6 at every register: a spec that drops an exit tool is never handed to the engine', ENGINE, async ($, on) => {
    expect(exitIssue(agentSpec('x', { ...AUD, disallowedTools: ['StructuredOutput'] }))).toContain('StructuredOutput'); expect(exitIssue(agentSpec('x', AUD))).toBeNull()
  })
})

// ---- a spawned custom role runs under its own spec: its tools are the allowlist, its write globs go through writes() ----
describe('profile roles: the guard enforces the role\'s own spec', () => {
  const EDITOR = { description: 'edits the sources', prompt: 'Fix what the request names, inside src.', tools: ['Read', 'Edit', 'mcp__cadre__report'], write: ['src/**'] }
  const WEB = { ...AUD, tools: [...AUD.tools, 'WebFetch'], network: 'on' }
  async function mk(spec: any) {
    const h: any = fakeHost(), E = ['/', '/x', '/x/repo', '/x/repo/src', '/x/repo/docs', '/x/repo/src/a.ts', '/x/repo/docs/a.md', '/x/repo/.git']
    h.stat = async (p: string, o: any) => (E.includes(norm(p)) ? { kind: 'file', realPath: o?.resolve ? norm(p) : undefined } : undefined)
    setRoles({ ...PROFILE_ROLES, r: spec })   // the profile's own role (each test below puts the table back)
    await setPolicy(h, { repo: '/x/repo', wtRoot: '/x', home: '/hm/u' }); await h.ui.update((u: any) => ({ ...u, asks: { ag: { id: 'ask-1', role: 'r', q: 'q', k: 0 } } }))
    return (e: any) => guard(h, { agentId: 'ag', ...e }, (x: any) => ({ ok: x.tool })) as Promise<any>
  }
  test('Edit inside write globs is allowed, outside refused; a tool the role lacks (Bash) is refused; its own report passes', async () => {
    const call = await mk(EDITOR)
    expect(await call({ tool: 'Edit', file_path: '/x/repo/src/a.ts' })).toEqual({ ok: 'Edit' })
    expect((await call({ tool: 'Edit', file_path: '/x/repo/docs/a.md' })).deny).toContain('your role allows')
    expect((await call({ tool: 'Edit', file_path: '/x/repo/.git/x' })).deny).toBeDefined()
    expect((await call({ tool: 'Bash', command: 'ls' })).deny).toContain('not available')
    expect(await call({ tool: 'mcp__cadre__report' })).toEqual({ ok: 'mcp__cadre__report' })
    expect((await call({ tool: 'Write', file_path: '/x/repo/src/a.ts' })).deny).toContain('not available'); setRoles(PROFILE_ROLES)
  })
  test('a read-only role is refused Write; network off refuses WebFetch, network on allows it', async () => {
    const ro = await mk(AUD); expect((await ro({ tool: 'Write', file_path: '/x/repo/src/a.ts' })).deny).toContain('not available'); expect((await ro({ tool: 'WebFetch' })).deny).toContain('not available')
    expect(await (await mk(WEB))({ tool: 'WebFetch' })).toEqual({ ok: 'WebFetch' })
    expect((await (await mk({ ...WEB, network: 'off' }))({ tool: 'WebFetch' })).deny).toContain('not available'); setRoles(PROFILE_ROLES)   // a spec that slipped past load is still refused
  })
})

describe('a cadre agent\'s Bash call goes on with the install caches in a folder of its own, for that one shell', () => {
  const host = async () => { const h: any = fakeHost(); await h.bind.update((b: any) => ({ ...b, ag1: { role: 'worker', taskId: 'c-1-1', worktree: '/x/wt' } })); return h }
  test('a bound agent\'s Bash gets the cache prefix in front of its own command, untouched; main, other tools and agents cadre did not start are unchanged', async () => {
    const h = await host(), e = { tool: 'Bash', agentId: 'ag1', command: 'npm install ms && npm test', description: 'x', timeout: 5 }, r = await shelled(h, e)
    expect(r.command).toBe(`${cachePrefix()}npm install ms && npm test`); expect(r).toMatchObject({ tool: 'Bash', agentId: 'ag1', description: 'x', timeout: 5 })
    expect(r.command).not.toContain('offline')   // what the shell does with it: tests/git/shell.test.mjs
    expect(e.command).toBe('npm install ms && npm test')   // the original event is not edited
    for (const x of [{ tool: 'Bash', command: 'ls' }, { tool: 'Bash', agentId: 'stranger', command: 'ls' }, { tool: 'Read', agentId: 'ag1', file_path: 'a' }, { tool: 'PowerShell', agentId: 'ag1', command: 'ls' }, { tool: 'Bash', agentId: 'ag1' }]) expect(await shelled(h, x)).toBe(x)
  })
  test('through the guard: the next hook receives the prefixed command (also when the guard only advises)', async () => {
    const h: any = fakeHost(); await h.bind.update((b: any) => ({ ...b, ag1: { role: 'worker', taskId: 'c-1-1', worktree: '/x/wt', step: 'worker' } }))
    h.config = async () => ({ strictness: 'advisory' }); await setPolicy(h, { repo: '/x/repo', wtRoot: '/x', home: '/hm/u' })
    const seen: any[] = []; await guard(h, { tool: 'Bash', agentId: 'ag1', command: 'ls' }, (x: any) => { seen.push(x); return {} })
    expect(seen.length).toBe(1); expect(seen[0].command === 'ls' || seen[0].command === `${cachePrefix()}ls`).toBe(true)
  })
})

describe('B5: an agent that needs something it cannot get reports blocked; nobody asks a helper', () => {
  test('outcome request is refused by shape for every role that took it, and no role has canRequest', () => {
    for (const r of [{ role: 'worker', outcome: 'request', summary: 'x' }, { role: 'tester', outcome: 'request', summary: 'x', tests: [] }, { role: 'planner', outcome: 'request' }, { role: 'worker', outcome: 'done', summary: 'x', request: {} }])
      expect(reportRefusal({ schemaVersion: 1, ...r })).toMatchObject({ code: 'shape' })
    expect(reportRefusal({ schemaVersion: 1, role: 'worker', outcome: 'blocked', summary: 'x', reason: 'needs a package' })).toBeNull()
    for (const r of Object.values(ROLES_DEFAULT)) expect(r).not.toHaveProperty('canRequest')
    expect(check({ roles: { x: { ...AUDR, canRequest: ['explore'] } } })).toContain('canRequest: unknown key')
    const rep = SPECS.find(t => t.name === 'report')!   // the tool schema the model sees offers no request either
    expect((rep.inputSchema as any).properties.outcome.enum).toEqual(['done', 'blocked', 'spec_change'])
    expect((rep.inputSchema as any).properties).not.toHaveProperty('request')
  })
})

// ---- S4: the work roles are the profile's data; one table feeds the agent files, the report form, the exit rule and the main-agent guard ----
import { roleSpecs, setRoles } from '../core/roles'
import { mainAgent } from '../core/plantools'
import { PROMPTS } from '../agents/prompts'

describe('roles as profile data (S4)', () => {
  const critic = { description: 'critic', prompt: 'p', tools: ['Read', 'mcp__cadre__report'], network: 'off' as const, write: [], ttl: '5m' as const, onSilent: 'block' as const, report: { outcomes: [], fields: { note: 'text' as const }, required: ['note'] } }
  test('every built-in prompt is the one in agents/prompts.ts (the source of truth); ROLES_DEFAULT is the profile\'s roles plus the planning roles', () => {
    for (const r of ['worker', 'tester', 'reviewer', 'explorer'] as const) expect(ROLES_DEFAULT[r].prompt).toBe(PROMPTS[r])
    expect(Object.keys(ROLES_DEFAULT)).toEqual([...Object.keys(PROFILE_ROLES), 'planner', 'specifier']); expect(Object.keys(roleSpecs())).toEqual(['worker', 'tester', 'reviewer', 'explorer'])
  })
  test('the exit-tool rule holds for every spec of the table and for a custom one: no spec drops or disallows an exit tool', () => {
    for (const s of [...Object.values(PROFILE_ROLES), critic]) { expect(exitIssue(s)).toBeNull(); for (const t of EXIT) expect(exitIssue({ ...s, disallowedTools: [t] })).toContain(t) }
    expect(customIssue('critic', { description: 'd', prompt: 'p', tools: ['Read', 'mcp__cadre__report', 'SubagentHandback'] })).toContain('StructuredOutput')
  })
  test('the main-agent guard is generated from the steps: the role of a step is main\'s to plan around, any other cadre: name (a role no step runs) is a role of main\'s', () => {
    const call = (n: string) => mainAgent({ tool: 'Agent', subagent_type: `cadre:${n}`, prompt: 'look into it' }, [])
    for (const n of ['worker', 'tester', 'reviewer', 'explorer', 'planner']) expect(call(n)).toHaveProperty('deny')
    expect(call('critic')).toBeUndefined()
    setProfile({ ...DEFAULT, roles: { ...PROFILE_ROLES, critic }, steps: { ...DEFAULT.steps, verify: { role: 'critic', workspace: 'none', brief: [] } } }); try { expect(call('critic')).toHaveProperty('deny') } finally { setProfile(DEFAULT) }   // a role some step runs is that step's
  })
})
