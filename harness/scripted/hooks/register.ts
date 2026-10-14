// Harness-only scripted model (S0): answers every model request at turn.step (TM-04) from the fixtures below, never calling next, so no request
// reaches the API (PROXY=1's effort.jsonl stays empty). Each answer is a function of the loop's own transcript ($.session.messages), never of a
// counter: a resumed or nudged agent gets the answer its transcript calls for. Loaded with a second --plugin-dir AFTER cadre's, so it sits inner to
// cadre in the user tier (load order): cadre's turn.step sees each scripted response come up from beneath (its cost ledger records `model: scripted`).
// Every line it logs starts with SCRIPTED (debug log). `/s0 <end|hb|wedge>` is the forced-exit / TaskStop probe (RESULTS.md (c), (d)).
// The script is chosen per cell by the repo's `.git/scripted.json` ({"script": …}, written by a harness/fixtures/scripted overlay), default `lite`:
//   lite: main plans one lite task; full: a full-lane task (tester, worker, reviewer); loop: lite, the worker calls the same tool forever (the repeat-call breaker, then forced exit);
//   limit: lite, the first worker's first step goes to the proxy, which answers a usage limit (stub-proxy.mjs); slow: lite, the worker waits 45 s first.
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
let script = 'lite', injected = false
const cwds: Record<string, string> = {}   // agentId -> the folder cadre spawned it in (agent.spawn): the tester writes there by its full path

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
  const mission = /There is no mission yet/.test(rows[g].text) ? { mission: 'Goal: add titleCase(s) to the library\nConstraints: none\nNon-goals: none' } : {}
  if (script === 'full') {
    if (!kind('plan')) return { tool: 'TaskCreate', input: { subject: 'Add titleCase(s) to the library', description: 'A new public function titleCase(s) with node:test tests.', metadata: { kind: 'plan', lane: 'full', reason: 'a new public function', ...mission } } }
    if (!has(c => c.tool === 'TaskCreate' && !c.input?.metadata?.kind)) return { tool: 'TaskCreate', input: { subject: 'titleCase(s) with node:test tests', description: 'Create src/titleCase.mjs exporting titleCase: uppercase the first letter of each whitespace-separated word, leave the rest unchanged.',
      metadata: { type: 'feature', package: '.', paths: ['src/titleCase.mjs', 'test/titleCase.test.mjs'], scenarios: [`S1: Given 'hello big world' When titleCase is called Then it returns 'Hello Big World'`],
        changelog: { category: 'Added', entry: 'titleCase(s) capitalises the first letter of each word' }, interface: { symbols: [{ name: 'titleCase', kind: 'function', params: ['s: string'], returns: 'string', status: 'new' }] } } } }
    return { text: 'The plan is drafted: approve it in the dialog (key 1 opens it).' }
  }
  if (!kind('plan')) {
    return { tool: 'TaskCreate', input: { subject: 'Add titleCase(s) with tests', description: 'Add titleCase(s) as a named export in src/titleCase.mjs, in the style of src/slug.mjs, with node:test tests in test/titleCase.test.mjs.',
      metadata: { kind: 'plan', lane: 'lite', reason: 'one small function and its test', type: 'feature', changelog: { category: 'Added', entry: 'titleCase(s) capitalises the first letter of each word' }, ...mission } } }
  }
  return { text: 'The plan is drafted: approve it in the dialog (key 1 opens it).' }
}
const TEST = `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { titleCase } from '../src/titleCase.mjs'
test('S1: titleCase capitalises each word', () => assert.equal(titleCase('hello big world'), 'Hello Big World'))
`
// the test file only when there is none (full lane: the tester's is locked)
const FILES = String.raw`mkdir -p src test && cat > src/titleCase.mjs <<'EOF'
export const titleCase = s => s.replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase())
EOF
test -f test/titleCase.test.mjs || cat > test/titleCase.test.mjs <<'EOF'
${TEST}EOF`
const taskOf = (brief: string) => brief.match(/TASK-([\w-]+\.\d+)/)?.[1] ?? brief.match(/\b([a-z][\w]*-[a-z0-9]+\.\d+)\b/)?.[1]
const WAIT = { tool: 'Bash', input: { command: 'node -e "setTimeout(() => {}, 45000)"', description: 'Wait' } }
const ROLES: Record<string, (k: number, brief: string, cwd: string) => Act> = {
  worker: (k, b) => script === 'loop' ? { tool: 'mcp__cadre__run_check', input: { name: 'test', task: taskOf(b) } } : (script === 'slow' ? [WAIT] : []).concat([{ tool: 'Bash', input: { command: FILES, description: 'Write titleCase and its test' } }, { tool: 'mcp__cadre__run_check', input: { name: 'test', task: taskOf(b) } },
    { tool: 'mcp__cadre__report', input: { schemaVersion: 1, role: 'worker', outcome: 'done', summary: 'Added titleCase(s) in src/titleCase.mjs with a node:test test; npm test passes.', risks: [] } }])[k] ?? { text: END },
  tester: (k, _b, cwd) => [{ tool: 'Write', input: { file_path: `${cwd}/test/titleCase.test.mjs`, content: TEST } },
    { tool: 'mcp__cadre__report', input: { schemaVersion: 1, role: 'tester', outcome: 'done', summary: 'One test per scenario in test/titleCase.test.mjs.', tests: [{ path: 'test/titleCase.test.mjs', name: 'S1: titleCase capitalises each word', scenario: 'S1' }], run: { command: ['node', '--test', 'test/titleCase.test.mjs'] } } }][k] ?? { text: END },
  reviewer: (k, b) => [{ tool: 'mcp__cadre__run_check', input: { name: 'test', task: taskOf(b) } },
    { tool: 'mcp__cadre__report', input: { schemaVersion: 1, role: 'reviewer', verdict: 'pass', summary: 'The commit adds titleCase and its test only; npm test passes.', findings: [], coverage: script === 'full' ? [{ scenario: 'S1', test: 'S1: titleCase capitalises each word', ok: true }] : [], contractStatus: script === 'full' ? [{ name: 'titleCase', ok: true }] : [] } }][k] ?? { text: END },
  explorer: k => [{ tool: 'mcp__cadre__report', input: { schemaVersion: 1, role: 'explorer', answer: 'One string helper, slug, in src/slug.mjs as a named ESM export; tests in test/ use node:test; npm test runs node --test.', citations: [{ path: 'src/slug.mjs', line: 1 }, { path: 'package.json', line: 1 }] } }][k] ?? { text: END },
}
function agent(rows: Row[], cwd: string): [string, Act] {
  const brief = rows.find(isText)?.text ?? '', probe = brief.match(/S0-PROBE tag=(\w+)/)?.[1]
  const k = done(since(rows))   // auto mode: a role's text + end_turn is re-asked 3 times for SubagentHandback, then the run ends (RESULTS.md (c))
  if (done(rows) > (script === 'loop' ? 40 : 15)) return ['cap', { text: END }]   // loop: past the breaker (20 in a row)
  if (probe === 'end') return [probe, { text: END }]
  if (probe === 'hb') return [probe, /No such tool available: SubagentHandback/.test(JSON.stringify(rows.at(-1))) ? { text: END } : { text: END, tool: 'SubagentHandback', input: { message: END } }]   // the tool exists in auto mode only
  if (probe === 'wedge') return [probe, k === 0 ? { tool: 'Bash', input: { command: 'node -e "setTimeout(() => {}, 600000)"', description: 'Wait' } } : { text: END }]
  const role = brief.match(/\b(Worker|Reviewer|Explorer|Tester|Planner) brief/)?.[1]?.toLowerCase() ?? 'unknown'
  return [role, ROLES[role]?.(k, brief, cwd) ?? { text: END }]
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
  on('session.start', async ($: any, e, next) => {
    try { script = JSON.parse(await $.fs.read('/work/run/.git/scripted.json')).script ?? script } catch {}
    await L($, `script ${script}`); await $.command.register({ name: 's0', description: 'scripted probe: /s0 end|hb|wedge', immediate: true }); return next(e)
  })
  on('agent.spawn', async ($: any, e: any, next) => { const r = await next(e); if (r?.agentId) cwds[r.agentId] = e.cwd ?? '/work/run'; return r })
  on('turn.step', async function* ($: any, e: any, next) {
    const rows = ((await $.session.messages(e.agentId ? { agentId: e.agentId } : {})) ?? []) as Row[]
    const [who, a] = e.agentId ? agent(rows, cwds[e.agentId] ?? '/work/run') : ['main', main(rows)]
    if (script === 'limit' && who === 'worker' && !injected) { injected = true; await L($, `step agent=${e.agentId} who=worker index=${e.index} -> next (usage limit from the proxy)`); return yield* next(e) }
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
