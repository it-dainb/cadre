import { expect, mock, test } from 'claude-code/testing'

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

test('session.start: no $.agent.register (agents are plugin files, A28), /cadre (immediate), env flags, policy written, one 5 s tick', async ($, on) => {
  const agents: any[] = [], commands: any[] = [], env: string[] = []
  on('session.start', () => ({ cwd: '/work' })); on('session.cwd', () => ({ value: '/work' })); on('store.get', () => ({ value: undefined })); on('store.set', () => ({ value: undefined }))
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

test('every slot is a pass-through until its owner fills it: tool.call, tool.check, prompt.submit, command.run reach the engine', async ($, on) => {
  const seen: string[] = []
  on('store.get', () => ({ value: undefined })); on('env.get', () => ({ value: undefined })); on('session.cwd', () => ({ value: '/work' }))   // policy/guards reads its paths from $.store (keyed by the repo), strictness from env
  on('tool.call', ($, e) => { seen.push(`call:${e.tool}`); return { result: 'ok' } })
  on('tool.check', () => ({ decision: 'allow' }))
  on('prompt.submit', ($, e) => { seen.push('prompt'); return { text: e.text } })
  on('command.run', () => ({ text: 'engine' })); on('fs.read', () => ({ value: '{}' }))   // an initialised repo: .cadre/config.json exists
  expect(await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })).toEqual({ result: 'ok' })
  expect((await $.prompt.submit({ text: 'hello' })).text).toBe('hello')
  expect((await $.command.run({ command: 'cadre', args: 'status' })).text).toBe('no plan\ncost: 0 tokens · containment unknown')   // commands/cadre.run is filled (w2-plan): it answers itself
  expect(seen).toEqual(['call:Read', 'prompt'])
})

test('dormant until init: main keeps Bash and Edit, status says so; once .cadre/config.json exists the same calls are denied, with no restart', async ($, on) => {
  let inited = false
  on('store.get', () => ({ value: undefined })); on('store.set', () => ({ value: undefined })); on('env.get', () => ({ value: undefined })); on('session.cwd', () => ({ value: '/work' }))
  on('fs.read', () => { if (!inited) throw new Error('ENOENT'); return { value: '{}' } }); on('fs.stat', () => ({ value: undefined }))
  on('tool.call', () => ({ result: 'ran' })); on('tool.check', () => ({ decision: 'allow' })); on('command.run', () => ({ text: 'engine' }))
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toEqual({ result: 'ran' })
  expect(await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts' })).toEqual({ result: 'ran' })
  expect((await $.command.run({ command: 'cadre', args: 'status' })).text).toBe('cadre is off in this repo · run /cadre init')
  inited = true
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).not.toEqual({ result: 'ran' })
  expect(await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts' })).not.toEqual({ result: 'ran' })
})

test('dev scenario seeding: inert without CADRE_DEV; with it, session.start seeds board/events/secret/ui from the dump', async ($, on) => {
  const env: Record<string, string> = {}, reads: string[] = [], state: Record<string, unknown> = {}
  const dump = { b: { schemaVersion: 1, seq: 7, repo: 'r', mission: null, epic: 'p3', plan: { id: 'p3', slug: 'p3', state: 'approved', epicBranch: 'epic/p3' }, tasks: [], approval: { planId: null, missing: [] }, drive: { on: false, level: 'epic', epicId: null, turns: 0, costUsd: 0, startedAt: null }, sync: [], cost: { tokens: 0 }, containment: { state: 'unknown', unsandboxed: 0 }, resumesQueued: 0, init: [] }, ring: [{ seq: 1 }, { seq: 2 }], sec: { nonce: 'x' }, ui: { tab: 'epic' } }
  on('session.start', () => ({ cwd: '/work' })); on('session.cwd', () => ({ value: '/work' })); on('store.get', () => ({ value: undefined })); on('store.set', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined })); on('env.set', () => ({ value: undefined })); on('env.get', ($, e) => ({ value: env[e.name] }))
  on('fs.read', ($, e) => { reads.push(e.path); if (e.path === '/s.json') return { value: JSON.stringify(dump) }; throw new Error('ENOENT') })
  on('state.set', ($, e) => { state[e.key] = e.value; return { value: { isSet: true } } })
  env.CADRE_DEV_SCENARIO = '/s.json'; await $.session.start(START)
  expect(reads).not.toContain('/s.json')   // CADRE_DEV unset: nothing read, nothing seeded
  env.CADRE_DEV = '1'; await $.session.start(START)
  expect(reads).toContain('/s.json')
  expect(JSON.stringify(state)).toContain('"epic":"p3"'); expect(JSON.stringify(state)).toContain('"epics":{"p3":[{"seq":1},{"seq":2}]}')
})
