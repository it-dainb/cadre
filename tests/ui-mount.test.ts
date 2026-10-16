import { expect, mock, test } from 'claude-code/testing'
const ENGINE = { timeoutMs: 30_000 }   // a fresh engine loads the whole hooks module per test: under the full suite's load that alone can pass 5 s (tests/register.test.ts)
import { BASE, MIN, approval, view } from './fixtures/ui/epic'

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
  test(`band + pane validate and draw on ${surface}; keys press; Raster only on terminal`, ENGINE, async ($, on) => {
    const opened: any[] = [], clock = mock.clock(on), asked: any[] = []
    stubs(on); on('tool.call', (_$, e) => { asked.push(e); return { result: { answers: { [e.questions[0].question]: 'Not now' } } } })
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
    on('ui.open', (_$, e) => { opened.push(e); return { value: { isPlaced: true } } })
    on('ui.panes', () => ({ value: [] }))
    seed(approval(62))
    const band = await $.ui.mount({ plugin: 'cadre', surface, component: 'AbovePrompt', props: BAND })
    expect((await band.find({ text: /NEEDS YOU/ }))?.text).toContain('approve plan p3')
    expect((await band.find({ text: /engine$/ }))?.text.endsWith('engine')).toBe(true)   // our rows wrap the engine's band
    expect((await band.findAll({ type: 'Button' })).map(b => b.key).sort()).toEqual(['att'])
    await band.press({ key: 'att' }); await clock.advance(1); await clock.advance(1)
    expect(asked.map(e => e.tool)).toEqual(['AskUserQuestion']); expect(opened).toEqual([])   // `1` = the decision's dialog, no pane
    await band.unmount()
    seed(view(62))
    const pane = await $.ui.mount({ plugin: 'cadre', surface, component: 'Pane', requestId: 'cadre', props: PANE })
    expect((await pane.find({ text: /Session refresh/ }))?.text).toContain('a2')
    expect((await pane.findAll({ type: 'Button' })).length).toBeGreaterThan(5)
    await pane.unmount()
    seed(view(62, { ui: { tab: 'timeline', t: BASE + 62 * MIN } }))   // the kit clock is 0: a replay cursor puts the lanes in range
    const tl = await $.ui.mount({ plugin: 'cadre', surface, component: 'Pane', requestId: 'cadre', props: PANE })
    expect((await tl.findAll({ type: 'Raster' })).length).toBe(surface === 'terminal' ? 1 : 0)
    await tl.unmount()
  })
}

// the dialog through the REAL register (Host.ask + Host.answer wiring, hooks, state): a plan asked by TaskCreate pops its dialog once; `1` in the pane re-opens it; Approve approves
test('dialog through the engine: pops once, `1` re-opens it, Approve approves the plan (register wires Host.answer)', ENGINE, async ($, on) => {
  const clock = mock.clock(on), asked: any[] = []; let say = 'Not now'
  stubs(on); on('tool.call', (_$, e, next) => { if (e.tool !== 'AskUserQuestion') return next(e); asked.push(e.questions[0]); return { result: { answers: { [e.questions[0].question]: say } } } })
  for (const k of Object.keys(store)) delete store[k]
  Object.assign(store, { secret: { active: true } })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] })); on('ui.open', () => ({ value: { isPlaced: true } })); on('ui.panes', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined })); on('ui.status', () => ({ value: undefined })); on('ui.notify', () => ({ value: { isSent: false } })); on('ui.log', () => ({ value: undefined })); on('ui.invalidate', () => ({ value: undefined }))
  on('env.get', (_$, e) => ({ value: e.name === 'CADRE_STORE' ? 'memory' : undefined })); on('session.cwd', () => ({ value: '/work' })); on('session.root', () => ({ value: '/work' })); on('store.get', () => ({ value: undefined })); on('store.set', () => ({ value: undefined }))
  on('fs.read', () => ({ value: '{}' })); on('fs.stat', () => ({ value: undefined })); on('prompt.read', () => ({ value: { text: '' } })); on('tool.check', () => ({ decision: 'allow' }))
  const meta = { type: 'feature', package: '.', scenarios: ['S1: Given a user When they log in Then a session exists'], changelog: { category: 'Added', entry: 'Login' }, interface: { symbols: [{ name: 'login', kind: 'function', params: ['email: string'], returns: 'Session', status: 'new' }] } }
  await $.tool.call({ tool: 'mcp__cadre__plan', title: 'Auth login', description: 'goal' }); await $.tool.call({ tool: 'mcp__cadre__task', title: 'Add login', description: 'impl', ...meta })
  expect(store.board.decisions.map((d: any) => d.kind)).toEqual(['plan']); expect(store.board.plan.state).toBe('draft')
  await clock.advance(1); await clock.advance(1)   // the event's autoAsk: the dialog once, answered "Not now"
  expect(asked.length).toBe(1); expect(asked[0].options.map((o: any) => o.label)).toEqual(['Approve', 'Reject', 'Lane → ask']); expect(store.board.plan.state).toBe('draft')
  const pane = await $.ui.mount({ plugin: 'cadre', surface: 'terminal', component: 'Pane', requestId: 'cadre', props: PANE })
  say = 'Approve'; await pane.press({ key: 'att' }); await clock.advance(1); await clock.advance(1)
  expect(asked.length).toBe(2); expect(store.board.plan.state).toBe('approved'); expect(store.board.decisions).toEqual([])
  await pane.unmount()
})
