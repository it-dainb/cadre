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
    expect(by['maxParallel'].src).toBe('default')
    expect([all['maxParallel'].src, all['review.maxRework'].src, all['strictness'].src, all['jail'].src, all['store.kind'].src, all['drive.maxTurns'].src, all['models.fast'].src]).toEqual(['user', 'repo', 'repo', 'repo', 'env', 'user', 'default'])
    expect([all['strictness'].cls, all['drive.maxTurns'].cls, all['store.kind'].cls, all['review.maxRework'].cls]).toEqual(['S', 'U', 'U', 'O'])
    expect(all['strictness'].value).toBe('strict')   // the repo file tightened the advisory from the user file
  })
  for (const w of [60, 120]) test(`golden lines at ${w}`, () => {
    const t = frame(w).join('\n'), s = frame(w, rowsOf(settingsScenario).findIndex(r => r.key === 'strictness')).join('\n')
    expect(frame(w, rowsOf(settingsScenario).findIndex(r => r.key === 'changelog.path')).join('\n')).toContain('changelog.path docs/CHANGES.md repo')
    expect(t).toContain('maxParallel 5 user')
    expect(t).toContain('roles.worker.tier deep user')
    expect(frame(w, rowsOf(settingsScenario).findIndex(r => r.key === 'maxParallel')).join('\n')).toContain('e: change')
    expect(s).toMatch(/strictness strict repo/)
    expect(s).toContain('default strict · tighten-only from repo · strict: guards')
    expect(frame(w).join('\n')).toContain('9: Settings')
  })
})

describe('buttons', () => {
  test('a toggle / cycle / edit button runs the matching config line', () => {
    const all = Object.fromEntries(rowsOf(settingsScenario).map(r => [r.key, r]))
    expect([actOf(all['disable']), actOf(all['jail']), actOf(all['strictness']), actOf(all['review.maxRework'])]).toEqual(['set disable true', 'set jail off', 'set strictness advisory', 'edit review.maxRework'])
    const ssel = rowsOf(settingsScenario).findIndex(r => r.key === 'maxParallel'), p = pane({ ...settingsScenario, ui: { ...settingsScenario.ui, tab: 'settings', ssel } }, 120, 60, A)
    const seg = [...p.before, ...p.after].flat().find(s => s.hk === 'e')!
    said.length = 0; seg.p!(); expect(said).toEqual(['edit maxParallel'])
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
    await configPress(h, 'edit maxParallel')
    let d = (await h.board.read()).decisions!.find(x => x.id === 'cfg:maxParallel')!
    expect(d.fields).toEqual([{ key: 'value', label: 'maxParallel', value: '3' }]); expect(d.options.map(o => o.key)).toEqual(['a', 'r', 'x'])
    const d0 = d; expect((await press(h, d.id, 'a', d.hash, 'lots')).text).toContain('refused: expected a number')
    d = (await h.board.read()).decisions!.find(x => x.id === 'cfg:maxParallel')!; expect(d.error).toContain('expected a number'); expect(files[HOME]).toBeUndefined()
    expect((await press(h, d0.id, 'a', d0.hash, '7')).text).toContain('refused: it changed')   // the old hash: the dialog re-asks the fresh one
    d = (await h.board.read()).decisions!.find(x => x.id === 'cfg:maxParallel')!
    expect((await press(h, d.id, 'a', d.hash, '7')).text).toBe('maxParallel = 7 · saved for you')
    expect(JSON.parse(files[HOME]).maxParallel).toBe(7); expect((await h.board.read()).decisions ?? []).toEqual([])
    expect(banned(d.title, d.lines, d.options.map(o => o.label))).toEqual([])
  })
  test('save to repo: O keys only, never S or U', async () => {
    const { h, files } = await hostWith()
    expect((await configPress(h, 'repo review.maxRework 8')).text).toBe('review.maxRework = 8 · saved to the repo'); expect(JSON.parse(files[REPO])).toEqual({ review: { maxRework: 8 } })
    for (const k of ['strictness strict', 'jail on', 'drive.maxTurns 5']) expect((await configPress(h, `repo ${k}`)).text).toMatch(/refused: .* key: save it for you, not in the repo file/)
    expect(Object.keys(files)).toEqual([REPO])
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
