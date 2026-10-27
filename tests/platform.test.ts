import { expect, test } from 'claude-code/testing'

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const
const ENGINE = { timeoutMs: 30_000 }

// uname: a Darwin / Linux answer, or a probe that throws
const boot = async ($: any, on: any, uname: 'Darwin' | 'Linux' | 'throws') => {
  const runs: string[] = [], sets: string[] = [], said: string[] = [], commands: any[] = [], tools: any[] = []
  on('session.start', () => ({ cwd: '/work' })); on('session.version', () => ({ value: { version: '2.1.299' } })); on('session.cwd', () => ({ value: '/work' })); on('session.root', () => ({ value: '/work' })); on('env.get', () => ({ value: undefined })); on('store.get', () => ({ value: undefined })); on('fs.read', () => ({ value: '{}' })); on('fs.write', () => ({ value: undefined }))
  on('process.run', ($: any, e: any) => { runs.push(e.argv.join(' ')); if (uname === 'throws' && e.argv[0] === 'uname') throw new Error('no uname'); return { value: { exitCode: 0, stdout: e.argv[0] === 'uname' ? `${uname}\n` : '', stderr: '' } } })
  on('store.set', ($: any, e: any) => { sets.push(`${e.key}=${JSON.stringify(e.value)}`); return { value: undefined } })
  on('command.register', ($: any, e: any) => { commands.push(e); return { value: undefined } }); on('tool.register', ($: any, e: any) => { tools.push(e); return { value: undefined } }); on('env.set', () => ({ value: undefined }))
  on('ui.log', ($: any, e: any) => { said.push(String(e.text ?? e)); return { value: undefined } }); on('ui.toast', ($: any, e: any) => { said.push(String(e.text ?? e)); return { value: undefined } })
  on('tool.call', () => ({ result: 'ran' }))
  await $.session.start(START)
  return { runs, sets, said, commands, tools }
}

test('not Linux: one line, only uname spawned, only the platform flag written, /cadre registered and repeating the line, no tools, no tick, every call passes', ENGINE, async ($, on) => {
  const r = await boot($, on, 'Darwin')
  expect(r.runs).toEqual(['uname -s']); expect(r.sets).toEqual([])   // the platform flag is the session secret, an atom: no store key (cadre:roots) is written
  expect(new Set(r.said).size).toBe(1); expect(r.said[0]).toContain('Linux only'); expect(r.commands.map(c => c.name)).toEqual(['cadre']); expect(r.tools).toEqual([])
  expect((await $.command.run({ command: 'cadre', args: 'status' })).text).toBe(r.said[0]); expect(r.runs).toEqual(['uname -s'])   // /cadre says the platform line and spawns nothing
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toEqual({ result: 'ran' })   // an initialised repo, yet no guard: cadre is off
})

test('Linux starts as before; a uname probe error starts normally', ENGINE, async ($, on) => {
  const r = await boot($, on, 'Linux')
  expect(r.commands.map(c => c.name)).toEqual(['cadre']); expect(r.sets.join()).toContain('cadre:roots'); expect(r.said.some(t => t.includes('Linux only'))).toBe(false)
})

test('a probe error is not proof of another OS', ENGINE, async ($, on) => {
  expect((await boot($, on, 'throws')).commands.map(c => c.name)).toEqual(['cadre'])
})
