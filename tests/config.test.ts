import { describe, expect, test } from 'claude-code/testing'
import { classOf, defaults, envLayer, load, resolve, tighten } from '../config/index'
import type { Layer } from '../config/index'
import { fakeHost } from './support'

const user = (value: unknown, name = 'home'): Layer => ({ name, trust: 'user', value })
const repo = (value: unknown): Layer => ({ name: 'repo', trust: 'repo', value })

describe('defaults (DESIGN 12)', () => {
  test('golden values', async () => {
    const d = defaults()
    expect([d.strictness, d.approval.allowSdk, d.mcpAllow, d.jail, d.effectCheck, d.tdd.enforce, d.changelog.enforce, d.roles.testerView, d.roles.tdd.author]).toEqual(['strict', false, [], 'auto', 'auto', true, true, 'view', 'separate'])
    expect([d.store.bin, d.store.timeoutMs, d.store.pollMs, d.drive, d.cost.clearHintPct, d.cost.compactPct]).toEqual(['bd', 45000, 10000, { level: 'epic', maxTurns: 100, maxCostUsd: 20, maxWallMinutes: 240, noProgressTurns: 3 }, 40, 60])
    expect([d.maxParallel, d.maxRows, d.reuse, d.review, d.limits.reportRetries, d.models, d.ui.glyphs, d.branches.dev, d.branches.epicPrefix, d.release.onEpicDone, d.changelog.path])
      .toEqual([3, 6, { maxContextPct: 60, cacheTtlMs: 3_600_000 }, { deepLabels: ['security', 'breaking'], maxRework: 3 }, 3, { fast: 'haiku', standard: 'sonnet', deep: 'opus' }, 'unicode', 'dev', 'epic/', 'propose', 'CHANGELOG.md'])
    expect(Object.keys((d.types as object))).toEqual(['feature', 'bug', 'refactor', 'docs', 'test', 'spike'])
    expect(d.roles.explorer).toEqual({ tier: 'fast', effort: 'low' })
  })
  test('defaults() returns a fresh object each time', async () => { const a = defaults(); a.mcpAllow.push('x'); expect(defaults().mcpAllow).toEqual([]) })
})

describe('classes', () => {
  test('S / U / O by longest prefix', async () => {
    for (const k of ['strictness', 'approval.allowSdk', 'mcpAllow', 'jail', 'jailWritable', 'effectCheck', 'tdd.enforce', 'changelog.enforce', 'roles.testerView']) expect(classOf(k)).toBe('S')
    for (const k of ['adapters.pm.command', 'store.bin', 'store.dir', 'store.kind', 'worktrees.root', 'drive.maxTurns', 'cost.prices', 'disable']) expect(classOf(k)).toBe('U')
    for (const k of ['store.timeoutMs', 'store.pollMs', 'changelog.path', 'cost.clearHintPct', 'types', 'packages', 'sync.pm', 'review.maxRework', 'maxParallel', 'ui.glyphs', 'roles.worker.tier', 'roles.tdd.author', 'models.fast']) expect(classOf(k)).toBe('O')
  })
  test('tighten: bool takes only the strict value, enum the stricter, list the intersection', async () => {
    expect(tighten('approval.allowSdk', false, true)).toBe(false)
    expect(tighten('tdd.enforce', false, true)).toBe(true); expect(tighten('tdd.enforce', true, false)).toBe(true)
    expect(tighten('strictness', 'strict', 'advisory')).toBe('strict'); expect(tighten('strictness', 'advisory', 'strict')).toBe('strict')
    expect(tighten('roles.testerView', 'view', 'full')).toBe('view'); expect(tighten('jail', 'auto', 'on')).toBe('on'); expect(tighten('jail', 'on', 'off')).toBe('on')
    expect(tighten('mcpAllow', ['a', 'b'], ['b', 'c'])).toEqual(['b'])
  })
})

