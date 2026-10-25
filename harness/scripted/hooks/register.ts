// Harness-only scripted model (S0): answers every model request at turn.step (TM-04) from the fixtures below, never calling next, so no request
// reaches the API (PROXY=1's effort.jsonl stays empty). Each answer is a function of the loop's own transcript ($.session.messages), never of a
// counter: a resumed or nudged agent gets the answer its transcript calls for. Loaded with a second --plugin-dir AFTER cadre's, so it sits inner to
// cadre in the user tier (load order): cadre's turn.step sees each scripted response come up from beneath (its cost ledger records `model: scripted`).
// Every line it logs starts with SCRIPTED (debug log). `/s0 <end|hb|wedge>` is the forced-exit / TaskStop probe (RESULTS.md (c), (d)).
// The script is chosen per cell by the repo's `.git/scripted.json` ({"script": …}, written by a harness/fixtures/scripted overlay), default `lite`:
//   lite: main plans one lite task; full: a full-lane task (tester, worker, reviewer); loop: lite, the worker calls the same tool forever (the repeat-call breaker, then forced exit);
//   limit: lite, the first worker's first step goes to the proxy, which answers a usage limit (stub-proxy.mjs); slow: lite, the worker waits 12 s first;
//   silent: lite, the worker writes its files and stops without a report, every time (the report-less end);
//   pair: full lane, two independent tasks (concurrency-fifo, with concurrency.default 1 in the repo's config);
//   needs: lite, the worker first asks the explore helper (report outcome request), and writes its files once it is answered (needs-explore);
//   setup: the worker asks for an install with its argv (a global one first: refused at once; then [npm install ms]); cadre installs it from the real registry, no helper (needs-setup-s);
//   multi: full lane, two tasks (kebabCase after titleCase), an amend on a stale revision refused then retried (plan-tools-full);
//   probe: a milestone of two epics (the second after the first); the epic's planner asks the probe helper first, and drafts its tasks once it is answered (planner-probe);
//   sub: lite, the task in the `lib` submodule unit (submodule-unit); cont: lite, the reviewer waits 14 s first (continue-after-quit-s kills before or during it).
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
  // custom-role: main calls the user's read-only role once (an Agent of type cadre:auditor), then ends; the answer is that Agent's result
  if (script === 'custom-role') {
    const m = rows.map(r => isText(r) && /S0-AUDIT/.test(r.text)).lastIndexOf(true); if (m < 0) return { text: 'OK.' }
    return rows.slice(m + 1).some(r => r.role === 'assistant' && r.toolUses?.some(c => c.tool === 'Agent')) ? { text: END } : { tool: 'Agent', input: { description: 'audit the slug helper', subagent_type: 'cadre:auditor', prompt: 'List the risks of src/slug.mjs, one line each.' } }
  }
  // the tool-surface probe (probes/0.15): main asks for Agent once; under a settings deny the call comes back refused
  const m = rows.map(r => isText(r) && /S0-PROBE main-agent/.test(r.text)).lastIndexOf(true), g = rows.map(r => isText(r) && GOAL.test(r.text)).lastIndexOf(true)
  if (m > g) return rows.slice(m + 1).some(r => r.role === 'assistant') ? { text: END } : { tool: 'Agent', input: { description: 's0 main agent', subagent_type: 'general-purpose', prompt: 'S0-PROBE tag=end. Do the task you are given.' } }
  if (g < 0) return { text: 'OK.' }
  const after = rows.slice(g + 1), calls = after.flatMap(r => (r.role === 'assistant' ? r.toolUses ?? [] : []))
  const has = (f: (c: { tool: string; input?: any }) => boolean) => calls.some(f)
  const T = (n: string) => `mcp__cadre__${n}`, used = (n: string) => has(c => c.tool === T(n))   // main plans only through cadre's tools: plan, task, explore, ask
  const ai = after.findIndex(r => r.role === 'assistant' && r.toolUses?.some(c => c.tool === T('explore')))
  const answered = ai >= 0 && after.slice(ai + 1).some(r => isText(r) && /Result of ask-|its answer was already given/.test(r.text))   // the explorer's answer comes back as a message of its own
  if (after.filter(r => r.role === 'assistant').length > (script === 'multi' ? 12 : script === 'pair' ? 12 : 8)) return { text: 'Stopping: approve the plan in the dialog.' }
  if (ai < 0) return { tool: T('explore'), input: { question: 'What in the project does adding titleCase(s) touch: where string helpers live, how they are exported, where the tests are?' } }
  if (!answered) return { text: 'Waiting for the explorer.' }
  if (!used('ask')) return { tool: T('ask'), input: { clarity: { outcome: 1, scope: 1, acceptance: 1, constraints: 1 } } }
  const mission = /There is no mission yet/.test(rows[g].text) ? { mission: 'Goal: add titleCase(s) to the library\nConstraints: none\nNon-goals: none' } : {}
  if (script === 'probe') {   // a milestone: two epics (the second after the first), the critic's review, then main waits for the roadmap's dialog
    const n = (t: string) => calls.filter(c => c.tool === T(t)).length, ids = after.flatMap(r => (r.role === 'user' ? r.toolResults ?? [] : [])).map(r => r.text ?? ''), id = (k: number) => ids.filter(x => /"id":\s*"/.test(x))[k]?.match(/"id":\s*"([^"]+)"/)?.[1]
    const rev = Math.max(1, ...ids.map(x => +(x.match(/"revision":\s*(\d+)/)?.[1] ?? 0)), 0)
    if (!used('plan')) return { tool: T('plan'), input: { title: 'Add two string helpers to the library', description: 'wordCount(s) and truncate(s, n), each with node:test tests.', lane: 'milestone', reason: 'two separate features', ...mission } }
    if (n('epic') < 2) return { tool: T('epic'), input: { ...EPICS[n('epic')], ...(n('epic') ? { after: [id(1)] } : {}) } }
    if (n('explore') < 2) return { tool: T('explore'), input: { question: `Review this roadmap for gaps, overlaps and a wrong order: ${EPICS.map((e, i) => `${i + 1}. ${e.title}: ${e.goal} (files ${e.paths.join(', ')})`).join('; ')}` } }
    if (after.filter(r => isText(r) && /Result of ask-|its answer was already given/.test(r.text)).length < 2) return { text: 'Waiting for the critic.' }
    if (!used('amend')) return { tool: T('amend'), input: { id: id(0), expectedRevision: rev, critique: 'The critic found no gaps or overlaps: the order stands.' } }
    return { text: 'The roadmap is drafted: approve it in the dialog (key 1 opens it).' }
  }
  if (script === 'multi') {   // res: the k-th result of a tool's calls (its text, whether refused)
    const n = (t: string) => calls.filter(c => c.tool === T(t)).length
    const res = (t: string, k: number) => { let j = -1; for (let i = 0; i < after.length; i++) if (after[i].role === 'assistant' && after[i].toolUses?.some(c => c.tool === T(t)) && ++j === k) return after[i + 1]?.toolResults?.[0] }
    const num = (t: string, k: number, re: RegExp) => res(t, k)?.text?.match(re)?.[1]
    if (!used('plan')) return { tool: T('plan'), input: { title: 'Add titleCase(s) and kebabCase(s) to the library', description: 'Two public string helpers with node:test tests.', lane: 'full', reason: 'two new public functions', ...mission } }
    if (n('task') < 2) return { tool: T('task'), input: { ...TASKS[n('task')], ...(n('task') ? { after: [num('task', 0, /"id":\s*"([^"]+)"/)] } : {}) } }
    const b = num('task', 1, /"id":\s*"([^"]+)"/), desc = `${TASKS[1].description} Trim the input first.`
    if (!n('amend')) return { tool: T('amend'), input: { id: b, expectedRevision: +(num('plan', 0, /"revision":\s*(\d+)/) ?? 1), description: desc } }   // the revision main read at plan time: stale by now
    if (n('amend') === 1 && /call again with expectedRevision \d+/.test(res('amend', 0)?.text ?? '')) return { tool: T('amend'), input: { id: b, expectedRevision: +(num('amend', 0, /call again with expectedRevision (\d+)/) ?? 0), description: desc } }   // refused as stale: retry with the revision it names
    return { text: 'The plan is drafted: approve it in the dialog (key 1 opens it).' }
  }
  if (script === 'pair') {
    if (!used('plan')) return { tool: T('plan'), input: { title: 'Add two string helpers to the library', description: 'Two public string helpers with node:test tests.', lane: 'full', reason: 'two new public functions', ...mission } }
    if (calls.filter(c => c.tool === T('task')).length < 2) return { tool: T('task'), input: TASKS[calls.filter(c => c.tool === T('task')).length] }
    return { text: 'The plan is drafted: approve it in the dialog (key 1 opens it).' }
  }
  if (script === 'full') {
    if (!used('plan')) return { tool: T('plan'), input: { title: 'Add titleCase(s) to the library', description: 'A new public function titleCase(s) with node:test tests.', lane: 'full', reason: 'a new public function', ...mission } }
    if (!used('task')) return { tool: T('task'), input: TASKS[0] }
    return { text: 'The plan is drafted: approve it in the dialog (key 1 opens it).' }
  }
  if (!used('plan')) {
    return { tool: T('plan'), input: { title: 'Add titleCase(s) with tests', description: 'Add titleCase(s) as a named export in src/titleCase.mjs, in the style of src/slug.mjs, with node:test tests in test/titleCase.test.mjs.',
      lane: 'lite', reason: 'one small function and its test', type: 'feature', ...(script === 'sub' ? { package: 'lib' } : {}), changelog: { category: 'Added', entry: 'titleCase(s) capitalises the first letter of each word' }, ...mission } }
  }
  return { text: 'The plan is drafted: approve it in the dialog (key 1 opens it).' }
}
const EPICS = [{ title: 'wordCount(s)', goal: 'wordCount(s) in src/words.mjs returns the number of words in s', size: 1, paths: ['src/words.mjs', 'test/words.test.mjs'] },
  { title: 'truncate(s, n)', goal: 'truncate(s, n) in src/truncate.mjs cuts s to n characters and ends it with "..."', size: 1, paths: ['src/truncate.mjs', 'test/truncate.test.mjs'] }]
// the function a brief is about (multi: kebabCase is the second task), its test and files
type Fn = { name: string; title: string; input: string; out: string; impl: string; what: string; lit?: string }   // lit: the expected value as code, when it is no string
const FNS: Fn[] = [   // wordCount is the probe script's task (its epic's planner drafts it); fnOf picks it by name
  { name: 'titleCase', title: 'S1: titleCase capitalises each word', input: 'hello big world', out: 'Hello Big World', impl: String.raw`s => s.replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase())`, what: 'uppercase the first letter of each whitespace-separated word, leave the rest unchanged' },
  { name: 'kebabCase', title: 'S1: kebabCase joins the words with dashes', input: 'Hello Big World', out: 'hello-big-world', impl: String.raw`s => s.trim().toLowerCase().split(/\s+/).join('-')`, what: 'lowercase the words and join them with dashes' },
  { name: 'wordCount', title: 'S1: wordCount counts the words', input: 'a b c', out: '3', lit: '3', impl: String.raw`s => s.trim().split(/\s+/).length`, what: 'count the whitespace-separated words' },
]
const fnOf = (brief: string) => (/wordCount/.test(brief) ? FNS[2] : /kebabCase/.test(brief) ? FNS[1] : FNS[0])
const TEST = (f: Fn) => `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ${f.name} } from '../src/${f.name}.mjs'
test('${f.title}', () => assert.equal(${f.name}('${f.input}'), ${f.lit ?? `'${f.out}'`}))
`
// the test file only when there is none (full lane: the tester's is locked)
const FILES = (f: Fn) => `mkdir -p src test && cat > src/${f.name}.mjs <<'EOF'
export const ${f.name} = ${f.impl}
EOF
test -f test/${f.name}.test.mjs || cat > test/${f.name}.test.mjs <<'EOF'
${TEST(f)}EOF`
const TASKS = FNS.map(f => ({ title: `${f.name}(s) with node:test tests`, description: `Create src/${f.name}.mjs exporting ${f.name}: ${f.what}.`, type: 'feature', package: '.',
  paths: [`src/${f.name}.mjs`, `test/${f.name}.test.mjs`], scenarios: [`S1: Given '${f.input}' When ${f.name} is called Then it returns '${f.out}'`],
  changelog: { category: 'Added', entry: `${f.name}(s): ${f.what}` }, interface: { symbols: [{ name: f.name, kind: 'function', params: ['s: string'], returns: 'string', status: 'new' }] } }))
const taskOf = (brief: string) => brief.match(/TASK-([a-z][\w-]*\w)/)?.[1]   // ids are c-6-1, m-2: a letter first, a word char last
const WAIT = { tool: 'Bash', input: { command: 'node -e "setTimeout(() => {}, 12000)"', description: 'Wait' } }
const ROLES: Record<string, (k: number, brief: string, cwd: string, rows: Row[]) => Act> = {
  worker: (k, b, _c, rows) => { const f = fnOf(b), w = { tool: 'Bash', input: { command: FILES(f), description: `Write ${f.name} and its test` } }
    const answered = rows.some(r => isText(r) && /Answer to your request/.test(r.text))   // the answer comes back as a message of its own: after it the worker goes on
    const req = (request: unknown, summary: string) => ({ tool: 'mcp__cadre__report', input: { schemaVersion: 1, role: 'worker', outcome: 'request', summary, request } })
    if (script === 'setup' && !answered) return [{ tool: 'Bash', input: { command: 'env | grep -E "^(npm_config_offline|UV_OFFLINE|PIP_NO_INDEX|CARGO_NET_OFFLINE|GOPROXY|YARN_ENABLE_OFFLINE_MODE)=" | sort', description: 'Show the package manager settings' } },   // the settings this agent's shell starts with
      req({ helper: 'setup', ask: 'add ms', why: `${f.name} needs the ms package`, argv: ['npm', 'install', '-g', 'ms'] }, 'I need the ms package installed.'),   // refused at once (a global install): the report comes back with the allowed forms
      req({ helper: 'setup', ask: 'add ms', why: `${f.name} needs the ms package`, argv: ['npm', 'install', 'ms'] }, 'I need the ms package installed.')][k] ?? { text: END }
    if (script === 'needs' && !answered) return [req({ helper: 'explore', ask: 'Where do the string helpers live and how are they exported?', why: `I add ${f.name} next to them`, paths: ['src/'] }, 'I need to know where string helpers live.')][k] ?? { text: END }
    return script === 'silent' ? [w][k] ?? { text: END } : script === 'loop' ? { tool: 'mcp__cadre__run_check', input: { name: 'test', task: taskOf(b) } } : (script === 'slow' ? [WAIT] : []).concat([w, { tool: 'mcp__cadre__run_check', input: { name: 'test', task: taskOf(b) } },
    { tool: 'mcp__cadre__report', input: { schemaVersion: 1, role: 'worker', outcome: 'done', summary: `Added ${f.name}(s) in src/${f.name}.mjs with a node:test test; npm test passes.`, risks: [] } }])[k] ?? { text: END } },
  tester: (k, b, cwd) => { const f = fnOf(b); return [{ tool: 'Write', input: { file_path: `${cwd}/test/${f.name}.test.mjs`, content: TEST(f) } },
    { tool: 'mcp__cadre__report', input: { schemaVersion: 1, role: 'tester', outcome: 'done', summary: `One test per scenario in test/${f.name}.test.mjs.`, tests: [{ path: `test/${f.name}.test.mjs`, name: f.title, scenario: 'S1' }], run: { command: ['node', '--test', `test/${f.name}.test.mjs`] } } }][k] ?? { text: END } },
  reviewer: (k, b) => { const f = fnOf(b), full = ['full', 'multi', 'pair', 'probe'].includes(script); return [{ tool: 'mcp__cadre__run_check', input: { name: 'test', task: taskOf(b) } },
    { tool: 'mcp__cadre__report', input: { schemaVersion: 1, role: 'reviewer', verdict: 'pass', summary: `The commit adds ${f.name} and its test only; npm test passes.`, findings: [], coverage: full ? [{ scenario: 'S1', test: f.title, ok: true }] : [], contractStatus: full ? [{ name: f.name, ok: true }] : [] } }][k] ?? { text: END } },
  planner: (k, _b, _c, rows) => rows.some(r => isText(r) && /Answer to your request/.test(r.text))
    ? [{ tool: 'mcp__cadre__report', input: { schemaVersion: 1, role: 'planner', summary: 'One task.', tasks: [{ subject: 'wordCount(s) with node:test tests', description: 'Create src/words.mjs exporting wordCount: the number of whitespace-separated words in s.',
      metadata: { type: 'feature', package: '.', paths: ['src/words.mjs', 'test/words.test.mjs'], scenarios: ["S1: Given 'a b c' When wordCount is called Then it returns 3"], changelog: { category: 'Added', entry: 'wordCount(s): the number of words in s' },
        interface: { symbols: [{ name: 'wordCount', kind: 'function', params: ['s: string'], returns: 'number', status: 'new' }] } } }] } }][k] ?? { text: END }   // after the probe's answer: the plan
    : [{ tool: 'mcp__cadre__report', input: { schemaVersion: 1, role: 'planner', outcome: 'request', summary: 'I look at the project before I plan.', request: { helper: 'probe', ask: 'Where do the string helpers live and how are they tested?', why: 'I plan the tasks next to them', paths: ['src/'] } } }][k] ?? { text: END },
  explorer: k => [{ tool: 'mcp__cadre__report', input: { schemaVersion: 1, role: 'explorer', answer: 'One string helper, slug, in src/slug.mjs as a named ESM export; tests in test/ use node:test; npm test runs node --test.', citations: [{ path: 'src/slug.mjs', line: 1 }, { path: 'package.json', line: 1 }] } }][k] ?? { text: END },
}
function agent(rows: Row[], cwd: string): [string, Act] {
  const brief = rows.find(isText)?.text ?? '', probe = brief.match(/S0-PROBE tag=(\w+)/)?.[1]
  const k = done(since(rows))   // auto mode: a role's text + end_turn is re-asked 3 times for SubagentHandback, then the run ends (RESULTS.md (c))
  if (done(rows) > (script === 'loop' ? 40 : 15)) return ['cap', { text: END }]   // loop: past the breaker (20 in a row)
  if (probe === 'end') return [probe, { text: END }]
  if (probe === 'hb') return [probe, /No such tool available: SubagentHandback/.test(JSON.stringify(rows.at(-1))) ? { text: END } : { text: END, tool: 'SubagentHandback', input: { message: END } }]   // the tool exists in auto mode only
  if (probe === 'wedge' || probe === 'tools') return [probe, k === 0 ? { tool: 'Bash', input: { command: 'node -e "setTimeout(() => {}, 600000)"', description: 'Wait' } } : { text: END }]
  const role = brief.match(/\b(Worker|Reviewer|Explorer|Tester|Planner) brief/)?.[1]?.toLowerCase() ?? (/# PLAN-\w/.test(brief) ? 'planner' : 'unknown')
  return [role, ROLES[role]?.(k, brief, cwd, rows) ?? { text: END }]
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
    await L($, `script ${script}`); await $.command.register({ name: 's0', description: 'scripted probe: /s0 end|hb|wedge|tools', immediate: true }); return next(e)
  })
  on('agent.spawn', async ($: any, e: any, next) => { const r = await next(e); if (r?.agentId) cwds[r.agentId] = e.cwd ?? '/work/run'; return r })
  on('turn.step', async function* ($: any, e: any, next) {
    const rows = ((await $.session.messages(e.agentId ? { agentId: e.agentId } : {})) ?? []) as Row[]
    const [who, a] = e.agentId ? agent(rows, cwds[e.agentId] ?? '/work/run') : ['main', main(rows)]
    if (script === 'limit' && who === 'worker' && !injected) { injected = true; await L($, `step agent=${e.agentId} who=worker index=${e.index} -> next (usage limit from the proxy)`); return yield* next(e) }
    if (who === 'planner' && a.tool && JSON.stringify(a.input).includes('"tasks"')) await L($, 'planner drafts')   // the cell waits for it; its tool result is the accepted plan
    await L($, `step agent=${e.agentId ?? 'main'} who=${who} index=${e.index} msgs=${e.messageCount} effort=${e.effort ?? '-'} -> ${a.tool ? `${a.text ? 'text+' : ''}tool ${a.tool}` : 'text end_turn'}`)
    // cont: the reviewer's first two steps wait 7 s each (a hook call over ~10 s fails: HooksError, so one long sleep won't do). The reviewer has no Bash, so the wait is a sleep here: with none, the reviewer ends within a second of the worker and the
    // cell's SIGKILL (polled every 2 s, later under load) lands after it, leaving no reviewer to run after the restart
    if (script === 'cont' && who === 'reviewer' && e.index < 2) await new Promise(r => setTimeout(r, 7000))
    return yield* answer(e, a)
  })
  on('turn.complete', async ($: any, e: any, next) => { await L($, `turn.complete agent=${e.agentId ?? 'main'} reason=${e.reason} usage=${e.usage?.model ?? '-'}`); return next(e) })
  // (c)/(d) probe: spawned from this command frame, so this plugin's turn.step (another registration) still sees the children's steps (G6)
  on('command.run', { command: 's0' }, async ($: any, e: any) => {
    const tag = String(e.args ?? '').trim() || 'end'
    if (tag === 'tools') {   // probes/0.15: the tool surface under the settings gate, and hard links where the file store will live
      await L($, `tools ${JSON.stringify((await $.tool.list()).map((t: any) => t.name).filter((n: string) => /^(Task|Todo|Agent$|mcp__)/.test(n)))}`)
      const ln = await $.process.run(['sh', '-c', 'cd /work/run && mkdir -p .cadre/state && cd .cadre/state && rm -f j.* && echo a > t.1 && echo b > t.2 && ln t.1 j.1 && sync j.1 && echo link=ok; ln t.2 j.1 2>/dev/null && echo cas=overwrote || echo cas=refused; stat -c nlink=%h j.1; [ j.1 -ef t.1 ] && echo ef=same; cat j.1; df -T . | tail -1'])
      await L($, `ln exit=${ln.exitCode} ${JSON.stringify(ln.stdout + ln.stderr)}`)
    }
    let r: any; try { r = await $.agent.spawn({ prompt: `S0-PROBE tag=${tag}. Do the task you are given.`, description: `s0 ${tag}`, subagentType: 'general-purpose' }) } catch (x) { r = { threw: String(x) } }
    await L($, `spawned ${tag} -> ${JSON.stringify(r)}`)
    if ((tag === 'wedge' || tag === 'tools') && r?.agentId) $.clock.after(6_000, async () => {   // a timer frame, as the backstop's: no hook is calling
      try { await L($, `TaskStop ${r.agentId} -> ${JSON.stringify(await $.tool.call({ tool: 'TaskStop', task_id: r.agentId }))}`) } catch (x) { await L($, `TaskStop ${r.agentId} threw ${x}`) }
    })
    return { text: `s0 ${tag} spawned` }
  })
}
