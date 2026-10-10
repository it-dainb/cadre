import { describe, expect, test } from 'claude-code/testing'
import { discovered, repoKeyOf, rootFor, run, wire } from '../commands/init'
import { fakeHost } from './support'
import { MemoryStore } from '../task-management/adapters/memory/store'
import { fnv1a64 } from '../core/board'
import { ofEpic } from '../core/events'
import { skeleton } from '../core/changelog'
import type { Host } from '../types'
import { policyOf } from '../policy/guards'

type R = { exitCode: number; stdout?: string; stderr?: string }
const ROOT = '/repo', HOME = '/home/u', RK = repoKeyOf(ROOT)
// In-memory repo + fs behind a scripted process.run; `extra` answers non-git argv (jailed runs, find, ...).
function mk(o: { repo?: boolean; branches?: string[]; files?: Record<string, string>; extra?: (argv: string[]) => R | undefined } = {}) {
  const files = { ...o.files }, g = { repo: o.repo ?? true, branches: new Set(o.branches ?? ['main', 'dev']) }, calls: string[][] = []
  const h = fakeHost({ files }) as Host & { logs: string[] }
  let n = 0
  Object.assign(h, {
    rand: () => `n${++n}`.padEnd(16, '0'), cwd: async () => ROOT, home: async () => HOME,
    settings: async () => JSON.parse(files[`${ROOT}/.claude/settings.local.json`] ?? '{}'),
    run: async (argv: string[]) => {
      calls.push(argv); const j = argv.join(' '), ok = (stdout = ''): R => ({ exitCode: 0, stdout, stderr: '' }), bad = (): R => ({ exitCode: 128, stdout: '', stderr: 'fatal: nope' })
      const x = o.extra?.(argv); if (x) return { stdout: '', stderr: '', ...x }
      if (argv[0] !== 'git') return ok()
      if (j === 'git rev-parse --git-dir') return g.repo ? ok('.git') : bad()
      if (j === 'git rev-parse --git-path info/exclude') return ok('.git/info/exclude')
      if (argv[1] === 'rev-parse' && argv[2] === '--verify') return g.branches.has(argv[3]) ? ok('sha') : bad()
      if (argv[1] === 'symbolic-ref') return bad()
      if (j === 'git branch --show-current') return ok('main')
      if (argv[1] === 'init') { g.repo = true; return ok() }
      if (argv[1] === 'commit') { g.branches.add('main'); return ok() }
      if (argv[1] === 'branch') { g.branches.add(argv[2]); return ok() }
      return ok()
    },
  })
  const code = async () => (await h.secret.read()).initConfirm?.code as string
  return { h, files, g, calls, code }
}
const store = () => { const s = new MemoryStore(); wire.store = async () => s; return s }