describe('layers', () => {
  test('precedence: defaults < userConfig < home < home[repo] < repo < env', async () => {
    const r = resolve([user({ maxParallel: 2, ui: { glyphs: 'ascii' } }, 'userConfig'), user({ maxParallel: 4 }), user({ maxParallel: 5 }, 'home[repo]'), repo({ maxParallel: 6 }), user({ maxParallel: 7 }, 'env')])
    expect(r.config.maxParallel).toBe(7); expect(r.config.ui.glyphs).toBe('ascii'); expect(r.diagnostics).toEqual([])
  })
  test('repo may not relax S keys: ignored with a diagnostic; may tighten', async () => {
    const r = resolve([user({ strictness: 'advisory', approval: { allowSdk: true }, tdd: { enforce: false }, mcpAllow: ['a', 'b'] }), repo({ strictness: 'strict', approval: { allowSdk: true }, tdd: { enforce: true }, mcpAllow: ['b', 'c'] })])
    expect(r.config.strictness).toBe('strict'); expect(r.config.approval.allowSdk).toBe(true)   // repo `true` is the relaxation: user's value stands
    expect(r.config.tdd.enforce).toBe(true); expect(r.config.mcpAllow).toEqual(['b'])
    expect(r.diagnostics).toEqual(['repo: mcpAllow: the repo file may only tighten this key'])
    const d = resolve([repo({ approval: { allowSdk: true }, tdd: { enforce: false } })])   // defaults are strict: the repo cannot relax them
    expect([d.config.approval.allowSdk, d.config.tdd.enforce]).toEqual([false, true])
    expect(d.diagnostics).toEqual(['repo: approval.allowSdk: the repo file may only tighten this key', 'repo: tdd.enforce: the repo file may only tighten this key'])
  })
  test('user layers may relax S keys', async () => {
    const r = resolve([user({ strictness: 'advisory', approval: { allowSdk: true }, tdd: { enforce: false }, roles: { testerView: 'full' } })])
    expect([r.config.strictness, r.config.approval.allowSdk, r.config.tdd.enforce, r.config.roles.testerView]).toEqual(['advisory', true, false, 'full'])
  })
  test('repo cannot set U keys but can set O siblings (store.timeoutMs vs store.bin)', async () => {
    const r = resolve([repo({ store: { bin: '/evil/bd', timeoutMs: 1000 }, drive: { maxCostUsd: 9999 }, adapters: { x: { command: ['y'] } }, worktrees: { root: '/tmp' }, maxRows: 9 })])
    expect(r.config.store).toMatchObject({ bin: 'bd', timeoutMs: 1000 }); expect(r.config.drive.maxCostUsd).toBe(20)
    expect(r.config.adapters).toEqual({}); expect(r.config.worktrees.root).toBe(''); expect(r.config.maxRows).toBe(9)
    expect(r.diagnostics.sort()).toEqual(['repo: adapters: user-level only, ignored in the repo file', 'repo: drive.maxCostUsd: user-level only, ignored in the repo file', 'repo: store.bin: user-level only, ignored in the repo file', 'repo: worktrees.root: user-level only, ignored in the repo file'])
  })
  test('packages[].knownRed: a repo package keeps only what the user layer granted', async () => {
    const r = resolve([user({ packages: [{ root: 'a', knownRed: ['lint', 'e2e'] }] }), repo({ packages: [{ root: 'a', knownRed: ['lint', 'sneaky'], checks: { t: ['x'] } }, { root: 'b', knownRed: ['x'] }, { root: 'c' }] })])
    expect(r.config.packages).toEqual([{ root: 'a', knownRed: ['lint'], checks: { t: ['x'] } }, { root: 'b', knownRed: [] }, { root: 'c', knownRed: [] }])
    expect(resolve([user({ packages: [{ root: 'a', knownRed: ['lint'] }] }), repo({ packages: [{ root: 'a' }] })]).config.packages).toEqual([{ root: 'a', knownRed: ['lint'] }])
  })
  test('bad layers are skipped with a diagnostic; unknown keys and wrong types are dropped, the rest applies', async () => {
    const r = resolve([user('bad json in x', 'home'), user({ nope: 1, maxParallel: 'many', ui: { glyphs: 'ascii' }, roles: { worker: 5 } })])
    expect(r.config.ui.glyphs).toBe('ascii'); expect(r.config.maxParallel).toBe(3)
    expect(r.diagnostics).toEqual(['home: not an object, skipped', 'home: nope: unknown key', 'home: maxParallel: expected number', 'home: roles.worker: expected an object'])
  })
  test('env layer maps CADRE_* and is user-trust', async () => {
    expect(envLayer({ CADRE_STRICTNESS: 'advisory', CADRE_STORE: 'memory', CADRE_ALLOW_SDK_APPROVAL: '1', CADRE_DISABLE: 'true' })).toEqual({ strictness: 'advisory', store: { kind: 'memory' }, approval: { allowSdk: true }, disable: true })
    expect(envLayer({})).toEqual({})
    const r = resolve([repo({}), user(envLayer({ CADRE_STORE: 'memory', CADRE_ALLOW_SDK_APPROVAL: 'true' }), 'env')])
    expect(r.config.store.kind).toBe('memory'); expect(r.config.approval.allowSdk).toBe(true)
  })
  test('load() reads home file (+ per-repo section), repo file, env and userConfig through the Host', async () => {
    const h = fakeHost({
      options: { strictness: 'advisory' }, env: { CADRE_STORE: 'memory' },
      files: { '/home/u/.claude/cadre.json': JSON.stringify({ maxParallel: 4, repos: { 'r-1': { maxParallel: 5, drive: { maxTurns: 7 } }, other: { maxParallel: 99 } } }), '/repo/.cadre/config.json': JSON.stringify({ maxRows: 8, strictness: 'advisory' }) },
    })
    const { config, diagnostics } = await load(h, { home: '/home/u', root: '/repo', repoKey: 'r-1' })
    expect([config.maxParallel, config.drive.maxTurns, config.maxRows, config.store.kind]).toEqual([5, 7, 8, 'memory'])
    expect(config.strictness).toBe('advisory'); expect(diagnostics).toEqual([])
    const bad = await load(fakeHost({ files: { '/repo/.cadre/config.json': '{oops' } }), { home: '/h', root: '/repo', repoKey: 'k' })
    expect(bad.diagnostics).toEqual(['.cadre/config.json: not an object, skipped'])
  })
})
