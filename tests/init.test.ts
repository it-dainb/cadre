import { describe, expect, test } from 'claude-code/testing'
import { DISCOVER, MISSION, after, discovered, repoKeyOf, rootFor, run, wire } from '../commands/init'
import { fakeHost } from './support'
import { MemoryStore } from '../task-management/adapters/memory/store'
import { fnv1a64 } from '../core/board'
import { TABLE, ofEpic } from '../core/events'
import { afterFix, turnStarted } from '../commands/doctor'
import { evText } from '../ui/epic'
import { skeleton } from '../core/changelog'
import type { Host } from '../types'
import { policyOf } from '../policy/guards'
import { banned } from './fixtures/wording'

type R = { exitCode: number; stdout?: string; stderr?: string }
const ROOT = '/repo', HOME = '/hm/u', RK = repoKeyOf(ROOT)
// In-memory repo + fs behind a scripted process.run; `extra` answers non-git argv (jailed runs, find, ...).
function mk(o: { repo?: boolean; branches?: string[]; files?: Record<string, string>; extra?: (argv: string[]) => R | undefined; noIdentity?: { on: boolean } } = {}) {
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
      if (argv[1] === 'rev-parse' && argv[2] === '--verify') return (argv[3] === 'HEAD' ? g.repo && g.branches.size > 0 : g.branches.has(argv[3])) ? ok('sha') : bad()   // HEAD: unborn until the first commit
      if (argv[1] === 'symbolic-ref') return bad()
      if (j === 'git branch --show-current') return ok('main')
      if (argv[1] === 'init') { g.repo = true; return ok() }
      if (argv[1] === 'commit') { if (o.noIdentity?.on) return { exitCode: 128, stdout: '', stderr: 'Author identity unknown\n\nfatal: unable to auto-detect email address' }; g.branches.add('main'); return ok() }
      if (argv[1] === 'branch' && !g.branches.has(argv[3])) return { exitCode: 128, stdout: '', stderr: `fatal: not a valid object name: '${argv[3]}'` }
      if (argv[1] === 'branch') { g.branches.add(argv[2]); return ok() }
      return ok()
    },
  })
  const code = async () => (await h.secret.read()).initConfirm?.code as string
  return { h, files, g, calls, code }
}
const store = () => { const s = new MemoryStore(); wire.store = async () => s; return s }
// what the human sees: the init card's lines, and the full pending diff (the card shows the first 14 lines)
const cardOf = async (h: Host) => ((await h.board.read()).decisions ?? []).filter(d => d.id.startsWith('init:')).map(d => [d.title, ...d.lines].join('\n')).join('\n')
const diffOf = async (h: Host) => (((await h.ui.read())['init.pending'] as { lines: string[] } | undefined)?.lines ?? []).join('\n')
const seen = async (h: Host) => `${await cardOf(h)}\n${await diffOf(h)}`

