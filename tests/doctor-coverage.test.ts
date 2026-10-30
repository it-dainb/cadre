import { expect, test } from 'claude-code/testing'
import { doctor, machine, setupItems } from '../commands/doctor'
import { scoped } from '../commands/init'
import { qk } from '../core/session'
import { defaults } from '../config/index'
import { BUDGET } from './fixtures/budget.generated'
import { fakeHost, task } from './support'
import type { Host } from '../types'

// Coverage by produced rows (ADR 0030): the table is whatever machine() and doctor() print over these fixture hosts, not a count of call sites.
type R = { exitCode: number; stdout: string; stderr: string }
const HOME = '/hm/u', USER = `${HOME}/.claude/settings.json`
const GIT = 'git version 2.43.0', ALL = { git: GIT, bwrap: 'bubblewrap 0.11.0', socat: 'socat version 1.8' }
type O = { tools?: Record<string, string>; jail?: 'overlay' | 'copy' | 'none'; cc?: string; files?: Record<string, string>; env?: Record<string, string>; repo?: boolean; noIdent?: boolean; wtFail?: boolean; noVersion?: boolean; ghOut?: number | 'missing'; quarantine?: boolean; branches?: boolean }
function mk(o: O = {}) {
  const files = { ...o.files }, tools = o.tools ?? ALL
  const h = fakeHost({ files, env: o.env }) as Host & { toasts: string[] }
  void h.store.set('cadre:prefs', { at: 0 })
  Object.assign(h, {
    cwd: async () => '/repo', home: async () => HOME, version: async () => (o.noVersion ? '' : o.cc ?? '2.1.295'), write: async (p: string, t: string) => { files[p] = t },
    stat: async (p: string) => (p === '/hm' || p === '/' || p === HOME || p === `${HOME}/.cache` || p.startsWith(`${HOME}/.cache/cadre`) ? { kind: 'dir' } : undefined),
    run: async (argv: string[]): Promise<R> => {
      const j = argv.join(' '), out = (stdout: string, exitCode = 0): R => ({ exitCode, stdout, stderr: '' })
      if (argv[0] === 'test') return out('', o.wtFail ? 1 : 0)
      if (argv[0] === 'chmod') return out('')
      if (argv[0] === 'sh') return out(argv[2] === 'command -v bwrap' ? '/usr/bin/bwrap' : '')
      if (argv[0] === 'bwrap') return !tools.bwrap || (o.jail === 'none' && argv[1] !== '--version') ? out('', 127) : argv[1] === '--help' ? out(o.jail === 'copy' ? 'usage' : '--overlay-src') : out(tools.bwrap)
      if (argv[0] === 'gh') return o.ghOut === 'missing' ? out('', 127) : out('gh version 2.60.0', argv[1] === 'auth' ? Number(o.ghOut ?? 0) : 0)
      if (argv[0] === 'git' && argv[1] === 'var') return o.noIdent ? { exitCode: 128, stdout: '', stderr: 'fatal' } : out('Ann <a@b> 1 +0000')
      if (argv[0] === 'git' && argv[1] === 'config') return out('', 1)
      if (argv[0] === 'git' && j.includes('for-each-ref')) return out(o.quarantine ? 'refs/cadre/quarantine/x\n' : '')
      if (argv[0] === 'git') return argv[1] === '--version' ? (tools.git ? out(tools.git) : out('', 127)) : o.repo && j.includes('rev-parse --git-dir') ? out('.git') : out('', 1)
      if (tools[argv[0]]) return out(tools[argv[0]])
      return out('', 127)
    },
  })
  return Object.assign(h, { files })
}
const doctorRowsOf = async (h: Host) => { await doctor(h); return (await h.ui.read())['doctor.rows'] as [string, string, string?][] }

