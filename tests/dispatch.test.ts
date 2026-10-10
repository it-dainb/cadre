import { describe, expect, test } from 'claude-code/testing'
import { defaults } from '../config/index'
import { dispatch, initConfirm, initPropose, isHuman, newToken } from '../core/dispatch'
import { plan, world } from './fixtures/native/world'

const cfg = (adapters: Record<string, unknown> = {}) => ({ ...defaults(), adapters })
const approve = async (w: Awaited<ReturnType<typeof world>>, origin: any) => w.text({ cmd: 'approve', args: [`${(await w.h.board.read()).plan!.id}@${(await w.h.secret.read()).approval!.code8}`], origin })

describe('origin matrix (DESIGN 2.5): who is the human', () => {
  test('composer yes; bridge, plugin, task-notification, unclassified no', async () => {
    const w = await world()
    expect(await isHuman(w.h, { kind: 'composer' })).toBeNull()
    for (const kind of ['bridge', 'plugin', 'task-notification', 'scheduled-trigger', 'peer', 'unclassified']) expect(await isHuman(w.h, { kind })).toBe(`origin ${kind} is not human`)
  })
  test('sdk only under approval.allowSdk (user-level config or CADRE_ALLOW_SDK_APPROVAL)', async () => {
    expect(await isHuman((await world()).h, { kind: 'sdk' })).toContain('approval.allowSdk is off')
    expect(await isHuman((await world({ env: { CADRE_ALLOW_SDK_APPROVAL: '1' } })).h, { kind: 'sdk' })).toBeNull()
  })
  test('adapter:<name> needs a commands grant AND the current session token', async () => {
    const w = await world({ config: cfg({ pm: { grants: ['commands'] }, ro: { grants: ['events'] } }) })
    const tok = await newToken(w.h)
    expect(w.h.toasts).toEqual([`cadre session token: ${tok}`]); expect(w.h.logs).toEqual([])
    expect(await isHuman(w.h, { kind: 'adapter', name: 'pm', token: tok })).toBeNull()
    for (const o of [{ kind: 'adapter', name: 'pm', token: 'wrong' }, { kind: 'adapter', name: 'pm' }, { kind: 'adapter', name: 'ro', token: tok }, { kind: 'adapter', name: 'zz', token: tok }])
      expect(await isHuman(w.h, o)).toContain('is not granted commands or the session token is wrong')
    expect(await isHuman((await world({ config: cfg({ pm: { grants: ['commands'] } }) })).h, { kind: 'adapter', name: 'pm', token: undefined })).toContain('session token')   // no token drawn yet
  })
  test('a new token (`adapter token`) kills the old one', async () => {
    const w = await world({ config: cfg({ pm: { grants: ['commands'] } }) }); const old = await newToken(w.h)
    expect((await w.text({ cmd: 'adapter', args: ['token'] })).text).toContain('shown by toast only')
    expect(await isHuman(w.h, { kind: 'adapter', name: 'pm', token: old })).not.toBeNull()
    expect(await isHuman(w.h, { kind: 'adapter', name: 'pm', token: (await w.h.secret.read()).token })).toBeNull()
  })
})