describe('init: confirm discipline (DESIGN 10.1)', () => {
  test('propose -> diff -> confirm -> .bak -> save; the code is nonce-salted and never printed', async () => {
    const { h, files, code } = mk({ files: { [`${ROOT}/CHANGELOG.md`]: undefined as any } }); delete files[`${ROOT}/CHANGELOG.md`]
    const out = await run(h, ['7'])
    expect(out).toBe('init: stage 7/8 changelog ready · confirm on the card'); expect(await cardOf(h)).toContain('+ CHANGELOG.md: KAC 1.1.0 skeleton'); expect(files[`${ROOT}/CHANGELOG.md`]).toBeUndefined()
    const c = await code(), s = await h.secret.read(), text = `init 7 changelog: proposed changes\n${await diffOf(h)}`
    expect(c).toBe(fnv1a64(s.initNonce + text).slice(0, 8)); expect(await cardOf(h)).not.toContain(c)
    const done = await run(h, ['confirm', c]); expect(done).toContain('stage 7/8 changelog done')
    expect(files[`${ROOT}/CHANGELOG.md`]).toBe(skeleton()); expect((await h.secret.read()).initConfirm?.stage).toBe(1)   // burned; the code now armed is the next stage's
  })
  test('wrong code refused, burned, nonce redrawn; the old code is dead; a new diff is shown', async () => {
    const { h, files, code } = mk(); await run(h, ['7'])
    const c1 = await code(), n1 = (await h.secret.read()).initNonce
    const out = await run(h, ['confirm', 'deadbeef'])
    expect(out).toContain('wrong code (burned)'); expect(out).not.toContain('\n'); expect(files[`${ROOT}/CHANGELOG.md`]).toBeUndefined()
    const c2 = await code(); expect(c2).not.toBe(c1); expect((await h.secret.read()).initNonce).not.toBe(n1)
    expect(await run(h, ['confirm', c1])).toContain('wrong code'); expect(files[`${ROOT}/CHANGELOG.md`]).toBeUndefined()
    expect(await run(h, ['confirm', await code()])).toContain('changelog done')   // an accepted attempt also burns
    expect(await run(h, ['confirm', c2])).toContain('wrong code')   // the next stage's card holds a new code; c2 is dead
  })
  test('changed bytes since the diff: nothing written, re-shown with a new code; then .bak holds the changed bytes', async () => {
    const { h, files, code } = mk({ files: { [`${ROOT}/.cadre/config.json`]: '{"maxParallel":2}' } })
    await run(h, ['6']); expect(await diffOf(h)).toContain('types')
    const c1 = await code(); files[`${ROOT}/.cadre/config.json`] = '{"maxParallel":2,"ui":{"glyphs":"ascii"}}'
    const re = await run(h, ['confirm', c1]); expect(re).toContain('files changed since the diff'); expect(await cardOf(h)).toContain('! last try: files changed'); expect(files[`${ROOT}/.cadre/config.json.bak`]).toBeUndefined()
    expect(files[`${ROOT}/.cadre/config.json`]).toBe('{"maxParallel":2,"ui":{"glyphs":"ascii"}}')
    const c2 = await code(); expect(c2).not.toBe(c1)
    expect(await run(h, ['confirm', c2])).toContain('stage 6/8 workflow done')
    expect(files[`${ROOT}/.cadre/config.json.bak`]).toBe('{"maxParallel":2,"ui":{"glyphs":"ascii"}}')
    expect(JSON.parse(files[`${ROOT}/.cadre/config.json`]).ui.glyphs).toBe('ascii')
  })
  test('no event, view or snapshot ever carries the code', async () => {
    const { h, code } = mk(); await run(h, ['7']); const c = await code(); await run(h, ['confirm', c])
    expect(JSON.stringify(await h.events.read())).not.toContain(c); expect(JSON.stringify(await h.board.read())).not.toContain(c)
    expect(ofEpic(await h.events.read(), '').map(e => `${e.data.stage}${e.data.state}`)).toEqual(['7proposed', '7done', '1proposed'])   // done -> the next incomplete stage is proposed
    expect((await h.board.read()).init).toEqual([{ stage: 1, state: 'proposed' }, { stage: 7, state: 'done' }])
  })
  test('bare /cadre init runs the next incomplete stage; unknown stage and empty confirm are told', async () => {
    const { h } = mk({ files: { [`${ROOT}/.cadre/config.json`]: '{"branches":{"main":"main"}}' } }); store()
    expect(await run(h, ['confirm', 'x'])).toContain('nothing pending')
    expect(await run(h, ['9'])).toContain('unknown stage')
    expect(await run(h, [])).toBe('init: stage 2/8 store ready · confirm on the card')
  })
})

