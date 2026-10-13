import { expect, mock, test } from 'claude-code/testing'

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

test('session.start: no $.agent.register (agents are plugin files, A28), /cadre (immediate), env flags, policy written, one 5 s tick', async ($, on) => {
  const agents: any[] = [], commands: any[] = [], env: string[] = []
  on('session.start', () => ({ cwd: '/work' })); on('session.cwd', () => ({ value: '/work' })); on('session.root', () => ({ value: '/work' })); on('store.get', () => ({ value: undefined })); on('store.set', () => ({ value: undefined }))
  on('agent.register', ($, e) => { agents.push(e); return { value: undefined } })
  on('command.register', ($, e) => { commands.push(e); return { value: undefined } })
  on('env.set', ($, e) => { env.push(`${e.name}=${e.value}`); return { value: undefined } })
  const clock = mock.clock(on)
  await $.session.start(START)
  expect(agents).toEqual([])
  expect(commands).toEqual([{ name: 'cadre', description: expect.any(String), argumentHint: '<sub> [args]', immediate: true }])
  expect(env).toEqual(['CLAUDE_CODE_ENABLE_TODO_TOOLS=1', 'ENABLE_TOOL_SEARCH=false'])
  await clock.advance(5000); await clock.advance(5000)   // the tick is a placeholder: it must not throw
})

test('Claude Code older than cadre needs: one loud line, /cadre answers only it, nothing else starts and every call passes untouched (live 0.12.0 on 2.1.287)', async ($, on) => {
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

test('every slot is a pass-through until its owner fills it: tool.call, tool.check, prompt.submit, command.run reach the engine', async ($, on) => {
  const seen: string[] = []
  on('store.get', () => ({ value: undefined })); on('env.get', () => ({ value: undefined })); on('session.cwd', () => ({ value: '/work' })); on('session.root', () => ({ value: '/work' }))   // policy/guards reads its paths from $.store (keyed by the repo), strictness from env
  on('tool.call', ($, e) => { seen.push(`call:${e.tool}`); return { result: 'ok' } })
  on('tool.check', () => ({ decision: 'allow' }))
  on('prompt.submit', ($, e) => { seen.push('prompt'); return { text: e.text } })
  on('command.run', () => ({ text: 'engine' })); on('fs.read', () => ({ value: '{}' }))   // an initialised repo: .cadre/config.json exists
  expect(await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })).toEqual({ result: 'ok' })
  expect((await $.prompt.submit({ text: 'hello' })).text).toBe('hello')
  expect((await $.command.run({ command: 'cadre', args: 'status' })).text).toBe("that's answered in the dialog now: press 1 on the band or run /cadre")   // commands/cadre.run is filled: it answers itself (ADR 0011: old subcommands are buttons)
  expect(seen).toEqual(['call:Read', 'prompt'])
})

test('dormant until init: main keeps Bash and Edit, status says so; once .cadre/config.json exists the same calls are denied, with no restart', async ($, on) => {
  let inited = false
  on('store.get', () => ({ value: undefined })); on('store.set', () => ({ value: undefined })); on('env.get', () => ({ value: undefined })); on('session.cwd', () => ({ value: '/work' })); on('session.root', () => ({ value: '/work' }))
  on('fs.read', () => { if (!inited) throw new Error('ENOENT'); return { value: '{}' } }); on('fs.stat', () => ({ value: undefined }))
  on('tool.call', () => ({ result: 'ran' })); on('tool.check', () => ({ decision: 'allow' })); on('command.run', () => ({ text: 'engine' }))
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toEqual({ result: 'ran' })
  expect(await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts' })).toEqual({ result: 'ran' })
  expect((await $.command.run({ command: 'cadre', args: 'fix the login bug' })).text).toBe('Welcome to cadre · run /cadre setup once on this machine')
  inited = true
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).not.toEqual({ result: 'ran' })
  expect(await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts' })).not.toEqual({ result: 'ran' })
})

test('dev scenario seeding: inert without CADRE_DEV; with it, session.start seeds board/events/secret/ui from the dump', async ($, on) => {
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
test('the repo root never follows a Bash cd: after /clear with the shell in a package folder, cadre still reads the repo root', async ($, on) => {
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
test('the repo root is the git top level above the project root, spelled from the session path', async ($, on) => {
  const reads: string[] = []
  on('session.cwd', () => ({ value: '/work/kit' })); on('session.root', () => ({ value: '/work/kit' }))
  on('process.run', ($, e) => ({ value: { exitCode: 0, stdout: e.argv.join(' ') === 'git rev-parse --show-cdup' ? '../\n' : '', stderr: '' } }))
  on('store.get', () => ({ value: undefined })); on('store.set', () => ({ value: undefined })); on('env.get', () => ({ value: undefined }))
  on('fs.read', ($, e) => { reads.push(e.path); throw new Error('ENOENT') }); on('command.run', () => ({ text: 'engine' })); on('ui.open', () => ({ value: undefined }))
  await $.command.run({ command: 'cadre', args: '' })
  expect(reads).toContain('/work/.cadre/config.json')
})
// live 0.9.1 (2.1.296): Claude stopped with setup checks red and the run sat in "running": the stop is refused with the list
test('during a setup run main\'s stop is refused while a check is red; with no run it passes', async ($, on) => {
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
