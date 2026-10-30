// ADR 0022: path-sliced plan notes, the cache-friendly brief layout (plan block first, byte-identical across siblings), scenario coverage as a hard check.
import { describe, expect, test } from 'claude-code/testing'
import { admitWith } from '../core/admission'
import type { Deps } from '../core/admission'
import { defaults } from '../config/index'
import { MemoryStore } from '../task-management/adapters/memory/store'
import { brief, planBlock } from '../core/briefs'
import { coverageGaps, notesOf, sliceNotes, untested, validateFields } from '../core/validate'
import { fakeHost, task } from './support'
import type { Host } from '../types'

const NOTES = [{ text: 'tests run with node --test' }, { paths: ['src/auth/'], text: 'auth: tokens are signed in src/auth/sign.ts' }, { paths: ['src/billing/**'], text: 'billing: cents, never floats' }]

describe('notes keyed by path', () => {
  test('metadata.notes takes the old string or a list of {paths?, text}; a bad list is refused with the shape', () => {
    expect(validateFields({ kind: 'plan', notes: 'auth lives in src/auth' })).toBeNull(); expect(validateFields({ kind: 'plan', notes: NOTES })).toBeNull()
    for (const bad of [[], [{ paths: ['a'] }], [{ text: 'x', paths: 'src' }], [{ text: 'x', paths: [] }], [{ text: 'x'.repeat(3001) }]]) expect(validateFields({ kind: 'plan', notes: bad })).toContain('[{"paths":["src/auth/"],"text":"…"}]')
  })
  test('the old string is one note for every task; a stored list parses back', () => {
    expect(notesOf('auth lives in src/auth')).toEqual([{ text: 'auth lives in src/auth' }]); expect(notesOf(JSON.stringify(NOTES))).toEqual(NOTES); expect(notesOf(undefined)).toEqual([])
  })
  test('a task gets the notes whose paths overlap its own (folder prefix or glob); notes without paths are shared; off: all shared', () => {
    expect(sliceNotes(NOTES, ['src/auth/login.ts'], true)).toEqual({ shared: 'tests run with node --test', slice: 'auth: tokens are signed in src/auth/sign.ts' })
    expect(sliceNotes(NOTES, ['src/billing/invoice.ts', 'src/auth'], true).slice).toBe('auth: tokens are signed in src/auth/sign.ts\nbilling: cents, never floats')
    expect(sliceNotes(NOTES, ['docs/x.md'], true).slice).toBe('')
    expect(sliceNotes(NOTES, [], true).slice).toContain('billing')   // a task that declares no paths sees every note
    expect(sliceNotes(NOTES, ['src/auth/login.ts'], false)).toEqual({ shared: NOTES.map(n => n.text).join('\n'), slice: '' })
  })
})

describe('brief layout: plan block first, byte-identical for sibling tasks', () => {
  const plan = { mission: 'Goal: sign in', protectedPaths: ['.git/', '.cadre/'], core: JSON.stringify({ items: [{ name: 'Session', kind: 'type', params: [], returns: 'object', status: 'new' }] }), shared: 'tests run with node --test' }
  const sib = (id: string, paths: string[]) => ({ ...plan, id, title: `task ${id}`, type: 'feature', scenarios: `S1: Given ${id} When x Then y`, paths, notes: `spawned ${id}`, others: ['- zz: src/x'], ...sliceNotes(NOTES, paths, true) })
  test('two siblings of every role share the plan block byte for byte; ids, paths and notes slices come after it', () => {
    for (const role of ['worker', 'tester', 'reviewer', 'explorer'] as const) {
      const a = brief(role, sib('a1', ['src/auth/login.ts'])), b = brief(role, sib('b2', ['src/billing/x.ts'])), p = planBlock(plan)
      expect(a.startsWith(`${p}\n\n`)).toBe(true); expect(b.startsWith(`${p}\n\n`)).toBe(true)
      for (const v of ['a1', 'b2', 'src/auth', 'src/billing', 'tokens are signed', 'cents']) expect(p).not.toContain(v)
      expect(a).toContain('## Notes on your files\nauth: tokens are signed'); expect(a).not.toContain('cents'); expect(b).toContain('cents')
    }
  })
  test('the plan block carries mission, protected paths, the landed core interface and the shared notes; nothing when there is no plan data', () => {
    const p = planBlock(plan)
    for (const s of ['## Mission\nGoal: sign in', '## Protected paths (never change them)\n.git/', '- Session (kind: type; params: ; returns: object; status: new)', '## Shared notes\ntests run with node --test']) expect(p).toContain(s)
    expect(planBlock({})).toBe('')
  })
})