describe('stage 1 repo', () => {
  test('non-repo: git init + initial commit + dev branch + exclude + config; re-run is idempotent', async () => {
    const { h, files, calls, code } = mk({ repo: false, branches: [] })
    await run(h, ['1']); expect(await cardOf(h)).toContain('git init -b main'); expect(await cardOf(h)).toContain('+ .git/info/exclude: .beads/'); expect(await cardOf(h)).not.toContain(ROOT)
    const done = await run(h, ['confirm', await code()]); expect(done).toContain('stage 1/8 repo done · stage 2/8 store')
    expect(calls.filter(a => a[0] === 'git' && ['init', 'add', 'commit', 'branch'].includes(a[1])).map(a => a.slice(1, 3).join(' '))).toEqual(['init -b', 'add -A', 'commit --allow-empty', 'branch dev'])
    expect(files[`${ROOT}/.git/info/exclude`]).toBe('.beads/\n.claude/settings.local.json\n')
    expect(JSON.parse(files[`${ROOT}/.cadre/config.json`]).branches).toEqual({ main: 'main', dev: 'dev' })
    const before = { ...files }; calls.length = 0
    expect(await run(h, ['1'])).toContain('stage 1/8 repo done'); expect(files).toEqual(before)   // nothing to change: applied without a code, no new .bak
    expect(calls.some(a => a[1] === 'init')).toBe(false)
    expect((await h.secret.read()).initConfirm?.stage).toBe(2)   // no code for stage 1; the next stage's diff is armed
  })
  test('existing repo without origin/HEAD uses the current branch; detached with no origin asks', async () => {
    const { h, code } = mk({ branches: ['trunk'], extra: a => a.join(' ') === 'git branch --show-current' ? { exitCode: 0, stdout: 'trunk' } : undefined })
    await run(h, ['1']); expect(await cardOf(h)).toContain('git branch dev trunk')
    expect(await run(h, ['confirm', await code()])).toContain('repo done'); expect(JSON.parse(String(await h.readText(`${ROOT}/.cadre/config.json`))).branches.main).toBe('trunk')
    const d = mk({ extra: a => a.join(' ') === 'git branch --show-current' ? { exitCode: 0, stdout: '' } : undefined })
    expect(await run(d.h, ['1'])).toContain('run /cadre init 1 <branch>')
    expect(await run(d.h, ['1', 'main'])).toContain('ready · confirm on the card')
  })
})

describe('stage 2 store', () => {
  test('probe, init with journal consent, round trip (create a draft, read it, drop it)', async () => {
    const s = store(), { h, code } = mk()
    await run(h, ['2']); const out = await cardOf(h); expect(out).toContain('bd init --non-interactive --skip-agents --skip-hooks'); expect(out).toContain('journal consent')
    expect((await s.probe()).journal).toBe(false)
    expect(await run(h, ['confirm', await code()])).toContain('stage 2/8 store done')
    expect((await s.probe()).journal).toBe(true)
    expect(await run(h, ['2'])).toContain('store done')   // complete -> applied directly
  })
  test('an unavailable store is refused with the reason', async () => {
    wire.store = async () => ({ probe: async () => ({ ok: false, journal: false, version: '1.2.0', detail: 'bd 1.2.0 < 1.3.0' }) }) as any
    const { h } = mk(); expect(await run(h, ['2'])).toContain('bd 1.2.0 < 1.3.0'); expect(await cardOf(h)).toContain('needs bd >= 1.3.0')
  })
})

