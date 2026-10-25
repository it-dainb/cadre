import { describe, expect, test } from 'claude-code/testing'
import { classOf, defaults, envLayer, load, resolve, tighten } from '../config/index'
import type { Layer } from '../config/index'
import { fakeHost } from './support'
import { REG } from '../config/defaults'

const user = (value: unknown, name = 'home'): Layer => ({ name, trust: 'user', value })
const repo = (value: unknown): Layer => ({ name: 'repo', trust: 'repo', value })

describe('defaults (DESIGN 12)', () => {
  test('golden values', async () => {
    const d = defaults()
    expect([d.strictness, d.mcpAllow, d.jail, d.effectCheck, d.roles.testerView, d.roles.tdd.author]).toEqual(['strict', [], 'auto', 'auto', 'view', 'separate'])
    expect([d.store.kind, d.drive, d.cost.clearHintPct, d.cost.compactPct]).toEqual(['file', { mode: 'auto', spawn: 'mod', maxTurns: 100, maxCostUsd: 20, maxWallMinutes: 240, noProgressTurns: 3 }, 40, 60])
    expect([d.concurrency.default, d.review.maxRework, d.reuse, d.review, d.limits.reportRetries, d.roles.reviewer.byRisk.thorough, d.ui.glyphs, d.branches.dev, d.branches.epicPrefix, d.release.onEpicDone, d.changelog.path])
      .toEqual([3, 3, { maxContextPct: 60, cacheTtlMs: 3_600_000 }, { ...d.review }, 3, { model: 'opus', effort: 'high', escalate: { after: 0, model: 'opus', effort: 'high' } }, 'unicode', 'dev', 'epic/', 'propose', 'CHANGELOG.md'])
    expect(Object.keys((d.types as object))).toEqual(['feature', 'bug', 'refactor', 'docs', 'test', 'spike'])
    expect(d.roles.explorer).toEqual({ model: 'haiku', effort: 'low' })
  })
  test('limits.shapeRetries: a row beside limits.reportRetries, default 6, whole numbers 1..10', async () => {
    expect(defaults().limits.shapeRetries).toBe(6); expect(Object.keys(REG).indexOf('limits.shapeRetries')).toBe(Object.keys(REG).indexOf('limits.reportRetries') + 1)
    expect([REG['limits.shapeRetries'].min, REG['limits.shapeRetries'].max]).toEqual([1, 10]); expect(REG['limits.shapeRetries'].desc).toContain('never count against the 3 tries')
  })
  test('defaults() returns a fresh object each time', async () => { const a = defaults(); a.mcpAllow.push('x'); expect(defaults().mcpAllow).toEqual([]) })
})

describe('classes', () => {
  test('S / U / O by longest prefix', async () => {
    for (const k of ['strictness', 'mcpAllow', 'jail', 'jailWritable', 'effectCheck', 'roles.testerView']) expect(classOf(k)).toBe('S')
    for (const k of ['adapters.pm.command', 'store.kind', 'worktrees.root', 'drive.maxTurns', 'cost.prices', 'disable']) expect(classOf(k)).toBe('U')
    for (const k of ['changelog.path', 'cost.clearHintPct', 'types', 'units', 'sync.pm', 'review.maxRework', 'concurrency.default', 'ui.glyphs', 'roles.worker.tier', 'roles.tdd.author', 'models.fast']) expect(classOf(k)).toBe('O')
  })
  test('tighten: bool takes only the strict value, enum the stricter, list the intersection', async () => {
    expect(tighten('jail', 'auto', 'on')).toBe('on')
    expect(tighten('strictness', 'strict', 'advisory')).toBe('strict'); expect(tighten('strictness', 'advisory', 'strict')).toBe('strict')
    expect(tighten('roles.testerView', 'view', 'full')).toBe('view'); expect(tighten('jail', 'auto', 'on')).toBe('on'); expect(tighten('jail', 'on', 'off')).toBe('on')
    expect(tighten('mcpAllow', ['a', 'b'], ['b', 'c'])).toEqual(['b'])
  })
})

