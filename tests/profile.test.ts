import { describe, expect, test } from 'claude-code/testing'
import { BUILTIN, check, cross, describe as show, loadProfile, bootProfile, loaded, nameOk } from '../core/profile'
import { setProfile, pipeOf, active } from '../core/pipeline'
import { profile as DEFAULT } from '../profiles/default'
const LOADED = JSON.parse(JSON.stringify(DEFAULT).split('${MODULES}').join('/plug/modules'))   // the default as a session loads it: its hooks run the plugin's modules
import { resolve } from '../config/index'
import { runShape } from '../core/validate'
import { fakeHost } from './support'
import type { Profile, ProfileLayer } from '../types/profile'

// a host with the user file, the repo's files and the module files that exist ("present"); the plugin is at /plug
const host = (o: { user?: unknown; repo?: unknown; cfg?: Record<string, unknown>; present?: string[]; adapters?: unknown } = {}) => {
  const files: Record<string, string> = {}
  if (o.repo !== undefined) files['/repo/.cadre/profile.json'] = typeof o.repo === 'string' ? o.repo : JSON.stringify(o.repo)
  const h = fakeHost({ files }) as any, present = o.present ?? []
  h.root = async () => '/plug'; h.config = async () => ({ profile: o.user ?? 'default', adapters: o.adapters ?? {}, ...o.cfg })
  h.stat = async (p: string, r?: { resolve?: boolean }) => (present.includes(p) ? { kind: 'file', realPath: r?.resolve ? p : undefined } : p === '/repo/.cadre/modules' || p === '/plug/modules' ? { kind: 'dir', realPath: p } : undefined)
  return h
}
const STEP_W = { role: 'writer', workspace: 'worktree', brief: ['description'] }
const WRITER = BUILTIN.docs.roles!.writer
const LAYER = (x: Record<string, unknown>): ProfileLayer => ({ schema: 2, ...x }) as ProfileLayer
const refused = async (layer: ProfileLayer, where: 'user' | 'repo' = 'repo') => { const l = await loadProfile(where === 'repo' ? host({ repo: layer }) : host({ user: layer })); return where === 'repo' ? l.bad : l.user }