describe('stage 3 mission', () => {
  test('hands main ONE brief; the card says Claude is on it; a mission draft waits on its own card', async () => {
    const { h } = mk(); store(); const sent: string[] = []; h.submit = async t => { sent.push(t) }
    expect(await run(h, ['3'])).toBe('init: stage 3/8 mission: Claude is working on it'); await new Promise(r => setTimeout(r, 0))
    expect(sent).toEqual([MISSION]); expect((await h.ui.read()).initRequest).toBe('mission'); expect((await h.board.read()).init).toEqual([{ stage: 3, state: 'pending' }])
    expect(await cardOf(h)).toContain('Claude is working on the mission'); expect(banned(MISSION, DISCOVER)).toEqual([])
    await run(h, ['3']); await new Promise(r => setTimeout(r, 0)); expect(sent).toHaveLength(1)   // one hand-off per stage run
    await h.board.update(b => ({ ...b, plan: { id: 'm', slug: 'mission', state: 'draft', epicBranch: '' } }))
    expect(await run(h, ['3'])).toContain('waits for your approval on its card'); expect(await cardOf(h)).toBe('')
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
    expect(await run(h, ['4'])).toContain('discovery: Claude is working on it'); expect((await h.ui.read()).initRequest).toBe('discovery')
    expect((await h.board.read()).init).toEqual([{ stage: 4, state: 'pending' }])   // briefs, admission and tools open the explorer's report on this (live: 'no discovery request is open')
  })
  test('malformed report refused with an example; sequence: diff 2 (caches, knownRed, fetches warning) -> validate in jail -> save only validated', async () => {
    const { h, s, files, calls, code } = ready(); await s.init({ types: {} as any, journal: true })
    expect(await discovered(h, { ...REPORT, discovery: { packages: [{ root: '/abs' }] } })).toContain('.root')
    expect(await discovered(h, { discovery: { packages: [] }, citations: [] })).toContain('discovery.packages')
    expect(await discovered(h, { ...REPORT, discovery: { packages: [{ ...REPORT.discovery.packages[0], root: '../x' }] } })).toContain('root')
    expect(await discovered(h, REPORT)).toBeNull()
    await run(h, ['4']); const out = await diffOf(h)
    expect(await cardOf(h)).toContain('~/.cache/pnpm'); expect(out).toContain('~/.cache/pnpm'); expect(out).toContain('~/.cargo/registry'); expect(out).not.toContain('target')
    expect(out).toContain('! e2e: fetches at test time'); expect(out).toContain('? lint: red at the clean base -> knownRed')
    const audit = calls.filter(a => a[0] === 'bwrap' && a.includes('--'))
    expect(audit[0]).toContain('--overlay-src'); expect(audit[0]).toContain(`${HOME}`); expect(audit.slice(1).every(a => a.includes('--unshare-net'))).toBe(true)
    expect(files[`${ROOT}/.cadre/config.json`]).not.toContain('packages')   // nothing saved before confirm
    calls.length = 0
    const done = await run(h, ['confirm', await code()]); expect(done).toContain('stage 4/8 discovery done'); expect(done).not.toContain('\n')
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
    await run(h, ['5']); const out = await diffOf(h); expect(out).toContain('sandbox.enabled'); expect(out).toContain(`+ sandbox.filesystem.denyWrite[]: "${ROOT}"`); expect(out).toContain('strictAllowlist')
    expect(await run(h, ['confirm', await code()])).toContain('stage 5/8 containment done')
    const s = JSON.parse(files[`${ROOT}/.claude/settings.local.json`]); expect(s.permissions.allow).toEqual(['Read']); expect(s.sandbox.allowUnsandboxedCommands).toBe(false)
    expect(files[`${ROOT}/.claude/settings.local.json.bak`]).toBe('{"permissions":{"allow":["Read"]}}')
    expect((await policyOf(h)).repo).toBe(ROOT); expect((await h.board.read()).containment.state).toBe('contained')
    expect(await run(h, ['5'])).toContain('containment done')   // idempotent: no diff
    await run(h, ['5', 'allowlist']); expect(await diffOf(h)).toContain('strictAllowlist: true'); expect(await cardOf(h)).toContain('~/.claude/settings.json: ')
  })
})

describe('stage 5 with a symlinked cache dir (G8)', () => {
  test('allowWrite and policy wtRoot use the realpath, matching contain()', async () => {
    const { h, files, code } = mk(); const stat = h.stat
    h.stat = async (p, o) => (p === `${HOME}/.cache` ? { kind: 'dir', realPath: o?.resolve ? '/data/cache' : undefined } : p.startsWith(`${HOME}/.cache/`) ? undefined : stat(p, o))
    await run(h, ['5']); expect(await run(h, ['confirm', await code()])).toContain('containment done')
    const real = `/data/cache/cadre/wt/${RK}`
    expect(JSON.parse(files[`${ROOT}/.claude/settings.local.json`]).sandbox.filesystem.allowWrite).toEqual([real]); expect((await policyOf(h)).wtRoot).toBe(real)
  })
})

describe('stage 6 workflow profile', () => {
  test('an invalid pipeline is refused (no code issued); defaults shown in full; valid saves types + roles', async () => {
    const bad = mk({ files: { [`${ROOT}/.cadre/config.json`]: JSON.stringify({ types: { x: { commit: 'feat', changelog: null, pipeline: ['worker', 'red'], contract: 'none' } } }) } })
    const out = await run(bad.h, ['6']); expect(out).toContain('refused'); expect(await cardOf(bad.h)).toContain('types.x'); expect((await bad.h.secret.read()).initConfirm).toBeUndefined()
    const odd = mk({ files: { [`${ROOT}/.cadre/config.json`]: JSON.stringify({ roles: { worker: { tier: 'huge' } } }) } })
    await run(odd.h, ['6']); expect(await cardOf(odd.h)).toContain('roles.worker.tier')
    const { h, files, code } = mk(); await run(h, ['6']); const shown = await diffOf(h)
    expect(shown).toContain('types.feature.pipeline'); expect(shown).toContain('roles.explorer.tier'); expect(shown).toContain('maxParallel')
    expect(await run(h, ['confirm', await code()])).toContain('stage 6/8 workflow done')
    const j = JSON.parse(files[`${ROOT}/.cadre/config.json`]); expect(Object.keys(j.types)).toContain('spike'); expect(j.roles.tester.tier).toBe('standard')
    expect(await run(h, ['6'])).toContain('workflow done')   // idempotent
  })
})

