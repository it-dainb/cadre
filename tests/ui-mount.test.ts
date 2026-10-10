import { expect, mock, test } from 'claude-code/testing'
import { approval, view } from './fixtures/ui/epic'

const BAND = { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 115, scroll: { offset: 0, bodyRows: 8 }, view: {} }
const PANE = { title: 'cadre', isFocused: true, bodyColumns: 118, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }
const store: Record<string, any> = {}
let ver = 1
const seed = (v) => Object.assign(store, { board: v.b, events: { seq: v.ring.length, epics: { p3: v.ring } }, secret: { ...v.sec, active: true }, ui: v.ui })
// $.state is answered by the kit; a state.get/state.set stub beneath the mod lets the test own the atoms
const stubs = (on) => {
  on('state.get', (_$, e) => ({ value: { value: store[e.key], version: ver } }))
  on('state.set', (_$, e) => { store[e.key] = e.value; return { value: { isSet: true, version: ++ver } } })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`band + pane validate and draw on ${surface}; keys press; Raster only on terminal`, async ($, on) => {
    const opened: any[] = [], clock = mock.clock(on)
    stubs(on)
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
    on('ui.open', (_$, e) => { opened.push(e); return { value: { isPlaced: true } } })
    on('ui.panes', () => ({ value: [] }))
    seed(approval(62, 'ab12cd34'))
    const band = await $.ui.mount({ plugin: 'cadre', surface, component: 'AbovePrompt', props: BAND })
    expect((await band.find({ text: /NEEDS YOU/ }))?.text).toContain('approve plan p3')
    expect((await band.find({ text: /engine$/ }))?.text.endsWith('engine')).toBe(true)   // our rows wrap the engine's band
    expect((await band.findAll({ type: 'Button' })).map(b => b.key).sort()).toEqual(['att', 'dag'])
    await band.press({ key: 'att' }); await clock.advance(1)
    expect(opened.map(o => o.id)).toEqual(['cadre'])
    await band.unmount()
    seed(view(62))
    const pane = await $.ui.mount({ plugin: 'cadre', surface, component: 'Pane', requestId: 'cadre', props: PANE })
    expect((await pane.findAll({ type: 'Raster' })).length).toBe(surface === 'terminal' ? 1 : 0)
    expect((await pane.find({ text: /SELECTED/ }))?.text).toContain('a2')
    expect((await pane.findAll({ type: 'Button' })).length).toBeGreaterThan(10)
    await pane.unmount()
  })
}