describe('the built-in profiles', () => {
  test('default, docs and analysis pass the schema and every cross-check (docs and analysis over the default flag rows)', () => {
    for (const [n, l] of Object.entries(BUILTIN)) { expect(check(l)).toBeNull(); expect(cross({ ...DEFAULT, ...l, flags: { ...DEFAULT.flags, ...l.flags } } as Profile), n).toBeNull() }
    expect(Object.keys(BUILTIN)).toEqual(['default', 'docs', 'analysis'])
  })
  test('the default loads as the default; docs replaces the sections it names and keeps the default flag rows', async () => {
    const d = await loadProfile(host()); expect(d.bad).toBeUndefined(); expect(d.profile).toEqual(LOADED); expect(d.name).toBe('default')
    const x = await loadProfile(host({ user: 'docs' })); expect(Object.keys(x.profile.types)).toEqual(['doc']); expect(Object.keys(x.profile.roles)).toEqual(['explorer', 'writer', 'critic']); expect(x.profile.flags).toEqual({ ...DEFAULT.flags, ...BUILTIN.docs.flags })
    expect(x.profile.hooks).toEqual({}); expect(x.profile.protected).toEqual([]); expect(x.profile.landing.provider).toBe('direct')   // S6: the docs profile wires no delivery hook (no changelog) and protects nothing
    const a = await loadProfile(host({ user: 'analysis' })); expect(a.profile.hooks).toEqual({}); expect(a.profile.types.analysis.pipeline).toEqual(['explore', 'work', 'verify', 'review', 'land']); expect(a.profile.checks.check.network).toBe(false)
    expect((await loadProfile(host({ user: 'nope' }))).user).toContain('no such built-in profile')   // the default stays, the refusal is shown
  })
  test('S6: envPass names are environment variable names, landing.union paths are plain repo paths; the default unions CHANGELOG.md, docs and analysis nothing', () => {
    const c = (landing: object, hooks: object = {}) => cross({ ...DEFAULT, landing: { ...DEFAULT.landing, ...landing }, hooks } as Profile)
    expect(c({ envPass: ['GH_TOKEN', '_x1'] })).toBeNull(); expect(c({ union: ['CHANGELOG.md', 'docs/NOTES.md'] })).toBeNull()
    for (const n of ['1X', 'A-B', 'A B', '', 'A=1']) expect(c({ envPass: [n] })).toContain('is not an environment variable name'), expect(c({}, { release: [{ run: ['x'], envPass: [n] }] })).toContain('is not an environment variable name')
    for (const u of ['/etc/x', '../x', 'a b', 'a*', '!x', '#x', '', 'a\nb', 'a\rb', 'a\vb', 'a\fb', 'a\tb', 'a b', 'a//b', './a', 'a/.', 'a=b', 'a\\b', 'ä']) expect(c({ union: [u] })).toContain('landing.union')
    expect(check({ schema: 2, landing: { ...DEFAULT.landing, union: 'CHANGELOG.md' } })).toContain('landing'); expect(DEFAULT.landing.union).toEqual(['CHANGELOG.md']); expect(BUILTIN.docs.landing!.union).toBeUndefined(); expect(BUILTIN.analysis.landing!.union).toBeUndefined()
  })
  test('pipelines for the six default types equal 1.0.1\'s defaults() (golden), and so do the commit prefixes (G5)', () => {
    expect(Object.fromEntries(Object.entries(DEFAULT.types).map(([k, v]) => [k, [v.commit ?? null, v.pipeline.join('>'), v.contract]]))).toEqual({
      feature: ['feat', 'tester>red>worker>green>reviewer>merge', 'required'], bug: ['fix', 'tester>red>worker>green>reviewer>merge', 'required'], refactor: ['refactor', 'worker>green>reviewer>merge', 'required'],
      docs: ['docs', 'worker>reviewer>merge', 'none'], test: ['test', 'tester>reviewer>merge', 'none'], spike: [null, 'explorer>report', 'none'] })
    expect([DEFAULT.types.feature.lite, DEFAULT.types.bug.lite, DEFAULT.types.docs.lite]).toEqual([['worker', 'green', 'reviewer', 'merge'], ['worker', 'green', 'reviewer', 'merge'], undefined])
    expect(Object.fromEntries(Object.entries(DEFAULT.types).map(([k, v]) => [k, v.acceptance.cover]))).toEqual({ feature: 'results', bug: 'results', refactor: 'report', docs: 'report', test: 'report', spike: 'none' })
  })
  test('G5: TypeSpec.commit is the landed commit prefix a type declares: a layer changes it for one type and the rest keep theirs', async () => {
    const l = await loadProfile(host({ repo: LAYER({ types: { bug: { ...DEFAULT.types.bug, commit: 'perf' } } }) }))
    expect([l.profile.types.bug.commit, l.profile.types.feature.commit]).toEqual(['perf', 'feat'])
  })
})