describe('stage 7 changelog and 8 sync', () => {
  test('invalid file refused with the line; valid file passes without a diff', async () => {
    expect(await run(mk({ files: { [`${ROOT}/CHANGELOG.md`]: '# Changelog\n\n## [Unreleased]\n\n### Misc\n' } }).h, ['7'])).toContain('line 5')
    const ok = mk({ files: { [`${ROOT}/CHANGELOG.md`]: skeleton() } }); expect(await run(ok.h, ['7'])).toContain('changelog done'); expect((await ok.h.secret.read()).initConfirm?.stage).toBe(1)
  })
  test('sync: lists adapters, skip is remembered, an adapter calls the wired setup', async () => {
    const { h } = mk({ files: { [`${HOME}/.claude/cadre.json`]: '{"adapters":{"pm":{"cmd":["pm-adapter"]}}}' } })
    expect(await run(h, ['8'])).toContain('sync this project'); expect(await cardOf(h)).toContain('configured adapters: pm'); expect(((await h.board.read()).decisions ?? [])[0].options.map(o => o.label)).toEqual(['Skip', 'Re-check', 'Cancel'])
    wire.syncAdd = async (_h, a) => `sync setup for ${a}`; expect(await run(h, ['8', 'pm'])).toContain('sync setup for pm')
    expect(await run(h, ['8', 'skip'])).toContain('stage 8/8 sync done'); expect(await run(h, [])).not.toContain('8/8')
  })
})

test('rootFor: an agent cwd (worktree or view) maps back to the repo root recorded at session start; unknown paths stay', () => {
  const roots = { 'run-568e48': '/work/run' }
  expect(rootFor(roots, '/hm/cc/.cache/cadre/wt/run-568e48/p-p1.1')).toBe('/work/run')
  expect(rootFor(roots, '/hm/cc/.cache/cadre/wt/run-568e48.views/p-p1.3')).toBe('/work/run')
  expect(rootFor(roots, '/work/run')).toBe('/work/run'); expect(rootFor(undefined, '/x/y')).toBe('/x/y'); expect(rootFor(roots, '/other/run-5')).toBe('/other/run-5')
})

