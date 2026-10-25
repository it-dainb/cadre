import { expect, mock, test } from 'claude-code/testing'

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const
// Each test here loads the whole hooks module into a fresh engine: about 0.7 s on an idle machine (a test that returns at once costs the same), several
// seconds when the full suite runs every file at once. The work under test is a fraction of that; the kit's 5 s default measured the machine's load.
const ENGINE = { timeoutMs: 30_000 }

test('session.start: no $.agent.register (agents are plugin files, A28), /cadre (immediate), env flags, policy written, one 5 s tick', ENGINE, async ($, on) => {
  const agents: any[] = [], commands: any[] = [], env: string[] = []
  on('session.start', () => ({ cwd: '/work' })); on('session.cwd', () => ({ value: '/work' })); on('session.root', () => ({ value: '/work' })); on('store.get', () => ({ value: undefined })); on('store.set', () => ({ value: undefined }))
  on('agent.register', ($, e) => { agents.push(e); return { value: undefined } })
  on('command.register', ($, e) => { commands.push(e); return { value: undefined } })
  on('env.set', ($, e) => { env.push(`${e.name}=${e.value}`); return { value: undefined } })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } })); on('fs.write', () => ({ value: undefined }))   // the task store's sh calls succeed with nothing stored
  const clock = mock.clock(on)
  await $.session.start(START)
  expect(agents).toEqual([])
  expect(commands).toEqual([{ name: 'cadre', description: expect.any(String), argumentHint: '<sub> [args]', immediate: true }])
  expect(env).toEqual(['ENABLE_TOOL_SEARCH=false'])   // the task-tool gate lives in each project's settings (commands/init.GATE)
  await clock.advance(5000); await clock.advance(5000)   // the tick is a placeholder: it must not throw
})

test('Claude Code older than cadre needs: one loud line, /cadre answers only it, nothing else starts and every call passes untouched (live 0.12.0 on 2.1.287)', ENGINE, async ($, on) => {
  const commands: any[] = [], env: string[] = [], tools: any[] = [], said: string[] = [], LINE = 'cadre needs Claude Code ≥ 2.1.295; you have 2.1.287 · update with: claude update'
  on('session.start', () => ({ cwd: '/work' })); on('session.version', () => ({ value: { version: '2.1.287' } })); on('session.cwd', () => ({ value: '/work' })); on('session.root', () => ({ value: '/work' })); on('store.get', () => ({ value: undefined })); on('store.set', () => ({ value: undefined })); on('env.get', () => ({ value: undefined }))
  on('command.register', ($, e) => { commands.push(e); return { value: undefined } }); on('env.set', ($, e) => { env.push(e.name); return { value: undefined } }); on('tool.register', ($, e) => { tools.push(e); return { value: undefined } })
  on('ui.toast', ($, e) => { said.push(String(e.text ?? e)); return { value: undefined } }); on('ui.log', ($, e) => { said.push(String(e.text ?? e)); return { value: undefined } })
  on('fs.read', () => ({ value: '{}' })); on('tool.call', () => ({ result: 'ran' })); on('command.run', () => ({ text: 'engine' }))
  await $.session.start(START)
  expect(commands.map(c => c.name)).toEqual(['cadre']); expect(env).toEqual([]); expect(tools).toEqual([]); expect(said.some(t => t.includes(LINE))).toBe(true)
  expect((await $.command.run({ command: 'cadre', args: 'continue' })).text).toBe(LINE)
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toEqual({ result: 'ran' })   // an initialised repo, yet no guard: cadre is off, not half on
})

test('every slot is a pass-through until its owner fills it: tool.call, tool.check, prompt.submit, command.run reach the engine', ENGINE, async ($, on) => {
  const seen: string[] = []
  on('store.get', () => ({ value: undefined })); on('env.get', () => ({ value: undefined })); on('session.cwd', () => ({ value: '/work' })); on('session.root', () => ({ value: '/work' }))   // policy/guards reads its paths from $.store (keyed by the repo), strictness from env
  on('tool.call', ($, e) => { seen.push(`call:${e.tool}`); return { result: 'ok' } })
  on('tool.check', () => ({ decision: 'allow' }))
  on('prompt.submit', ($, e) => { seen.push('prompt'); return { text: e.text } })
  on('command.run', () => ({ text: 'engine' })); on('fs.read', () => ({ value: '{}' }))   // an initialised repo: .cadre/config.json exists
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } })); on('fs.write', () => ({ value: undefined }))   // the task store's sh calls succeed with nothing stored
  expect(await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })).toEqual({ result: 'ok' })
  expect((await $.prompt.submit({ text: 'hello' })).text).toBe('hello')
  expect((await $.command.run({ command: 'cadre', args: 'status' })).text).toBe("that's answered in the dialog now: press 1 on the band or run /cadre")   // commands/cadre.run is filled: it answers itself (ADR 0011: old subcommands are buttons)
  expect(seen).toEqual(['call:Read', 'prompt'])
})