describe('refusals: one line, with an example', () => {
  const R: [string, ProfileLayer, string][] = [
    ['an unknown key', LAYER({ colour: 1 }), 'colour: unknown key'],
    ['a step names a role that is not there', LAYER({ steps: { w: { ...STEP_W, role: 'ghost' } } }), 'steps.w.role: no role "ghost"'],
    ['a gate names a check that is not there', LAYER({ steps: { g: { gate: 'lint', expect: 'pass', on: 'worker' } } }), 'steps.g.gate: no check "lint"'],
    ['a gate on a step after the gate', LAYER({ steps: { w: STEP_W, g: { gate: 'integrate', expect: 'pass', on: 'later' }, later: STEP_W }, roles: { writer: WRITER }, types: { t: { pipeline: ['w', 'g', 'later'], acceptance: { format: 'x', cover: 'none' }, contract: 'none' } } }), 'gate "g" must come after its step "later"'],
    ['the integrate gate is not last', LAYER({ steps: { w: STEP_W, g: { gate: 'integrate', expect: 'pass', on: 'w' } }, roles: { writer: WRITER }, types: { t: { pipeline: ['g', 'w'], acceptance: { format: 'x', cover: 'none' }, contract: 'none' } } }), 'must come after its step'],
    ['the integrate gate comes before a review step', LAYER({ steps: { w: STEP_W, g: { gate: 'integrate', expect: 'pass', on: 'w' }, r: { role: 'critic', workspace: 'none', brief: ['diff'] } }, roles: { writer: WRITER, critic: BUILTIN.docs.roles!.critic }, types: { t: { pipeline: ['w', 'g', 'r'], acceptance: { format: 'x', cover: 'none' }, contract: 'none' } } }), 'the integrate gate must be last and after every review step'],
    ['a check gate after a read-only step', LAYER({ steps: { s: { role: 'scout', workspace: 'none', brief: ['description'] }, g: { gate: 'verify', expect: 'pass', on: 's' } }, roles: { scout: { ...WRITER, write: [] } }, checks: { verify: { failExit: [1], network: false } }, types: { t: { pipeline: ['s', 'g'], acceptance: { format: 'x', cover: 'none' }, contract: 'none' } } }), 'follows the read-only step "s"'],
    ['a pipeline step that does not exist', LAYER({ types: { t: { pipeline: ['nope'], acceptance: { format: 'x', cover: 'none' }, contract: 'none' } } }), 'types.t: no step "nope"'],
    ['a step twice', LAYER({ types: { t: { pipeline: ['worker', 'worker'], acceptance: { format: 'x', cover: 'none' }, contract: 'none' } } }), 'step "worker" appears twice'],
    ['an unknown effect', LAYER({ flags: { blocked: { why: 'w', holds: false, yolo: 'human', options: [{ key: 'k', label: 'K', effect: [{ do: 'explode' }] }] } } }), 'effect[0].do: expected'],
    ['an unknown effect parameter', LAYER({ flags: { blocked: { why: 'w', holds: false, yolo: 'human', options: [{ key: 'k', label: 'K', effect: [{ do: 'wait', kinds: ['x'] }] }] } } }), 'effect "wait" takes no "kinds"'],
    ['an unknown counter', LAYER({ flags: { blocked: { why: 'w', holds: false, yolo: 'human', options: [{ key: 'k', label: 'K', effect: [{ do: 'retry', counter: 'lives' }] }] } } }), 'no counter "lives"'],
    ['an unknown ${NAME}', LAYER({ sandbox: { env: { A: '${HOME}/x' } } }), 'sandbox: no ${HOME}'],
    ['an empty hook argument list', LAYER({ hooks: { 'task.closed': [{ run: [] }] } }), 'hooks.task.closed: a hook runs an argument list'],
    ['an unknown event', LAYER({ hooks: { 'task.done': [{ run: ['true'] }] } }), 'unknown event'],
    ['a module that is not there', LAYER({ hooks: { 'task.closed': [{ run: ['node', '${MODULES}/missing.mjs'] }] } }), '${MODULES}/missing.mjs: no such module'],
    ['a step id of __proto__', JSON.parse('{"schema":2,"steps":{"__proto__":{"role":"worker","workspace":"none","brief":[]}}}'), 'not a plain name'],
    ['a path-like step id', LAYER({ steps: { '../x': STEP_W } }), 'not a plain name'],
    ['a check named like a built-in gate', LAYER({ checks: { integrate: {} } }), '"integrate" is a built-in gate'],
    ['a built-in role redefined', LAYER({ roles: { worker: WRITER } }), 'a built-in role cannot be redefined'],
    ['a role that drops an exit tool', LAYER({ roles: { scribe: { ...WRITER, disallowedTools: ['SubagentHandback'] } } }), 'SubagentHandback'],
    ['a field that requires a type that is not there', LAYER({ fields: [{ name: 'x', store: 'meta', required: ['ghost'] }] }), 'no type "ghost"'],
  ]
  for (const [what, layer, why] of R) test(`${what}: the line names it and shows an example (repo layer: dormant; user layer: shown, the default stays)`, async () => {
    const r = await refused(layer, 'repo'), u = await refused(layer, 'user')
    for (const line of [r, u]) { expect(line).toContain(why); expect(line).not.toContain('\n'); expect(line).toMatch(/example: |sections: /) }
    expect(r).toMatch(/^repo profile: /); expect(u).toMatch(/^user profile: /)
  })
  test('names: plain characters only; the prototype names are never a key', () => {
    expect(['worker', 'my-step_2', 'A1'].every(nameOk)).toBe(true); expect(['', '__proto__', 'constructor', 'prototype', 'a/b', 'a.b', '-x', 'x'.repeat(41), 'a b'].some(nameOk)).toBe(false)
  })
})