describe('init flow (ADR 0009)', () => {
  test('regression: a failed first commit leaves an unborn repo; the press says why on the card and a retry finishes the stage', async () => {
    const id = { on: true }, { h, files, calls, code } = mk({ repo: false, branches: [], noIdentity: id }); store()
    await run(h, [])
    const r1 = await run(h, ['confirm', await code()])   // git init ran, the commit did not: before the fix the re-proposal could never finish (`git branch dev main` on an unborn main)
    expect(r1).toBe('init: stage 1/8 repo failed: git commit failed: git has no author name/email; run git config --global user.name "…" and user.email "…", then confirm again · ready · confirm on the card')
    expect(files[`${ROOT}/.cadre/config.json`]).toBeUndefined(); expect(await cardOf(h)).toContain('! last try: git commit failed')
    expect(await cardOf(h)).toContain('+ initial commit on main'); expect(await cardOf(h)).not.toContain('git init')
    id.on = false; calls.length = 0
    expect(await run(h, ['confirm', await code()])).toContain('stage 1/8 repo done · stage 2/8 store ready')
    expect(calls.filter(a => a[0] === 'git' && ['init', 'add', 'commit', 'branch'].includes(a[1]) && a[2] !== '--show-current').map(a => a[1])).toEqual(['add', 'commit', 'branch'])
    expect(JSON.parse(files[`${ROOT}/.cadre/config.json`]).branches).toEqual({ main: 'main', dev: 'dev' })
  })
  test('auto-advance: confirming a stage proposes the next incomplete one, progress in the card title; all done is said', async () => {
    const { h, code } = mk({ repo: false, branches: [] }); store()
    expect(await run(h, [])).toBe('init: stage 1/8 repo ready · confirm on the card')
    expect((await h.board.read()).decisions?.map(d => d.title)).toEqual(['init 1/8 repo · confirm'])
    expect(await run(h, ['confirm', await code()])).toBe('init: stage 1/8 repo done · stage 2/8 store ready · confirm on the card')
    expect((await h.board.read()).decisions?.map(d => d.title)).toEqual(['init 2/8 store · confirm'])   // stage 1's card is gone
    const sent: string[] = []; h.submit = async t => { sent.push(t) }
    expect(await run(h, ['confirm', await code()])).toBe('init: stage 2/8 store done · stage 3/8 mission: Claude is working on it')
    await new Promise(r => setTimeout(r, 0)); expect(sent).toEqual([MISSION])
    expect((await h.board.read()).decisions?.map(d => d.title)).toEqual(['init 3/8 mission · Claude is on it'])
  })
  test('agentic hand-off: marked at turn.start, the end of THAT turn continues init or says Claude stopped; discovery reported later moves on', async () => {
    const { h } = mk({ extra: jailed(), files: { [`${ROOT}/.cadre/config.json`]: '{"branches":{"main":"main","dev":"dev"}}' } }); const s = store(); await s.init({ types: {} as any, journal: true })
    const sent: string[] = []; h.submit = async t => { sent.push(t) }
    await h.board.update(b => ({ ...b, mission: 'm' }))
    expect(await run(h, [])).toBe('init: stage 4/8 discovery: Claude is working on it'); await new Promise(r => setTimeout(r, 0))
    expect(sent).toEqual([DISCOVER]); expect((await h.secret.read()).setupFix).toMatchObject({ kind: 'init', n: 4, sent: true })
    await turnStarted(h, { text: `The cadre plugin sent a message:\n${DISCOVER}`, turnId: 't1' })
    await afterFix(h, { turnId: 't1' })   // the turn ended with no report: the card says so, no second hand-off
    expect(await cardOf(h)).toContain('Claude stopped before finishing discovery'); expect(sent).toHaveLength(1); expect((await h.secret.read()).setupFix).toBeUndefined()
    await afterFix(h, { turnId: 't2' }); expect(await cardOf(h)).toContain('Claude stopped')   // nothing reported yet: nothing moves
    await discovered(h, REPORT); await afterFix(h, { turnId: 't3' })   // the report came in a later turn: diff 2 follows
    expect((await h.board.read()).decisions?.map(d => d.title)).toEqual(['init 4/8 discovery · confirm']); expect(await cardOf(h)).toContain('packages[.]')
    expect(sent).toHaveLength(1)
  })
  test('the mission hand-off turn ends with a draft: no init card, the mission card decides', async () => {
    const { h } = mk({ files: { [`${ROOT}/.cadre/config.json`]: '{"branches":{"main":"main","dev":"dev"}}' } }); await store().init({ types: {} as any, journal: true }); h.submit = async () => {}
    await run(h, ['3']); await h.board.update(b => ({ ...b, plan: { id: 'm', slug: 'mission', state: 'draft', epicBranch: '' } }))
    await after(h, true); expect(await cardOf(h)).toBe(''); expect((await h.board.read()).init).toEqual([{ stage: 3, state: 'pending' }])
  })
  test('every init answer is ONE line of task language; the same proposal twice emits one event', async () => {
    const { h, code } = mk({ repo: false, branches: [] }); store(); h.submit = async () => {}
    const outs = [await run(h, []), await run(h, []), await run(h, ['confirm', 'bad']), await run(h, ['confirm', await code()]), await run(h, ['6']), await run(h, ['9']), await run(h, ['8']), await run(h, ['confirm'])]
    for (const o of outs) expect(o).not.toContain('\n')
    expect(banned(outs)).toEqual([])
    expect(ofEpic(await h.events.read(), '').filter(e => e.data.stage === 1).map(e => e.data.state)).toEqual(['proposed', 'done'])   // run twice + a wrong code: still one `proposed`
  })
  test('log text: init.stage reads as words, no event kind falls back to raw JSON', async () => {
    const v = { c: { glyphs: 'ascii' }, b: { tasks: [] } } as any, ev = (type: string, data: Record<string, unknown>) => ({ type, data } as any)
    expect(evText(ev('init.stage', { stage: 1, state: 'proposed', name: 'repo' }), v)).toBe('init: stage 1 repo proposed')
    for (const t of Object.keys(TABLE)) expect(evText(ev(t, Object.fromEntries(TABLE[t as keyof typeof TABLE][3].map(k => [k, 'x']))), v)).not.toContain('{')
  })
})