describe('init: confirm discipline (DESIGN 10.1)', () => {
  test('propose -> diff -> confirm -> .bak -> save; the code is nonce-salted and never printed', async () => {
    const { h, files, code } = mk({ files: { [`${ROOT}/CHANGELOG.md`]: undefined as any } }); delete files[`${ROOT}/CHANGELOG.md`]
    const out = await run(h, ['7'])
    expect(out).toContain('KAC 1.1.0 skeleton'); expect(files[`${ROOT}/CHANGELOG.md`]).toBeUndefined()
    const c = await code(), s = await h.secret.read(), text = out.split('\n\nConfirm')[0]
    expect(c).toBe(fnv1a64(s.initNonce + text).slice(0, 8)); expect(out).not.toContain(c)
    const done = await run(h, ['confirm', c]); expect(done).toContain('changelog ok')
    expect(files[`${ROOT}/CHANGELOG.md`]).toBe(skeleton()); expect((await h.secret.read()).initConfirm).toBeUndefined()
  })
  test('wrong code refused, burned, nonce redrawn; the old code is dead; a new diff is shown', async () => {
    const { h, files, code } = mk(); await run(h, ['7'])
    const c1 = await code(), n1 = (await h.secret.read()).initNonce
    const out = await run(h, ['confirm', 'deadbeef'])
    expect(out).toContain('wrong code (burned)'); expect(files[`${ROOT}/CHANGELOG.md`]).toBeUndefined()
    const c2 = await code(); expect(c2).not.toBe(c1); expect((await h.secret.read()).initNonce).not.toBe(n1)
    expect(await run(h, ['confirm', c1])).toContain('wrong code'); expect(files[`${ROOT}/CHANGELOG.md`]).toBeUndefined()
    expect(await run(h, ['confirm', await code()])).toContain('changelog ok')   // an accepted attempt also burns
    expect(await run(h, ['confirm', c2])).toContain('nothing pending')
  })
  test('changed bytes since the diff: nothing written, re-shown with a new code; then .bak holds the changed bytes', async () => {
    const { h, files, code } = mk({ files: { [`${ROOT}/.cadre/config.json`]: '{"maxParallel":2}' } })
    const out = await run(h, ['6']); expect(out).toContain('types')
    const c1 = await code(); files[`${ROOT}/.cadre/config.json`] = '{"maxParallel":2,"ui":{"glyphs":"ascii"}}'
    const re = await run(h, ['confirm', c1]); expect(re).toContain('files changed since the diff'); expect(files[`${ROOT}/.cadre/config.json.bak`]).toBeUndefined()
    expect(files[`${ROOT}/.cadre/config.json`]).toBe('{"maxParallel":2,"ui":{"glyphs":"ascii"}}')
    const c2 = await code(); expect(c2).not.toBe(c1)
    expect(await run(h, ['confirm', c2])).toContain('workflow profile saved')
    expect(files[`${ROOT}/.cadre/config.json.bak`]).toBe('{"maxParallel":2,"ui":{"glyphs":"ascii"}}')
    expect(JSON.parse(files[`${ROOT}/.cadre/config.json`]).ui.glyphs).toBe('ascii')
  })
  test('no event, view or snapshot ever carries the code', async () => {
    const { h, code } = mk(); await run(h, ['7']); const c = await code(); await run(h, ['confirm', c])
    expect(JSON.stringify(await h.events.read())).not.toContain(c); expect(JSON.stringify(await h.board.read())).not.toContain(c)
    expect(ofEpic(await h.events.read(), '').map(e => e.data.state)).toEqual(['proposed', 'done'])
    expect((await h.board.read()).init).toEqual([{ stage: 7, state: 'done' }])
  })
  test('bare /cadre init runs the next incomplete stage; unknown stage and empty confirm are told', async () => {
    const { h } = mk({ files: { [`${ROOT}/.cadre/config.json`]: '{"branches":{"main":"main"}}' } }); store()
    expect(await run(h, ['confirm', 'x'])).toContain('nothing pending')
    expect(await run(h, ['9'])).toContain('unknown stage')
    expect(await run(h, [])).toContain('init 2 store')
  })
})

describe('stage 1 repo', () => {
  test('non-repo: git init + initial commit + dev branch + exclude + config; re-run is idempotent', async () => {
    const { h, files, calls, code } = mk({ repo: false, branches: [] })
    const out = await run(h, ['1']); expect(out).toContain('git init -b main'); expect(out).toContain('.beads/')
    const done = await run(h, ['confirm', await code()]); expect(done).toContain('main=main, dev=dev')
    expect(calls.filter(a => a[0] === 'git' && ['init', 'add', 'commit', 'branch'].includes(a[1])).map(a => a.slice(1, 3).join(' '))).toEqual(['init -b', 'add -A', 'commit --allow-empty', 'branch dev'])
    expect(files[`${ROOT}/.git/info/exclude`]).toBe('.beads/\n.claude/settings.local.json\n')
    expect(JSON.parse(files[`${ROOT}/.cadre/config.json`]).branches).toEqual({ main: 'main', dev: 'dev' })
    const before = { ...files }; calls.length = 0
    expect(await run(h, ['1'])).toContain('repo ready'); expect(files).toEqual(before)   // nothing to change: applied without a code, no new .bak
    expect(calls.some(a => a[1] === 'init')).toBe(false)
    expect((await h.secret.read()).initConfirm).toBeUndefined()
  })
  test('existing repo without origin/HEAD uses the current branch; detached with no origin asks', async () => {
    const { h, code } = mk({ branches: ['trunk'], extra: a => a.join(' ') === 'git branch --show-current' ? { exitCode: 0, stdout: 'trunk' } : undefined })
    const out = await run(h, ['1']); expect(out).toContain('git branch dev trunk')
    expect(await run(h, ['confirm', await code()])).toContain('main=trunk')
    const d = mk({ extra: a => a.join(' ') === 'git branch --show-current' ? { exitCode: 0, stdout: '' } : undefined })
    expect(await run(d.h, ['1'])).toContain('run /cadre init 1 <branch>')
    expect(await run(d.h, ['1', 'main'])).toContain('proposed')
  })
})

