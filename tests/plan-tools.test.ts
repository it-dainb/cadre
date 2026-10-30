// The epic planner (ADR 0021): in a milestone, each ready epic's task plan comes from a planner agent the spawner starts (never main). Its report is checked like
// main's drafts (fields, duplicates, the missing list with the path overlap), approved automatically and recorded; a refused plan goes back to the same planner,
// planner.maxRounds refusals stop the epic; milestone.epicPlanner 'main' keeps main planning.
import { describe, expect, test } from 'claude-code/testing'
import { runOf } from '../core/lifecycle'
import { decide } from '../commands/cadre'
import { defaults } from '../config/index'
import { admitWith, type Deps } from '../core/admission'
import { modelView } from '../core/board'
import { RUNS, nextAction, spawnable } from '../core/render'
import { spawnStep } from '../core/spawner'
import { kick } from '../core/drive'
import { stopped } from '../core/close'
import { handleWith } from '../tools/index'
import { FULL, world } from './fixtures/native/world'
import { setProfile } from '../core/pipeline'
import { BUILTIN } from '../core/profile'
import { profile as DEFAULT } from '../profiles/default'
import { planRules } from '../core/plantools'
import { validateFields, scenarioIds, liteFields, taskFields } from '../core/validate'
import { PROMPTS } from '../agents/prompts'
import { fieldsOf } from '../core/plantools'

const MSP = { kind: 'plan', lane: 'milestone', reason: 'two features: export and import' }
const task = (subject: string, path: string, o: Record<string, unknown> = {}) => ({ subject, description: `implement ${subject}`, metadata: { ...FULL, paths: [path] }, ...o })

// an approved milestone of two independent epics, drive armed in mod mode; spawnAgent runs admission as the spawner's own call
async function ms(o: { planner?: 'agent' | 'main'; maxRounds?: number } = {}) {
  const cfg = defaults(); if (o.planner === 'main') cfg.milestone.epicPlanner = 'main'
  if (o.maxRounds) cfg.planner.maxRounds = 2
  const w = await world({ config: cfg }), submitted: string[] = [], spawned: any[] = []
  Object.assign(w.h, { submit: async (t: string) => { submitted.push(t) }, usage: async () => ({ cost: { usd: 1 } }) })
  const d: Deps = { store: w.store, cfg, root: '/repo', home: '/hm/u', wtRoot: '/wt', key: 'repo-1', actor: 'cadre/u/a', session: 's-1' }
  let k = 0
  const engine = Object.assign(async (e: any) => (spawned.push(e), { agentId: `ag${++k}`, model: 'claude-sonnet-x' }), { origin: { plugin: 'cadre' } })
  const main = Object.assign(async (e: any) => (spawned.push(e), { agentId: `ag${++k}` }), { origin: { plugin: 'engine' } })
  Object.assign(w.h, { spawnAgent: (a: any) => admitWith(w.h, d, a, engine) })
  const m = (await w.call('TaskCreate', { subject: 'Data files', description: 'export and import', metadata: MSP })).result.task.id as string
  const es: string[] = []
  for (const [i, f] of ['export', 'import'].entries()) es.push((await w.call('TaskCreate', { subject: `Add ${f}`, description: `users can ${f} a data file`, metadata: { size: 2, paths: [`src/${f}/`] } })).result.task.id)
  await w.h.ui.update(u => ({ ...u, asks: { ag0: { id: 'ask-ag0', q: 'critique', k: 0, answer: 'fine' } } })); await w.call('TaskUpdate', { taskId: m, metadata: { critique: 'no gaps' } })
  const dc = (await w.h.board.read()).decisions!.find(x => x.kind === 'plan')!; await decide(w.h, dc.id, 'a', dc.hash)
  const rep = (agentId: string, body: Record<string, unknown>) => handleWith(w.h, d, { tool: 'mcp__cadre__report', agentId, input: { schemaVersion: 1, role: 'planner', summary: 'plan', ...body } }).then(r => r.result)
  const turn = () => spawnStep(w.h, 'turn.complete'), board = () => w.h.board.read()
  const records = async () => (await w.store.list({})).filter(x => x.type === 'decision').map(x => x.title)
  return { ...w, d, m, es, rep, turn, board, records, submitted, spawned, mainSpawn: (e: any) => admitWith(w.h, d, e, main) }
}
const ev = async (w: { h: any }) => Object.values((await w.h.events.read()).epics).flat() as any[]

