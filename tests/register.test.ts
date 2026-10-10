import { expect, mock, test } from 'claude-code/testing'

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

test('session.start registers the four agents, /cadre (immediate) and arms one 5 s tick', async ($, on) => {
  const agents: any[] = [], commands: any[] = [], env: string[] = []
  on('session.start', () => ({ cwd: '/work' }))
  on('agent.register', ($, e) => { agents.push(e); return { value: undefined } })
  on('command.register', ($, e) => { commands.push(e); return { value: undefined } })
  on('env.set', ($, e) => { env.push(`${e.name}=${e.value}`); return { value: undefined } })
  const clock = mock.clock(on)
  await $.session.start(START)
  expect(agents.map(a => a.name)).toEqual(['worker', 'tester', 'reviewer', 'explorer'])
  expect(agents.every(a => typeof a.prompt === 'string' && Array.isArray(a.tools))).toBe(true)
  expect(commands).toEqual([{ name: 'cadre', description: expect.any(String), argumentHint: '<sub> [args]', immediate: true }])
  expect(env).toEqual(['CLAUDE_CODE_ENABLE_TODO_TOOLS=1'])
  await clock.advance(5000); await clock.advance(5000)   // the tick is a placeholder: it must not throw
})

test('every slot is a pass-through until its owner fills it: tool.call, tool.check, prompt.submit, command.run reach the engine', async ($, on) => {
  const seen: string[] = []
  on('store.get', () => ({ value: undefined })); on('env.get', () => ({ value: undefined }))   // policy/guards reads its paths from $.store, strictness from env
  on('tool.call', ($, e) => { seen.push(`call:${e.tool}`); return { result: 'ok' } })
  on('tool.check', () => ({ decision: 'allow' }))
  on('prompt.submit', ($, e) => { seen.push('prompt'); return { text: e.text } })
  on('command.run', () => ({ text: 'engine' }))
  expect(await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })).toEqual({ result: 'ok' })
  expect(await $.tool.call({ tool: 'mcp__cadre__inspect' } as any)).toEqual({ result: 'ok' })
  expect((await $.prompt.submit({ text: 'hello' })).text).toBe('hello')
  expect((await $.command.run({ command: 'cadre', args: 'status' })).text).toBe('no plan\ncost: 0 tokens · containment unknown')   // commands/cadre.run is filled (w2-plan): it answers itself
  expect(seen).toEqual(['call:Read', 'call:mcp__cadre__inspect', 'prompt'])
})