// fixture hosts: machine facts, then project and runtime states
const hosts: [string, () => Promise<[string, string, string?][]>][] = []
const machineHost = (name: string, o: O) => hosts.push([name, async () => (await machine(mk(o), defaults() as any)).rows]), doctorHost = (name: string, o: O, tweak?: (h: Host) => Promise<void> | void) => hosts.push([name, async () => { const h = mk(o); await tweak?.(h); return doctorRowsOf(h) }])
const NOGIT = { bwrap: ALL.bwrap, socat: ALL.socat }, NOBWRAP = { git: GIT, socat: ALL.socat }, NOSOCAT = { git: GIT, bwrap: ALL.bwrap }
machineHost('healthy', {})
machineHost('no tools', { tools: {} }); machineHost('no git', { tools: NOGIT }); machineHost('old git', { tools: { ...ALL, git: 'git version 2.10.0' } }); machineHost('no bwrap', { tools: NOBWRAP }); machineHost('no socat', { tools: NOSOCAT })
machineHost('copy jail', { jail: 'copy' }); machineHost('no namespaces', { jail: 'none' })
machineHost('apparmor', { jail: 'none', files: { '/proc/sys/kernel/apparmor_restrict_unprivileged_userns': '1\n' } }); machineHost('userns clone 0', { jail: 'none', files: { '/proc/sys/kernel/unprivileged_userns_clone': '0' } })
machineHost('claude newer', { cc: '2.1.310' }); machineHost('claude older than tested', { cc: '2.1.297' }); machineHost('claude too old', { cc: '2.1.287' }); machineHost('claude 2.1.296', { cc: '2.1.296' })
machineHost('worktree root not writable', { wtFail: true }); machineHost('claude version unreadable', { noVersion: true })
machineHost('no git identity', { noIdent: true })
doctorHost('not a repo, sudo fix not prepared', { jail: 'none', files: { '/proc/sys/kernel/apparmor_restrict_unprivileged_userns': '1\n' } })
doctorHost('start failed', {}, async h => { await h.secret.update((x: any) => ({ ...x, start: { failed: 'Error: slow' } })) })
doctorHost('dormant repo', { repo: true }, async h => { await h.secret.update(x => ({ ...x, active: false })) })
doctorHost('dormant repo with leftover gate keys', { repo: true, files: { '/repo/.claude/settings.local.json': JSON.stringify({ env: { CLAUDE_CODE_ENABLE_TASKS: 'false' } }) } }, async h => { await h.secret.update(x => ({ ...x, active: false })); await h.store.set('cadre:scope:settings', { rev: 1, added: ['CLAUDE_CODE_ENABLE_TASKS'] }) })
doctorHost('repo, not initialised', { repo: true })
doctorHost('user settings carry the todo flag', { files: { [USER]: '{"env":{"CLAUDE_CODE_ENABLE_TODO_TOOLS":"1"}}' } })
doctorHost('user settings unreadable', { files: { [USER]: '{' } })
doctorHost('tools refused', { repo: true }, async h => { await h.secret.update(x => ({ ...x, tools: { on: [], refused: ['plan'] } })) })
doctorHost('planning tools not loaded yet', { repo: true }, async h => { await h.secret.update(x => ({ ...x, tools: { on: ['report'], refused: [] } })) })
doctorHost('built-in task tools on', { repo: true }, async h => { await h.secret.update(x => ({ ...x, tools: { on: ['plan'], refused: [], task: ['TaskCreate'] } })) })
doctorHost('pane could not open', {}, async h => { await h.ui.update(u => ({ ...u, paneErr: { at: 1, reason: 'no pane surface' } })) })
doctorHost('refused setting and effort override', { files: { [`${HOME}/.claude/cadre.json`]: '{"drive":{"mode":"fast"}}' }, env: { CLAUDE_CODE_EFFORT_LEVEL: 'low' } })
doctorHost('older task store', { repo: true }, h => { const st = h.stat; Object.assign(h, { stat: async (p: string) => (p === '/repo/.beads' ? { kind: 'dir' } : st(p)) }) })
doctorHost('older store folder', { repo: true }, h => { const st = h.stat; Object.assign(h, { stat: async (p: string) => (p === '/repo/.cadre/store' ? { kind: 'dir' } : st(p)) }) })
doctorHost('sync target does not answer', { repo: true }, h => { const c = defaults() as any; c.sync = { tracker: { adapter: 'nope' } }; Object.assign(h, { config: async () => c }) })
doctorHost('task store probe fails', { repo: true }, h => { Object.assign(h, { taskStore: async () => ({ probe: async () => ({ ok: false, journal: false, version: 'file', detail: 'hard links fail' }) }) }) })
doctorHost('task store unreachable', { repo: true }, h => { Object.assign(h, { taskStore: async () => { throw new Error('boom') } }) })
doctorHost('task store journal off', { repo: true }, h => { Object.assign(h, { taskStore: async () => ({ probe: async () => ({ ok: true, journal: false, version: 'file', detail: '' }), list: async () => [] }) }) })
doctorHost('older run state', { repo: true }, async h => { await h.ui.update(u => ({ ...u, handed: {} })) })
doctorHost('branches missing, open flags, shape flag', { repo: true }, async h => { await h.board.update(b => ({ ...b, tasks: [task('c-8-1', { state: 'blocked', flags: ['shape'] })] })) })
doctorHost('quarantined refs', { repo: true, quarantine: true })
doctorHost('repo profile refused', {}, async h => { await h.secret.update((x: any) => ({ ...x, profileBad: 'repo profile: colour: unknown key; sections: schema, types' })) })
doctorHost('custom role rejected twice', {}, async h => { await h.secret.update((x: any) => ({ ...x, roles: { failed: { qa: { n: 2, why: 'no tools' } } } })) })
doctorHost('unknown injected tools', { repo: true }, async h => { await h.store.set(await scoped(h, 'injected'), ['Foo']) })
doctorHost('run and sync state of an older version', { repo: true }, async h => { await h.store.set(await scoped(h, 'runs'), {}) })
doctorHost('resumes queued', { repo: true }, async h => { await h.store.set(await qk(h), [{}]) })
doctorHost('drive stopped', { repo: true }, async h => { await h.board.update(b => ({ ...b, drive: { ...b.drive, stopped: 'bound hit' } })) })
doctorHost('drive paused', { repo: true }, async h => { await h.board.update(b => ({ ...b, drive: { ...b.drive, paused: 'a flag is open' } })) })