describe('the planner is started by the spawner; main is not asked to plan', () => {
  test('approval: main hears the epics plan themselves; its line names no epic; the spawner starts one planner per ready epic, routed by roles.planner', async () => {
    const w = await ms(), [a, b] = w.es
    let s = await w.board(); expect(s.drive.planner).toBe('agent'); expect(s.plan!.epics!.map(e => e.state)).toEqual(['ready', 'ready'])
    expect(String((await w.h.ui.read()).goal)).toContain("Each epic's tasks are planned, started, reviewed and land by themselves")
    expect(nextAction(modelView(s), [], true)).toBe(RUNS)
    expect((await w.call('TaskCreate', { subject: 'X', description: 'd', metadata: { ...FULL, epic: a } })).deny).toContain(`epic ${a}'s tasks are planned for you`)
    await w.turn()
    expect(w.spawned.map(e => [e.subagentType, e.model, e.cwd])).toEqual([['cadre:planner', 'sonnet', '/repo'], ['cadre:planner', 'sonnet', '/repo']])
    const br = w.spawned[0].prompt as string
    expect(br.startsWith('# PLAN\n')).toBe(true); expect(br).toContain('# Roadmap of milestone'); expect(br).toContain(`# PLAN-${a} Add export`); expect(br).toContain('Goal: users can export a data file'); expect(br).toContain('files src/export/')
    expect(w.spawned[1].prompt.split('# PLAN-')[0]).toBe(br.split('# PLAN-')[0])   // the roadmap block is the same bytes for every planner of the milestone
    const bind = await w.h.bind.read(); expect(Object.values(bind).map(x => [x.taskId, x.role, x.effort])).toEqual([[a, 'planner', 'high'], [b, 'planner', 'high']])
    expect((await ev(w)).filter(e => e.type === 'agent.bound').map(e => [e.data.role, e.data.setting])).toEqual([['planner', 'roles.planner'], ['planner', 'roles.planner']])
    await w.turn(); expect(w.spawned.length).toBe(2)   // bound: never started twice
    expect(w.submitted).toEqual([])   // main took no turn
    expect((await w.mainSpawn({ prompt: `PLAN-${a}` })).agentId).toBeTruthy(); expect(w.spawned[2].subagentType).toBe('cadre:explorer')   // from main it is a plain question
    s = await w.board(); expect(spawnable(modelView(s), await w.h.bind.read())).toEqual([])
  })
})

