// Harness-only scripted model (S0): answers every model request at turn.step (TM-04) from the fixtures below, never calling next, so no request
// reaches the API (PROXY=1's effort.jsonl stays empty). Each answer is a function of the loop's own transcript ($.session.messages), never of a
// counter: a resumed or nudged agent gets the answer its transcript calls for. Loaded with a second --plugin-dir AFTER cadre's, so it sits inner to
// cadre in the user tier (load order): cadre's turn.step sees each scripted response come up from beneath (its cost ledger records `model: scripted`).
// Every line it logs starts with SCRIPTED (debug log). `/s0 <end|hb|wedge>` is the forced-exit / TaskStop probe (RESULTS.md (c), (d)).
import type { Register } from 'claude-code'

type Row = { role: 'user' | 'assistant'; text: string; toolUses?: { tool: string; input?: any }[]; toolResults?: { text?: string; isError?: boolean }[] }
type Act = { text?: string; tool?: string; input?: unknown }
const U = { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'scripted' }   // tokensOf = 7 + 5*3 = 22 per step
const L = ($: any, t: string) => $.ui.log(`SCRIPTED ${t}`)
const id = () => `toolu_s0${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
const isText = (r: Row) => r.role === 'user' && !r.toolResults?.length && !!r.text
const since = (rows: Row[]) => { let i = rows.length - 1; while (i > 0 && !isText(rows[i])) i--; return rows.slice(i) }   // from the last prompt/brief/nudge on
const done = (rows: Row[]) => rows.filter(r => r.role === 'assistant').length
const END = 'Done. Stopping here.'

// ---- fixtures: titleCase(s) on the `single` repo, lite lane ----
const GOAL = /Goal from the user/
function main(rows: Row[]): Act {
  const g = rows.map(r => isText(r) && GOAL.test(r.text)).lastIndexOf(true)
  if (g < 0) return { text: 'OK.' }
  const after = rows.slice(g + 1), calls = after.flatMap(r => (r.role === 'assistant' ? r.toolUses ?? [] : []))
  const has = (f: (c: { tool: string; input?: any }) => boolean) => calls.some(f)
  const kind = (k: string) => has(c => c.tool === 'TaskCreate' && c.input?.metadata?.kind === k)
  const ai = after.findIndex(r => r.role === 'assistant' && r.toolUses?.some(c => c.tool === 'Agent'))
  const answered = ai >= 0 && after.slice(ai + 1).some(r => isText(r) || r.toolResults?.some(t => t.text && !/launched/i.test(t.text)))
  if (after.filter(r => r.role === 'assistant').length > 8) return { text: 'Stopping: approve the plan in the dialog.' }
  if (ai < 0) return { tool: 'Agent', input: { description: 'Explore the library', subagent_type: 'Explore', prompt: 'What in the project does adding titleCase(s) touch: where string helpers live, how they are exported, where the tests are?' } }
  if (!answered) return { text: 'Waiting for the explorer.' }
  if (!kind('clarity')) return { tool: 'TaskCreate', input: { subject: 'clarity', description: 'Clarity of the goal after exploring.', metadata: { kind: 'clarity', outcome: 1, scope: 1, acceptance: 1, constraints: 1 } } }
  if (!kind('plan')) {
    const mission = /There is no mission yet/.test(rows[g].text) ? { mission: 'Goal: add titleCase(s) to the library\nConstraints: none\nNon-goals: none' } : {}
    return { tool: 'TaskCreate', input: { subject: 'Add titleCase(s) with tests', description: 'Add titleCase(s) as a named export in src/titleCase.mjs, in the style of src/slug.mjs, with node:test tests in test/titleCase.test.mjs.',
      metadata: { kind: 'plan', lane: 'lite', reason: 'one small function and its test', type: 'feature', changelog: { category: 'Added', entry: 'titleCase(s) capitalises the first letter of each word' }, ...mission } } }
  }
  return { text: 'The plan is drafted: approve it in the dialog (key 1 opens it).' }
}
const FILES = String.raw`mkdir -p src test && cat > src/titleCase.mjs <<'EOF'
export const titleCase = s => s.replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase())
EOF
cat > test/titleCase.test.mjs <<'EOF'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { titleCase } from '../src/titleCase.mjs'
test('titleCase capitalises each word', () => assert.equal(titleCase('hello big world'), 'Hello Big World'))
EOF`
const taskOf = (brief: string) => brief.match(/\b(p-[a-z0-9]+\.\d+)\b/)?.[1]
const ROLES: Record<string, (k: number, brief: string) => Act> = {
  worker: (k, b) => [{ tool: 'Bash', input: { command: FILES, description: 'Write titleCase and its test' } }, { tool: 'mcp__cadre__run_check', input: { name: 'test', task: taskOf(b) } },
    { tool: 'mcp__cadre__report', input: { schemaVersion: 1, role: 'worker', outcome: 'done', summary: 'Added titleCase(s) in src/titleCase.mjs with a node:test test; npm test passes.', risks: [] } }][k] ?? { text: END },
  reviewer: (k, b) => [{ tool: 'mcp__cadre__run_check', input: { name: 'test', task: taskOf(b) } },
    { tool: 'mcp__cadre__report', input: { schemaVersion: 1, role: 'reviewer', verdict: 'pass', summary: 'The commit adds titleCase and its test only; npm test passes.', findings: [], coverage: [], contractStatus: [] } }][k] ?? { text: END },
  explorer: k => [{ tool: 'mcp__cadre__report', input: { schemaVersion: 1, role: 'explorer', answer: 'One string helper, slug, in src/slug.mjs as a named ESM export; tests in test/ use node:test; npm test runs node --test.', citations: [{ path: 'src/slug.mjs', line: 1 }, { path: 'package.json', line: 1 }] } }][k] ?? { text: END },
}
function agent(rows: Row[]): [string, Act] {
  const brief = rows.find(isText)?.text ?? '', probe = brief.match(/S0-PROBE tag=(\w+)/)?.[1]
  const k = done(since(rows))   // auto mode: a role's text + end_turn is re-asked 3 times for SubagentHandback, then the run ends (RESULTS.md (c))
  if (done(rows) > 15) return ['cap', { text: END }]
  if (probe === 'end') return [probe, { text: END }]
  if (probe === 'hb') return [probe, /No such tool available: SubagentHandback/.test(JSON.stringify(rows.at(-1))) ? { text: END } : { text: END, tool: 'SubagentHandback', input: { message: END } }]   // the tool exists in auto mode only
  if (probe === 'wedge') return [probe, k === 0 ? { tool: 'Bash', input: { command: 'node -e "setTimeout(() => {}, 600000)"', description: 'Wait' } } : { text: END }]
  const role = brief.match(/\b(Worker|Reviewer|Explorer|Tester|Planner) brief/)?.[1]?.toLowerCase() ?? 'unknown'
  return [role, ROLES[role]?.(k, brief) ?? { text: END }]
}

async function* answer(e: any, a: Act): AsyncGenerator<any, any, any> {
  let i = 0
  if (a.text) yield { kind: 'text', index: i++, text: a.text }
  if (a.tool) { yield { kind: 'tool', index: i, id: id(), name: a.tool }; yield { kind: 'input', index: i, json: JSON.stringify(a.input ?? {}) } }
  const stopReason = a.tool ? 'tool_use' : 'end_turn'
  yield { kind: 'stop', stopReason, usage: U }
  return { turnId: e.turnId, index: e.index, answer: a.text ?? '', toolUses: a.tool ? [{ name: a.tool, input: a.input ?? {} }] : [], stopReason, usage: U }
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => { await $.command.register({ name: 's0', description: 'scripted probe: /s0 end|hb|wedge', immediate: true }); return next(e) })
  on('turn.step', async function* ($: any, e: any, next) {
    const rows = ((await $.session.messages(e.agentId ? { agentId: e.agentId } : {})) ?? []) as Row[]
    const [who, a] = e.agentId ? agent(rows) : ['main', main(rows)]
    await L($, `step agent=${e.agentId ?? 'main'} who=${who} index=${e.index} msgs=${e.messageCount} effort=${e.effort ?? '-'} -> ${a.tool ? `${a.text ? 'text+' : ''}tool ${a.tool}` : 'text end_turn'}`)
    return yield* answer(e, a)
  })
  on('turn.complete', async ($: any, e: any, next) => { await L($, `turn.complete agent=${e.agentId ?? 'main'} reason=${e.reason} usage=${e.usage?.model ?? '-'}`); return next(e) })
  // (c)/(d) probe: spawned from this command frame, so this plugin's turn.step (another registration) still sees the children's steps (G6)
  on('command.run', { command: 's0' }, async ($: any, e: any) => {
    const tag = String(e.args ?? '').trim() || 'end'
    const r = await $.agent.spawn({ prompt: `S0-PROBE tag=${tag}. Do the task you are given.`, description: `s0 ${tag}`, subagentType: 'general-purpose' })
    await L($, `spawned ${tag} -> ${JSON.stringify(r)}`)
    if (tag === 'wedge' && r?.agentId) $.clock.after(20_000, async () => {   // a timer frame, as the backstop's: no hook is calling
      try { await L($, `TaskStop ${r.agentId} -> ${JSON.stringify(await $.tool.call({ tool: 'TaskStop', task_id: r.agentId }))}`) } catch (x) { await L($, `TaskStop ${r.agentId} threw ${x}`) }
    })
    return { text: `s0 ${tag} spawned` }
  })
}
