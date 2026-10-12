import { describe, expect, test } from 'claude-code/testing'
import { confirm, initItems, repoKeyOf, rootFor, wire } from '../commands/init'
import { pump, recheck, start, turnEnd } from '../commands/agentrun'
import { press, run as cadreRun } from '../commands/cadre'
import { guard, policyOf, setPolicy, LIMIT } from '../policy/guards'
import { wake } from '../core/session'
import { fakeHost } from './support'
import { MemoryStore } from '../task-management/adapters/memory/store'
import { skeleton } from '../core/changelog'
import { BUDGET } from './fixtures/budget.generated'
import type { Host } from '../types'
import { banned } from './fixtures/wording'

type R = { exitCode: number; stdout?: string; stderr?: string }
const ROOT = '/repo', HOME = '/hm/u', RK = repoKeyOf(ROOT), PLUG = '/plug', CFG = `${ROOT}/.cadre/config.json`
const PKG = { root: '.', setup: ['npm', 'ci'], checks: { test: ['npm', 'test'] }, tdd: { paths: ['test/**'] } }
const READY = { [CFG]: JSON.stringify({ branches: { main: 'main', dev: 'dev' }, packages: [PKG] }), [`${ROOT}/.git/info/exclude`]: '.beads/\n.claude/settings.local.json\n', [`${ROOT}/CHANGELOG.md`]: skeleton() }
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
  const code = async () => (await h.secret.read()).initConfirm?.code as string
  const tick = () => pump(h)   // the session's 5 s timer sends a waiting brief
  return { h, files, g, calls, code, sent, tick, s }
}
const items = async (h: Host) => Object.fromEntries((await initItems(h)).map(i => [i.name, `${i.st}${i.why ? `: ${i.why}` : ''}`]))
const card = async (h: Host, id = 'run:init') => ((await h.board.read()).decisions ?? []).find(d => d.id === id)

describe('init checks (ADR 0010): read-only, one per phase', () => {
  test('an empty folder: every phase says what is missing; later phases wait as todo; nothing is written or run', async () => {
    const { h, files, calls } = mk({ repo: false, branches: [], mission: false, journal: false })
    expect(await items(h)).toEqual({ repository: 'fail: no git repository yet', 'task store': 'todo: after the steps above', mission: 'fail: no mission yet', 'build and test commands': 'fail: no packages in .cadre/config.json',
      'commands pass on a clean checkout': 'todo: after the steps above', workflow: 'ok', changelog: 'fail: CHANGELOG.md is missing', 'safety settings': 'todo: after the steps above' })
    expect(files).toEqual({}); expect(calls.filter(a => a[0] !== 'git' || !/rev-parse/.test(a.join(' ')))).toEqual([])
    expect(banned(Object.values(await items(h)))).toEqual([])   // what a follow-up may quote
  })
  test('repository: unborn HEAD, a missing dev branch, a missing exclude line, unset main are each named', async () => {
    expect((await items(mk({ branches: [], files: READY }).h)).repository).toBe('fail: no first commit yet')
    expect((await items(mk({ branches: ['main'], files: READY }).h)).repository).toBe('fail: branch dev is missing')
    expect((await items(mk({ files: { ...READY, [`${ROOT}/.git/info/exclude`]: '.beads/\n' } }).h)).repository).toBe('fail: .git/info/exclude lacks .claude/settings.local.json')
    expect((await items(mk({ files: { ...READY, [CFG]: '{}' } }).h)).repository).toBe('fail: branches.main is not set in .cadre/config.json')
  })
  test('mission: a draft waits for the human on its card; a recorded one is read back from the store', async () => {
    const { h } = mk({ files: READY, mission: false }); expect((await items(h)).mission).toBe('fail: no mission yet')
    await h.board.update(b => ({ ...b, plan: { id: 'm', slug: 'mission', state: 'draft', epicBranch: '' } })); expect((await items(h)).mission).toBe('wait: approve it on its card')
  })
  test('commands are validated in a clean offline copy once per package list; a red check is named for Claude to fix', async () => {
    const { h, calls } = mk({ files: { ...READY, [CFG]: JSON.stringify({ branches: { main: 'main', dev: 'dev' }, packages: [{ ...PKG, checks: { test: ['npm', 'test'], lint: ['npm', 'run', 'lint'] } }] }) }, extra: jailed(['npm run lint']) })
    expect((await items(h))['commands pass on a clean checkout']).toBe('fail: .: lint fails on a clean checkout (fix the command or leave it out)')
    const n = calls.filter(a => a[0] === 'bwrap' && a.includes('--')).length; expect(calls.some(a => a[0] === 'bwrap' && a.includes('--unshare-net'))).toBe(true)
    await items(h); expect(calls.filter(a => a[0] === 'bwrap' && a.includes('--')).length).toBe(n)   // cached while the list is unchanged
  })
})