describe("the planner's report: main's draft checks, rounds, auto-approval", () => {
  test('a refused plan goes back to the same planner with what is missing; a good one is approved, recorded and its tasks start', async () => {
    const w = await ms(), [a] = w.es; await w.turn()
    let r = await w.rep('ag1', { tasks: [{ subject: 'Writer', description: 'd', metadata: { type: 'feature', paths: ['src/export/w.ts'] } }] })
    expect(r).toContain('error: incomplete, missing: task 1: acceptance, changelog, contract'); expect(r).toContain('(round 1/3)')
    expect(await w.store.list({ parent: a })).toEqual([])   // the refused round left no drafts
    r = await w.rep('ag1', { tasks: [{ subject: 'Writer', description: 'd', metadata: { type: 'feature', paths: ['src/export/w.ts'] } }] }); expect(r).toContain('(round 2/3)')   // B10: two tasks of one title are no refusal
    expect(await w.rep('ag1', { role: 'worker', outcome: 'done', summary: 's' })).toContain('you are the planner')
    r = await w.rep('ag1', { tasks: [task('Writer', 'src/export/w.ts'), task('Command', 'src/export/w.ts', { after: [1] })] }); expect(r).toBe('plan accepted: 2 tasks approved; they start by themselves. Stop.')
    const s = await w.board(), ts = s.tasks.filter(t => t.epic === a)
    expect(s.plan!.epics![0].state).toBe('running'); expect(ts.map(t => [t.title, t.state])).toEqual([['Writer', 'todo'], ['Command', 'todo']]); expect(ts[1].deps.map(x => x.id)).toEqual([ts[0].id])
    expect(await w.records()).toContain(`auto: plan ${a} approved automatically for milestone ${w.m} · drafted by the planner`)
    expect((await ev(w)).some(e => e.type === 'drive.decided' && e.data.kind === 'plan' && /drafted by the planner/.test(e.data.text))).toBe(true)
    expect((await w.h.bind.read()).ag1).toBeDefined(); expect((await runOf(w.h, 'ag1'))?.state).toEqual({ state: 'idle-bound' })   // bound until its turn ends: its last requests keep the routed effort
    await stopped(w.h, w.d, { agentId: 'ag1', reason: 'answer' }); expect((await w.h.bind.read()).ag1).toBeUndefined(); expect((await w.store.get(a)).meta['cadre.planRounds']).toBe('2')   // its turn end is no extra round
    expect(w.submitted).toEqual([])
    expect(spawnable(modelView(s), await w.h.bind.read()).filter(x => x.role === 'claim').map(x => x.id)).toEqual([ts[0].id])
  })
  test('a planner\'s task whose holds names a scenario it does not have is refused with the round', async () => {
    const w = await ms(), [a] = w.es; await w.turn()
    const r = await w.rep('ag1', { tasks: [task('Writer', 'src/export/w.ts', { metadata: { ...FULL, paths: ['src/export/w.ts'], holds: ['S9'] } })] })
    expect(r).toContain('task 1: metadata.holds: S9 is not a scenario of this task'); expect(await w.store.list({ parent: a })).toEqual([])
  })
  test('the path overlap of main\'s missing list: two tasks on one file need an order', async () => {
    const w = await ms(), [, b] = w.es; await w.turn()
    expect(await w.rep('ag2', { tasks: [task('Reader', 'src/import/r.ts'), task('Command', 'src/import/r.ts')] })).toContain('task 1+task 2 both change src/import/r.ts')
    expect((await w.board()).plan!.epics![1].state).toBe('ready'); expect(await w.store.list({ parent: b })).toEqual([])
  })
  test('settings: cfg.planner.maxRounds = 2: the second refusal stops the epic (auto asks the human, Retry plans it again); a planner that stops without a plan counts a round', async () => {
    const w = await ms({ maxRounds: 2 }), [a, b] = w.es; await w.turn()
    expect(await w.rep('ag1', { tasks: [] })).toContain('(round 1/2)')
    expect(await w.rep('ag1', { tasks: [] })).toBe('the plan was refused too often; the user takes over. Stop.')
    let s = await w.board(); expect(s.plan!.epics!.map(e => e.state)).toEqual(['stopped', 'ready'])
    const dc = s.decisions!.find(x => x.id === `flag:${a}:stopped`)!; expect(dc.lines.join('\n')).toContain('its task plan was refused 2 times')
    await stopped(w.h, w.d, { agentId: 'ag1', reason: 'answer' }); expect((await w.h.bind.read()).ag1).toBeUndefined(); expect((await w.store.get(a)).meta['cadre.planRounds']).toBe('2')
    await w.h.board.update(x => ({ ...x, drive: { ...x.drive, paused: 'x' } })); await kick(w.h); expect((await w.board()).drive.paused).toContain(`epic ${a} stopped`)
    await decide(w.h, dc.id, 'r', dc.hash); s = await w.board(); expect(s.plan!.epics![0].state).toBe('ready'); expect((await w.store.get(a)).meta['cadre.planRounds']).toBe('')
    await w.turn(); expect(w.spawned.filter(e => e.subagentType === 'cadre:planner').length).toBe(3)   // a fresh planner for the retried epic
    await stopped(w.h, w.d, { agentId: 'ag2', reason: 'answer' }); expect((await w.h.bind.read()).ag2).toBeUndefined(); expect((await w.store.get(b)).meta['cadre.planRounds']).toBe('1')
  })
})