// the JUnit probe rows (D15, D16): read from the store, never run from Doctor
const U = (checks: Record<string, string[]>) => ({ ...defaults() as any, units: [{ root: '.', checks, tdd: { paths: ['t/**'] } }] }), JK = async (h: Host) => scoped(h, 'junit:.')
doctorHost('junit probe: yes', { repo: true }, async h => { const c = U({ test: ['t', '$CADRE_JUNIT'] }); Object.assign(h, { config: async () => c }); await h.store.set(await JK(h), { ok: true, argv: ['t', '$CADRE_JUNIT'] }) })
doctorHost('junit probe: no', { repo: true }, async h => { const c = U({ test: ['t'] }); Object.assign(h, { config: async () => c }); await h.store.set(await JK(h), { ok: false, argv: ['t'] }) })
doctorHost('junit probe: stale argv', { repo: true }, async h => { const c = U({ test: ['t', '-x'] }); Object.assign(h, { config: async () => c }); await h.store.set(await JK(h), { ok: true, argv: ['t'] }) })
doctorHost('junit probe: not probed', { repo: true }, h => { const c = U({ test: ['t'] }); Object.assign(h, { config: async () => c }) })
doctorHost('no test check', { repo: true }, h => { const c = U({ lint: ['l'] }); Object.assign(h, { config: async () => c }) })

const all = async () => (await Promise.all(hosts.map(async ([n, f]) => (await f()).map(r => [n, r] as const)))).flat()
// a fix names a path of the host in two rows; the doc carries the text without it
const stable = (fix: string) => fix.replace(/^! /, '').replace(/ of \/\S+$/, '')