describe('safety settings: written by cadre only after the human confirms the diff on its card', () => {
  test('proposed once the rest passes; nothing written before the confirm; then .bak, settings, the cache allowance, policy, ok', async () => {
    const { h, files, code } = mk({ files: { ...READY, [`${ROOT}/.claude/settings.local.json`]: '{"permissions":{"allow":["Read"]}}' } })
    const its = await items(h); expect(Object.values(its).filter(v => v !== 'ok')).toEqual(['wait: confirm them on their card'])
    const d = (await card(h, 'init:5'))!; expect(d.title).toBe('init · safety settings · confirm'); expect(d.options.map(o => o.run)).toEqual(['init confirm {code}'])
    expect(d.lines.join('\n')).toContain('sandbox.enabled'); expect(d.lines.join('\n')).toContain(`~/.claude/cadre.json: + repos.${RK}`); expect(d.lines.join('\n')).not.toContain((await h.secret.read()).initConfirm!.code)
    expect(files[`${ROOT}/.claude/settings.local.json`]).toBe('{"permissions":{"allow":["Read"]}}'); expect(files[`${HOME}/.claude/cadre.json`]).toBeUndefined()
    await items(h); expect((await h.board.read()).decisions?.filter(x => x.id === 'init:5')).toHaveLength(1)   // a re-check does not re-ask
    expect(await confirm(h, 'deadbeef')).toContain('wrong code'); expect(files[`${ROOT}/.claude/settings.local.json`]).toBe('{"permissions":{"allow":["Read"]}}')   // burned
    await items(h); expect(await confirm(h, await code())).toBe('init: safety settings written')
    const s = JSON.parse(files[`${ROOT}/.claude/settings.local.json`]); expect(s.permissions.allow).toEqual(['Read']); expect(s.sandbox.allowUnsandboxedCommands).toBe(false); expect(s.sandbox.filesystem.allowWrite).toContain(`${HOME}/.cache/pnpm`)
    expect(files[`${ROOT}/.claude/settings.local.json.bak`]).toBe('{"permissions":{"allow":["Read"]}}'); expect(JSON.parse(files[`${HOME}/.claude/cadre.json`]).repos[RK].jailWritable).toEqual([`${HOME}/.cache/pnpm`])
    expect((await policyOf(h)).repo).toBe(ROOT); expect(Object.values(await items(h)).every(v => v === 'ok')).toBe(true)
  })
  test('settings changed since the card: nothing written', async () => {
    const { h, files, code } = mk({ files: READY }); await items(h); files[`${ROOT}/.claude/settings.local.json`] = '{"x":1}'
    expect(await confirm(h, await code())).toContain('changed since the card'); expect(files[`${ROOT}/.claude/settings.local.json`]).toBe('{"x":1}')
  })
  test('a symlinked cache dir: allowWrite and policy wtRoot use the realpath, matching contain() (G8)', async () => {
    const { h, files, code } = mk({ files: READY }); const stat = h.stat
    h.stat = async (p, o) => (p === `${HOME}/.cache` ? { kind: 'dir', realPath: o?.resolve ? '/data/cache' : undefined } : p.startsWith(`${HOME}/.cache/`) ? undefined : stat(p, o))
    await items(h); await confirm(h, await code()); const real = `/data/cache/cadre/wt/${RK}`
    expect(JSON.parse(files[`${ROOT}/.claude/settings.local.json`]).sandbox.filesystem.allowWrite[0]).toBe(real); expect((await policyOf(h)).wtRoot).toBe(real)
  })
})