describe('the repo layer (D18, B23): as is, the repo wins; an invalid one is dormant with no fallback', () => {
  const MODS = ['/repo/.cadre/modules/note.mjs']
  test('roles, hooks, a provider and a network slot load as is; ${MODULES} resolves to the repo folder', async () => {
    const l = await loadProfile(host({ present: MODS, repo: LAYER({
      roles: { scribe: WRITER }, checks: { fetch: { network: true } }, hooks: { 'task.closed': [{ run: ['node', '${MODULES}/note.mjs'], commit: 'docs: ${id}' }] },
      landing: { provider: '${MODULES}/note.mjs', onEpicDone: 'off', baseline: 'strict' } }) }))
    expect(l.bad).toBeUndefined(); expect(l.repo).toBe('.cadre/profile.json'); expect(l.profile.roles.scribe).toEqual(WRITER); expect(l.profile.checks.fetch.network).toBe(true)
    expect(l.profile.hooks['task.closed']).toEqual([{ run: ['node', '/repo/.cadre/modules/note.mjs'], commit: 'docs: ${id}' }]); expect(l.profile.landing.provider).toBe('/repo/.cadre/modules/note.mjs')
    expect(l.profile.roles.worker).toEqual(DEFAULT.roles.worker)   // what it does not name survives
  })
  test('${MODULES} resolves per origin layer: the plugin\'s folder for the user layer, the repo\'s for the repo', async () => {
    const both = await loadProfile(host({ present: ['/plug/modules/u.mjs', '/repo/.cadre/modules/r.mjs'], user: LAYER({ hooks: { release: [{ run: ['node', '${MODULES}/u.mjs'] }] } }), repo: LAYER({ hooks: { 'task.closed': [{ run: ['node', '${MODULES}/r.mjs'] }] } }) }))
    expect([both.bad, both.profile.hooks.release![0], both.profile.hooks['task.closed']![0]]).toEqual([undefined, { run: ['node', '/plug/modules/u.mjs'] }, { run: ['node', '/repo/.cadre/modules/r.mjs'] }])
  })
  test('F6: ${MODULES} is substituted per string after the parse: a plugin path with a quote and a backslash stays one string', async () => {
    const root = '/pl"ug\\x', h = host({ user: LAYER({ hooks: { release: [{ run: ['node', '${MODULES}/u.mjs'] }] } }) }), stat = h.stat
    h.root = async () => root; h.stat = async (p: string, r?: { resolve?: boolean }) => (p === `${root}/modules/u.mjs` ? { kind: 'file', realPath: r?.resolve ? p : undefined } : p === `${root}/modules` ? { kind: 'dir', realPath: p } : stat(p, r))
    const l = await loadProfile(h); expect(l.bad).toBeUndefined(); expect(l.profile.hooks.release![0]).toEqual({ run: ['node', `${root}/modules/u.mjs`] })
  })
  test('a repo key replaces the same user key and a key it does not name survives (the repo wins)', async () => {
    const user = LAYER({ limits: { rebaseRounds: 5, startFails: 4 }, roles: { scribe: WRITER }, fields: [{ name: 'team', store: 'meta', required: false }] })
    const repo = LAYER({ limits: { rebaseRounds: 7 }, roles: { scribe: { ...WRITER, description: 'the repo\'s writer' } }, fields: [{ name: 'team', store: 'meta', required: true }, { name: 'area', store: 'meta', required: false }] })
    const l = await loadProfile(host({ user, repo })); expect(l.bad).toBeUndefined()
    expect([l.profile.limits.rebaseRounds, l.profile.limits.startFails, l.profile.roles.scribe.description]).toEqual([7, 4, 'the repo\'s writer'])
    expect(l.profile.fields.filter(f => ['team', 'area'].includes(f.name)).map(f => [f.name, f.required])).toEqual([['team', true], ['area', false]]); expect(l.profile.fields.some(f => f.name === 'scope')).toBe(true)
    expect(Object.keys(l.owner).length).toBeGreaterThan(0)
  })
  test('flags merge over the default rows by kind: a layer lists only what it changes', async () => {
    const row = { why: 'the repo\'s own line', holds: false, yolo: 'human' as const, options: [{ key: 'k', label: 'Keep', effect: [{ do: 'clear' as const }] }] }
    const l = await loadProfile(host({ repo: LAYER({ flags: { blocked: row } }) }))
    expect(l.profile.flags.blocked).toEqual(row); expect(l.profile.flags.red).toEqual(DEFAULT.flags.red); expect(Object.keys(l.profile.flags)).toEqual(Object.keys(DEFAULT.flags))
  })
  test('invalid: an unknown key, a missing module, adapters, credentialEnv and an envPass naming a credential make cadre dormant for the repo, with one line and no fallback', async () => {
    const cases: [unknown, string, unknown?][] = [[{ schema: 2, colour: 1 }, 'colour: unknown key'], [LAYER({ hooks: { release: [{ run: ['node', '${MODULES}/gone.mjs'] }] } }), 'no such module'],
      [{ schema: 2, adapters: {} }, 'adapters: a user-level key'], [{ schema: 2, credentialEnv: 'X' }, 'credentialEnv: a user-level key'], ['{oops', 'not valid JSON'],
      [LAYER({ landing: { provider: 'direct', onEpicDone: 'off', baseline: 'strict', envPass: ['GH_TOKEN'] } }), 'GH_TOKEN is a credential name', { gh: { credentialEnv: 'GH_TOKEN' } }]]
    for (const [repo, why, adapters] of cases) {
      const h = host({ repo, adapters }), l = await loadProfile(h)
      expect(l.bad).toContain(why); expect(l.bad).toMatch(/^repo profile: /); expect(l.bad).not.toContain('\n'); expect(l.profile).toEqual(LOADED)   // the layers below are shown, never run on
      const sec: any = { active: true }; h.secret.read = async () => sec
    }
  })
  test('a repo hook may be any program; only ${MODULES} paths are confined (absolute, .., a subdirectory, a link, a file that is not there)', async () => {
    expect((await loadProfile(host({ repo: LAYER({ hooks: { release: [{ run: ['sh', '-c', 'true'] }, { run: ['/usr/bin/env', 'x'] }, { run: ['node', 'scripts/release.js'] }] } }) }))).bad).toBeUndefined()
    for (const p of ['${MODULES}//etc/x.mjs', '${MODULES}/../x.mjs', '${MODULES}/sub/x.mjs', '${MODULES}/x.sh', 'x/${MODULES}/y.mjs', '${MODULES}x.mjs']) expect((await loadProfile(host({ present: ['/repo/.cadre/modules/x.mjs'], repo: LAYER({ hooks: { release: [{ run: ['node', p] }] } }) }))).bad, p).toContain('a plain file name')
    const link = host({ repo: LAYER({ hooks: { release: [{ run: ['node', '${MODULES}/link.mjs'] }] } }) }); link.stat = async (p: string, r?: { resolve?: boolean }) => (p === '/repo/.cadre/modules/link.mjs' ? { kind: r?.resolve ? 'file' : 'symlink', realPath: '/elsewhere/link.mjs' } : { kind: 'dir', realPath: p })
    expect((await loadProfile(link)).bad).toContain('no such module')
    const dirLink = host({ present: ['/repo/.cadre/modules/x.mjs'], repo: LAYER({ hooks: { release: [{ run: ['node', '${MODULES}/x.mjs'] }] } }) }); dirLink.stat = async (p: string, r?: { resolve?: boolean }) => (p === '/repo/.cadre/modules' ? { kind: r?.resolve ? 'dir' : 'symlink', realPath: '/elsewhere' } : { kind: 'file', realPath: p.replace('/repo/.cadre/modules', '/elsewhere') })
    expect((await loadProfile(dirLink)).bad).toContain('no such module')
  })
  test('the profile is read once, at session start: an edit mid-session changes nothing until the next start', async () => {
    const h = host({ repo: LAYER({ limits: { rebaseRounds: 6 } }) }); try {
      await bootProfile(h); expect(loaded()!.profile.limits.rebaseRounds).toBe(6)
      h.readText = async () => JSON.stringify(LAYER({ limits: { rebaseRounds: 9 } })); expect(loaded()!.profile.limits.rebaseRounds).toBe(6); expect(active().limits.rebaseRounds).toBe(6)
      await bootProfile(h); expect(active().limits.rebaseRounds).toBe(9)
    } finally { setProfile(DEFAULT) }
  })
  test('a user profile that is refused is shown and the default stays; the repo is not blamed', async () => {
    const l = await loadProfile(host({ user: { schema: 2, colour: 1 } })); expect(l.user).toContain('colour: unknown key'); expect(l.bad).toBeUndefined(); expect(l.profile).toEqual(LOADED)
  })
})

