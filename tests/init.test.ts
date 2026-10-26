import { describe, expect, test } from 'claude-code/testing'
import { clearKnownRed, confirm, initItems, repoKeyOf, rootFor, wire } from '../commands/init'
import { load } from '../config/index'
import { GOAL_FOLLOW, QUIET, cancel, halt, pump, recheck, resume, redNote, ran, seen, start, stopCheck, turnEnd, watch } from '../commands/agentrun'
import { band2 } from '../ui/v2/band'
import { txt } from '../ui/model'
import { HINT, SETTING_UP, decide, parse, route, run as cadreRun, status as statusLine } from '../commands/cadre'
import { guard, policyOf, setPolicy, settingsOnly, LIMIT } from '../policy/guards'
import { wake, warm } from '../core/session'
import { fakeHost } from './support'
import { MemoryStore } from '../task-management/adapters/memory/store'
import { skeleton } from '../core/changelog'
import { BUDGET } from './fixtures/budget.generated'
import type { Host } from '../types'
import { banned } from './fixtures/wording'
import { taskCall } from './fixtures/native/world'
import { scoped } from '../commands/init'
import { goal as goalBrief, sendBrief } from '../core/lanes'

type R = { exitCode: number; stdout?: string; stderr?: string }
const ROOT = '/repo', HOME = '/hm/u', RK = repoKeyOf(ROOT), PLUG = '/plug', CFG = `${ROOT}/.cadre/config.json`
const PKG = { root: '.', setup: ['npm', 'ci'], checks: { test: ['npm', 'test'] }, tdd: { paths: ['test/**'] } }
const READY = { [CFG]: JSON.stringify({ branches: { main: 'main', dev: 'dev' }, units: [PKG] }), [`${ROOT}/.git/info/exclude`]: '.cadre/state/\n.claude/settings.local.json\n', [`${ROOT}/CHANGELOG.md`]: skeleton() }
// bwrap answers by inner argv: `npm ci` setup, `npm test` passes, anything else is red; find lists the caches setup wrote
const jailed = (red: string[] = []) => (argv: string[]): R | undefined => {
  if (argv[0] === 'bwrap' && !argv.includes('--')) return { exitCode: 0, stdout: argv[1] === '--help' ? '--overlay-src --tmp-overlay' : '' }   // jailMode probes
  if (argv[0] === 'find') return { exitCode: 0, stdout: './.cache\n./.cache/pnpm\n' }
  if (argv[0] !== 'bwrap') return undefined
  const inner = argv.slice(argv.indexOf('--', 3) + 1).join(' ')
  return { exitCode: red.includes(inner) ? 1 : 0 }
}
// In-memory repo + fs behind a scripted process.run
function mk(o: { repo?: boolean; branches?: string[]; files?: Record<string, string>; extra?: (argv: string[]) => R | undefined; mission?: boolean; journal?: boolean } = {}) {
  const files: Record<string, string> = { ...o.files }, g = { repo: o.repo ?? true, branches: new Set(o.branches ?? ['main', 'dev']) }, calls: string[][] = [], sent: string[] = []
  const h = fakeHost({ files }) as Host & { logs: string[]; toasts: string[] }
  void h.store.set('cadre:prefs', { at: 0 })   // preferences chosen (tests/prefs.test.ts)
  let n = 0
  Object.assign(h, {
    rand: () => `n${++n}`.padEnd(16, '0'), cwd: async () => ROOT, home: async () => HOME, root: async () => PLUG, submit: async (t: string) => { sent.push(t) },
    settings: async () => JSON.parse(files[`${ROOT}/.claude/settings.local.json`] ?? '{}'),
    run: async (argv: string[]) => {
      calls.push(argv); const j = argv.join(' '), ok = (stdout = ''): R => ({ exitCode: 0, stdout, stderr: '' }), bad = (): R => ({ exitCode: 128, stdout: '', stderr: 'fatal: nope' })
      const x = (o.extra ?? jailed())(argv); if (x) return { stdout: '', stderr: '', ...x }
      if (argv[0] !== 'git') return ok()
      if (j === 'git rev-parse --git-dir') return g.repo ? ok('.git') : bad()
      if (j === 'git rev-parse --git-path info/exclude') return ok('.git/info/exclude')
      if (argv[1] === 'rev-parse' && argv[2] === '--verify') return (argv[3] === 'HEAD' ? g.repo && g.branches.size > 0 : g.branches.has(argv[3])) ? ok('sha') : bad()
      return ok()
    },
  })
  const s = new MemoryStore(); wire.store = async () => s; if (o.journal !== false) void s.init({ journal: true } as any)
  if (o.mission !== false) void h.board.update(b => ({ ...b, mission: 'ship it' }))
  const tick = () => pump(h)   // the session's 5 s timer sends a waiting brief
  return { h, files, g, calls, sent, tick, s }
}
const items = async (h: Host) => Object.fromEntries((await initItems(h)).map(i => [i.name, `${i.st}${i.why ? `: ${i.why}` : ''}`]))
const card = async (h: Host, id = 'run:init') => ((await h.board.read()).decisions ?? []).find(d => d.id === id)

describe('init checks (ADR 0010): read-only, one per phase', () => {
  test('an empty folder: every phase says what is missing; later phases wait as todo; nothing is written or run', async () => {
    const { h, files, calls } = mk({ repo: false, branches: [], mission: false, journal: false })
    expect(await items(h)).toEqual({ repository: 'fail: no git repository yet', 'task store': 'todo: after the steps above', mission: 'fail: no mission yet', 'build and test commands': 'fail: no units in .cadre/config.json',
      'commands pass on a clean checkout': 'todo: after the steps above', workflow: 'ok', changelog: 'fail: CHANGELOG.md is missing', 'safety settings': 'todo: after the steps above' })
    expect(files).toEqual({}); expect(calls.filter(a => a[0] !== 'find' && (a[0] !== 'git' || !/rev-parse/.test(a.join(' '))))).toEqual([])   // find: the stray .cadre look, read-only
    expect(banned(Object.values(await items(h)))).toEqual([])   // what a follow-up may quote
  })
  test('a .cadre folder below the root (made from a shell in a package folder) is a red item naming it and its delete; node_modules and .git are not searched', async () => {
    const { h, calls } = mk({ files: READY, extra: a => (a[0] === 'find' && a[1] === ROOT ? { exitCode: 0, stdout: `${ROOT}/kit/.cadre\n` } : jailed()(a)) })
    const its = await initItems(h, { quick: true }), st = its.find(i => i.name === 'no setup folder outside the root')
    expect(st).toEqual({ name: 'no setup folder outside the root', st: 'fail', why: `kit/.cadre is not the project root's: delete it (rm -rf ${ROOT}/kit/.cadre)` })
    expect(calls.find(a => a[0] === 'find')!.join(' ')).toContain('-name .git -o -name node_modules ) -prune')
    await h.secret.update(x => ({ ...x, run: { kind: 'init' as const, at: 0, turns: 0, follow: 0, guide: 'g' } })); expect(await redNote(h)).toContain('no setup folder outside the root (kit/.cadre')
    expect((await items(mk({ files: READY }).h))['no setup folder outside the root']).toBeUndefined()   // none: no row at all
  })
  test('repository: unborn HEAD, a missing dev branch, a missing exclude line, unset main are each named', async () => {
    expect((await items(mk({ branches: [], files: READY }).h)).repository).toBe('fail: no first commit yet')
    expect((await items(mk({ branches: ['main'], files: READY }).h)).repository).toBe('fail: branch dev is missing')
    expect((await items(mk({ files: { ...READY, [`${ROOT}/.git/info/exclude`]: '.cadre/state/\n' } }).h)).repository).toBe('fail: .git/info/exclude lacks .claude/settings.local.json')
    expect((await items(mk({ files: { ...READY, [CFG]: '{}' } }).h)).repository).toBe('fail: branches.main is not set in .cadre/config.json')
  })
  test('mission: a draft waits for the human on its card; a recorded one is read back from the store', async () => {
    const { h } = mk({ files: READY, mission: false }); expect((await items(h)).mission).toBe('fail: no mission yet')
    await h.board.update(b => ({ ...b, plan: { id: 'm', slug: 'mission', state: 'draft', epicBranch: '' } })); expect((await items(h)).mission).toBe('wait: approve it on its card')
  })
  test('commands are validated in a clean offline copy once per package list; a red check is named for Claude to fix', async () => {
    const { h, calls } = mk({ files: { ...READY, [CFG]: JSON.stringify({ branches: { main: 'main', dev: 'dev' }, units: [{ ...PKG, checks: { test: ['npm', 'test'], lint: ['npm', 'run', 'lint'] } }] }) }, extra: jailed(['npm run lint']) })
    expect((await items(h))['commands pass on a clean checkout']).toBe('fail: .: lint fails on a clean checkout (fix the command or leave it out)')
    const n = calls.filter(a => a[0] === 'bwrap' && a.includes('--')).length; expect(calls.some(a => a[0] === 'bwrap' && a.includes('--unshare-net'))).toBe(true)
    await items(h); expect(calls.filter(a => a[0] === 'bwrap' && a.includes('--')).length).toBe(n)   // cached while the list is unchanged
  })
})