describe('agent-run init (ADR 0010): the brief, the checklist card, re-checks at main turn end', () => {
  test('/cadre init from the composer: ONE line, a short brief that points at the guide, the run (lease) starts, the checklist card shows', async () => {
    const { h, sent, tick } = mk({ repo: false, branches: [], mission: false })
    const t = (await cadreRun(h, { args: 'init', origin: { kind: 'composer' } }, () => ({}))).text
    expect(t).toBe('init: Claude is on it · progress on the cadre card')
    expect(sent).toEqual([]); expect((await h.secret.read()).run?.brief).toContain('guides/init.md')   // a command frame cannot submit (live 0.7.0): the brief waits for the timer
    await tick(); expect((await h.secret.read()).run?.brief).toBeUndefined()
    expect(sent).toEqual([`Set up cadre in this project. Follow ${PLUG}/guides/init.md step by step.`]); expect(banned(t, sent)).toEqual([])
    expect((await h.secret.read()).run).toMatchObject({ kind: 'init', turns: 0, follow: 0, guide: `${PLUG}/guides/init.md` })
    const d = (await card(h))!; expect(d.title).toBe('init · 1/8 done · Claude is on it'); expect(d.lines).toContain('✗ repository: no git repository yet'); expect(d.lines).toContain('· task store: after the steps above')
    expect(d.options.map(o => o.label)).toEqual(['Cancel'])
  })
  test('another origin cannot start it (no lease from a model or a script)', async () => {
    const { h, sent, tick } = mk({ repo: false })
    expect((await cadreRun(h, { args: 'init', origin: { kind: 'sdk' } }, () => ({}))).text).toContain('refused'); await tick()
    expect((await h.secret.read()).run).toBeUndefined(); expect(sent).toEqual([])
  })
  test('main turn end: re-check, ONE follow-up naming what still fails, at most 3; then the card shows what is left and Retry', async () => {
    const { h, sent, tick, files } = mk({ files: READY, mission: false }); delete files[`${ROOT}/CHANGELOG.md`]
    await start(h, 'init'); await tick(); sent.length = 0
    await turnEnd(h, { agentId: 'sub1' }); await tick(); expect(sent).toEqual([])   // a subagent's turn is not main's
    for (let i = 1; i <= 3; i++) { await turnEnd(h, {}); await tick(); expect(sent).toHaveLength(i) }
    expect(sent[0]).toBe(`Some steps are still open. Each item below must pass:\n1. mission: no mission yet\n2. changelog: CHANGELOG.md is missing\nKeep following ${PLUG}/guides/init.md. When you are done, stop; the checks run again on their own.`)
    expect(banned(sent)).toEqual([])
    await turnEnd(h, {}); await tick(); expect(sent).toHaveLength(3)
    const d = (await card(h))!; expect(d.title).toBe('init · stopped · 3 left'); expect(d.lines[0]).toBe('Claude stopped with steps still open'); expect(d.options.map(o => o.label)).toEqual(['Retry', 'Cancel'])
    expect((await h.secret.read()).run).toBeUndefined()   // the lease ended
    expect((await press(h, d.id, 'r', d.hash)).text).toBe('init: Claude is on it · progress on the cadre card'); await tick(); expect(sent).toHaveLength(4); expect((await h.secret.read()).run?.follow).toBe(0)
  })
  test('only the human owes something (mission card, safety card): the card says so and nothing is sent to main', async () => {
    const { h, sent, tick } = mk({ files: READY, mission: false }); await h.board.update(b => ({ ...b, plan: { id: 'm', slug: 'mission', state: 'draft', epicBranch: '' } }))
    await start(h, 'init'); await tick(); sent.length = 0; await turnEnd(h, {}); await tick()
    expect(sent).toEqual([]); expect((await card(h))!.title).toBe('init · 6/8 done · needs you'); expect((await card(h, 'init:5'))).toBeDefined()
  })
  test('done: the run ends (and with it the lease), the card says all done with Close, a toast; a confirm on the safety card finishes it', async () => {
    const { h, tick, code } = mk({ files: READY }); await start(h, 'init'); await tick()
    expect((await cadreRun(h, { args: `init confirm ${await code()}`, origin: { kind: 'press' } }, () => ({}))).text).toContain('refused')   // a press origin from the engine is not ours (ADR 0008): refused, the code burned
    await recheck(h)   // the next re-check asks again with a new code
    const d = (await card(h, 'init:5'))!; expect((await press(h, d.id, 'a', d.hash)).text).toBe('init: safety settings written · init: all done')
    expect((await h.secret.read()).run).toBeUndefined(); const c = (await card(h))!; expect(c.title).toBe('init · all done'); expect(c.options.map(o => o.label)).toEqual(['Close']); expect(h.toasts).toContain('cadre: init done')
    expect((await press(h, c.id, 'x', c.hash)).text).toBe('init: cancelled'); expect(await card(h)).toBeUndefined()
  })
  test('nothing open: /cadre init says all done and starts nothing', async () => {
    const { h, tick, code, sent } = mk({ files: READY }); await items(h); await confirm(h, await code())
    expect(await start(h, 'init')).toBe('init: all done'); await tick(); expect(sent).toEqual([]); expect((await h.secret.read()).run).toBeUndefined()
  })
  test('limits: 20 main turns or 30 minutes stop the run', async () => {
    const { h, tick } = mk({ repo: false, mission: false }); await start(h, 'init'); await tick()
    await h.secret.update(s => ({ ...s, run: { ...s.run!, turns: LIMIT.turns - 1 } })); await turnEnd(h, {})
    expect((await card(h))!.lines[0]).toBe('the time or turn limit was reached'); expect((await h.secret.read()).run).toBeUndefined()
    await start(h, 'init'); await h.secret.update(s => ({ ...s, run: { ...s.run!, at: -LIMIT.ms } })); expect(await recheck(h)).toBe('init: stopped · see the card')
  })
  // Regression (0.6.1, real machine): init stuck at "init 4/8 discovery · Claude is on it" after the explorer finished and main summarized in chat.
  // Cause: stage 4 waited on ui.discoveryAgent, set at spawn and cleared only by an accepted report{discovery}; an unbound explorer that stopped without
  // one (text answer, refused report) is outside close.observe's nudge/auto-report, so init.after returned early forever. Now nothing waits on an agent:
  // the state is the files, re-checked at every main turn end.
  test('regression: main answers in chat without writing the commands: the card does not stay "Claude is on it"; it is told what is missing, then stops with Retry', async () => {
    const { h, sent, tick } = mk({ files: { ...READY, [CFG]: JSON.stringify({ branches: { main: 'main', dev: 'dev' } }) } })
    await start(h, 'init'); await tick(); sent.length = 0
    for (let i = 0; i < 4; i++) { await turnEnd(h, {}); await tick() }   // each turn: main "summarized the discovery in chat", nothing written
    expect(sent).toHaveLength(3); expect(sent[0]).toContain('1. build and test commands: no packages in .cadre/config.json')
    expect((await card(h))!.title).toBe('init · stopped · 3 left'); expect((await card(h))!.options.map(o => o.label)).toContain('Retry')
  })
  test('cancel ends the run and its lease; the card goes', async () => {
    const { h, tick } = mk({ repo: false }); await start(h, 'init'); await tick()
    const d = (await card(h))!; expect((await press(h, d.id, 'x', d.hash)).text).toBe('init: cancelled')
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
  const ALLOWED = [`${ROOT}/.cadre/config.json`, `${ROOT}/.git/info/exclude`, `${ROOT}/.claude/settings.local.json`, `${ROOT}/CHANGELOG.md`, `${HOME}/.claude/settings.json`, `${HOME}/.claude/cadre.json`]
  test('no run: main has no shell and none of the setup files', async () => {
    const { call } = await lease(); expect(await call('Bash')).toContain('not available to main')
    for (const p of ALLOWED) expect(await call('Write', p)).not.toBe('ok')
  })
  test('during a run: Bash, Write/Edit on the setup files only, Read of the guide; never source files; activation keeps it', async () => {
    const { h, tick, call } = await lease(); await start(h, 'init'); await tick()
    expect(await call('Bash')).toBe('ok')
    for (const p of ALLOWED) { expect(await call('Write', p)).toBe('ok'); expect(await call('Edit', p)).toBe('ok') }
    for (const p of [`${ROOT}/src/a.ts`, `${ROOT}/.git/config`, `${HOME}/.claude/settings.local.json`]) expect(await call('Write', p)).not.toBe('ok')
    expect(await call('Read', `${HOME}/.claude/plugins/store/cadre/guides/init.md`)).toBe('ok')
    await h.secret.update(s => ({ ...s, active: false })); expect(await wake(h)).toBe(true); expect(await call('Bash')).toBe('ok')   // .cadre/config.json appeared mid-run: still leased
  })
  test('expires: after 20 main turns or 30 minutes, and on cancel', async () => {
    const { h, tick, call } = await lease(); await start(h, 'init'); await tick()
    await h.secret.update(s => ({ ...s, run: { ...s.run!, turns: LIMIT.turns } })); expect(await call('Bash')).not.toBe('ok')
    await h.secret.update(s => ({ ...s, run: { ...s.run!, turns: 0, at: -LIMIT.ms } })); expect(await call('Write', ALLOWED[0])).not.toBe('ok')
    await start(h, 'init'); expect(await call('Bash')).toBe('ok'); await cadreRun(h, { args: 'init cancel', origin: { kind: 'composer' } }, () => ({})); expect(await call('Bash')).not.toBe('ok')
  })
})

describe('agent-run setup', () => {
  test('bd missing: Claude gets the setup guide; once bd answers, the turn end finds everything green, stamps, ends the run', async () => {
    const tools: Record<string, string> = { git: 'git version 2.43.0', bwrap: 'bubblewrap 0.11.0', socat: 'x', npm: '10.0.0' }
    const { h, sent, tick } = mk({ files: { [`${HOME}/.claude/settings.json`]: '{"env":{"CLAUDE_CODE_ENABLE_TODO_TOOLS":"1"}}' }, extra: argv => {
      if (argv[0] === 'git' && argv[1] === '--version') return { exitCode: 0, stdout: tools.git }
      if (argv[0] === 'git' && argv[1] === 'var') return { exitCode: 0, stdout: 'A <a@b> 1 +0000' }
      if (argv[0] === 'bwrap') return { exitCode: 0, stdout: argv[1] === '--help' ? '--overlay-src' : tools.bwrap }
      if (argv[0] === 'bd') return tools.bd ? { exitCode: 0, stdout: argv[1] === 'update' ? '--if-revision' : tools.bd } : { exitCode: 127 }
      if (argv[0] === 'test' || argv[0] === 'chmod' || argv[0] === 'uname') return { exitCode: 0, stdout: argv[0] === 'uname' ? 'Linux' : '' }
      if (argv[0] in tools) return { exitCode: 0, stdout: tools[argv[0]] }
      return argv[0] === 'git' ? undefined : { exitCode: 127 }
    } })
    expect(await start(h, 'setup')).toBe('setup: Claude is on it · progress on the cadre card'); await tick()
    expect(sent).toEqual([`Set up cadre on this machine. Follow ${PLUG}/guides/setup.md step by step.`])
    expect((await card(h, 'run:setup'))!.lines).toContain('✗ bd not found: npm install -g @beads/bd@latest')
    tools.bd = 'bd version 1.3.1'; await turnEnd(h, {}); await tick()   // Claude installed it with a visible Bash call
    expect((await card(h, 'run:setup'))!.title).toBe('setup · all done'); expect((await h.secret.read()).run).toBeUndefined(); expect(await h.store.get('cadre:setup')).toMatchObject({ bd: '1.3.1' })
    expect(sent).toHaveLength(1)
  })
})

describe('guides', () => {
  test('the guides speak task language (commands in backticks are literal), name every phase with a done line, and match the checks', () => {
    const g = BUDGET.guides as Record<string, string>
    expect(Object.keys(g)).toEqual(['init', 'setup'])
    for (const t of Object.values(g)) { expect(banned(t.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, ''))).toEqual([]); expect(t).toContain('AskUserQuestion'); expect(t).not.toContain('sudo apt') }
    expect(g.init).toContain('bd config set events-journal true'); expect(g.init).toContain('"kind": "mission"'); expect(g.init).toContain(skeleton().trim())
    expect(g.setup).toContain('npm install -g @beads/bd@latest'); expect(g.setup).toContain('CLAUDE_CODE_ENABLE_TODO_TOOLS')
  })
})

test('rootFor: an agent cwd (worktree or view) maps back to the repo root recorded at session start; unknown paths stay', () => {
  const roots = { [RK]: ROOT }
  expect(rootFor(roots, `/c/wt/${RK}/bd-1`)).toBe(ROOT); expect(rootFor(roots, `/c/wt/${RK}.views/bd-1/x`)).toBe(ROOT); expect(rootFor(roots, '/else')).toBe('/else')
})