describe('config keys and the tester\'s run', () => {
  test('a repo config names a built-in profile and limits; an inline profile in the repo config is refused (its own is .cadre/profile.json)', () => {
    const ok = resolve([{ name: '.cadre/config.json', trust: 'repo', value: { profile: 'docs', limits: { rebaseRounds: 1 } } }]); expect(ok.diagnostics).toEqual([]); expect([ok.config.profile, ok.config.limits.rebaseRounds]).toEqual(['docs', 1])
    expect(resolve([{ name: '.cadre/config.json', trust: 'repo', value: { profile: { schema: 2 } } }]).diagnostics.join()).toContain('profile: a built-in profile name')
    expect(resolve([{ name: 'u', trust: 'user', value: { profile: { schema: 2 } } }]).diagnostics).toEqual([])
    expect(resolve([{ name: '.cadre/config.json', trust: 'repo', value: { units: [{ root: '.', checks: { test: ['node', '--test'] } }] } }]).diagnostics).toEqual([])   // repo data argv for a declared slot: accepted (it runs jailed)
    for (const k of ['types', 'tdd', 'review', 'lanes']) expect(resolve([{ name: 'u', trust: 'user', value: { [k]: {} } }]).diagnostics).toEqual([`u: ${k}: unknown key`])
    expect(resolve([{ name: 'u', trust: 'user', value: { limits: { testerRounds: 2 }, roles: { custom: {} } } }]).diagnostics).toEqual(['u: limits.testerRounds: unknown key', 'u: roles.custom: unknown key'])
  })
  test('the tester\'s run is argv and a folder only: it never picks a check slot', () => {
    expect(runShape({ command: ['node', '--test'] })).toBeNull(); expect(runShape({ command: ['node'], cwd: 'sub' })).toBeNull()
    expect(runShape({ command: ['node'], slot: 'setup' })).toContain('not yours to pick'); expect(runShape({ command: ['node'], network: true })).toContain('only command and cwd')
  })
})