describe('milestone.epicPlanner main', () => {
  test("cfg.milestone.epicPlanner = 'main': no planner starts; main's line names the epic to plan, as before", async () => {
    const w = await ms({ planner: 'main' }), s = await w.board()
    expect(s.drive.planner).toBeUndefined(); expect(nextAction(modelView(s), [], true)).toContain(`plan epic ${w.es[0]}`)
    await w.turn(); expect(w.spawned).toEqual([])
  })
})

// S7 (B15, theme 6): the planner's vocabulary is the profile's data
const DOCS = { ...DEFAULT, ...BUILTIN.docs } as typeof DEFAULT
describe('plan tools take acceptance [{id,text}] and the type list of the profile (B15)', () => {
  test('items without an id (or with an id that cannot lead a line) are refused; any other id string is fine, and no sentence form is checked', () => {
    for (const bad of [[{ text: 'x' }], [{ id: '', text: 'x' }], [{ id: 'A 1', text: 'x' }], [{ id: 'A:1', text: 'x' }], [{ id: 'A1' }], [{ id: 'A1', text: 'x\ny' }], [{ id: 'A1', text: 'x' }, { id: 'A1', text: 'y' }], 'A1: x', []])
      expect(validateFields({ acceptance: bad })).toContain('metadata.acceptance')
    expect(validateFields({ acceptance: [{ id: 'login-ok', text: 'a user can log in' }, { id: '7', text: 'whatever form' }] })).toBeNull()
    const f = fieldsOf({ acceptance: [{ id: 'login-ok', text: 'a user can log in' }, { id: '7', text: 'whatever form' }] }); expect(f.patch.acceptance).toBe('login-ok: a user can log in\n7: whatever form')
    expect(scenarioIds(f.patch.acceptance)).toEqual(['login-ok', '7'])
  })
  test('the type list in the refusal and in the plan rules is Object.keys(profile.types): the docs profile lists doc, and no bug', () => {
    try {
      setProfile(DOCS)
      const e = validateFields({ type: 'bug' })!; expect(e).toContain(`one of ${Object.keys(DOCS.types).join('|')}`); expect(e).toContain('doc')
      expect(planRules()).toContain('doc write>review>land'); expect(planRules()).not.toContain('bug'); expect(planRules()).toContain('Acceptance: doc: what the reader must be able to do')
    } finally { setProfile(DEFAULT) }
    expect(validateFields({ type: 'doc' })).toContain(`one of ${Object.keys(DEFAULT.types).join('|')}`); expect(planRules()).toContain('bug tester>red>worker')
  })
  test('S8: the task-fields line, the planner brief and the lite lane line come from profile.fields: the docs profile is told no changelog and no holds', () => {
    const line = () => planRules().split('\n').find(l => l.startsWith('- Task fields:'))!
    expect(line()).toContain('changelog {"category"'); expect(line()).toContain('holds? acceptance ids already true, e.g. ["A2"]'); expect(line()).toContain('breaking?'); expect(liteFields()).toContain(' and changelog ({"category"')
    expect(planRules()).not.toContain('- holds')
    try {
      setProfile(DOCS)
      expect(line()).not.toContain('changelog'); expect(line()).not.toContain('holds'); expect(line()).toContain('acceptance [{"id","text"}]'); expect(line()).toContain('contract {"items"'); expect(liteFields()).toBe('')
      expect(taskFields()).toBe(line().slice('- Task fields: '.length, -1))
    } finally { setProfile(DEFAULT) }
  })
  test('S8: the planner prompt names risk and leaves the field list to its brief', () => {
    expect(PROMPTS.planner).toContain('risk: light, standard, thorough or core'); expect(PROMPTS.planner).toContain('Task fields'); expect(PROMPTS.planner).not.toContain('changelog'); expect(PROMPTS.planner).not.toContain('holds')
  })
  test('the profile\'s fields are the allowed names: the docs profile declares none, so a changelog is an unknown field there', () => {
    expect(validateFields({ changelog: { none: true, reason: 'x' } })).toBeNull(); expect(validateFields({ holds: 'S1' })).toContain('metadata.holds')
    try { setProfile(DOCS); expect(validateFields({ changelog: { none: true, reason: 'x' } })).toContain('unknown field'); expect(validateFields({ lane: 'lite', reason: 'x', kind: 'plan' })).toBeNull() } finally { setProfile(DEFAULT) }
  })
})