test('dormant until init: main keeps Bash and Edit, status says so; once .cadre/config.json exists the same calls are denied, with no restart', ENGINE, async ($, on) => {
  let inited = false
  on('store.get', () => ({ value: undefined })); on('store.set', () => ({ value: undefined })); on('env.get', () => ({ value: undefined })); on('session.cwd', () => ({ value: '/work' })); on('session.root', () => ({ value: '/work' }))
  on('fs.read', () => { if (!inited) throw new Error('ENOENT'); return { value: '{}' } }); on('fs.stat', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } })); on('fs.write', () => ({ value: undefined }))   // the task store's sh calls succeed with nothing stored
  on('tool.call', () => ({ result: 'ran' })); on('tool.check', () => ({ decision: 'allow' })); on('command.run', () => ({ text: 'engine' }))
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toEqual({ result: 'ran' })
  expect(await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts' })).toEqual({ result: 'ran' })
  expect((await $.command.run({ command: 'cadre', args: 'fix the login bug' })).text).toBe('Welcome to cadre · run /cadre setup once on this machine')
  inited = true
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).not.toEqual({ result: 'ran' })
  expect(await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts' })).not.toEqual({ result: 'ran' })
})

test('dev scenario seeding: inert without CADRE_DEV; with it, session.start seeds board/events/secret/ui from the dump', ENGINE, async ($, on) => {
  const env: Record<string, string> = {}, reads: string[] = [], state: Record<string, unknown> = {}
  const dump = { b: { schemaVersion: 1, seq: 7, repo: 'r', mission: null, epic: 'p3', plan: { id: 'p3', slug: 'p3', state: 'approved', epicBranch: 'epic/p3' }, tasks: [], approval: { planId: null, missing: [] }, drive: { on: false, level: 'epic', epicId: null, turns: 0, costUsd: 0, startedAt: null }, sync: [], cost: { tokens: 0 }, containment: { state: 'unknown', unsandboxed: 0 }, resumesQueued: 0, init: [] }, ring: [{ seq: 1 }, { seq: 2 }], sec: { nonce: 'x' }, ui: { tab: 'epic' } }
  on('session.start', () => ({ cwd: '/work' })); on('session.cwd', () => ({ value: '/work' })); on('session.root', () => ({ value: '/work' })); on('store.get', () => ({ value: undefined })); on('store.set', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined })); on('env.set', () => ({ value: undefined })); on('env.get', ($, e) => ({ value: env[e.name] }))
  on('fs.read', ($, e) => { reads.push(e.path); if (e.path === '/s.json') return { value: JSON.stringify(dump) }; throw new Error('ENOENT') })
  on('state.set', ($, e) => { state[e.key] = e.value; return { value: { isSet: true } } })
  mock.clock(on); env.CADRE_DEV_SCENARIO = '/s.json'; await $.session.start(START)
  expect(reads).not.toContain('/s.json')   // CADRE_DEV unset: nothing read, nothing seeded
  env.CADRE_DEV = '1'; await $.session.start(START)
  expect(reads).toContain('/s.json')
  expect(JSON.stringify(state)).toContain('"epic":"p3"'); expect(JSON.stringify(state)).toContain('"epics":{"p3":[{"seq":1},{"seq":2}]}')
})

