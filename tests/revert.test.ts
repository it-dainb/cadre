import { describe, expect, test } from 'claude-code/testing'
import { fakeHost } from './support'
import { defaults } from '../config/index'
import { ROUTES } from '../core/dispatch'
import { RevertRefusal, planOf } from '../core/revert'

const S1 = 'a'.repeat(40), M1 = 'b'.repeat(40)
// a scripted git: `has` = the refs that exist; every call is recorded; diff/log answer for the commit being reverted
const world = async (has: string[] = ['dev', 'feat/t1-a']) => {
  const h = fakeHost(), calls: string[] = [], store = await h.taskStore!(), cfg = defaults()
  cfg.units = []
  Object.assign(h, { config: async () => cfg, run: async (argv: readonly string[]) => {
    const a = argv.slice(3), line = a.join(' '); calls.push(line)
    const out = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' })
    if (a[0] === 'rev-parse' && a.includes('--quiet')) return { exitCode: has.includes(a.at(-1)!.replace('^{commit}', '')) ? 0 : 1, stdout: '', stderr: '' }
    if (a[0] === 'diff') return out('src/a.ts\nsrc/b.ts\n')
    if (a[0] === 'log') return out('1111111 feat: a\n2222222 feat: b\n')
    if (a[0] === 'rev-parse') return out(M1)
    if (a[0] === 'worktree' && a[1] === 'list') return out('')
    return out('')
  } })
  const epic = await store.createEpic('auth', 'goal'), mk = (title: string, o: object = {}) => store.createDraft({ title, description: 'd', type: 'feature', parent: epic, ...o })
  const t1 = await mk('login', { meta: { 'cadre.branch': 'feat/t1-a', 'cadre.changelog': JSON.stringify({ category: 'Added', entry: 'Login' }), 'cadre.rec.close': `[cadre:close v1] t1 @1 by mod\nsquash: ${S1}\nepic: x` } })
  const t2 = await mk('logout', { deps: [{ id: t1.id, type: 'blocks' }] }), t3 = await mk('profile', { deps: [{ id: t2.id, type: 'blocks' }] })
  await store.setMeta(epic, { 'cadre.landed': `dev@${M1}`, 'cadre.branch': 'epic/p1-auth' }, 'cadre')
  const ask = async (id: string, key: string) => { const d = ((await h.board.read()).decisions ?? []).find(x => x.id === id)!; return ROUTES.revert(h, { schemaVersion: 1, cmd: d.options.find(o => o.key === key)!.run!.split(' ')[0], args: d.options.find(o => o.key === key)!.run!.split(' ').slice(1), origin: { kind: 'dialog' } }) }
  const press = (id: string) => ROUTES.revert(h, { schemaVersion: 1, cmd: 'revert', args: [id], origin: { kind: 'press' } })
  return { h, store, calls, epic, t1, t2, t3, press, ask }
}

describe('H9 revert flow (core/revert; git in tests/git/revert.test.mjs)', () => {
  test('the card previews what is lost: later dependent tasks, files, commits, the changelog entry', async () => {
    const { t1, t2, t3, press, h } = await world()
    const p = await planOf(h, t1.id); const txt = p.lines.join('\n')
    expect(txt).toContain('changelog: Login'); expect(txt).toContain(`later tasks that depend on it: ${t2.id}, ${t3.id}`); expect(txt).toContain('files lost (2): src/a.ts, src/b.ts'); expect(txt).toContain('commits (2)')
    await press(t1.id); const d = ((await h.board.read()).decisions ?? []).find(x => x.id === `revert:${t1.id}`)!
    expect(d.lines.join('\n')).toBe(txt); expect(d.options.map(o => o.label)).toEqual(['Revert to this point', 'Keep it'])
  })
  test('one confirm does nothing; the second one reverts, and only a dialog that stands can send either', async () => {
    const { h, t1, press, ask, calls, store } = await world()
    expect((await ROUTES.revert(h, { schemaVersion: 1, cmd: 'revert', args: [t1.id, 'yes'], origin: { kind: 'press' } })).text).toContain('not confirmed')   // no card, no confirm
    await press(t1.id); expect((await ROUTES.revert(h, { schemaVersion: 1, cmd: 'revert', args: [t1.id, 'yes'], origin: { kind: 'press' } })).text).toContain('not confirmed')   // the card alone, then "yes"
    await ask(`revert:${t1.id}`, 'c')   // confirm 1
    const ids = ((await h.board.read()).decisions ?? []).map(d => d.id); expect(ids).toEqual([`revert-sure:${t1.id}`])
    expect(calls.some(c => c.startsWith('revert ') || c.startsWith('merge ') || c.includes('worktree add'))).toBe(false); expect((await store.get(t1.id)).meta['cadre.reverted']).toBeUndefined()
    await ask(`revert-sure:${t1.id}`, 'y')   // confirm 2
    expect(calls).toContain(`revert --no-commit ${S1}`); expect(calls.some(c => c.startsWith('merge --no-ff'))).toBe(true)   // a task: its squash commit, no -m
    expect((await store.get(t1.id)).meta['cadre.reverted']).toBeTruthy(); expect(calls.some(c => c.startsWith('update-ref') && c.includes('refs/heads/dev'))).toBe(true)   // dev moved by CAS (landDev -> move), not by a revert on dev
    expect(calls).toContain('branch -D feat/t1-a')   // its recorded branch
  })
  test('an epic reverts its merge (-m 1); a revert of a revert, a second revert, an unknown id and a task that never landed are refused with a declared code', async () => {
    const { h, epic, press, ask, calls, store } = await world()
    await press(epic); await ask(`revert:${epic}`, 'c'); await ask(`revert-sure:${epic}`, 'y'); expect(calls).toContain(`revert --no-commit -m 1 ${M1}`)
    const rec = (await store.get(epic)).meta['cadre.reverted'], code = async (id: string) => planOf(h, id).then(() => 'ok', (e: unknown) => (e instanceof RevertRefusal ? e.code : 'other'))
    expect(await code(rec)).toBe('revert-of-revert'); expect((await press(rec)).text).toContain('refused (revert-of-revert)')
    expect(await code(epic)).toBe('already-reverted'); expect(await code('nope')).toBe('unknown')
    const k = await world(); await k.store.setMeta(k.epic, { 'cadre.landed': '' }, 'cadre')
    expect(await planOf(k.h, k.t1.id).then(() => 'ok', (e: RevertRefusal) => e.code)).toBe('not-landed')
  })
  test('abandoning an epic that never landed removes only the branches the store recorded, whatever the other names', async () => {
    const w = await world(['dev', 'epic/p1-auth', 'feat/t1-a', 'epic/p1-auth-decoy', 'feat/t9-x']), { h, store, epic, press, ask, calls } = w
    await store.setMeta(epic, { 'cadre.landed': '' }, 'cadre')
    await press(epic); const d = ((await h.board.read()).decisions ?? []).find(x => x.id === `revert:${epic}`)!; expect(d.options[0].label).toBe('Abandon it')
    await ask(`revert:${epic}`, 'a'); await ask(`revert-sure:${epic}`, 'z')
    expect(calls.filter(c => c.startsWith('branch -D')).sort()).toEqual(['branch -D epic/p1-auth', 'branch -D feat/t1-a'])
    expect(calls.some(c => c.startsWith('revert') || c.startsWith('merge'))).toBe(false)
  })
})