// the admission path end to end: the epic's notes and core contract reach every sibling's brief in the same bytes
const T0 = 1_700_000_000_000
async function world() {
  const store = new MemoryStore(() => T0), dirs = new Set<string>(), refs = new Set(['epic/p1-x', 'dev'])
  const run = async (argv: readonly string[]) => {
    const a = argv.slice(3); if (a[0] === 'worktree' && a[1] === 'add') { dirs.add(a.includes('-b') ? a[4] : a[2]); if (a.includes('-b')) refs.add(a[3]) }
    return { exitCode: a[0] === 'rev-parse' && a.includes('--quiet') && !refs.has(a[a.length - 1].replace('^{commit}', '')) ? 1 : 0, stdout: a[0] === 'rev-parse' ? 'abc1234\n' : '', stderr: '' }
  }
  await store.init({ types: {} as any, journal: true }); const epic = await store.createEpic('E', 'goal'), ids: string[] = []
  for (const [i, p] of [['src/auth/a.ts'], ['src/billing/b.ts']].entries()) ids.push((await store.createDraft({ title: `task ${i}`, description: 'd', acceptance: 'S1: Given x When y Then z', design: '{"none":true,"reason":"internal"}', type: 'refactor', parent: epic, meta: { 'cadre.package': '.', 'cadre.paths': JSON.stringify(p) } })).id)
  await store.approve([epic, ...ids]); await store.setMeta(epic, { 'cadre.notes': JSON.stringify(NOTES), 'cadre.coreContract': plan0 }, 'x')
  const mk = (n: string, slice = true) => {
    const h: Host = { ...fakeHost({ t0: T0 }), run, stat: async (p: string) => (dirs.has(p) ? { kind: 'dir' } : undefined) } as any
    const cfg = defaults(); cfg.notes.slice = slice
    return { h, d: { store, cfg, root: '/repo', home: '/hm/u', wtRoot: '/wt', key: 'repo-1', actor: 'cadre/u/aaaaaa', session: `s-${n}` } as Deps }
  }
  const prompt = async (n: string, id: string, slice = true) => {
    const { h, d } = mk(n, slice), seen: any[] = []
    await h.board.update(s => ({ ...s, seq: 1, mission: 'Goal: sign in', epic, plan: { id: epic, slug: 'x', state: 'approved', epicBranch: 'epic/p1-x' }, tasks: ids.map(i => task(i, { type: 'refactor' })) }))
    await admitWith(h, d, { prompt: `do TASK-${id}`, description: 'd', subagentType: 'general-purpose', background: true, fork: false }, async (e: any) => (seen.push(e), { agentId: `ag-${n}` })).then(r => { if (!seen.length) throw new Error(JSON.stringify(r)) })
    return seen[0].prompt as string
  }
  return { ids, prompt }
}
const plan0 = JSON.stringify({ items: [{ name: 'Session', kind: 'type', params: [], returns: 'object', status: 'new' }] })

describe('admission builds the briefs from the plan (notes.slice)', () => {
  test('siblings spawned in different sessions share the plan block up to the task block; each gets only its notes', async () => {
    const w = await world(), a = await w.prompt('a', w.ids[0]), b = await w.prompt('b', w.ids[1]), cut = (s: string) => s.slice(0, s.indexOf('Worker brief.'))
    expect(cut(a)).toBe(cut(b)); expect(cut(a)).toContain('## Mission\nGoal: sign in'); expect(cut(a)).toContain('Session (kind: type'); expect(cut(a)).toContain('## Shared notes\ntests run with node --test')
    expect(a).toContain('tokens are signed'); expect(a).not.toContain('cents'); expect(b).toContain('cents'); expect(b).not.toContain('tokens are signed')
  })
  test('notes.slice off: every note is in the shared plan block', async () => {
    const w = await world(), a = await w.prompt('a', w.ids[0], false)
    expect(a.slice(0, a.indexOf('Worker brief.'))).toContain('cents'); expect(a).not.toContain('## Notes on your files')
  })
})

describe('scenario coverage is a hard check (a type whose acceptance.cover is not none)', () => {
  const acc = 'S1: Given a When b Then c\nS3: Given a When b Then c\nS30: Given a When b Then c'
  const T = (...ids: string[][]) => ids.map((i, n) => ({ name: `t${n}`, ids: i }))
  test('a scenario counts as tested only when a declared test lists its exact id (the name says nothing)', () => {
    expect(untested(acc, T(['S1'], ['S3'], ['S30']))).toEqual([]); expect(untested(acc, T(['S1', 'S30']))).toEqual(['S3'])
    expect(untested(acc, [{ name: 'S1 S3 S30', ids: [] }, { name: 'x', ids: ['S10'] }])).toEqual(['S1', 'S3', 'S30']); expect(untested(acc, null)).toEqual([])   // no locked tests: nothing to check
  })
  test('a pass is blocked by an untested scenario or a coverage entry not marked ok; off: nothing blocks', () => {
    expect(coverageGaps(true, acc, T(['S1'], ['S3'], ['S30']), [{ scenario: 'S1', ok: true }, { scenario: 'S3', test: 't', ok: false }, { scenario: 'S30', ok: 'weak' }])).toEqual(['scenario S3 is not covered by a test that checks it', 'scenario S30 is not covered by a test that checks it'])
    expect(coverageGaps(true, acc, T(['S1'], ['S30']), [])).toEqual(['scenario S3 has no test']); expect(coverageGaps(false, acc, T(['S1']), [{ scenario: 'S1', ok: false }])).toEqual([])
  })
  test('the reviewer brief says so in task language and names the untested scenarios; without the rule the section is absent', () => {
    const r = brief('reviewer', { id: 'a1', title: 't', type: 'feature', scenarios: acc, uncovered: ['S3'] })
    expect(r).toContain('## Scenario coverage\nEvery scenario needs a spec test named after its id'); expect(r).toContain('No spec test is named after: S3. That alone means verdict changes.')
    expect(brief('reviewer', { id: 'a1', title: 't', type: 'feature', scenarios: acc })).not.toContain('Scenario coverage')
  })
})