describe('approval through every origin: plan@code8 is required of all of them', () => {
  test('bridge / plugin origins are refused, and the refused attempt still redraws the nonce', async () => {
    const w = await world(); await plan(w); const c = (await w.h.secret.read()).approval!.code8
    expect((await approve(w, { kind: 'bridge' })).text).toBe('refused: origin bridge is not human')
    expect((await approve(w, { kind: 'plugin', name: 'x' })).text).toBe('refused: origin plugin is not human')
    expect((await w.h.secret.read()).approval!.code8).not.toBe(c)
  })
  test('sdk under allowSdk with the right code approves; with a wrong code does not', async () => {
    const w = await world({ env: { CADRE_ALLOW_SDK_APPROVAL: '1' } }); const { plan: p } = await plan(w)
    expect((await w.text({ cmd: 'approve', args: [`${p}@bad`], origin: { kind: 'sdk' } })).text).toContain('token mismatch')
    expect((await approve(w, { kind: 'sdk' })).text).toContain('approved')
  })
  test('adapter: granted + token + plan@code8 approves; granted + token but a wrong code does not', async () => {
    const w = await world({ config: cfg({ pm: { grants: ['commands'] } }) }); const { plan: p } = await plan(w); const token = await newToken(w.h)
    expect((await w.text({ cmd: 'approve', args: [`${p}@bad`], origin: { kind: 'adapter', name: 'pm', token } })).text).toContain('token mismatch')
    expect((await approve(w, { kind: 'adapter', name: 'pm', token })).text).toContain('approved')
  })
  test('approve without a code from a non-human is refused before routing; status is open to anyone', async () => {
    const w = await world()
    expect(await w.text({ cmd: 'approve', args: ['p1'], origin: { kind: 'plugin', name: 'x' } })).toEqual({ text: 'refused: origin plugin is not human' })
    expect(await w.text({ cmd: 'status', args: [], origin: { kind: 'plugin', name: 'x' } })).toEqual({ text: 'routed' })
    expect(await w.text({ cmd: 'sync', args: ['now'], origin: { kind: 'bridge' } })).toEqual({ text: 'routed' })
    expect(await w.text({ cmd: 'sync', args: ['add', 'pm'], origin: { kind: 'bridge' } })).toEqual({ text: 'refused: origin bridge is not human' })
    expect(await w.text({ cmd: 'drive', args: ['on'], origin: { kind: 'bridge' } })).toEqual({ text: 'refused: origin bridge is not human' })
    expect(await w.text({ cmd: 'drive', args: ['status'], origin: { kind: 'bridge' } })).toEqual({ text: 'routed' })
    expect(await w.text({ cmd: 'config', args: ['set', 'a', 'b'], origin: { kind: 'bridge' } })).toEqual({ text: 'refused: origin bridge is not human' })
    expect(await w.text({ cmd: 'config', args: ['show'], origin: { kind: 'bridge' } })).toEqual({ text: 'routed' })
  })
  test('an unknown schemaVersion is refused', async () => {
    const w = await world()
    expect(await dispatch(w.h, { schemaVersion: 2 as any, cmd: 'status', args: [], origin: { kind: 'composer' } }, async () => ({ text: 'x' }))).toEqual({ text: 'refused: unsupported command schemaVersion' })
  })
})

describe('init confirm code (DESIGN 10.1): nonce-salted, burned on every attempt', () => {
  test('same diff, two proposals → two different codes (not a hash of the diff); the code lives only in secret', async () => {
    const w = await world()
    const a = await initPropose(w.h, 2, 'diff'), na = (await w.h.secret.read()).initNonce
    const b = await initPropose(w.h, 2, 'diff')
    expect(a).toMatch(/^[0-9a-f]{8}$/); expect(a).not.toBe(b); expect((await w.h.secret.read()).initNonce).not.toBe(na)
    expect(JSON.stringify(await w.h.board.read())).not.toContain(b)
  })
  test('accepted and refused attempts both redraw the nonce and kill the code', async () => {
    const w = await world(); const code = await initPropose(w.h, 2, 'd'); const n0 = (await w.h.secret.read()).initNonce
    expect(await initConfirm(w.h, 2, 'wrong')).toBe(false)
    const s1 = await w.h.secret.read(); expect([s1.initNonce === n0, s1.initConfirm]).toEqual([false, undefined])
    expect(await initConfirm(w.h, 2, code)).toBe(false)   // the refused attempt burned it
    const c2 = await initPropose(w.h, 2, 'd'); const n2 = (await w.h.secret.read()).initNonce
    expect(await initConfirm(w.h, 3, c2)).toBe(false)   // wrong stage
    await initPropose(w.h, 2, 'd'); const c3 = (await w.h.secret.read()).initConfirm!.code
    expect(await initConfirm(w.h, 2, c3)).toBe(true)
    const s = await w.h.secret.read(); expect(s.initConfirm).toBeUndefined(); expect(s.initNonce).not.toBe(n2)
    expect(await initConfirm(w.h, 2, c3)).toBe(false)   // replay
  })
  test('a non-human `init confirm` is refused and burns the pending code', async () => {
    const w = await world(); await initPropose(w.h, 2, 'd')
    expect(await w.text({ cmd: 'init', args: ['confirm', 'x'], origin: { kind: 'bridge' } })).toEqual({ text: 'refused: origin bridge is not human' })
    expect((await w.h.secret.read()).initConfirm).toBeUndefined()
  })
})