// non-ok rows that state a fact and carry no fix of their own (changing that would change text the setup checklist hands to Claude); each phrase must still be in the doc
const INFO: [RegExp, string][] = [
  [/^Claude Code version unreadable$/, 'Claude Code version unreadable'], [/^Claude Code \S+: newer than the tested/, 'newer than the tested'], [/^custom role \S+ is not available/, 'is not available:'], [/^tools Claude Code gave the agents/, 'tools Claude Code gave the agents that cadre does not know'],
  [/^an agent that is done is ended by cadre itself/, 'an agent that is done is ended by cadre itself'], [/^test check writes JUnit: not probed on this machine/, 'not probed on this machine'],
]
test('every non-ok row over the fixture hosts has fix text, and that text is in docs/troubleshooting.md', async () => {
  const bad = (await all()).filter(([, r]) => r[0] !== 'ok'), doc = BUDGET.docs.troubleshooting
  expect(bad.length).toBeGreaterThan(30)
  const bare = bad.filter(([, r]) => !r[2]), info = INFO.map(([re, phrase]) => ({ re, phrase }))
  expect(bare.filter(([, r]) => !info.some(i => i.re.test(r[1]))).map(([n, r]) => `${n}: ${r[1]}`)).toEqual([])
  expect(info.filter(i => !doc.includes(i.phrase)).map(i => i.phrase)).toEqual([])
  expect([...new Set(bad.filter(([, r]) => r[2]).map(([, r]) => stable(r[2]!)).filter(f => !doc.includes(f)))]).toEqual([])
})
test('the healthy machine is all ok; the table has fails and warns for tools, jail, versions and runtime states', async () => {
  const rows = await all()
  expect(rows.filter(([n]) => n === 'healthy').every(([, r]) => r[0] === 'ok')).toBe(true)
  expect(rows.filter(([, r]) => r[0] === 'crit').length).toBeGreaterThan(8); expect(rows.filter(([, r]) => r[0] === 'warn').length).toBeGreaterThan(15)
})
test('the hosts for the less common rows do produce them', async () => {
  const lines = (await all()).map(([, r]) => r[1])
  for (const re of [/^worktree root .* is not writable/, /^Claude Code version unreadable/, /^\.cadre\/store: a task store/, /^sync tracker: /]) expect(lines.some(l => re.test(l))).toBe(true)
})
test('D15/D16: Doctor reads the stored probe and probes nothing: rows for yes, no, stale, unprobed and none; no test argv or $CADRE_JUNIT reaches h.run', async () => {
  const rs = async (n: string) => (await all()).filter(([m, r]) => m === n && /test check/.test(r[1])).map(([, r]) => r)
  expect(await rs('junit probe: yes')).toEqual([['ok', 'test check writes JUnit: yes', undefined]]); expect(await rs('junit probe: no')).toEqual([['warn', 'test check writes JUnit: no: red checks use the exit code only', 'rerun /cadre init']])
  expect(await rs('junit probe: stale argv')).toEqual([['warn', 'test check writes JUnit: no: red checks use the exit code only', 'rerun /cadre init']])
  expect(await rs('junit probe: not probed')).toEqual([['warn', 'test check writes JUnit: not probed on this machine: rerun /cadre init', undefined]]); expect(await rs('no test check')).toEqual([['ok', 'test check: none: the first feature/bug task sets one up', undefined]])
  const h = mk({ repo: true }), c = U({ test: ['probe-me', '$CADRE_JUNIT'] }), calls: string[][] = [], run = h.run; Object.assign(h, { config: async () => c, run: async (a: string[]) => { calls.push(a); return run(a) } })
  await doctor(h); expect(calls.some(a => a.join(' ').includes('probe-me') || a.join(' ').includes('CADRE_JUNIT') || a[0] === 'stat')).toBe(false)
})