// live 0.9.1: after a /clear (no session.start, no remembered root) main had `cd kit/`: the checks, the store and the opt-in read kit/ instead of the repo
test('the repo root never follows a Bash cd: after /clear with the shell in a package folder, cadre still reads the repo root', ENGINE, async ($, on) => {
  const reads: string[] = [], sets: Record<string, unknown> = {}
  on('session.cwd', () => ({ value: '/work/kit' })); on('session.root', () => ({ value: '/work' }))
  on('store.get', () => ({ value: undefined })); on('store.set', ($, e) => { sets[e.key] = e.value; return { value: undefined } }); on('env.get', () => ({ value: undefined }))
  on('fs.read', ($, e) => { reads.push(e.path); throw new Error('ENOENT') }); on('command.run', () => ({ text: 'engine' })); on('ui.open', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work/kit' })); on('command.register', () => ({ value: undefined })); on('env.set', () => ({ value: undefined })); mock.clock(on)
  await $.command.run({ command: 'cadre', args: '' })
  expect(reads).toContain('/work/.cadre/config.json'); expect(reads.some(p => p.startsWith('/work/kit/'))).toBe(false)
  await $.session.start({ ...START, cwd: '/work/kit' })
  expect(Object.values(sets['cadre:roots'] as object)).toEqual(['/work'])
})

// live 0.9.1: Claude Code started in a package folder still works on the repo: the root is the git top level above the session's project root
test('the repo root is the git top level above the project root, spelled from the session path', ENGINE, async ($, on) => {
  const reads: string[] = []
  on('session.cwd', () => ({ value: '/work/kit' })); on('session.root', () => ({ value: '/work/kit' }))
  on('process.run', ($, e) => ({ value: { exitCode: 0, stdout: e.argv.join(' ') === 'git rev-parse --show-cdup' ? '../\n' : '', stderr: '' } }))
  on('store.get', () => ({ value: undefined })); on('store.set', () => ({ value: undefined })); on('env.get', () => ({ value: undefined }))
  on('fs.read', ($, e) => { reads.push(e.path); throw new Error('ENOENT') }); on('command.run', () => ({ text: 'engine' })); on('ui.open', () => ({ value: undefined }))
  await $.command.run({ command: 'cadre', args: '' })
  expect(reads).toContain('/work/.cadre/config.json')
})
// live 0.9.1 (2.1.296): Claude stopped with setup checks red and the run sat in "running": the stop is refused with the list
test('during a setup run main\'s stop is refused while a check is red; with no run it passes', ENGINE, async ($, on) => {
  const env: Record<string, string> = {}, run = { kind: 'init', at: 0, turns: 0, follow: 0, guide: '/p/guides/init.md' }
  const dump = { b: { schemaVersion: 1, seq: 1, repo: 'r', mission: null, epic: null, plan: null, tasks: [], approval: { planId: null, missing: [] }, drive: { on: false, level: 'epic', epicId: null, turns: 0, costUsd: 0, startedAt: null }, sync: [], cost: { tokens: 0 }, containment: { state: 'unknown', unsandboxed: 0 }, resumesQueued: 0, init: [] }, ring: [], sec: { run } }
  on('session.start', () => ({ cwd: '/work' })); on('session.cwd', () => ({ value: '/work' })); on('session.root', () => ({ value: '/work' })); on('store.get', () => ({ value: undefined })); on('store.set', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined })); on('env.set', () => ({ value: undefined })); on('env.get', ($, e) => ({ value: env[e.name] }))
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' } })); on('fs.stat', () => ({ value: undefined }))
  on('fs.read', ($, e) => { if (e.path === '/s.json') return { value: JSON.stringify(dump) }; throw new Error('ENOENT') }); on('classic.Stop', () => ({}))
  mock.clock(on)
  expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()   // no run: Claude stops as usual
  env.CADRE_DEV = '1'; env.CADRE_DEV_SCENARIO = '/s.json'; await $.session.start(START)   // a run is on
  const r = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'done looking' })
  expect(r.block).toMatch(/^Setup is not done: these checks still fail\.\n1\. repository: no git repository yet \(phase 1\)/)
})

// main's tools are registered at session start only where their work is due (the set is fixed for the session); a refused one is kept for Doctor
const MAIN_NAMES = ['plan', 'task', 'epic', 'amend', 'explore', 'ask', 'status']
const startWith = async ($: any, on: any, o: { active: boolean; stamp?: string; refuse?: string }) => {
  const tools: string[] = []
  on('session.start', () => ({ cwd: '/work' })); on('session.cwd', () => ({ value: '/work' })); on('session.root', () => ({ value: '/work' })); on('env.get', () => ({ value: undefined })); on('store.set', () => ({ value: undefined }))
  on('session.version', () => ({ value: { version: '2.1.299' } })); on('store.get', ($: any, e: any) => ({ value: e.key === 'cadre:setup' && o.stamp ? { cc: o.stamp } : undefined }))
  on('fs.read', () => { if (!o.active) throw new Error('ENOENT'); return { value: '{}' } }); on('fs.stat', () => ({ value: undefined })); on('command.register', () => ({ value: undefined })); on('env.set', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } })); on('fs.write', () => ({ value: undefined }))
  on('tool.register', ($: any, e: any) => { if (e.name === o.refuse) throw new Error('refused'); tools.push(e.name); return { value: undefined } }); on('tool.call', () => ({ result: 'ran' })); mock.clock(on)
  await $.session.start(START); return tools
}
test('tools at start: dormant on a set-up machine: the agent tools only', ENGINE, async ($, on) => {
  expect(await startWith($, on, { active: false, stamp: '2.1.299' })).toEqual(['report', 'inspect', 'run_check'])
})
test('tools at start: dormant, setup due (no stamp, or another Claude Code build): preferences too', ENGINE, async ($, on) => {
  expect(await startWith($, on, { active: false, stamp: '2.1.290' })).toEqual(['report', 'inspect', 'run_check', 'preferences'])
})
test('tools at start: an active repo gets every main tool; one Claude Code refuses is left out', ENGINE, async ($, on) => {
  expect(await startWith($, on, { active: true, stamp: '2.1.299', refuse: 'ask' })).toEqual(['report', 'inspect', 'run_check', ...MAIN_NAMES.filter(t => t !== 'ask'), 'preferences'])
})

