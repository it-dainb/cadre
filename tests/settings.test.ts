// Settings tab (hotkey 9): rows/sources/classes from the settings scenario at 60 and 120, and the buttons' writes through the mod (config/route).
import { describe, expect, test } from 'claude-code/testing'
import settingsScenario from '../scenarios/settings'
import { ROUTES, answer } from '../core/dispatch'
import { rows } from '../config/index'
import { configPress, refreshSettings } from '../config/route'
import { pane } from '../ui/pane'
import { actOf, rowsOf } from '../ui/settings'
import { txt } from '../ui/model'
import type { Acts } from '../ui/model'
import { fakeHost, task } from './support'
import { banned } from './fixtures/wording'

const HOME = '/hm/u/.claude/cadre.json', REPO = '/repo/.cadre/config.json'
const said: string[] = []
const A: Acts = { go() {}, pick() {}, answer() {}, step() {}, run: c => said.push(c) }
const frame = (w: number, ssel = 0) => txt(pane({ ...settingsScenario, ui: { ...settingsScenario.ui, tab: 'settings', ssel } }, w, 60, A).before).map(l => l.replace(/\s+/g, ' ').trim())
// what the dialog's answer does (core/dispatch.answer): the option's run line, {fields} -> value=<typed>, as origin dialog
const press = (h: any, id: string, key: string, hash: string, value: string) => answer(h, id, key, hash, async (x, c) => ROUTES.config(x, c), { value })
const hostWith = async (files: Record<string, string> = {}) => { const h = fakeHost({ files }); await refreshSettings(h); return { h, files } }

describe('settings rows (scenario: every layer)', () => {
  const by = Object.fromEntries(rows([]).map(r => [r.key, r]))
  const all = Object.fromEntries(rowsOf(settingsScenario).map(r => [r.key, r]))
  test('source layer and class per key', () => {
    expect(by['concurrency.default'].src).toBe('default')
    expect([all['concurrency.default'].src, all['review.maxRework'].src, all['strictness'].src, all['jail'].src, all['store.kind'].src, all['drive.maxTurns'].src, all['roles.explorer.model'].src]).toEqual(['user', 'repo', 'repo', 'repo', 'env', 'user', 'default'])
    expect([all['strictness'].cls, all['drive.maxTurns'].cls, all['store.kind'].cls, all['review.maxRework'].cls]).toEqual(['S', 'U', 'U', 'O'])
    expect(all['strictness'].value).toBe('strict')   // the repo file tightened the advisory from the user file
  })
  for (const w of [60, 120]) test(`golden lines at ${w}`, () => {
    const t = frame(w).join('\n'), s = frame(w, rowsOf(settingsScenario).findIndex(r => r.key === 'strictness')).join('\n')
    expect(frame(w, rowsOf(settingsScenario).findIndex(r => r.key === 'changelog.path')).join('\n')).toContain('changelog.path docs/CHANGES.md repo')
    expect(t).toContain('concurrency.default 5 user')
    expect(frame(w, rowsOf(settingsScenario).findIndex(r => r.key === 'roles.worker.byRisk.light.model')).join('\n')).toContain('worker.light.model opus user')
    expect(frame(w, rowsOf(settingsScenario).findIndex(r => r.key === 'concurrency.default')).join('\n')).toContain('e: change')
    expect(s).toMatch(/strictness strict repo/)
    expect(s).toContain('default strict · tighten-only from repo · strict: guards')
    expect(frame(w).join('\n')).toContain('9: Settings')
  })
})

