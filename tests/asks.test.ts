import { describe, expect, test } from 'claude-code/testing'
import { admitWith } from '../core/admission'
import { observeWith } from '../core/close'
import { drain, submit } from '../core/reuse'
import { wrap } from '../core/effect'
import { handleWith } from '../tools/index'
import { guard } from '../policy/guards'
import { answer } from '../native/tasks'
import { NUDGE, askOf } from '../core/asks'
import { defaults } from '../config/index'
import { MemoryStore } from '../task-management/adapters/memory/store'
import { fakeHost } from './support'
import { banned } from './fixtures/wording'

// One output contract for every agent (ADR 0010): a marker-less explorer is tracked from admission, nudged, auto-reported, and main only ever sees its card.
const PROSE = `I looked around the repository. ${'The parser lives in src/parse.ts and it is long. '.repeat(60)}`
async function mk() {
  const h = fakeHost() as any, store = new MemoryStore(() => 1000), sent: [string, string][] = [], submitted: string[] = []
  await store.init({ types: defaults().types as any, journal: false })
  const cfg = defaults(), d = { store, cfg, reg: cfg.types as any, root: '/repo', home: '/hm/u', wtRoot: '/wt', key: 'k', actor: 'cadre/u/aaaaaa', session: 's1' }
  Object.assign(h, { taskStore: async () => store, config: async () => cfg, sendTo: async (id: string, text: string) => { sent.push([id, text]); return { isDelivered: true } }, submit: async (t: string) => { submitted.push(t) }, usage: async () => ({}) })
  await h.secret.update((s: any) => ({ ...s, session: 'S1' }))
  await admitWith(h, d as any, { prompt: 'where is the parser?', tool_use_id: 'tu1' }, async () => ({ agentId: 'agent-x1y2z3', model: 'haiku' }))
  const stop = (answerText = PROSE) => drain(h, { agentId: 'agent-x1y2z3', reason: 'answer', answer: answerText }, (e: any) => observeWith(h, d as any, e, () => ({})))   // #1 drain wraps #2 observe, as registered
  const fg = (text = PROSE) => wrap(h, { tool: 'Agent', prompt: 'where is the parser?', tool_use_id: 'tu1' }, async () => ({ result: { content: [{ type: 'text', text }] } }))
  const note = () => submit(h, { text: `<task-notification>\n<task-id>agent-x1y2z3</task-id>\n<tool-use-id>tu1</tool-use-id>\n<result>${PROSE}</result>`, origin: { kind: 'task-notification' } }, (e: any) => e)
  return { h, d, sent, submitted, stop, fg, note }
}

describe('one output contract: a marker-less explorer (ask)', () => {
  test('tracked at admission; a stop without report is nudged twice through the queued resume (with the example), then auto-reported', async () => {
    const { h, sent, stop } = await mk()
    expect(await askOf(h, 'agent-x1y2z3')).toMatchObject({ id: 'ask-x1y2z3', q: 'where is the parser?', k: 0 })
    await stop(); await stop()
    expect(sent).toEqual([['agent-x1y2z3', NUDGE], ['agent-x1y2z3', NUDGE]]); expect(NUDGE).toContain('"role":"explorer","answer"')
    await stop(); expect(sent).toHaveLength(2)
    const a = (await askOf(h, 'agent-x1y2z3'))!; expect(a.auto).toBe(true); expect(a.answer!.length).toBeLessThanOrEqual(2000); expect(a.answer).toStartWith('I looked around')
  })
  test('the foreground Agent result is the card, never the prose; the answer comes once when the agent finally reports; a later notification says it was given', async () => {
    const { h, sent, submitted, stop, fg, note } = await mk()
    const r1: any = await fg(); const t1 = r1.result.content[0].text
    expect(t1).toBe('EXPLORER ask-x1y2z3 "where is the parser?" · explorer → finishing its answer · flags: none · next: wait; the answer arrives on its own. Do not ask again.')
    await stop(); expect(sent).toHaveLength(1)   // nudged
    expect(await handleWith(h, (await mk()).d as any, { tool: 'mcp__cadre__report', agentId: 'agent-x1y2z3', input: { schemaVersion: 1, role: 'explorer' } }).then((r: any) => r.result)).toContain('error: answer: required')   // the report tool stays the gate
    expect(await handleWith(h, {} as any, { tool: 'mcp__cadre__report', agentId: 'agent-x1y2z3', input: { schemaVersion: 1, role: 'explorer', answer: 'src/parse.ts:12 parse()', citations: [{ path: 'src/parse.ts', line: 12 }] } }).then((r: any) => r.result)).toBe('answer recorded. Stop.')
    await stop(); expect(submitted).toEqual(['Result of ask-x1y2z3: EXPLORER ask-x1y2z3 "where is the parser?" · explorer → answered (1 citations) · flags: none · answer: src/parse.ts:12 parse() · next: full answer: TaskGet ask-x1y2z3'])
    await stop(); expect(submitted).toHaveLength(1)   // once
    expect((await note()).text).toBe('Agent ask-x1y2z3 finished; its answer was already given (TaskGet ask-x1y2z3).')
  })
  test('auto mode hand-back: never refused, before or after the report, and it carries no agent prose for main (live 0.12.0, 0.12.1: agents could not end)', async () => {
    const { h } = await mk(), hb = (agentId: string) => guard(h, { tool: 'SubagentHandback', agentId, input: { message: PROSE } }, async (e: any) => e) as Promise<any>
    for (const a of ['agent-x1y2z3', 'agent-q9']) { const r = await hb(a); expect(r.deny).toBeUndefined(); expect(r.tool).toBe('SubagentHandback'); expect(r.input.message).not.toContain('parser') }
    expect(await handleWith(h, {} as any, { tool: 'mcp__cadre__report', agentId: 'agent-x1y2z3', input: { schemaVersion: 1, role: 'explorer' } }).then((r: any) => r.result)).toContain('error: answer: required')   // refused
    expect((await hb('agent-x1y2z3')).deny).toBeUndefined()
  })
  test('background: the task-notification becomes the card (auto-reported answer, one line <= 200), main reads no agent prose; TaskGet has the full answer', async () => {
    const { h, stop, note } = await mk()
    await stop(); await stop(); await stop()
    const t = (await note()).text as string
    expect(t).toStartWith('Result of ask-x1y2z3: EXPLORER ask-x1y2z3'); expect(t).toContain('flags: auto-reported'); expect(t).not.toContain('<result>')
    expect(t.length).toBeLessThan(420); expect(t).not.toContain(PROSE.slice(0, 300)); expect(banned(t)).toEqual([])
    const g: any = await answer(h, { tool: 'TaskGet', taskId: 'ask-x1y2z3' }, () => ({}))
    expect(g.result.task).toMatchObject({ id: 'ask-x1y2z3', status: 'completed' }); expect(g.result.task.description).toContain('auto-reported')
  })
  test('an ask reporting as another role is refused with the right example; a bound agent is untouched by the ask path', async () => {
    const { h } = await mk()
    expect(await handleWith(h, {} as any, { tool: 'mcp__cadre__report', agentId: 'agent-x1y2z3', input: { schemaVersion: 1, role: 'worker', outcome: 'done', summary: 's' } }).then((r: any) => r.result)).toContain('role "explorer"')
    expect(await askOf(h, 'someone-else')).toBeUndefined()
  })
})