describe('safety settings: written by cadre only after the human confirms the diff on its card', () => {
  test('proposed once the rest passes; nothing written before the confirm; then .bak, settings, the cache allowance, policy, ok', async () => {
    const { h, files } = mk({ files: { ...READY, [`${ROOT}/.claude/settings.local.json`]: '{"permissions":{"allow":["Read"]}}' } })
    const its = await items(h); expect(Object.values(its).filter(v => v !== 'ok')).toEqual(['wait: confirm them on their card'])
    const d = (await card(h, 'init:5'))!; expect(d.title).toBe('init · safety settings · confirm'); expect(d.options.map(o => o.run)).toEqual(['init confirm'])
    expect(d.lines.join('\n')).toContain('sandbox.enabled'); expect(d.lines.join('\n')).toContain(`~/.claude/cadre.json: + repos.${RK}`); expect(d.lines.join('\n')).not.toMatch(/\b[0-9a-f]{8}\b/); expect(await h.secret.read()).not.toHaveProperty('initConfirm')
    expect(files[`${ROOT}/.claude/settings.local.json`]).toBe('{"permissions":{"allow":["Read"]}}'); expect(files[`${HOME}/.claude/cadre.json`]).toBeUndefined()
    await items(h); expect((await h.board.read()).decisions?.filter(x => x.id === 'init:5')).toHaveLength(1)   // a re-check does not re-ask
    expect(await confirm(h)).toBe('init: safety settings written · restart Claude Code for the task-tool settings to apply')
    const s = JSON.parse(files[`${ROOT}/.claude/settings.local.json`]); expect(s.permissions.allow).toEqual(['Read']); expect(s.sandbox.allowUnsandboxedCommands).toBe(false); expect(s.sandbox.filesystem.allowWrite).toContain(`${HOME}/.cache/pnpm`)
    expect(files[`${ROOT}/.claude/settings.local.json.bak`]).toBe('{"permissions":{"allow":["Read"]}}'); expect(JSON.parse(files[`${HOME}/.claude/cadre.json`]).repos[RK].jailWritable).toEqual([`${HOME}/.cache/pnpm`])
    expect((await policyOf(h)).repo).toBe(ROOT); expect(Object.values(await items(h)).every(v => v === 'ok')).toBe(true)
    expect(s.env).toEqual({ CLAUDE_CODE_ENABLE_TASKS: 'false', CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' }); expect(s.permissions.deny).toBeUndefined()   // the task-tool gate; never an Agent deny (it would stop cadre's own spawns)
    expect(await h.store.get(await scoped(h, 'settings'))).toEqual({ rev: 1, added: ['CLAUDE_CODE_ENABLE_TASKS', 'CLAUDE_CODE_ENABLE_TODO_TOOLS'] }); expect(files[`${HOME}/.claude/settings.json`]).toBeUndefined()   // per repo; the user settings untouched
  })
  test('an older cadre\'s project (sandbox set, todo flag on, no task gate): the card adds only the gate; its todo flag counts as cadre\'s', async () => {
    const { h, files } = mk({ files: { ...READY, [`${ROOT}/.claude/settings.local.json`]: '{"env":{"CLAUDE_CODE_ENABLE_TODO_TOOLS":"1","FOO":"x"}}' } }); await items(h)
    const d = (await card(h, 'init:5'))!; expect(d.lines.join('\n')).toContain('+ env.CLAUDE_CODE_ENABLE_TASKS: "false"'); expect(d.lines.join('\n')).not.toContain('+ env.CLAUDE_CODE_ENABLE_TODO_TOOLS')
    await confirm(h); expect(JSON.parse(files[`${ROOT}/.claude/settings.local.json`]).env).toEqual({ CLAUDE_CODE_ENABLE_TODO_TOOLS: '1', FOO: 'x', CLAUDE_CODE_ENABLE_TASKS: 'false' })
    expect(((await h.store.get(await scoped(h, 'settings'))) as any).added).toEqual(['CLAUDE_CODE_ENABLE_TASKS', 'CLAUDE_CODE_ENABLE_TODO_TOOLS'])
  })
  test('settings changed since the human saw them: nothing written', async () => {
    const { h, files } = mk({ files: READY }); await items(h); files[`${ROOT}/.claude/settings.local.json`] = '{"x":1}'
    expect(await confirm(h)).toContain('changed since you saw them'); expect(files[`${ROOT}/.claude/settings.local.json`]).toBe('{"x":1}')
  })
  test('a symlinked cache dir: allowWrite and policy wtRoot use the realpath, matching contain() (G8)', async () => {
    const { h, files } = mk({ files: READY }); const stat = h.stat
    h.stat = async (p, o) => (p === `${HOME}/.cache` ? { kind: 'dir', realPath: o?.resolve ? '/data/cache' : undefined } : p.startsWith(`${HOME}/.cache/`) ? undefined : stat(p, o))
    await items(h); await confirm(h); const real = `/data/cache/cadre/wt/${RK}`
    expect(JSON.parse(files[`${ROOT}/.claude/settings.local.json`]).sandbox.filesystem.allowWrite[0]).toBe(real); expect((await policyOf(h)).wtRoot).toBe(real)
  })
})

describe('agent-run init (ADR 0010): the brief, the checklist card, re-checks at main turn end', () => {
  test('/cadre init from the composer: ONE line, a short brief that points at the guide, the run (lease) starts, the checklist card shows', async () => {
    const { h, sent, tick } = mk({ repo: false, branches: [], mission: false })
    const t = (await cadreRun(h, { args: 'init', origin: { kind: 'composer' } }, () => ({}))).text
    expect(t).toBe('init: Claude is on it · progress in the cadre pane')
    expect(sent).toEqual([]); expect((await h.secret.read()).run?.brief).toContain('guides/init.md')   // a command frame cannot submit (live 0.7.0): the brief waits for the timer
    await tick(); expect((await h.secret.read()).run?.brief).toBeUndefined()
    expect(sent).toEqual([`Set up cadre in this project. Follow ${PLUG}/guides/init.md step by step. The project root is ${ROOT}: start every Bash call with cd "${ROOT}" && and give files there by their full path.`]); expect(banned(t, sent)).toEqual([])
    expect((await h.secret.read()).run).toMatchObject({ kind: 'init', turns: 0, follow: 0, guide: `${PLUG}/guides/init.md` })
    const d = (await card(h))!; expect(d.title).toBe('init · 1/8 done · Claude is on it'); expect(d.lines).toContain('✗ repository: no git repository yet'); expect(d.lines).toContain('· task store: after the steps above')
    expect(d.options.map(o => o.label)).toEqual(['Cancel'])
  })
  test('another origin cannot start it (no lease from a model or a script)', async () => {
    const { h, sent, tick } = mk({ repo: false })
    expect((await cadreRun(h, { args: 'init', origin: { kind: 'sdk' } }, () => ({}))).text).toContain('refused'); await tick()
    expect((await h.secret.read()).run).toBeUndefined(); expect(sent).toEqual([])
  })
  test('main turn end (no stop check here, as on a managed machine): ONE follow-up naming what still fails, at most 3; then the dialog shows what is left', async () => {
    const { h, sent, tick, files } = mk({ files: READY, mission: false }); delete files[`${ROOT}/CHANGELOG.md`]
    await start(h, 'init'); await tick(); sent.length = 0
    await turnEnd(h, { agentId: 'sub1' }); await tick(); expect(sent).toEqual([])   // a subagent's turn is not main's
    for (let i = 1; i <= 3; i++) { await turnEnd(h, {}); await tick(); expect(sent).toHaveLength(i) }
    expect(sent[0]).toBe(`Setup is not done: these checks still fail.\n1. mission: no mission yet (phase 3)\n2. changelog: CHANGELOG.md is missing (phase 5)\nFix them now, following ${PLUG}/guides/init.md. If you cannot fix one, say which one and why, then stop.`)
    expect(banned(sent)).toEqual([])
    await turnEnd(h, {}); await tick(); expect(sent).toHaveLength(3)
    const d = (await card(h))!; expect(d.title).toBe('init · Claude stopped · 3 left'); expect(d.lines[0]).toBe('Claude stopped 3 times with checks still failing'); expect(d.options.map(o => o.label)).toEqual(['Let Claude try again', 'Stop setup'])
    expect((await h.secret.read()).run).toBeUndefined()   // the lease ended
    expect((await decide(h, d.id, 'r', d.hash)).text).toBe('init: Claude is on it · progress in the cadre pane'); await tick(); expect(sent).toHaveLength(4); expect((await h.secret.read()).run?.follow).toBe(3)   // the human's retry: the brief goes, the spent follow-ups stay spent
    await turnEnd(h, {}); await tick(); expect(sent).toHaveLength(4); expect((await card(h))!.lines[0]).toBe('Claude stopped 3 times with checks still failing')
    const s = (await card(h))!; expect((await decide(h, s.id, 's', s.hash)).text).toBe('init: cancelled'); expect(await card(h)).toBeUndefined()   // Stop setup is key s on a stopped card
  })
  // quick tier user2 on 6665614 / 33ff8a3 (2.1.299, FAULT=interrupt): after Esc every submit resolved { drop } ("the session was stopped…") until the human sent
  // input; a dialog answer's work runs later, so each "Let Claude try again" was refused again: 37 dialogs, no turn. Now a drop holds the run: one dialog, no submit
  // while held, and the human's typed line restarts it; the step goes once on the next tick.
  test('a stopped Claude: a refused step holds the run (one dialog, no retry storm); a typed line sends the step once', async () => {
    const { h, sent, tick, files } = mk({ files: READY, mission: false }); delete files[`${ROOT}/CHANGELOG.md`]
    let stopped = true, tries = 0; h.submit = async (t: string) => (tries++, stopped ? { drop: 'the session was stopped and nobody has sent input since' } : (sent.push(t), {}))
    await start(h, 'init'); await tick()
    const d = (await card(h))!; expect(d.title).toBe('init stopped · type anything to go on'); expect(d.lines[1]).toContain('Type anything in the prompt')
    expect(d.options.map(o => o.label)).toEqual(['Stop setup'])   // no retry: pressing 1 cannot loop
    expect((await h.secret.read()).run).toBeUndefined(); expect((await h.ui.read()).shown).toContain('run:init')   // no dialog pops by itself: the band asks for 1
    expect(txt(band2({ b: await h.board.read(), ui: await h.ui.read(), sec: await h.secret.read() } as any, 120, {} as any)).join("\n")).toContain('type anything in the prompt')
    for (let i = 0; i < 5; i++) { await pump(h); await tick() }
    expect(tries).toBe(1); expect(((await h.board.read()).decisions ?? []).filter(x => x.id === 'run:init')).toHaveLength(1)   // held: nothing is submitted, one dialog
    stopped = false; await resume(h); await pump(h); await pump(h)   // the human typed a line (prompt.submit), then the ticks
    expect(sent).toHaveLength(1); expect(sent[0]).toMatch(/^The user asked you to go on: do it now\. Set up cadre in this project/); expect((await h.ui.read()).held).toBeUndefined()
    expect((await h.secret.read()).run).toBeDefined(); expect(((await h.board.read()).decisions ?? []).find(x => x.id === 'run:init')?.title).not.toContain('stopped')
    await resume(h); await pump(h); expect(sent).toHaveLength(1)   // a later typed line does nothing
  })
  test('a new start while held hands its brief over (the hold of an earlier stop does not swallow it)', async () => {
    const { h, sent, tick, files } = mk({ files: READY, mission: false }); delete files[`${ROOT}/CHANGELOG.md`]
    let stopped = true; h.submit = async (t: string) => (stopped ? { drop: 'the session was stopped' } : (sent.push(t), {}))
    await start(h, 'init'); await tick(); expect((await h.ui.read()).held).toBe(true)
    stopped = false; await start(h, 'init'); for (let i = 0; i < 3; i++) await pump(h)
    expect(sent).toHaveLength(1); expect((await h.ui.read()).held).toBeUndefined()
  })
  test('a held card still restarts on a typed line after ui was reset (/clear)', async () => {
    const { h, sent, tick, files } = mk({ files: READY, mission: false }); delete files[`${ROOT}/CHANGELOG.md`]
    let stopped = true; h.submit = async (t: string) => (stopped ? { drop: 'the session was stopped' } : (sent.push(t), {}))
    await start(h, 'init'); await tick(); await h.ui.update(() => ({}))
    stopped = false; await resume(h); await pump(h)
    expect(sent).toHaveLength(1); expect((await h.secret.read()).run?.kind).toBe('init')
  })
  test('a thrown submit is no human stop: the step is kept and goes on the next tick, no hold', async () => {
    const { h, sent, tick, files } = mk({ files: READY, mission: false }); delete files[`${ROOT}/CHANGELOG.md`]
    let fail = true; h.submit = async (t: string) => { if (fail) { fail = false; throw new Error('host busy') } sent.push(t); return {} }
    await start(h, 'init'); await tick(); expect((await h.ui.read()).held).toBeUndefined(); expect((await h.secret.read()).run).toBeDefined()
    await pump(h); expect(sent).toHaveLength(1)
  })
  test('a submit that keeps throwing holds the run after 3 tries (one dialog), never a silent loop', async () => {
    const { h, tick, files } = mk({ files: READY, mission: false }); delete files[`${ROOT}/CHANGELOG.md`]
    let tries = 0; h.submit = async () => { tries++; throw new Error('host busy') }
    await start(h, 'init'); for (let i = 0; i < 20; i++) { await tick(); await watch(h) }
    expect(tries).toBe(3); expect((await h.secret.read()).run).toBeUndefined(); expect((await card(h))!.title).toBe('init stopped · type anything to go on')
  })
  test('the time limit still stops a run whose brief is queued and never goes out', async () => {
    const { h, files } = mk({ files: READY, mission: false }); delete files[`${ROOT}/CHANGELOG.md`]
    await start(h, 'init'); await h.secret.update(s => ({ ...s, run: { ...s.run!, at: -LIMIT.ms } })); expect((await h.secret.read()).run?.brief).toBeDefined()
    await watch(h); expect((await h.secret.read()).run).toBeUndefined(); expect((await card(h))!.title).toContain('Claude stopped')
  })
  test('a held goal brief plus a new init: the run step goes alone, the goal waits until the run ends', async () => {
    const { h, sent, files } = mk({ files: READY, mission: false }); delete files[`${ROOT}/CHANGELOG.md`]
    await h.ui.update(u => ({ ...u, goal: 'plan it', held: true }))
    await start(h, 'init'); await pump(h); expect(sent).toHaveLength(1); expect(sent[0]).toMatch(/^Set up cadre in this project/); expect((await h.ui.read()).goal).toBe('plan it')
  })
  test('a held run resumed after ui was reset (/clear) keeps its spent stop budget', async () => {
    const { h, tick, files } = mk({ files: READY, mission: false }); delete files[`${ROOT}/CHANGELOG.md`]
    let stopped = false; h.submit = async () => (stopped ? { drop: 'the session was stopped' } : {})
    await start(h, 'init'); await tick(); await h.secret.update(s => ({ ...s, run: { ...s.run!, follow: 2, brief: 'go on' } })); stopped = true; await tick()
    expect((await h.ui.read()).held).toBe(true); await h.ui.update(() => ({}))
    stopped = false; await resume(h); expect((await h.secret.read()).run?.follow).toBe(2)
  })
  test('a stale stopped card does not restart on a typed line that lifts another hold (the goal brief)', async () => {
    const { h } = mk({ files: READY, mission: false })
    await h.ui.update(u => ({ ...u, retry: { kind: 'init', follow: 3 }, held: true, goal: 'plan it' }))
    await h.board.update(b => ({ ...b, decisions: [...(b.decisions ?? []), { id: 'run:init', kind: 'init', title: 'init · Claude stopped · 2 left', short: 'x', lines: [], hash: 'x', options: [] } as any] }))
    await resume(h); expect((await h.secret.read()).run).toBeUndefined(); expect((await h.board.read()).decisions?.some(d => d.id === 'run:init')).toBe(true)
    expect((await h.ui.read()).held).toBeUndefined()
  })
  test('a run held after a stop keeps the queued goal: the same tick sends nothing more, and a thrown goal submit re-queues it', async () => {
    const { h, tick, files } = mk({ files: READY, mission: false }); delete files[`${ROOT}/CHANGELOG.md`]
    let tries = 0; h.submit = async (t: string) => { tries++; if (t === 'plan it') throw new Error('host busy'); return { drop: 'the session was stopped' } }
    await h.ui.update(u => ({ ...u, goal: 'plan it' })); await start(h, 'init'); await tick()
    expect((await h.ui.read()).held).toBe(true); expect(tries).toBe(1); expect((await h.ui.read()).goal).toBe('plan it')   // held: the goal is not handed over in the hold's own tick
    await h.ui.update(({ held: _h, ...u }) => u); await sendBrief(h); expect(tries).toBe(2); expect((await h.ui.read()).goal).toBe('plan it')   // the throw keeps it for the next tick
  })
  test('a submit that goes through resets the throw count: only throws in a row hold the run', async () => {
    const { h, files } = mk({ files: READY, mission: false }); delete files[`${ROOT}/CHANGELOG.md`]
    await start(h, 'init'); await h.secret.update(s => ({ ...s, run: { ...s.run!, errs: 2 } })); await pump(h)
    expect((await h.secret.read()).run?.errs).toBe(0)
  })
  test("another frame's throw between this frame's read and write is never lost: the count is one update", async () => {
    const { h, files } = mk({ files: READY, mission: false }); delete files[`${ROOT}/CHANGELOG.md`]
    await start(h, 'init'); await h.secret.update(s => ({ ...s, run: { ...s.run!, errs: 1 } }))
    let race = false; h.submit = async () => { race = true; throw new Error('host busy') }
    const other = () => h.secret.update(s => (s.run ? { ...s, run: { ...s.run, errs: (s.run.errs ?? 0) + 1 } } : s))   // the other frame counts its own throw
    const { read, update } = h.secret
    h.secret.read = async () => { const v = await read(); if (race) { race = false; await other() } return v }
    h.secret.update = async f => { if (race) { race = false; await other() } return update(f) }
    await pump(h); expect((await h.secret.read()).run).toBeUndefined(); expect((await card(h))!.title).toBe('init stopped · type anything to go on')   // 1 + theirs + ours = 3: held
  })
  test('a goal brief whose submit always throws is held after 3: one dialog, nothing more goes; a typed line lifts it; Drop clears it', async () => {
    const { h } = mk({ files: READY }); let tries = 0, fail = true; h.submit = async () => { tries++; if (fail) throw new Error('host busy'); return {} }
    await h.ui.update(u => ({ ...u, goal: 'plan it' })); for (let i = 0; i < 6; i++) await pump(h)
    expect(tries).toBe(3); expect((await h.ui.read()).goal).toBe('plan it'); expect((await h.board.read()).decisions?.filter(d => d.id === 'goal:held').map(d => d.title)).toEqual(['goal stopped · type anything to go on'])
    fail = false; await resume(h); expect(await card(h, 'goal:held')).toBeUndefined(); await pump(h)
    expect(tries).toBe(4); expect((await h.ui.read()).goal).toBeUndefined(); expect((await h.ui.read()).goalErrs).toBeUndefined()   // went through: the count starts over
    fail = true; await h.ui.update(u => ({ ...u, goal: 'plan that' })); for (let i = 0; i < 3; i++) await pump(h)
    expect((await route(h, { schemaVersion: 1, cmd: 'goal', args: ['drop'], origin: { kind: 'sdk' } } as any)).text).toMatch(/^refused/); expect((await h.ui.read()).goal).toBe('plan that')   // only a press drops it
    expect(parse('goal drop')).toEqual({ hint: HINT })   // typed, it is never a goal named "drop"
    const d = (await card(h, 'goal:held'))!; expect((await decide(h, d.id, 'x', d.hash)).text).toBe('goal dropped')
    expect((await h.ui.read()).goal).toBeUndefined(); expect((await h.ui.read()).held).toBeUndefined(); expect(await card(h, 'goal:held')).toBeUndefined()
  })
  test('a replaced goal is told to the human, not only logged', async () => {
    const { h } = mk({ files: { ...READY, [`${PLUG}/guides/goal.md`]: (BUDGET.guides as Record<string, string>).goal } }); await items(h); await confirm(h)
    await goalBrief(h, 'add login'); await goalBrief(h, 'add logout'); expect(h.toasts).toContain('your queued goal was replaced: add login')
    await start(h, 'init', { text: 'add search', mode: 'auto' }); expect(h.toasts).toContain('your queued goal was replaced: add logout')
  })
  test('a retry keeps the newer goal the human queued; a fresh goal replaces the queued one; neither is dropped without a log line', async () => {
    const a = mk({ files: READY }); await items(a.h); await confirm(a.h)
    await a.h.ui.update(u => ({ ...u, goal: 'Goal from the user: newer' })); await start(a.h, 'init', { text: 'older', mode: 'auto' }, 0)
    expect((await a.h.ui.read()).goal).toBe('Goal from the user: newer'); expect(a.h.logs.some(l => l.includes('older'))).toBe(true)
    const b = mk({ files: { ...READY, [`${PLUG}/guides/goal.md`]: (BUDGET.guides as Record<string, string>).goal } }); await items(b.h); await confirm(b.h)
    await b.h.ui.update(u => ({ ...u, goal: 'Goal from the user: older' })); await start(b.h, 'init', { text: 'newer', mode: 'auto' })
    expect((await b.h.ui.read()).goal).toMatch(/^Goal from the user: newer/); expect(b.h.logs.some(l => l.includes('older'))).toBe(true)
  })
  test('a refused goal brief waits for the human: no submit until they type', async () => {
    const { h, sent } = mk({ files: READY }); let stopped = true, tries = 0; h.submit = async (t: string) => (tries++, stopped ? { drop: 'the session was stopped' } : (sent.push(t), {}))
    await h.ui.update(u => ({ ...u, goal: 'plan it' })); await pump(h); await pump(h); await pump(h)
    expect(tries).toBe(1); expect((await h.ui.read()).goal).toBe('plan it')
    stopped = false; await resume(h); await pump(h); expect(sent).toEqual(['plan it']); expect((await h.ui.read()).goal).toBeUndefined()
  })
  test('only the human owes something (mission card, safety card): the card says so and nothing is sent to main', async () => {
    const { h, sent, tick } = mk({ files: READY, mission: false }); await h.board.update(b => ({ ...b, plan: { id: 'm', slug: 'mission', state: 'draft', epicBranch: '' } }))
    await start(h, 'init'); await tick(); sent.length = 0; await turnEnd(h, {}); await tick()
    expect(sent).toEqual([]); expect((await card(h))!.title).toBe('init · 6/8 done · needs you'); expect((await card(h, 'init:5'))).toBeDefined()
  })
  test('done: the run ends (and with it the lease), the card says all done with Close, a toast; a confirm on the safety card finishes it', async () => {
    const { h, tick } = mk({ files: READY }); await start(h, 'init'); await tick()
    expect((await cadreRun(h, { args: 'init confirm', origin: { kind: 'press' } }, () => ({}))).text).not.toContain('written')   // typed never confirms (ADR 0012); the card stays
    const d = (await card(h, 'init:5'))!; expect((await decide(h, d.id, 'a', d.hash)).text).toBe('init: safety settings written · restart Claude Code for the task-tool settings to apply · init: all done')
    expect((await h.secret.read()).run).toBeUndefined(); const c = (await card(h))!; expect(c.title).toBe('init · all done'); expect(c.options.map(o => o.label)).toEqual(['Close']); expect(h.toasts).toContain('cadre: init done')
    expect((await decide(h, c.id, 'c', c.hash)).text).toBe('init: cancelled'); expect(await card(h)).toBeUndefined()
  })
  test('killed mid-setup: the next session names the interrupted setup (status and band), with the queued goal; the goal picks it up; done or cancel forgets it', async () => {
    const { h, files } = mk({ files: READY, mission: false }); delete files[`${ROOT}/CHANGELOG.md`]
    await start(h, 'init'); expect((await cadreRun(h, { args: 'add a login page', origin: { kind: 'composer' } }, () => ({}))).text).toBe(SETTING_UP)   // queued behind the run
    await h.secret.update(({ run: _r, ...x }) => x); await h.board.update(b => ({ ...b, decisions: [] }))   // Claude Code killed: session memory and the dialog are gone, $.store and the files stay
    expect(await statusLine(h)).toBe('Setup was interrupted · /cadre add a login page to pick it up')
    await halt(h); const v = { b: await h.board.read(), ring: [], sec: await h.secret.read(), ui: await h.ui.read(), c: { maxTurns: 100 }, now: 0, sx: 'strict', t: null } as any
    expect(txt(band2(v, 120, { go() {}, pick() {}, answer() {}, step() {} })).join('\n')).toContain('Setup was interrupted · /cadre add a login page to pick it up')
    expect((await cadreRun(h, { args: 'add a login page', origin: { kind: 'composer' } }, () => ({}))).text).toBe('init: Claude is on it · progress in the cadre pane · then your goal')
    expect((await h.secret.read()).run).toMatchObject({ kind: 'init', goal: { text: 'add a login page' } })
    expect(await statusLine(h)).not.toContain('press 1')   // the run's checklist is progress: 1 opens nothing (live 0.11.0)
    files[`${ROOT}/CHANGELOG.md`] = skeleton(); await turnEnd(h, {})
    await h.secret.update(({ run: _r, ...x }) => x); expect(await statusLine(h)).not.toContain('interrupted')
    await start(h, 'setup'); await h.secret.update(({ run: _r, ...x }) => x); await h.board.update(b => ({ ...b, decisions: [] })); expect(await statusLine(h)).toBe('Setup was interrupted · /cadre setup to pick it up')
    await cancel(h, 'setup'); expect(await statusLine(h)).not.toContain('interrupted')
  })
  test('nothing open: /cadre init says all done and starts nothing', async () => {
    const { h, tick, sent } = mk({ files: READY }); await items(h); await confirm(h)
    expect(await start(h, 'init')).toBe('init: all done'); await tick(); expect(sent).toEqual([]); expect((await h.secret.read()).run).toBeUndefined()
  })
  test('limits: 20 main turns or 30 minutes stop the run', async () => {
    const { h, tick } = mk({ repo: false, mission: false }); await start(h, 'init'); await tick()
    await h.secret.update(s => ({ ...s, run: { ...s.run!, turns: LIMIT.turns - 1 } })); await turnEnd(h, {})
    expect((await card(h))!.lines[0]).toBe('the time or turn limit was reached'); expect((await h.secret.read()).run).toBeUndefined()
    await start(h, 'init'); await h.secret.update(s => ({ ...s, run: { ...s.run!, at: -LIMIT.ms } })); expect(await recheck(h)).toBe('init: stopped · press 1')
  })
  // Regression (0.6.1, real machine): init stuck at "init 4/8 discovery · Claude is on it" after the explorer finished and main summarized in chat.
  // Cause: stage 4 waited on ui.discoveryAgent, set at spawn and cleared only by an accepted report{discovery}; an unbound explorer that stopped without
  // one (text answer, refused report) is outside close.observe's nudge/auto-report, so init.after returned early forever. Now nothing waits on an agent:
  // the state is the files, re-checked at every main turn end.
  test('regression: main answers in chat without writing the commands: the card does not stay "Claude is on it"; it is told what is missing, then the dialog', async () => {
    const { h, sent, tick } = mk({ files: { ...READY, [CFG]: JSON.stringify({ branches: { main: 'main', dev: 'dev' } }) } })
    await start(h, 'init'); await tick(); sent.length = 0
    for (let i = 0; i < 4; i++) { await turnEnd(h, {}); await tick() }   // each turn: main "summarized the discovery in chat", nothing written
    expect(sent).toHaveLength(3); expect(sent[0]).toContain('1. build and test commands: no units in .cadre/config.json')
    expect((await card(h))!.title).toBe('init · Claude stopped · 3 left'); expect((await card(h))!.options.map(o => o.label)).toContain('Let Claude try again')
  })
  // live 0.9.1 (2.1.296, a folder with no git): Claude stopped early and the run sat in "running" with nothing working. Claude's stop is refused while a check
  // it owns is red; a stop with no tool call since the last refusal means it cannot go on; then ONE dialog for the human. Never a silent spinner.
  test('stop with red checks: refused with the list and the guide step; a second stop without trying is let through, and the dialog shows Claude\'s words', async () => {
    const { h, sent, tick } = mk({ repo: false, branches: [], mission: false }); await start(h, 'init'); await tick(); sent.length = 0
    const b1 = await stopCheck(h, { last_assistant_message: 'I looked around.' })
    expect(b1).toBe(`Setup is not done: these checks still fail.\n1. repository: no git repository yet (phase 1)\n2. mission: no mission yet (phase 3)\n3. build and test commands: no units in .cadre/config.json (phase 4)\n4. changelog: CHANGELOG.md is missing (phase 5)\nFix them now, following ${PLUG}/guides/init.md. If you cannot fix one, say which one and why, then stop.`)
    expect(banned(b1!)).toEqual([])
    expect(await stopCheck(h, { last_assistant_message: 'I cannot run git here: the folder is read-only.' })).toBeNull()   // no tool call since: it says it cannot
    await turnEnd(h, { answer: 'I cannot run git here: the folder is read-only.' }); await tick()
    const d = (await card(h))!; expect(d.quiet).toBeUndefined(); expect(d.title).toBe('init · Claude stopped · 7 left')
    expect(d.lines.slice(0, 2)).toEqual(['Claude stopped with checks still failing', 'Claude: "I cannot run git here: the folder is read-only."'])
    expect(d.options.map(o => o.label)).toEqual(['Let Claude try again', 'Stop setup']); expect(sent).toEqual([])   // no follow-up: the human decides
    expect((await h.secret.read()).run).toBeUndefined(); expect(await statusLine(h)).toBe('setup · 1 needs you · press 1 to answer')
  })
  test('three refusals, each after Claude tried (tool calls): the fourth stop goes through and the dialog says so; a green stop is never refused', async () => {
    const { h, tick, files } = mk({ files: READY, mission: false }); delete files[`${ROOT}/CHANGELOG.md`]; await start(h, 'init'); await tick()
    for (let i = 0; i < 3; i++) { expect(await stopCheck(h, {})).toContain('changelog: CHANGELOG.md is missing (phase 5)'); await seen(h, { tool: true }) }
    expect(await stopCheck(h, {})).toBeNull(); await turnEnd(h, {})
    expect((await card(h))!.lines[0]).toBe('Claude stopped 3 times with checks still failing')
    const g = mk({ files: READY }); await start(g.h, 'init'); expect(await stopCheck(g.h, {})).toBeNull()
  })
  test('each tool result in a run names what is still red, cheaply (no clean-checkout run); nothing when green or with no run', async () => {
    const { h, calls, files } = mk({ files: READY, mission: false }); delete files[`${ROOT}/CHANGELOG.md`]; expect(await redNote(h)).toBeNull()
    await start(h, 'init'); calls.length = 0
    expect(await redNote(h)).toBe('setup still open: mission (no mission yet); changelog (CHANGELOG.md is missing)')
    expect(calls.some(a => a[0] === 'bwrap')).toBe(false)
    h.shell = async () => `${ROOT}/kit`; expect(await redNote(h)).toBe(`setup still open: mission (no mission yet); changelog (CHANGELOG.md is missing) · your shell is in ${ROOT}/kit; the project root is ${ROOT}`)   // main's Bash was left in a package folder
    h.shell = async () => ROOT; expect(await redNote(h)).not.toContain('your shell')
    files[`${ROOT}/CHANGELOG.md`] = skeleton(); await h.board.update(b => ({ ...b, mission: 'ship it' })); expect(await redNote(h)).toBeNull()
  })
  test('Let Claude try again: the same run, the goal still queued', async () => {
    const { h, sent, tick } = mk({ repo: false, branches: [], mission: false })
    await start(h, 'init', { text: 'implement MGIoU 1D', mode: 'auto' }); await tick(); await stopCheck(h, {}); await stopCheck(h, {}); await turnEnd(h, {}); sent.length = 0
    const d = (await card(h))!; expect((await decide(h, d.id, 'r', d.hash)).text).toBe('init: Claude is on it · progress in the cadre pane · then your goal'); await tick()
    expect((await h.secret.read()).run).toMatchObject({ follow: 1, goal: { text: 'implement MGIoU 1D', mode: 'auto' } }); expect(sent[0]).toMatch(/^The user asked you to go on: do it now\. .*then plan the user's goal/)
    expect(banned(sent[0])).toEqual([])
  })
  // live 0.12.0 (an Esc on a write, then 29 retries): every "Let Claude try again" refilled the stop budget, so Claude was refused once per retry forever.
  // ONE budget per run: a retry keeps the refusals spent; a stop with no tool call after it is the dialog at once, and 3 refusals in all is the cap.
  test('Let Claude try again never refills the stop refusals: no 4th refusal across retries', async () => {
    const { h, tick, files } = mk({ files: READY, mission: false }); delete files[`${ROOT}/CHANGELOG.md`]; await start(h, 'init'); await tick()
    const retry = async () => { await turnEnd(h, {}); const d = (await card(h))!; expect(d.options.map(o => o.label)).toContain('Let Claude try again'); await decide(h, d.id, 'r', d.hash); await tick() }
    let refused = 0
    for (let n = 0; n < 6; n++) {   // each retry: Claude tries once (a tool call), stops, stops again
      if (await stopCheck(h, {})) refused++; await seen(h, { tool: true })
      if (await stopCheck(h, {})) refused++
      expect(await stopCheck(h, {})).toBeNull(); await retry()
    }
    expect(refused).toBe(LIMIT.follow)
    expect(await stopCheck(h, {})).toBeNull()   // straight to the dialog
  })
  test('the watchdog: a run whose main went quiet is checked as if Claude stopped; a turn still on waits 10 minutes; the human\'s card is not a stall', async () => {
    const { h, sent, tick } = mk({ repo: false, branches: [], mission: false }); let t = 0; Object.assign(h, { now: async () => t })
    await start(h, 'init'); await tick(); sent.length = 0
    await seen(h, { start: true }); t = QUIET.idle + 1; await watch(h); await tick(); expect(sent).toEqual([])   // a turn is on: not yet
    t = QUIET.busy + 1; await watch(h); await tick(); expect(sent).toHaveLength(1); expect(sent[0]).toMatch(/^Setup is not done/)   // the turn end never came: the follow-up goes
    await h.secret.update(s => ({ ...s, run: { ...s.run!, stopSeen: true } })); t += QUIET.idle + 1; await watch(h)
    expect((await card(h))!.title).toBe('init · Claude stopped · 7 left')   // the stop check runs here: the dialog
    const w = mk({ files: READY }); let u = 0; Object.assign(w.h, { now: async () => u }); await start(w.h, 'init'); await w.tick()
    u = QUIET.idle + 1; await watch(w.h); expect((await w.h.secret.read()).run).toBeDefined()   // only the safety card waits, for the human
  })
  test('a folder with no git: Claude runs git init and the first commit, the checks pass, the safety confirm, then the goal', async () => {
    const { h, g, files, sent, tick } = mk({ repo: false, branches: [], mission: false, files: { [`${PLUG}/guides/goal.md`]: (BUDGET.guides as Record<string, string>).goal } })
    await start(h, 'init', { text: 'implement MGIoU 1D', mode: 'auto' }); await tick()
    expect(await stopCheck(h, {})).toContain('repository: no git repository yet (phase 1)'); await seen(h, { tool: true })
    g.repo = true; g.branches.add('main'); g.branches.add('dev'); Object.assign(files, READY)   // git init -b main, the first commit, dev, exclude, config, changelog
    expect(await stopCheck(h, {})).toBeNull(); await turnEnd(h, {}); const c = (await card(h, 'init:5'))!
    expect((await decide(h, c.id, 'a', c.hash)).text).toBe('init: safety settings written · restart Claude Code for the task-tool settings to apply · init: all done · Claude plans your goal'); await tick()
    expect(sent.at(-1)).toMatch(/^Goal from the user: implement MGIoU 1D/)
  })
  test('cancel ends the run and its lease; the card goes', async () => {
    const { h, tick } = mk({ repo: false }); await start(h, 'init'); await tick()
    const d = (await card(h))!; expect((await decide(h, d.id, 'x', d.hash)).text).toBe('init: cancelled')
    expect((await h.secret.read()).run).toBeUndefined(); expect(await card(h)).toBeUndefined()
  })
})

describe('maintenance lease (ADR 0010): main during a human-started run', () => {
  const lease = async () => {
    const { h, tick } = mk({ files: READY }); const EX = ['/', '/repo', '/repo/.cadre', '/repo/src', '/hm', '/hm/u', '/hm/u/.claude', `${HOME}/.claude/plugins/store/cadre/guides`, '/repo/.git', '/repo/.git/info', '/repo/.claude']
    h.stat = async (p: string, o?: { resolve?: boolean }) => (EX.includes(p) || EX.includes(p.slice(0, p.lastIndexOf('/'))) ? { kind: 'file', realPath: o?.resolve ? p : undefined } : undefined)
    Object.assign(h, { root: async () => `${HOME}/.claude/plugins/store/cadre` })
    await setPolicy(h, { repo: ROOT, home: HOME, changelog: 'CHANGELOG.md' })
    const call = async (tool: string, file_path?: string) => ((await guard(h, { tool, file_path, input: { file_path } }, () => 'ok')) as any)?.deny ?? 'ok'
    return { h, tick, call }
  }
  const ALLOWED = [`${ROOT}/.cadre/config.json`, `${ROOT}/.git/info/exclude`, `${ROOT}/CHANGELOG.md`], SETTINGS = [`${ROOT}/.claude/settings.local.json`, `${ROOT}/.claude/settings.json`, `${HOME}/.claude/settings.json`, `${HOME}/.claude/settings.local.json`]
  test('no run: main has no shell and none of the setup files; settings files are refused with the card wording', async () => {
    const { call } = await lease(); expect(await call('Bash')).toContain('not available to main')
    for (const p of SETTINGS) expect(await call('Edit', p)).toBe('these settings are applied for you after the human confirms them in the dialog')
    for (const p of ALLOWED) expect(await call('Write', p)).not.toBe('ok')
  })
  test('during a run: Bash, Write/Edit on the setup files only, Read of the guide; never source files; activation keeps it', async () => {
    const { h, tick, call } = await lease(); await start(h, 'init'); await tick()
    expect(await call('Bash')).toBe('ok')
    for (const p of ALLOWED) { expect(await call('Write', p)).toBe('ok'); expect(await call('Edit', p)).toBe('ok') }
    for (const p of [`${ROOT}/src/a.ts`, `${ROOT}/.git/config`, `${HOME}/.claude/cadre.json`]) expect(await call('Write', p)).not.toBe('ok')
    for (const p of SETTINGS) for (const t of ['Write', 'Edit']) expect(await call(t, p)).toBe('these settings are applied for you after the human confirms them in the dialog')   // never, lease or not
    expect(await call('Read', `${HOME}/.claude/plugins/store/cadre/guides/init.md`)).toBe('ok')
    await h.secret.update(s => ({ ...s, active: false })); expect(await wake(h)).toBe(true); expect(await call('Bash')).toBe('ok')   // .cadre/config.json appeared mid-run: still leased
  })
  test('expires: after 20 main turns or 30 minutes, and on cancel', async () => {
    const { h, tick, call } = await lease(); await start(h, 'init'); await tick()
    await h.secret.update(s => ({ ...s, run: { ...s.run!, turns: LIMIT.turns } })); expect(await call('Bash')).not.toBe('ok')
    await h.secret.update(s => ({ ...s, run: { ...s.run!, turns: 0, at: -LIMIT.ms } })); expect(await call('Write', ALLOWED[0])).not.toBe('ok')
    await start(h, 'init'); expect(await call('Bash')).toBe('ok'); const d = (await card(h, 'run:init'))!; await decide(h, d.id, 'x', d.hash); expect(await call('Bash')).not.toBe('ok')   // the card's Cancel; typed cancel does not exist
  })
})

describe('settings watch (ADR 0010): a settings file changed outside cadre during a run', () => {
  const SET = `${ROOT}/.claude/settings.local.json`, USR = `${HOME}/.claude/settings.json`
  test('a change by a command stops the run with a CRIT card (diff) and Restore puts the bytes back (the changed file kept aside)', async () => {
    const { h, files, sent, tick } = mk({ repo: false, mission: false, files: { [USR]: '{"env":{}}' } }); await start(h, 'init'); await tick(); sent.length = 0
    files[USR] = '{"env":{},"permissions":{"allow":["Bash(*)"]}}'   // e.g. echo > ~/.claude/settings.json from Bash
    await turnEnd(h, {}); await tick()
    expect((await h.secret.read()).run).toBeUndefined(); expect(sent).toEqual([]); expect(await card(h)).toBeUndefined()
    const d = (await card(h, 'run:settings'))!; expect(d.crit).toBe(true); expect(d.title).toBe('settings-changed · init stopped'); expect(d.lines.join('\n')).toContain('~/.claude/settings.json:'); expect(d.lines.join('\n')).toContain('permissions.allow')
    expect(d.options.map(o => o.label)).toEqual(['Restore', 'Keep']); expect(h.logs.some(l => l.startsWith('settings-changed'))).toBe(true)
    expect((await decide(h, d.id, 'r', d.hash)).text).toBe('init: settings restored · run /cadre init to go on')
    expect(files[USR]).toBe('{"env":{}}'); expect(files[`${USR}.cadre-changed`]).toContain('Bash(*)'); expect(await card(h, 'run:settings')).toBeUndefined()
  })
  test('Keep accepts the change; a file created during the run counts too', async () => {
    const { h, files, tick } = mk({ repo: false, mission: false }); await start(h, 'init'); await tick()
    files[SET] = '{"sandbox":{"enabled":false}}'; await turnEnd(h, {})
    const d = (await card(h, 'run:settings'))!; expect(d.lines.join('\n')).toContain('.claude/settings.local.json:')
    expect((await decide(h, d.id, 'k', d.hash)).text).toBe('init: settings kept · run /cadre init to go on'); expect(files[SET]).toBe('{"sandbox":{"enabled":false}}')
  })
  test("cadre's own confirmed write (the safety settings card) is not a change from outside", async () => {
    const { h, tick } = mk({ files: { ...READY, [`${ROOT}/.claude/settings.local.json`]: '{}' } }); await start(h, 'init'); await tick()
    const d = (await card(h, 'init:5'))!; expect((await decide(h, d.id, 'a', d.hash)).text).toBe('init: safety settings written · restart Claude Code for the task-tool settings to apply · init: all done')
    expect(await card(h, 'run:settings')).toBeUndefined()
  })
  test('a repo where cadre is off: during a run only the settings rule applies', async () => {
    const { h } = mk({ repo: false }); const pass = () => 'ok'
    expect(await settingsOnly(h, { tool: 'Write', file_path: `${HOME}/.claude/settings.json` }, pass)).toEqual({ deny: 'these settings are applied for you after the human confirms them in the dialog' })
    expect(await settingsOnly(h, { tool: 'Write', file_path: `${ROOT}/a.ts` }, pass)).toBe('ok'); expect(await settingsOnly(h, { tool: 'Bash' }, pass)).toBe('ok')
  })
})

describe('agent-run setup', () => {
  test('git identity missing: Claude gets the setup guide; once it is set, the turn end finds everything green, stamps, ends the run', async () => {
    const tools: Record<string, string> = { git: 'git version 2.43.0', bwrap: 'bubblewrap 0.11.0', socat: 'x', npm: '10.0.0' }; let ident = false
    const { h, sent, tick } = mk({ files: { [`${HOME}/.claude/settings.json`]: '{"env":{"CLAUDE_CODE_ENABLE_TODO_TOOLS":"1"}}' }, extra: argv => {
      if (argv[0] === 'git' && argv[1] === '--version') return { exitCode: 0, stdout: tools.git }
      if (argv[0] === 'git' && argv[1] === 'var') return ident ? { exitCode: 0, stdout: 'A <a@b> 1 +0000' } : { exitCode: 128, stdout: '' }
      if (argv[0] === 'bwrap') return { exitCode: 0, stdout: argv[1] === '--help' ? '--overlay-src' : tools.bwrap }
      if (argv[0] === 'test' || argv[0] === 'chmod' || argv[0] === 'uname') return { exitCode: 0, stdout: argv[0] === 'uname' ? 'Linux' : '' }
      if (argv[0] in tools) return { exitCode: 0, stdout: tools[argv[0]] }
      return argv[0] === 'git' ? undefined : { exitCode: 127 }
    } })
    expect(await start(h, 'setup')).toBe('setup: Claude is on it · progress in the cadre pane'); await tick()
    expect(sent).toEqual([`Set up cadre on this machine. Follow ${PLUG}/guides/setup.md step by step.`])
    expect((await card(h, 'run:setup'))!.lines).toContain('✗ git identity missing: commits need your name and email: ask for them, then git config --global user.name and user.email')
    ident = true; await turnEnd(h, {}); await tick()   // Claude asked and set it with a visible Bash call
    expect((await card(h, 'run:setup'))!.title).toBe('setup · all done'); expect((await h.secret.read()).run).toBeUndefined(); expect(await h.store.get('cadre:setup')).toMatchObject({ cc: expect.any(String) })
    expect(sent).toHaveLength(1)
  })
})

describe('guides', () => {
  test('the guides speak task language (commands in backticks are literal), name every phase, and match the checks', () => {
    const g = BUDGET.guides as Record<string, string>
    expect(Object.keys(g)).toEqual(['deep', 'goal', 'init', 'setup'])   // goal: tests/lanes.test.ts · deep: tests/clarify.test.ts
    for (const t of [g.init, g.setup]) { expect(banned(t.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, ''))).toEqual([]); expect(t).toContain('AskUserQuestion'); expect(t).not.toContain('sudo apt') }
    expect(g.init).toContain('`.cadre/state/`'); expect(g.init).toContain('"kind": "mission"'); expect(g.init).toContain(skeleton().trim())
    for (const t of [g.init, g.setup]) expect(t).not.toMatch(/\bbd\b|beads/i); expect(g.setup).toContain('confirm the user settings'); expect(g.setup).toContain('Never edit a Claude Code settings file'.slice(0, 10))   // init: the fence refuses a settings edit (policy/guards SETTINGS_DENY)
  })
})

test('rootFor: an agent cwd (worktree or view) maps back to the repo root recorded at session start; unknown paths stay', () => {
  const roots = { [RK]: ROOT }
  expect(rootFor(roots, `/c/wt/${RK}/bd-1`)).toBe(ROOT); expect(rootFor(roots, `/c/wt/${RK}.views/bd-1/x`)).toBe(ROOT); expect(rootFor(roots, '/else')).toBe('/else')
})

// ADR 0014: init folded into the first goal. Typing a goal in a repo cadre is not set up in is the opt-in; three dialogs in all (Set up, safety, mission + plan)
describe('onboarding: /cadre <goal> in a repo cadre is not set up in', () => {
  const { [CFG]: _cfg, ...BARE } = READY
  const boot = (o: { setUp?: boolean } = {}) => {
    const w = mk({ files: { ...BARE, [`${PLUG}/guides/goal.md`]: (BUDGET.guides as Record<string, string>).goal }, mission: false })
    Object.assign(w.h, { taskStore: async () => w.s }); void w.h.secret.update(() => ({})); if (o.setUp !== false) void w.h.store.set('cadre:setup', { at: 0 })
    const asked = new Set<string>(), seen = async () => { for (const d of (await w.h.board.read()).decisions ?? []) if (!d.quiet) asked.add(d.id) }
    return { ...w, asked, seen }
  }
  const goal = (h: Host, args: string) => cadreRun(h, { args, origin: { kind: 'composer' } }, () => ({})) as Promise<{ text: string }>
  test('Set up: one dialog, the visible init run without the mission round, the safety confirm, then the goal goes to Claude with a mission to draft into the plan', async () => {
    const { h, files, sent, tick, asked, seen, s } = boot()
    expect((await goal(h, 'fix the login bug')).text).toBe('cadre is not set up here yet · answer the dialog (press 1)'); await seen()
    const d = (await card(h, 'init:goal'))!; expect(d.title).toBe("cadre isn't set up here. Set it up and plan this goal?"); expect(d.options.map(o => o.label)).toEqual(['Set up', 'Not now'])
    expect((await decide(h, d.id, 's', d.hash)).text).toBe('init: Claude is on it · progress in the cadre pane · then your goal'); await tick()
    expect(sent[0]).toBe(`Set up cadre in this project, then plan the user's goal (it comes next). Follow ${PLUG}/guides/init.md step by step. The project root is ${ROOT}: start every Bash call with cd "${ROOT}" && and give files there by their full path. Skip the mission question: you draft the mission together with the plan.`)
    expect((await card(h))!.lines).toContain('✓ mission: you approve it with the plan'); expect(await card(h, 'init:goal')).toBeUndefined()
    files[CFG] = READY[CFG]; await turnEnd(h, {}); await tick(); await seen()   // Claude wrote the config (phase 1, 4); the rest already holds
    expect((await card(h))!.quiet).toBe(true)   // the checklist never pops in a goal run: only the safety card does
    const c = (await card(h, 'init:5'))!; expect((await decide(h, c.id, 'a', c.hash)).text).toBe('init: safety settings written · restart Claude Code for the task-tool settings to apply · init: all done · Claude plans your goal')
    expect(await card(h)).toBeUndefined(); expect((await h.secret.read()).run).toBeUndefined(); await tick()
    expect(sent.at(-1)).toMatch(/^Goal from the user: fix the login bug\nThere is no mission yet\.\n\n# Work on a goal/)
    expect((await wake(h))).toBe(true)
    const call = (input: Record<string, unknown>) => taskCall(h, { tool: 'TaskCreate', tool_use_id: 'u', ...input }, async () => 'NEXT') as Promise<any>
    const mission = 'Goal: login works for every user\nConstraints: no new deps\nNon-goals: SSO'
    const r = await call({ subject: 'Fix login', description: 'the session cookie is dropped', metadata: { kind: 'plan', lane: 'lite', reason: 'one small fix', type: 'bug', changelog: { category: 'Fixed', entry: 'Login keeps the session' }, mission } })
    const id = r.result.task.id as string; await seen()
    const p = (await card(h, `plan:${id}`))!; expect(p.title).toBe(`approve the mission and plan ${id}`); expect(p.lines[0]).toBe('mission: login works for every user')
    expect([...asked]).toEqual(['init:goal', 'init:5', `plan:${id}`])   // three dialogs in all
    expect((await decide(h, p.id, 'a', p.hash)).text).toMatch(new RegExp(`^Plan ${id} approved`))
    expect((await h.board.read()).mission).toBe('login works for every user'); expect((await s.list({})).some(t => t.type === 'milestone' && t.description === mission)).toBe(true)
  })
  test('Not now: the dialog goes and nothing else changes', async () => {
    const { h, files, sent, tick } = boot(), before = JSON.stringify(files)
    await goal(h, 'fix the login bug'); const d = (await card(h, 'init:goal'))!
    expect((await decide(h, d.id, 'x', d.hash)).text).toBe('init: cancelled'); await tick()
    expect((await h.board.read()).decisions ?? []).toEqual([]); expect((await h.secret.read()).run).toBeUndefined(); expect(sent).toEqual([]); expect(JSON.stringify(files)).toBe(before); expect(await wake(h)).toBe(false)
  })
  test('yolo: the mode rides through the init run onto the goal; a machine without setup gets the welcome line instead of the dialog', async () => {
    const { h, files, tick } = boot()
    await goal(h, 'yolo fix the login bug'); const d = (await card(h, 'init:goal'))!; await decide(h, d.id, 's', d.hash)
    expect((await h.secret.read()).run?.goal).toEqual({ text: 'fix the login bug', mode: 'yolo' })
    files[CFG] = READY[CFG]; await turnEnd(h, {}); const c = (await card(h, 'init:5'))!
    expect((await decide(h, c.id, 'a', c.hash)).text).toBe('init: safety settings written · restart Claude Code for the task-tool settings to apply · init: all done · Claude plans your goal'); await tick()
    expect((await h.ui.read()).mode).toBe('yolo')
    const n = boot({ setUp: false }); expect((await goal(n.h, 'fix it')).text).toBe('Welcome to cadre · run /cadre setup once on this machine'); expect((await n.h.board.read()).decisions ?? []).toEqual([])
  })
  // live 0.9.1 (a user's monorepo): /clear, a goal, Set up; a pointer left by an earlier session named a draft the store did not have; the goal was typed again mid-init
  test('a second goal while setting up waits, once (the newest text); a stale draft pointer never blocks; still exactly 3 dialogs and the plan is approvable', async () => {
    const { h, files, sent, tick, asked, seen } = boot()
    await (await (h as any).taskStore()).setControl({ board: { mission: null, epic: 'my_project-32t', plan: { id: 'my_project-32t', slug: 'homepage', state: 'draft', epicBranch: '' }, drive: { on: false }, bind: {} } })
    await goal(h, 'fix the login bug'); await seen()
    expect((await goal(h, 'fix the login bug!')).text).toBe(SETTING_UP)   // the dialog is up: it shows the newest text
    expect((await card(h, 'init:goal'))!.lines[0]).toBe('fix the login bug!')
    const d = (await card(h, 'init:goal'))!; await decide(h, d.id, 's', d.hash); await tick()
    expect((await goal(h, 'fix the login bug, and the logout')).text).toBe(SETTING_UP)   // the init run is on: folded into it, no second goal run
    expect((await h.secret.read()).run?.goal).toEqual({ text: 'fix the login bug, and the logout', mode: 'auto' }); await tick()
    expect(sent.filter(t => t.startsWith('Goal from the user'))).toEqual([])
    files[CFG] = READY[CFG]; await warm(h); await turnEnd(h, {}); await tick(); await seen()   // any hook warms the board once the repo is on
    expect((await h.board.read()).plan).toBeNull()   // the pointer named a draft the store does not have: dropped, not resumed
    expect((await (await (h as any).taskStore()).control()).doc.board).toBeUndefined(); expect(h.logs.join('\n')).not.toContain('resumed')
    const c = (await card(h, 'init:5'))!; await decide(h, c.id, 'a', c.hash); await tick()
    expect(sent.filter(t => t.startsWith('Goal from the user'))).toEqual([expect.stringMatching(/^Goal from the user: fix the login bug, and the logout\n/)])
    const r = await taskCall(h, { tool: 'TaskCreate', tool_use_id: 'u', subject: 'Fix login', description: 'cookie', metadata: { kind: 'plan', lane: 'lite', reason: 'one fix', type: 'bug', changelog: { category: 'Fixed', entry: 'Login keeps the session' }, mission: 'Goal: login works' } }, async () => 'NEXT') as any
    const id = r.result.task.id as string; await seen()
    expect([...asked]).toEqual(['init:goal', 'init:5', `plan:${id}`])
    const p = (await card(h, `plan:${id}`))!; expect((await decide(h, p.id, 'a', p.hash)).text).toMatch(new RegExp(`^Plan ${id} approved`))
  })
  test('a repo already set up is unaffected: the goal goes straight to Claude, no dialog', async () => {
    const { h, tick, sent } = boot(); h.board.update(b => ({ ...b, mission: 'ship it' }))
    const w = mk({ files: { ...READY, [`${PLUG}/guides/goal.md`]: (BUDGET.guides as Record<string, string>).goal } }); void w.h.store.set('cadre:setup', { at: 0 })
    expect((await goal(w.h, 'fix it')).text).toBe('goal: Claude is on it · the plan comes up for approval'); await w.tick()
    expect((await w.h.board.read()).decisions ?? []).toEqual([]); expect(w.sent[0]).toMatch(/^Goal from the user: fix it\n\n# Work on a goal/); void tick; void sent
  })
})

// team decision (ADR 0014): in a goal run a check red on the clean checkout is often the goal's own bug: known red, confirmed knowingly on the safety card, cleared on a green landing
describe('known red before a goal', () => {
  const USR = `${HOME}/.claude/cadre.json`
  test('red at init in a goal run: not a failure; the safety card names it; Confirm grants it in the user layer; the audit then passes it as known red', async () => {
    const { h, files } = mk({ files: READY, extra: jailed(['npm test']) })
    await h.secret.update(s => ({ ...s, run: { kind: 'init' as const, at: 0, turns: 0, follow: 0, guide: 'g', goal: { text: 'fix it', mode: 'auto' as const } } }))
    expect((await items(h))['commands pass on a clean checkout']).toBe('ok: known red before your goal: .: test · it must turn green')
    const d = (await card(h, 'init:5'))!; expect(d.lines).toContain('  known red before your goal: .: test · it must turn green')
    expect(await confirm(h)).toBe('init: safety settings written · restart Claude Code for the task-tool settings to apply')
    expect(JSON.parse(files[USR]).repos[RK].units).toEqual([{ root: '.', knownRed: ['test'] }])
    expect((await load(h, { home: HOME, root: ROOT, repoKey: RK })).config.units[0].knownRed).toEqual(['test'])
    const plain = mk({ files: READY, extra: jailed(['npm test']) }); expect((await items(plain.h))['commands pass on a clean checkout']).toContain('fail: .: test fails on a clean checkout')   // no goal: unchanged
  })
  test('green after a landing: the mark goes, recorded; nothing else in the file moves', async () => {
    const { h, files, s } = mk({ files: { ...READY, [USR]: JSON.stringify({ theme: 'dark', repos: { [RK]: { jailWritable: ['/x'], units: [{ root: '.', knownRed: ['test', 'lint'] }] } } }) } })
    await clearKnownRed(h, [{ root: '.', n: 'test' }], 'p1')
    expect(JSON.parse(files[USR])).toEqual({ theme: 'dark', repos: { [RK]: { jailWritable: ['/x'], units: [{ root: '.', knownRed: ['lint'] }] } } }); expect(files[`${USR}.bak`]).toContain('"test"')
    expect((await s.list({})).some(t => t.type === 'decision' && t.title === 'known red is green now: .: test')).toBe(true)
  })
  test('the setup commit: cadre commits config + changelog after the confirm and brings dev along when it is behind', async () => {
    const { h, calls } = mk({ files: READY, extra: argv => {
      const j = argv.join(' ')
      if (j.startsWith('git status --porcelain')) return { exitCode: 0, stdout: '?? CHANGELOG.md\n' }
      if (j === 'git symbolic-ref --short -q HEAD') return { exitCode: 0, stdout: 'main\n' }
      if (j === 'git rev-parse dev') return { exitCode: 0, stdout: 'old\n' }
      if (j === 'git rev-parse HEAD') return { exitCode: 0, stdout: 'new\n' }
      return jailed()(argv)
    } })
    await initItems(h); expect(await confirm(h)).toBe('init: safety settings written · setup committed · restart Claude Code for the task-tool settings to apply')
    expect(calls.map(a => a.join(' '))).toEqual(expect.arrayContaining(['git commit --no-verify -m chore: set up cadre -- CHANGELOG.md', 'git merge-base --is-ancestor old new', 'git update-ref refs/heads/dev new old']))
  })
})

// live (quick tier, a folder with no git, Esc mid-setup): after setup main chose the lane, said "next is step 2" and stopped; nothing pushed it and no plan came.
// The setup run's stop check now covers a goal run until its lane's step is done, at most twice; a stop right after a question to the user goes through.
describe('a goal run: main does not stop before the lane\'s step', () => {
  const G = { ...READY, [`${PLUG}/guides/goal.md`]: (BUDGET.guides as Record<string, string>).goal }
  const lite = { tool: 'TaskCreate', tool_use_id: 'u', subject: 'Add titleCase', description: 'src/index.js', metadata: { kind: 'plan', lane: 'lite', reason: 'one function', type: 'feature', changelog: { category: 'Added', entry: 'titleCase' } } }
  const on = async () => { const m = mk({ files: G }); Object.assign(m.h, { taskStore: async () => m.s }); await warm(m.h); await goalBrief(m.h, 'add titleCase(s)'); expect(await stopCheck(m.h, {})).toBeNull(); await m.tick(); return m }   // not refused before main has the brief
  test('a stop with no plan is refused twice with the missing step; the third goes through and the band says the plan was not drafted', async () => {
    const { h } = await on()
    for (let i = 0; i < GOAL_FOLLOW; i++) { const t = await stopCheck(h, {}); expect(t).toMatch(/^The goal is not planned yet: draft the plan now\. plan \{/); expect(banned(t!)).toEqual([]); await seen(h, { tool: true, name: 'Read' }) }
    expect(await stopCheck(h, {})).toBeNull(); expect((await h.secret.read()).goalRun).toBeUndefined()
    expect((await h.ui.read()).halt).toBe("the plan wasn't drafted · /cadre add titleCase(s) to try again")
    expect(txt(band2({ b: await h.board.read(), ui: await h.ui.read(), sec: await h.secret.read() } as any, 100, {} as any)).join('\n')).toContain("the plan wasn't drafted")
    await goalBrief(h, 'add titleCase(s)'); expect((await h.ui.read()).halt).toBeUndefined()   // trying again clears it
  })
  test('the plan drafted (lite): the stop goes through and the run ends; an explore asked (ask) too', async () => {
    const { h } = await on(); expect(await stopCheck(h, {})).not.toBeNull()
    await taskCall(h, lite, async () => 'NEXT'); expect(await stopCheck(h, {})).toBeNull(); expect((await h.secret.read()).goalRun).toBeUndefined()
    const a = await on(); await seen(a.h, { name: 'mcp__cadre__explore', ask: true }); await seen(a.h, { name: 'mcp__cadre__explore', ask: true }); expect(await stopCheck(a.h, {})).toBeNull()   // the first is the clarify explorer
  })
  test('a denied Agent explorer is neither the clarify explorer nor the ask step: the goal still owes its plan', async () => {
    const { h } = await on(); for (let i = 0; i < 2; i++) await seen(h, { name: 'Agent', sub: 'cadre:explorer', ran: ran({ deny: 'no' }) })
    expect((await h.secret.read()).goalRun?.explored).toBeUndefined(); expect(await stopCheck(h, {})).toMatch(/^The goal is not planned yet/)
    await seen(h, { name: 'Agent', sub: 'cadre:explorer', ran: ran({ result: 'ok' }) }); expect((await h.secret.read()).goalRun?.explored).toBe(true)
  })
  test('the lite plan\'s own task counts even while its approval turns it open and the board still says draft (live: main drafted it again)', async () => {
    const m = await on(); await taskCall(m.h, lite, async () => 'NEXT'); await seen(m.h, { name: 'Read' })
    const p = (await m.h.board.read()).plan!, kid = (await m.s.list({ parent: p.id }))[0]; await m.s.approve([kid.id])   // mid-approval: the store moved, the board did not yet
    expect((await m.h.board.read()).plan!.state).toBe('draft'); await m.h.secret.update(x => ({ ...x, goalRun: { ...x.goalRun!, on: true } })); expect(await stopCheck(m.h, {})).toBeNull()
  })
  test('a second task with the subject (or the files and description) of an open task of the plan is refused, naming it', async () => {
    const { h } = await on(); await taskCall(h, { ...lite, metadata: { kind: 'plan', lane: 'full', reason: 'a feature' } }, async () => 'NEXT')
    const one = { tool: 'TaskCreate', tool_use_id: 'u', subject: 'Add titleCase', description: 'd', metadata: { type: 'feature', paths: ['src/title.js', 'test/title.test.js'] } }
    const a = await taskCall(h, one, async () => 'NEXT') as any, id = a.result.task.id
    expect((await taskCall(h, { ...one, subject: '  add  TITLECASE ' }, async () => 'NEXT') as any).deny).toBe(`${id} already covers this (the same title): amend ${id} instead of adding a second task`)
    expect((await taskCall(h, { ...one, subject: 'Other', metadata: { ...one.metadata, paths: ['test/title.test.js', 'src/title.js'] } }, async () => 'NEXT') as any).deny).toMatch(/already covers this \(the same files and description\)/)
    expect((await taskCall(h, { ...one, subject: 'Other', description: 'the next step on the same file', metadata: { ...one.metadata, paths: ['src/title.js', 'test/title.test.js'] } }, async () => 'NEXT') as any).result.task.id).toBeDefined()   // same files, another step: the overlap check orders them
  })
  test('a full plan with no tasks yet: refused naming the tasks', async () => {
    const { h } = await on(); await taskCall(h, { ...lite, metadata: { kind: 'plan', lane: 'full', reason: 'a feature' } }, async () => 'NEXT')
    expect(await stopCheck(h, {})).toMatch(/^Plan \S+ has no tasks yet: draft them now, one task call per task/)
  })
  test('a stop right after a question to the user is not refused and not counted', async () => {
    const { h } = await on(); await seen(h, { name: 'AskUserQuestion' }); expect(await stopCheck(h, {})).toBeNull()
    expect((await h.secret.read()).goalRun).toMatchObject({ follow: 0 }); await seen(h, { name: 'Read' }); expect(await stopCheck(h, {})).not.toBeNull()
  })
  test('the watchdog: a quiet main with no plan gets the missing step as its next brief', async () => {
    const m = await on(); let t = await m.h.now(); Object.assign(m.h, { now: async () => t }); await seen(m.h); m.sent.length = 0
    t += QUIET.idle - 1; await watch(m.h); await m.tick(); expect(m.sent).toEqual([])
    t += 2; await watch(m.h); await m.tick(); expect(m.sent).toEqual([expect.stringMatching(/^The goal is not planned yet/)])
  })
})

// ADR 0019 (user decision): Claude may write .cadre/config.json only in an init run, and cadre re-validates it after every write against the settings
describe('the project settings file during init', () => {
  const lease = async () => {
    const { h, tick, files } = mk({ files: READY }); const EX = ['/', '/repo', '/repo/.cadre', '/hm', '/hm/u', '/hm/u/.claude', `${HOME}/.claude/plugins/store/cadre/guides`]
    h.stat = async (p: string, o?: { resolve?: boolean }) => (EX.includes(p) || EX.includes(p.slice(0, p.lastIndexOf('/'))) ? { kind: 'file', realPath: o?.resolve ? p : undefined } : undefined)
    Object.assign(h, { root: async () => `${HOME}/.claude/plugins/store/cadre` }); await setPolicy(h, { repo: ROOT, home: HOME, changelog: 'CHANGELOG.md' })
    const call = async (tool: string, file_path?: string) => ((await guard(h, { tool, file_path, input: { file_path } }, () => 'ok')) as any)?.deny ?? 'ok'
    return { h, tick, call, files }
  }
  test('Claude writes it in an init run only; a setup run and no run refuse it with where the user changes settings', async () => {
    const a = await lease(); expect(await a.call('Write', CFG)).toBe('the project settings are changed by the user in the cadre pane (Settings, key 9); do not edit that file')
    await start(a.h, 'init'); await a.tick(); expect(await a.call('Write', CFG)).toBe('ok')
    const b = await lease(); await b.h.secret.update(s => ({ ...s, run: { kind: 'setup', at: 0, turns: 0, follow: 0, guide: `${HOME}/.claude/plugins/store/cadre/guides/setup.md`, snap: {} } }))
    expect(await b.call('Write', CFG)).toBe('the project settings are changed by the user in the cadre pane (Settings, key 9); do not edit that file'); expect(await b.call('Write', `${ROOT}/CHANGELOG.md`)).toBe('ok')
  })
  test('a bad write is a red check naming each key and why: the checklist, the tool-result line and the stop refusal; fixing it clears it', async () => {
    const { h, files } = mk({ files: { ...READY } }); await start(h, 'init')
    files[CFG] = JSON.stringify({ ...JSON.parse(READY[CFG]), bogus: 1, review: { maxRework: 'many' }, drive: { maxTurns: 5 }, strictness: 'advisory', jail: 'off' })
    const why = '.cadre/config.json: bogus: unknown key; review.maxRework: expected number; drive.maxTurns: user-level only, ignored in the repo file; strictness: the repo file may only tighten this key; a safety key: the repo file may only tighten this key; fix or remove these keys (the user sets the rest in the cadre pane)'
    expect((await items(h))['settings file']).toBe(`fail: ${why}`)
    expect(await redNote(h)).toContain(`settings file (${why})`)
    expect(await stopCheck(h, {})).toContain(`settings file: ${why}`)
    files[CFG] = READY[CFG]; expect((await items(h))['settings file']).toBeUndefined()
  })
})