describe('stage 2 store', () => {
  test('probe, init with journal consent, round trip (create a draft, read it, drop it)', async () => {
    const s = store(), { h, code } = mk()
    const out = await run(h, ['2']); expect(out).toContain('bd init --non-interactive --skip-agents --skip-hooks'); expect(out).toContain('journal consent')
    expect((await s.probe()).journal).toBe(false)
    expect(await run(h, ['confirm', await code()])).toContain('round trip ok')
    expect((await s.probe()).journal).toBe(true)
    expect(await run(h, ['2'])).toContain('store ready')   // complete -> applied directly
  })
  test('an unavailable store is refused with the reason', async () => {
    wire.store = async () => ({ probe: async () => ({ ok: false, journal: false, version: '1.2.0', detail: 'bd 1.2.0 < 1.3.0' }) }) as any
    expect(await run(mk().h, ['2'])).toContain('bd 1.2.0 < 1.3.0')
  })
})

describe('stage 3 mission', () => {
  test('queues a request; complete when the board has a mission', async () => {
    const { h } = mk(); const out = await run(h, ['3'])
    expect(out).toContain('mission request queued'); expect((await h.ui.read()).initRequest).toBe('mission')
    await h.board.update(b => ({ ...b, mission: 'm-1' })); expect(await run(h, ['3'])).toContain('mission request queued')
  })
})