test('main in an active repo: an Agent with no task in it and the built-in task tools are refused toward cadre\'s tools; an agent\'s Agent passes', ENGINE, async ($, on) => {
  await startWith($, on, { active: true, stamp: '2.1.299' })
  expect((await $.tool.call({ tool: 'Agent', prompt: 'where is login handled?', description: 'x' }) as any).deny).toContain('call explore with your question')
  expect((await $.tool.call({ tool: 'TaskCreate', subject: 's', description: 'd' }) as any).deny).toContain('plan with the plan tools')
})

// review 0.15 #7: cadre's own tools answer innermost, so a hook after them never saw main's explore: a clarify goal could never record its clarity
test('a goal run: main\'s explore through the real chain counts as its clarify explore, so ask {clarity} goes on', ENGINE, async ($, on) => {
  const env: Record<string, string> = { CADRE_DEV: '1', CADRE_DEV_SCENARIO: '/s.json' }
  const dump = { b: { schemaVersion: 1, seq: 1, repo: 'r', mission: null, epic: null, plan: null, tasks: [], approval: { planId: null, missing: [] }, drive: { on: false, level: 'epic', epicId: null, turns: 0, costUsd: 0, startedAt: null }, sync: [], cost: { tokens: 0 }, containment: { state: 'unknown', unsandboxed: 0 }, resumesQueued: 0, init: [] }, ring: [], sec: { goalRun: { text: 'fix login', mode: 'auto', follow: 0, on: true, deep: true } } }
  on('session.start', () => ({ cwd: '/work' })); on('session.cwd', () => ({ value: '/work' })); on('session.root', () => ({ value: '/work' })); on('store.get', () => ({ value: undefined })); on('store.set', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined })); on('env.set', () => ({ value: undefined })); on('env.get', ($, e) => ({ value: env[e.name] })); on('tool.register', () => ({ value: undefined }))
  on('fs.read', ($, e) => { if (e.path === '/s.json') return { value: JSON.stringify(dump) }; throw new Error('ENOENT') }); on('fs.stat', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined })); on('ui.toast', () => ({ value: undefined })); on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } })); on('fs.write', () => ({ value: undefined }))
  mock.clock(on); await $.session.start(START)
  const said = (r: any) => String(r.deny ?? r.result)   // a refusal is a deny (the model's error result)
  expect(said(await $.tool.call({ tool: 'mcp__cadre__ask', clarity: { outcome: 1, scope: 1, acceptance: 1, constraints: 1 } }))).toContain('call explore first')
  expect(said(await $.tool.call({ tool: 'mcp__cadre__explore', question: 'where is login handled?' }))).toContain('An explorer starts when this turn ends')
  expect(said(await $.tool.call({ tool: 'mcp__cadre__ask', clarity: { outcome: 1, scope: 1, acceptance: 1, constraints: 1 } }))).not.toContain('call explore first')
})

// review 0.15 #6: the repo turned on mid-session (/cadre init): the plan tools were never registered, yet Agent and the task tools were refused, so main had no way to plan
test('a repo that turns on mid-session: main keeps Agent until its plan tools are registered (next turn) and listed (the turn after)', ENGINE, async ($, on) => {
  let inited = false; const tools: string[] = []
  on('session.start', () => ({ cwd: '/work' })); on('session.cwd', () => ({ value: '/work' })); on('session.root', () => ({ value: '/work' })); on('env.get', () => ({ value: undefined })); on('store.set', () => ({ value: undefined }))
  on('session.version', () => ({ value: { version: '2.1.299' } })); on('store.get', ($: any, e: any) => ({ value: e.key === 'cadre:setup' ? { cc: '2.1.299' } : undefined }))
  on('fs.read', () => { if (!inited) throw new Error('ENOENT'); return { value: '{}' } }); on('fs.stat', () => ({ value: undefined })); on('command.register', () => ({ value: undefined })); on('env.set', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } })); on('fs.write', () => ({ value: undefined })); on('ui.log', () => ({ value: undefined })); on('ui.toast', () => ({ value: undefined }))
  on('tool.register', ($: any, e: any) => { tools.push(e.name); return { value: undefined } }); on('tool.call', () => ({ result: 'ran' })); on('turn.start', ($: any, e: any) => e); mock.clock(on)
  await $.session.start(START); expect(tools).not.toContain('plan')
  inited = true   // /cadre init wrote the config
  const agent = () => $.tool.call({ tool: 'Agent', prompt: 'where is login handled?', description: 'x' }) as any
  expect(await agent()).toEqual({ result: 'ran' })   // no plan tool to point to: Agent stays
  await $.turn.start({ turnId: 't1' }); expect(tools).toEqual(expect.arrayContaining(MAIN_NAMES)); expect(await agent()).toEqual({ result: 'ran' })   // registered now, listed from the next prompt
  await $.turn.start({ turnId: 't2' }); expect((await agent()).deny).toContain('call explore with your question')
})