describe('/cadre profile', () => {
  test('names the profile, the layers, where each entry came from and what cannot run', async () => {
    const present = ['/repo/.cadre/modules/note.mjs'], h = host({ present, user: 'docs', repo: LAYER({ roles: { scribe: WRITER }, hooks: { release: [{ run: ['node', '${MODULES}/note.mjs'] }] } }) })
    try {
      await bootProfile(h); const t = await show(h)
      expect(t.split('\n')[0]).toBe('profile docs + .cadre/profile.json'); expect(t).toContain('roles: explorer, writer, critic (docs) · scribe (repo)'); expect(t).toContain('types: doc (docs)'); expect(t).toContain('hooks: release 1 · landing: direct')
      expect(t).toContain('unrunnable: none'); present.length = 0   // the module goes away after the load: the next look says so
      expect(await show(h)).toContain('unrunnable: no module modules/note.mjs')
    } finally { setProfile(DEFAULT) }
  })
  test('a refused repo profile is named, with the instruction that cadre stays off; the active profile is the layers below', async () => {
    const h = host({ repo: { schema: 2, colour: 1 } }); try { await bootProfile(h); const t = await show(h); expect(t).toContain('repo profile invalid: colour: unknown key'); expect(t).toContain('cadre stays off for this repo') } finally { setProfile(DEFAULT) }
  })
  test('pipeOf follows the active profile and falls back to nothing for an unknown type', () => {
    try { setProfile({ ...DEFAULT, ...BUILTIN.docs, flags: DEFAULT.flags } as Profile); expect([pipeOf('doc'), pipeOf('feature')]).toEqual([['write', 'review', 'land'], []]) } finally { setProfile(DEFAULT) }
  })
})