// bwrap jail answer by mode: setup = no flag, check = --unshare-net, home = --overlay.
const REPORT = { citations: [{ path: '.github/workflows/ci.yml', line: 9 }], discovery: { packages: [{ root: '.', setup: ['npm', 'ci'], checks: { test: ['npm', 'test'], lint: ['npm', 'run', 'lint'], e2e: ['npm', 'run', 'e2e'] }, fetches: ['e2e'], tdd: { paths: ['test/**'] } }] } }
const jailed = (o: { setup?: number } = {}) => (argv: string[]): R | undefined => {
  if (argv[0] === 'bwrap' && !argv.includes('--')) return { exitCode: 0, stdout: argv[1] === '--help' ? '--overlay-src --tmp-overlay' : '' }   // jailMode probes
  if (argv[0] === 'find') return { exitCode: 0, stdout: './.cache\n./.cache/pnpm\n./.cargo\n./.cargo/target\n./.cargo/registry\n' }
  if (argv[0] !== 'bwrap') return undefined
  const inner = argv.slice(argv.indexOf('--', 3) + 1).join(' ')
  if (inner === 'npm ci') return { exitCode: o.setup ?? 0 }
  return { exitCode: inner === 'npm test' ? 0 : 1 }
}
describe('stage 4 discovery', () => {
  const ready = () => {
    const s = store(); const t = mk({ extra: jailed(), files: { [`${ROOT}/.cadre/config.json`]: '{"branches":{"main":"main","dev":"dev"}}' } })
    return { s, ...t }
  }
  test('needs stages 1-2; without a report it queues the explorer request', async () => {
    const s = store(); const bare = mk({ branches: [] }); expect(await run(bare.h, ['4'])).toContain('run stages 1 and 2 first'); void s
    const { h, s: st } = ready(); await st.init({ types: {} as any, journal: true })
    expect(await run(h, ['4'])).toContain('discovery requested'); expect((await h.ui.read()).initRequest).toBe('discovery')
    expect((await h.board.read()).init).toEqual([{ stage: 4, state: 'pending' }])   // briefs, admission and tools open the explorer's report on this (live: 'no discovery request is open')
  })
  test('malformed report refused with an example; sequence: diff 2 (caches, knownRed, fetches warning) -> validate in jail -> save only validated', async () => {
    const { h, s, files, calls, code } = ready(); await s.init({ types: {} as any, journal: true })
    expect(await discovered(h, { ...REPORT, discovery: { packages: [{ root: '/abs' }] } })).toContain('.root')
    expect(await discovered(h, { discovery: { packages: [] }, citations: [] })).toContain('discovery.packages')
    expect(await discovered(h, { ...REPORT, discovery: { packages: [{ ...REPORT.discovery.packages[0], root: '../x' }] } })).toContain('root')
    expect(await discovered(h, REPORT)).toBeNull()
    const out = await run(h, ['4'])
    expect(out).toContain('~/.cache/pnpm'); expect(out).toContain('~/.cargo/registry'); expect(out).not.toContain('target')
    expect(out).toContain('! e2e: fetches at test time'); expect(out).toContain('? lint: red at the clean base -> knownRed')
    const audit = calls.filter(a => a[0] === 'bwrap' && a.includes('--'))
    expect(audit[0]).toContain('--overlay-src'); expect(audit[0]).toContain(`${HOME}`); expect(audit.slice(1).every(a => a.includes('--unshare-net'))).toBe(true)
    expect(files[`${ROOT}/.cadre/config.json`]).not.toContain('packages')   // nothing saved before confirm
    calls.length = 0
    const done = await run(h, ['confirm', await code()]); expect(done).toContain('discovery saved: .'); expect(done).toContain('! .:e2e needs the network; not saved')
    const setup = calls.find(a => a[0] === 'bwrap' && a.includes('npm') && a.includes('ci'))!
    expect(setup).not.toContain('--unshare-net'); expect(setup).toContain(`${HOME}/.cache/pnpm`)   // writable jail with the confirmed binds
    expect(calls.filter(a => a[0] === 'bwrap' && a.includes('--unshare-net')).map(a => a.slice(-3).join(' '))).toEqual(['-- npm test', 'npm run e2e'])   // knownRed lint not run; e2e runs, fails offline, is dropped
    const repo = JSON.parse(files[`${ROOT}/.cadre/config.json`]), user = JSON.parse(files[`${HOME}/.claude/cadre.json`]), set = JSON.parse(files[`${ROOT}/.claude/settings.local.json`])
    expect(repo.packages).toEqual([{ root: '.', setup: ['npm', 'ci'], checks: { test: ['npm', 'test'], lint: ['npm', 'run', 'lint'] }, verify: ['test'], tdd: { paths: ['test/**'] } }])
    expect(user.repos[RK].packages).toEqual([{ root: '.', knownRed: ['lint'] }]); expect(user.repos[RK].jailWritable).toEqual([`${HOME}/.cache/pnpm`, `${HOME}/.cargo/registry`])
    expect(set.sandbox.filesystem.allowWrite).toEqual([`${HOME}/.cache/pnpm`, `${HOME}/.cargo/registry`])
    expect(JSON.stringify(repo)).not.toContain('knownRed'); expect(JSON.stringify(repo)).not.toContain('e2e')
    expect((await s.list({})).some(t => t.title === 'fix known-red lint')).toBe(true)
  })
  test('a failing setup is refused before any diff', async () => {
    const bad = mk({ extra: jailed({ setup: 1 }), files: { [`${ROOT}/.cadre/config.json`]: '{"branches":{"main":"main","dev":"dev"}}' } }); const s = store(); await s.init({ types: {} as any, journal: true })
    await discovered(bad.h, REPORT); expect(await run(bad.h, ['4'])).toContain('failed in .')
    expect((await bad.h.secret.read()).initConfirm).toBeUndefined()
  })
})

describe('stage 5 containment', () => {
  test('settings merge diff -> confirm -> .bak -> contained; policy keys written; optional allowlist hunk', async () => {
    const { h, files, code } = mk({ files: { [`${ROOT}/.claude/settings.local.json`]: '{"permissions":{"allow":["Read"]}}' } })
    const out = await run(h, ['5']); expect(out).toContain('sandbox.enabled'); expect(out).toContain(`+ sandbox.filesystem.denyWrite[]: "${ROOT}"`); expect(out).toContain('strictAllowlist')
    expect(await run(h, ['confirm', await code()])).toContain('contained')
    const s = JSON.parse(files[`${ROOT}/.claude/settings.local.json`]); expect(s.permissions.allow).toEqual(['Read']); expect(s.sandbox.allowUnsandboxedCommands).toBe(false)
    expect(files[`${ROOT}/.claude/settings.local.json.bak`]).toBe('{"permissions":{"allow":["Read"]}}')
    expect((await policyOf(h)).repo).toBe(ROOT); expect((await h.board.read()).containment.state).toBe('contained')
    expect(await run(h, ['5'])).toContain('contained')   // idempotent: no diff
    const a = await run(h, ['5', 'allowlist']); expect(a).toContain('strictAllowlist: true'); expect(a).toContain('/home/u/.claude/settings.json')
  })
})

