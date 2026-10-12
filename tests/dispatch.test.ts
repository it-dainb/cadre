import { describe, expect, test } from 'claude-code/testing'
import { answer, dispatch, initConfirm, initPropose, isHuman } from '../core/dispatch'
import { plan, world } from './fixtures/native/world'

const card = { title: 't', lines: ['  1. x'], sub: 'setup', change: 'setup' }
const route = async () => ({ text: 'routed' })

describe('origin matrix (ADR 0012): only a press or the ask dialog is the human', () => {
  test('press and dialog yes; composer, sdk, adapter, bridge, plugin and the rest no', () => {
    expect([isHuman({ kind: 'press' }), isHuman({ kind: 'dialog' })]).toEqual([null, null])
    for (const kind of ['composer', 'sdk', 'adapter', 'bridge', 'plugin', 'task-notification', 'scheduled-trigger', 'peer', 'unclassified']) expect(isHuman({ kind })).toContain(`origin ${kind} cannot decide`)
  })
  test('every gate command is refused to a typed origin before routing; reads and start commands are open', async () => {
    const w = await world()
    for (const origin of [{ kind: 'composer' }, { kind: 'bridge' }, { kind: 'sdk' }, { kind: 'adapter', name: 'pm' }]) {
      for (const [cmd, args] of [['approve', ['p1']], ['reject', ['p1']], ['resolve', ['p1', 'recut']], ['release', []], ['restore', []], ['sync', ['add', 'pm']], ['drive', ['on']], ['config', ['set', 'a', 'b']], ['init', ['confirm']], ['setup', ['confirm']], ['init', ['cancel']]] as [string, string[]][])
        expect((await w.text({ cmd, args, origin })).text).toContain('cannot decide')
    }
    const o = { kind: 'bridge' }
    expect(await w.text({ cmd: 'status', args: [], origin: o })).toEqual({ text: 'routed' })
    expect(await w.text({ cmd: 'sync', args: ['now'], origin: o })).toEqual({ text: 'routed' })
    expect(await w.text({ cmd: 'drive', args: ['status'], origin: o })).toEqual({ text: 'routed' })
    expect(await w.text({ cmd: 'config', args: ['show'], origin: o })).toEqual({ text: 'routed' })
    expect(await w.text({ cmd: 'init', args: [], origin: { kind: 'composer' } })).toEqual({ text: 'routed' })   // typed `/cadre init` / `setup` only START the run
    expect((await w.text({ cmd: 'setup', args: [], origin: o })).text).toContain('cannot start setup')
  })
  test('an unknown schemaVersion is refused', async () => {
    const w = await world()
    expect(await dispatch(w.h, { schemaVersion: 2 as any, cmd: 'status', args: [], origin: { kind: 'composer' } }, route)).toEqual({ text: 'refused: unsupported command schemaVersion' })
  })
})

describe('approval is a press (or dialog) on the decision: no typed path exists', () => {
  test('a typed approve with an @code suffix is just an unknown plan; nothing is approved', async () => {
    const w = await world(); const { plan: p, task } = await plan(w)
    expect((await w.text({ cmd: 'approve', args: [`${p}@ab12cd34`], origin: { kind: 'composer' } })).text).toContain('cannot decide')
    expect((await w.text({ cmd: 'approve', args: [`${p}@ab12cd34`] })).text).toBe(`refused: no draft plan ${p}@ab12cd34`)
    expect((await w.store.get(task)).category).toBe('draft')
  })
  test('the secret atom carries no approval material', async () => {
    const w = await world(); await plan(w); await initPropose(w.h, 2, 'd', card)
    const s = await w.h.secret.read(); for (const k of ['approval', 'nonce', 'initNonce', 'initConfirm', 'dcode', 'token']) expect(s).not.toHaveProperty(k)
  })
})

describe('init confirm (DESIGN 10.1): the card is bound to the diff hash', () => {
  test('the card carries the diff hash and a Confirm that runs `<sub> confirm` (no code)', async () => {
    const w = await world(); await initPropose(w.h, 2, 'diff', card)
    const d = (await w.h.board.read()).decisions![0]; expect([d.id, d.options.map(o => o.run)]).toEqual(['init:2', ['setup confirm', 'setup cancel', 'setup']]); expect(d.hash).toMatch(/^[0-9a-f]+$/)
  })
  test('a confirm of a pending card is true once and settles it; with nothing pending (or another stage) it is false', async () => {
    const w = await world(); await initPropose(w.h, 2, 'd', card)
    expect(await initConfirm(w.h, 3)).toBe(false); expect((await w.h.board.read()).decisions).toHaveLength(1)
    expect(await initConfirm(w.h, 2)).toBe(true); expect((await w.h.board.read()).decisions).toEqual([])
    expect(await initConfirm(w.h, 2)).toBe(false)   // replay
  })
  test('answer: a changed diff (new hash) refuses the old answer; the current one runs', async () => {
    const w = await world(); await initPropose(w.h, 2, 'd1', card); const old = (await w.h.board.read()).decisions![0].hash
    await initPropose(w.h, 2, 'd2', card)
    expect((await answer(w.h, 'init:2', 'a', old, route)).text).toBe('refused: it changed; review again')
    expect((await answer(w.h, 'init:2', 'a', (await w.h.board.read()).decisions![0].hash, route)).text).toBe('routed')
  })
})