describe('buttons', () => {
  test('a toggle / cycle / edit button runs the matching config line', () => {
    const all = Object.fromEntries(rowsOf(settingsScenario).map(r => [r.key, r]))
    expect([actOf(all['disable']), actOf(all['jail']), actOf(all['strictness']), actOf(all['review.maxRework'])]).toEqual(['set disable true', 'set jail off', 'set strictness advisory', 'edit review.maxRework'])
    const ssel = rowsOf(settingsScenario).findIndex(r => r.key === 'concurrency.default'), p = pane({ ...settingsScenario, ui: { ...settingsScenario.ui, tab: 'settings', ssel } }, 120, 60, A)
    const seg = [...p.before, ...p.after].flat().find(s => s.hk === 'e')!
    said.length = 0; seg.p!(); expect(said).toEqual(['edit concurrency.default'])
  })
  test('toggle writes the user file through the mod with a .bak and re-reads it', async () => {
    const { h, files } = await hostWith({ [HOME]: '{"review":{"maxRework":8}}' })
    expect((await configPress(h, 'set disable true')).text).toBe('disable = true · saved for you')
    expect(JSON.parse(files[HOME])).toEqual({ review: { maxRework: 8 }, disable: true }); expect(files[`${HOME}.bak`]).toBe('{"review":{"maxRework":8}}')
    expect(((await h.ui.read())['settings.rows'] as any[]).find(r => r.key === 'disable')).toMatchObject({ value: true, src: 'user' })
  })
  test('enum cycle', async () => {
    const { h, files } = await hostWith()
    const jail = rowsOf({ ...settingsScenario, ui: { 'settings.rows': (await h.ui.read())['settings.rows'] } }).find(r => r.key === 'jail')!
    await configPress(h, actOf(jail)); expect(JSON.parse(files[HOME]).jail).toBe('on')
    expect((await configPress(h, 'set jail sideways')).text).toContain('expected one of')
  })
  test('field edit: the value typed in the dialog is validated (refused: the decision is re-asked with the error), then saved', async () => {
    const { h, files } = await hostWith()
    await configPress(h, 'edit concurrency.default')
    let d = (await h.board.read()).decisions!.find(x => x.id === 'cfg:concurrency.default')!
    expect(d.fields).toEqual([{ key: 'value', label: 'concurrency.default', value: '3' }]); expect(d.options.map(o => o.key)).toEqual(['a', 'r', 'x'])
    const d0 = d; expect((await press(h, d.id, 'a', d.hash, 'lots')).text).toContain('refused: expected a number')
    d = (await h.board.read()).decisions!.find(x => x.id === 'cfg:concurrency.default')!; expect(d.error).toContain('expected a number'); expect(files[HOME]).toBeUndefined()
    expect((await press(h, d0.id, 'a', d0.hash, '7')).text).toContain('refused: it changed')   // the old hash: the dialog re-asks the fresh one
    d = (await h.board.read()).decisions!.find(x => x.id === 'cfg:concurrency.default')!
    expect((await press(h, d.id, 'a', d.hash, '7')).text).toBe('concurrency.default = 7 · saved for you')
    expect(JSON.parse(files[HOME]).concurrency.default).toBe(7); expect((await h.board.read()).decisions ?? []).toEqual([])
    expect(banned(d.title, d.lines, d.options.map(o => o.label))).toEqual([])
  })
  test('save to repo: O keys; S keys tighten-only against the user/default value (both directions); never U', async () => {
    const { h, files } = await hostWith()
    expect((await configPress(h, 'repo review.maxRework 8')).text).toBe('review.maxRework = 8 · saved to the repo'); expect(JSON.parse(files[REPO])).toEqual({ review: { maxRework: 8 } })
    expect((await configPress(h, 'repo drive.maxTurns 5')).text).toBe('refused: drive.maxTurns is a user-level key: save it for you, not in the repo file')
    expect((await configPress(h, 'repo jail on')).text).toBe('jail = "on" · saved to the repo')   // auto -> on: stricter
    expect((await configPress(h, 'repo effectCheck off')).text).toBe('refused: effectCheck: the repo file may only make it stricter than auto')
    expect((await configPress(h, 'repo strictness advisory')).text).toBe('refused: strictness: the repo file may only make it stricter than strict')
    expect((await configPress(h, 'repo review.tiers.light.files 9')).text).toBe('refused: review.tiers.light.files is not a setting')   // B9: the risk is the planner's call, no thresholds
    expect(JSON.parse(files[REPO])).toEqual({ review: { maxRework: 8 }, jail: 'on' }); expect(Object.keys(files)).toEqual([REPO, `${REPO}.bak`])   // never the user file
  })
  test('S tighten is judged against the user value: a user that relaxed strictness may get strict back from the repo; the card lists only stricter values', async () => {
    const { h, files } = await hostWith({ [HOME]: '{"strictness":"advisory","jail":"off"}' })
    expect((await configPress(h, 'repo strictness strict')).text).toBe('strictness = "strict" · saved to the repo')
    expect((await configPress(h, 'repo jail auto')).text).toBe('jail = "auto" · saved to the repo'); expect(JSON.parse(files[REPO])).toEqual({ strictness: 'strict', jail: 'auto' })
    await configPress(h, 'edit jail'); const d = ((await h.board.read()).decisions ?? []).find((x: any) => x.id === 'cfg:jail')!
    expect(d.lines.join('\n')).toContain('safety key: the repo file may only make it stricter than off (auto, on)'); expect(d.options.map((o: any) => o.label)).toEqual(['Save for me', 'Save to repo', 'Cancel'])
  })
  test('strictness change is refused while a task runs; other keys are not', async () => {
    const { h, files } = await hostWith()
    await h.board.update(b => ({ ...b, tasks: [task('a1', { state: 'active', step: 'worker' })] }))
    expect((await configPress(h, 'set strictness advisory')).text).toContain('cannot change while tasks are running'); expect(files[HOME]).toBeUndefined()
    expect((await configPress(h, 'set review.maxRework 9')).text).toContain('saved for you')
  })
  test('only a human press writes', async () => {
    const { h, files } = await hostWith()
    expect((await ROUTES.config(h, { schemaVersion: 1, cmd: 'config', args: ['set', 'review.maxRework', '9'], origin: { kind: 'composer' } })).text).toMatch(/^refused/); expect(files[HOME]).toBeUndefined()
  })
})