describe('stage 5 with a symlinked cache dir (G8)', () => {
  test('allowWrite and policy wtRoot use the realpath, matching contain()', async () => {
    const { h, files, code } = mk(); const stat = h.stat
    h.stat = async (p, o) => (p === `${HOME}/.cache` ? { kind: 'dir', realPath: o?.resolve ? '/data/cache' : undefined } : p.startsWith(`${HOME}/.cache/`) ? undefined : stat(p, o))
    await run(h, ['5']); expect(await run(h, ['confirm', await code()])).toContain('contained')
    const real = `/data/cache/cadre/wt/${RK}`
    expect(JSON.parse(files[`${ROOT}/.claude/settings.local.json`]).sandbox.filesystem.allowWrite).toEqual([real]); expect((await policyOf(h)).wtRoot).toBe(real)
  })
})

describe('stage 6 workflow profile', () => {
  test('an invalid pipeline is refused (no code issued); defaults shown in full; valid saves types + roles', async () => {
    const bad = mk({ files: { [`${ROOT}/.cadre/config.json`]: JSON.stringify({ types: { x: { commit: 'feat', changelog: null, pipeline: ['worker', 'red'], contract: 'none' } } }) } })
    const out = await run(bad.h, ['6']); expect(out).toContain('refused'); expect(out).toContain('types.x'); expect((await bad.h.secret.read()).initConfirm).toBeUndefined()
    const odd = mk({ files: { [`${ROOT}/.cadre/config.json`]: JSON.stringify({ roles: { worker: { tier: 'huge' } } }) } })
    expect(await run(odd.h, ['6'])).toContain('roles.worker.tier')
    const { h, files, code } = mk(); const shown = await run(h, ['6'])
    expect(shown).toContain('types.feature.pipeline'); expect(shown).toContain('roles.explorer.tier'); expect(shown).toContain('maxParallel')
    expect(await run(h, ['confirm', await code()])).toContain('4 sample briefs')
    const j = JSON.parse(files[`${ROOT}/.cadre/config.json`]); expect(Object.keys(j.types)).toContain('spike'); expect(j.roles.tester.tier).toBe('standard')
    expect(await run(h, ['6'])).toContain('workflow profile saved')   // idempotent
  })
})

describe('stage 7 changelog and 8 sync', () => {
  test('invalid file refused with the line; valid file passes without a diff', async () => {
    expect(await run(mk({ files: { [`${ROOT}/CHANGELOG.md`]: '# Changelog\n\n## [Unreleased]\n\n### Misc\n' } }).h, ['7'])).toContain('line 5')
    const ok = mk({ files: { [`${ROOT}/CHANGELOG.md`]: skeleton() } }); expect(await run(ok.h, ['7'])).toContain('changelog ok'); expect((await ok.h.secret.read()).initConfirm).toBeUndefined()
  })
  test('sync: lists adapters, skip is remembered, an adapter calls the wired setup', async () => {
    const { h } = mk({ files: { [`${HOME}/.claude/cadre.json`]: '{"adapters":{"pm":{"cmd":["pm-adapter"]}}}' } })
    expect(await run(h, ['8'])).toContain('configured adapters: pm')
    wire.syncAdd = async (_h, a) => `sync setup for ${a}`; expect(await run(h, ['8', 'pm'])).toBe('sync setup for pm')
    expect(await run(h, ['8', 'skip'])).toContain('skipped'); expect(await run(h, [])).not.toContain('init 8')
  })
})

test('rootFor: an agent cwd (worktree or view) maps back to the repo root recorded at session start; unknown paths stay', () => {
  const roots = { 'run-568e48': '/work/run' }
  expect(rootFor(roots, '/home/cc/.cache/cadre/wt/run-568e48/p-p1.1')).toBe('/work/run')
  expect(rootFor(roots, '/home/cc/.cache/cadre/wt/run-568e48.views/p-p1.3')).toBe('/work/run')
  expect(rootFor(roots, '/work/run')).toBe('/work/run'); expect(rootFor(undefined, '/x/y')).toBe('/x/y'); expect(rootFor(roots, '/other/run-5')).toBe('/other/run-5')
})