describe('layers', () => {
  test('precedence: defaults < userConfig < home < home[repo] < repo < env', async () => {
    const r = resolve([user({ concurrency: { default: 2 }, ui: { glyphs: 'ascii' } }, 'userConfig'), user({ concurrency: { default: 4 } }), user({ concurrency: { default: 5 } }, 'home[repo]'), repo({ concurrency: { default: 6 } }), user({ concurrency: { default: 7 } }, 'env')])
    expect(r.config.concurrency.default).toBe(7); expect(r.config.ui.glyphs).toBe('ascii'); expect(r.diagnostics).toEqual([])
  })
  test('branch and remote names that reach git push/fetch: an option-like value is refused', async () => {
    const r = resolve([repo({ branches: { dev: '--upload-pack=x', main: '' }, landing: { remote: '-o' } })])
    expect([r.config.branches.dev, r.config.branches.main, r.config.landing.remote]).toEqual(['dev', '', 'origin'])
    expect(r.diagnostics.map(d => d.split(': a git name')[0]).sort()).toEqual(['repo: branches.dev', 'repo: landing.remote'])
    expect(resolve([repo({ branches: { dev: 'release/next' }, landing: { remote: 'up-stream' } })]).diagnostics).toEqual([])
  })
  test('repo may not relax S keys: ignored with a diagnostic; may tighten', async () => {
    const r = resolve([user({ strictness: 'advisory', mcpAllow: ['a', 'b'] }), repo({ strictness: 'strict', mcpAllow: ['b', 'c'] })])
    expect(r.config.strictness).toBe('strict')
    expect(r.config.mcpAllow).toEqual(['b'])
    expect(r.diagnostics).toEqual(['repo: mcpAllow: the repo file may only tighten this key'])
    const d = resolve([repo({ strictness: 'advisory' })])   // defaults are strict: the repo cannot relax them
    expect(d.config.strictness).toBe('strict')
    expect(d.diagnostics).toEqual(['repo: strictness: the repo file may only tighten this key'])
  })
  test('drive.mode: yolo only from the user; a repo file may force auto, never yolo (ADR 0013)', async () => {
    const r = resolve([repo({ drive: { mode: 'yolo' } })])
    expect(r.config.drive.mode).toBe('auto'); expect(r.diagnostics).toEqual(['repo: drive.mode: the repo file may only tighten this key'])
    expect(resolve([user({ drive: { mode: 'yolo' } })]).config.drive.mode).toBe('yolo')
    const f = resolve([user({ drive: { mode: 'yolo' } }), repo({ drive: { mode: 'auto' } })]); expect([f.config.drive.mode, f.diagnostics]).toEqual(['auto', []])
    expect(resolve([repo({ drive: { maxTurns: 5 } })]).diagnostics).toEqual(['repo: drive.maxTurns: user-level only, ignored in the repo file'])
    expect(classOf('drive.mode')).toBe('S')
  })
  test('user layers may relax S keys', async () => {
    const r = resolve([user({ strictness: 'advisory', roles: { testerView: 'full' } })])
    expect([r.config.strictness, r.config.roles.testerView]).toEqual(['advisory', 'full'])
  })
  test('repo cannot set U keys but can set O siblings (drive.maxCostUsd vs concurrency.default)', async () => {
    const r = resolve([repo({ store: { kind: 'memory' }, drive: { maxCostUsd: 9999 }, adapters: { x: { command: ['y'] } }, worktrees: { root: '/tmp' }, concurrency: { default: 9 } })])
    expect(r.config.store).toMatchObject({ kind: 'file' }); expect(r.config.drive.maxCostUsd).toBe(20)
    expect(r.config.adapters).toEqual({}); expect(r.config.worktrees.root).toBe(''); expect(r.config.concurrency.default).toBe(9)
    expect(r.diagnostics.sort()).toEqual(['repo: adapters: user-level only, ignored in the repo file', 'repo: drive.maxCostUsd: user-level only, ignored in the repo file', 'repo: store.kind: user-level only, ignored in the repo file', 'repo: worktrees.root: user-level only, ignored in the repo file'])
  })
  test('units[].knownRed: a repo layer cannot widen units[i].knownRed (it keeps only what the user layer granted)', async () => {
    const r = resolve([user({ units: [{ root: 'a', knownRed: ['lint', 'e2e'] }] }), repo({ units: [{ root: 'a', knownRed: ['lint', 'sneaky'], checks: { t: ['x'] } }, { root: 'b', knownRed: ['x'] }, { root: 'c' }] })])
    expect(r.config.units).toEqual([{ root: 'a', knownRed: ['lint'], checks: { t: ['x'] } }, { root: 'b', knownRed: [] }, { root: 'c', knownRed: [] }])
    expect(resolve([user({ units: [{ root: 'a', knownRed: ['lint'] }] }), repo({ units: [{ root: 'a' }] })]).config.units).toEqual([{ root: 'a', knownRed: ['lint'] }])
  })
  test('bad layers are skipped with a diagnostic; unknown keys and wrong types are dropped, the rest applies', async () => {
    const r = resolve([user('bad json in x', 'home'), user({ nope: 1, concurrency: { default: 'many' }, ui: { glyphs: 'ascii' }, roles: { worker: 5 } })])
    expect(r.config.ui.glyphs).toBe('ascii'); expect(r.config.concurrency.default).toBe(3)
    expect(r.diagnostics).toEqual(['home: not an object, skipped', 'home: nope: unknown key', 'home: concurrency.default: expected number', 'home: roles.worker: expected an object'])
  })
  test('env layer maps CADRE_* and is user-trust', async () => {
    expect(envLayer({ CADRE_STRICTNESS: 'advisory', CADRE_STORE: 'memory', CADRE_DISABLE: 'true' })).toEqual({ strictness: 'advisory', store: { kind: 'memory' }, disable: true })
    expect(envLayer({})).toEqual({})
    const r = resolve([repo({}), user(envLayer({ CADRE_STORE: 'memory' }), 'env')])
    expect(r.config.store.kind).toBe('memory')
  })
  test('load() reads home file (+ per-repo section), repo file, env and userConfig through the Host', async () => {
    const h = fakeHost({
      options: { strictness: 'advisory' }, env: { CADRE_STORE: 'memory' },
      files: { '/hm/u/.claude/cadre.json': JSON.stringify({ concurrency: { default: 4 }, repos: { 'r-1': { concurrency: { default: 5 }, drive: { maxTurns: 7 } }, other: { concurrency: { default: 99 } } } }), '/repo/.cadre/config.json': JSON.stringify({ review: { maxRework: 8 }, strictness: 'advisory' }) },
    })
    const { config, diagnostics } = await load(h, { home: '/hm/u', root: '/repo', repoKey: 'r-1' })
    expect([config.concurrency.default, config.drive.maxTurns, config.review.maxRework, config.store.kind]).toEqual([5, 7, 8, 'memory'])
    expect(config.strictness).toBe('advisory'); expect(diagnostics).toEqual([])
    const bad = await load(fakeHost({ files: { '/repo/.cadre/config.json': '{oops' } }), { home: '/h', root: '/repo', repoKey: 'k' })
    expect(bad.diagnostics).toEqual(['.cadre/config.json: not an object, skipped'])
  })
  test('settings: models.allow: opus[1m], @date, :0 pass; an unknown model fails load and names the cell; maxParallel is renamed', () => {
    const at = (m: string, extra: any = {}) => resolve([{ name: 'u', trust: 'user', value: { roles: { worker: { byRisk: { light: { model: m } } } }, ...extra } }]).diagnostics
    expect([at('opus[1m]'), at('claude-opus-4-5@20251101'), at('claude-sonnet-4-5[1m]'), at('us.anthropic.claude-opus-4-1-v1:0')]).toEqual([[], [], [], []])
    expect(at('gpt-5')).toEqual(['roles.worker.byRisk.light.model: unknown model "gpt-5" (an alias, a claude-… id or a models.allow entry)'])
    expect(at('gpt-5', { models: { allow: ['gpt-5'] } })).toEqual([])
    expect(resolve([{ name: 'u', trust: 'user', value: { units: [{ root: '.', routing: { worker: { model: 'bogus' } } }] } }]).diagnostics).toEqual(['units .: routing.worker.model: unknown model "bogus" (an alias, a claude-… id or a models.allow entry)'])
    expect(resolve([{ name: 'u', trust: 'user', value: { maxParallel: 2 } }]).diagnostics).toEqual(['u: maxParallel: renamed: concurrency.default'])
  })
})