// slice 5: the HooksError seen under load at session.start was not reproduced (eight starts at once, with the machine's load average at 68 and 24 more busy loops: all returned in about 0.9 s);
// a step that does throw no longer fails the hook: the session goes on, the log says so, and Doctor has a row (tests/doctor.test.ts)
test('eight session.start calls at once all return, with one registered command each', ENGINE, async ($, on) => {
  const commands: any[] = []
  on('session.start', () => ({ cwd: '/work' })); on('session.cwd', () => ({ value: '/work' })); on('session.root', () => ({ value: '/work' })); on('store.get', () => ({ value: undefined })); on('store.set', () => ({ value: undefined }))
  on('command.register', ($, e) => { commands.push(e); return { value: undefined } }); on('env.set', () => ({ value: undefined })); on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } })); on('fs.write', () => ({ value: undefined }))
  mock.clock(on)
  const rs = await Promise.allSettled(Array.from({ length: 8 }, () => $.session.start(START)))
  expect(rs.map(r => r.status)).toEqual(Array(8).fill('fulfilled')); expect(commands.length).toBe(8)
})

test('a session.start step that throws does not fail the hook: the session starts, the log names the step', ENGINE, async ($, on) => {
  const said: string[] = []
  on('session.start', () => ({ cwd: '/work' })); on('session.cwd', () => ({ value: '/work' })); on('session.root', () => ({ value: '/work' })); on('store.get', () => ({ value: undefined })); on('store.set', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined })); on('env.set', () => ({ deny: 'the host was slow' })); on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } })); on('fs.write', () => ({ value: undefined }))
  on('ui.log', ($, e) => { said.push(String(e.text ?? e)); return { value: undefined } })
  mock.clock(on)
  await $.session.start(START)   // resolves: it does not reject
  expect(said.some(t => t.includes('session start:') && t.includes('the host was slow'))).toBe(true)
})

test('a failed start says so: a toast, secret.start set on the throw and cleared by the next complete start; a throw before the version is recorded still leaves cadre off on an old Claude Code', ENGINE, async ($, on) => {
  const said: string[] = [], st: Record<string, any> = {}; let fail = true, ver = 1, deny = 0, v = '2.1.299'
  on('session.start', () => ({ cwd: '/work' })); on('session.cwd', () => ({ value: '/work' })); on('session.root', () => ({ value: '/work' })); on('store.get', () => ({ value: undefined })); on('store.set', () => ({ value: undefined }))
  on('session.version', () => ({ value: { version: v } })); on('command.register', () => ({ value: undefined })); on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } })); on('fs.write', () => ({ value: undefined }))
  on('env.set', () => (fail ? { deny: 'the host was slow' } : { value: undefined }))
  on('state.get', (_$, e) => ({ value: { value: st[e.key], version: ver } }))
  on('state.set', (_$, e) => (deny-- > 0 ? { deny: 'busy' } : (st[e.key] = e.value, { value: { isSet: true, version: ++ver } })))
  on('ui.toast', ($, e) => { said.push(String(e.text ?? e)); return { value: undefined } }); on('ui.log', ($, e) => { said.push(String(e.text ?? e)); return { value: undefined } })
  mock.clock(on)
  await $.session.start(START)
  expect(st.secret.start.failed).toContain('the host was slow'); expect(said).toContain('cadre started only in part; restart Claude Code')
  fail = false; await $.session.start(START); expect(st.secret.start).toBeUndefined()
  v = '2.1.287'; deny = 1; said.length = 0; await $.session.start(START)   // the first state write (the version) throws
  expect(st.secret.old).toBe('2.1.287'); expect(said.some(t => t.includes('cadre needs Claude Code'))).toBe(true)
})
