#!/usr/bin/env node
// Judges one cell's evidence dir (harness/cell.sh writes it), never by eye. Usage: node harness/oracle.mjs <dir> [--landed]
// Reads driver.log (what the driver did, epoch ms), panes/<ms>.txt (a capture each time the screen changed), debug*.log (Claude Code's
// debug log: turns, cadre's toasts, AskUserQuestion calls), jsonl/**.jsonl (transcripts: refusals), stray-state, refs-*.
// Writes verdict.json and prints `<cell> PASS|FAIL <invariant>: <evidence>`; exit 1 on FAIL. Budgets: ORACLE_TURNS (10), ORACLE_DIALOGS (3), ORACLE_STUCK_S (90).
import { readFileSync, readdirSync, existsSync, writeFileSync, statSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'

const dir = process.argv[2], wantLanded = process.argv.includes('--landed')
const TURNS = +(process.env.ORACLE_TURNS ?? 10), DIALOGS = +(process.env.ORACLE_DIALOGS ?? 3), STUCK = 1000 * +(process.env.ORACLE_STUCK_S ?? 90)
const read = f => (existsSync(f) ? readFileSync(f, 'utf8') : '')
const walk = d => (existsSync(d) ? readdirSync(d).flatMap(f => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)])) : [])
const clip = s => s.replace(/\s+/g, ' ').trim().slice(0, 200)

// ---- inputs ----
const drv = read(join(dir, 'driver.log')).split('\n').filter(Boolean).map(l => { const [t, kind, ...r] = l.split(' '); return { t: +t, kind, text: r.join(' ') } })
const tEnd = drv.findLast(e => e.kind === 'end')?.t ?? Date.now()
const panes = readdirSync(join(dir, 'panes')).filter(f => f.endsWith('.txt')).map(f => ({ t: +basename(f, '.txt'), text: read(join(dir, 'panes', f)) })).sort((a, b) => a.t - b.t)
// Claude Code 2.1.310 keeps only the last ~1 MB of its debug log: cell.sh's keeplogs collects every line in keep-<name> as it runs, so that is the log to read when it exists
const debug = readdirSync(dir).filter(f => /^debug.*\.log$/.test(f)).sort().map(f => read(join(dir, existsSync(join(dir, `keep-${f}`)) ? `keep-${f}` : f)).split('\n'))
const ts = l => Date.parse(l.slice(0, 24))
const dlines = debug.flat().filter(l => /^\d{4}-/.test(l))

// a pane docked at the right shares every row: cut its column (the │ at one index on a third of the rows or more), as the watcher's dialog title does
const left = p => { const L = p.split('\n'), n = {}; for (const l of L) { const i = l.indexOf('│'); if (i > 0) n[i] = (n[i] ?? 0) + 1 }
  const [c, k] = Object.entries(n).sort((a, b) => b[1] - a[1])[0] ?? []; return k >= L.length / 3 ? L.map(l => (l.indexOf('│') === +c ? l.slice(0, +c).trimEnd() : l)).join('\n') : p }
// the transcript with a reply wrapped onto indented rows joined back into one line (a docked pane narrows it: "Setup was" / "interrupted · /cadre …")
const flow = p => left(p).split('\n').reduce((o, l) => (o.length && /^ {3,}\S/.test(l) && !/^\s*[⎿●❯]/.test(l) && o.at(-1).trim() ? [...o.slice(0, -1), `${o.at(-1).trimEnd()} ${l.trim()}`] : [...o, l]), []).join('\n')
// the band (from the row ending in the fold button [-] down to the composer) + the status line under it: the same cut as the watcher's
const band = q => { const p = left(q), L = p.split('\n'), b = L.flatMap((l, i) => (/^─{20}/.test(l) ? [i] : [])); if (b.length < 2) return ''
  const t = b.at(-2), s = L.slice(Math.max(0, t - 8), t).findLastIndex(l => /\[-\] *$/.test(l)); return [...(s < 0 ? [] : L.slice(Math.max(0, t - 8) + s, t)), ...L.slice(b.at(-1) + 1)].join('\n') }
const isDialog = p => p.includes('Enter to select')
// main's turns: [start, end] from the debug log (a restart starts a new log; an open turn at the end runs to tEnd)
const turns = debug.flatMap(ls => {
  const out = []; let s
  for (const l of ls) { if (/\[engine\] turn \d+ start/.test(l)) s = ts(l); else if (/\[engine\] turn \d+ end/.test(l) && s) { out.push([s, ts(l)]); s = undefined } }
  if (s) out.push([s, tEnd]); return out
})
const inTurn = t => turns.some(([a, b]) => t >= a - 2000 && t <= b + 2000)
const fails = [], stats = {}
const fail = (inv, evidence) => fails.push({ invariant: inv, evidence: clip(evidence) })

// 1. never "running" / "Claude is on it" for > 90 s with no active turn
{
  let from = null, ev = ''
  const stuck = (p, t) => /is running|Claude is on it/.test(band(p.text)) && !isDialog(p.text) && !p.text.includes('esc to interrupt') && !inTurn(t)
  for (let i = 0; i <= panes.length; i++) {
    const p = panes[i], t = p?.t ?? tEnd
    if (p && stuck(p, t)) { if (from === null) { from = t; ev = band(p.text).split('\n').find(l => /is running|Claude is on it/.test(l)) } continue }
    // a pane only changes when the screen does: between captures the state held. Re-check turn starts inside the window.
    if (from !== null) { const firstTurn = turns.find(([a]) => a > from && a < t)?.[0] ?? t; if (firstTurn - from > STUCK) fail('stuck-running', `${Math.round((firstTurn - from) / 1000)} s with no turn: ${ev}`); from = null }
  }
}
// 2. every press of 1 (the band said "press 1" / "answer the dialog") opens a dialog within 5 s (+ one capture interval)
const asks = dlines.filter(l => /\$\.tool\.call \(cadre\): AskUserQuestion \(/.test(l)).map(ts)
// Only a press the band or status line asked for is judged: Claude's own reply may name the dialog it is about to open ("…to approve in the cadre dialog
// (press 1)" before the plan is drafted, live 0.12.0); the watcher still presses on it like a user would, and nothing coming of it is no defect of cadre's text.
const offered = t => band(panes.findLast(p => p.t <= t)?.text ?? '').match(/press 1|answer the dialog|1: answer/)
for (const e of drv.filter(e => e.kind === 'press1' && offered(e.t) && e.t + 5000 <= tEnd)) {   // a press the cell stopped watching within 5 s is not judged (cell.sh stops pressing 7 s before the end)
  const ok = panes.some(p => p.t >= e.t && p.t <= e.t + 7000 && isDialog(p.text)) || asks.some(t => t >= e.t - 500 && t <= e.t + 5000)
  if (!ok) fail('press1-no-dialog', `pressed 1 on "${e.text}", no dialog within 5 s`)
}
// 3. no refusal repeated >= 3 times with the same text by one agent (its own transcript: tool calls refused, Claude's stop refused); three agents missing once each are not a loop
{
  const n = new Map(), uses = new Map()
  // forced: the worker's same call 20x in a row IS the scenario (scripted/loop; the breaker, then the forced step, checked under ORACLE=forced): its
  // refusals are error results since tools/index sends them as {deny}, so only main's transcript is held to the rule there
  for (const f of walk(join(dir, 'jsonl')).filter(f => f.endsWith('.jsonl') && !(process.env.ORACLE === 'forced' && f.includes('/subagents/')))) for (const l of read(f).split('\n').filter(Boolean)) {
    let d; try { d = JSON.parse(l) } catch { continue }
    const c = d.type === 'user' ? d.message?.content : undefined
    if (d.type === 'assistant' && Array.isArray(d.message?.content)) for (const b of d.message.content) if (b.type === 'tool_use') uses.set(b.id, JSON.stringify(b.input))
    const texts = typeof c === 'string' ? (c.startsWith('Stop hook feedback') ? [c] : [])
      : Array.isArray(c) ? c.filter(b => b.type === 'tool_result' && b.is_error).map(b => (typeof b.content === 'string' ? b.content : JSON.stringify(b.content))) : []
    // a tool's own error can read the same for different calls ("File does not exist. Note: your current working directory is …"): three
    // different missing files are exploration, so the producing call's input is part of the key; the same call 3x is still a loop
    for (const b of Array.isArray(c) ? c : []) if (b.type === 'tool_result' && b.is_error) { const i = texts.findIndex(x => x === (typeof b.content === 'string' ? b.content : JSON.stringify(b.content))); if (i >= 0) texts[i] = `${uses.get(b.tool_use_id) ?? ''} ${texts[i]}` }
    for (const t of texts) n.set(`${f}\0${t}`, (n.get(`${f}\0${t}`) ?? 0) + 1)
  }
  const [key, k] = [...n].sort((a, b) => b[1] - a[1])[0] ?? ['', 0], t = key.slice(key.indexOf('\0') + 1)
  stats.refusals = [...n.values()].reduce((a, b) => a + b, 0)
  if (k >= 3) fail('refusal-loop', `${k}x: ${t}`)
}
// 4. band, toast and Doctor never disagree on containment
{
  const word = s => s.match(/\b(degraded|contained)\b/)?.[1]
  const bandWord = p => word(band(p.text).split('\n').filter(l => /ontain/i.test(l)).join(' '))
  for (const l of dlines.filter(l => /\$\.ui\.toast \(cadre\):.*ontain/.test(l))) {
    const w = word(l), t = ts(l), later = panes.filter(p => p.t >= t + 5000 && p.t <= t + 20000).map(bandWord).filter(Boolean)
    if (w && later.length && later.every(b => b !== w)) fail('containment-disagree', `toast "${l.split('): ')[1]}" but the band says ${later[0]}`)
  }
  for (const p of panes.filter(p => /Doctor/.test(p.text))) {
    const doc = word(p.text.split('\n').filter(l => /containment/i.test(l) && !band(p.text).includes(l)).join(' ')), b = bandWord(p)
    if (doc && b && doc !== b) fail('containment-disagree', `Doctor says ${doc}, the band says ${b}`)
  }
}
// 5. no NotInitialized / uncaught errors / failed hooks
{
  const bad = /NotInitialized|Uncaught|unhandledRejection|Unhandled promise rejection|hook failed:/
  // a hook CC aborted (a quit or interrupt mid-hook: "$.process.run(sh) aborted") is the engine's teardown, not cadre's error: CC runs what is below it
  const hit = dlines.find((l, i) => bad.test(l) && !(/hook failed:/.test(l) && /hook skipped: threw .* aborted$/.test(dlines[i + 1] ?? ''))) ?? panes.map(p => p.text.split('\n').find(l => bad.test(l))).find(Boolean)
  if (hit) fail('errors', hit.replace(/^\S+ \[\w+\] /, ''))
}
// main's own tool calls, from its transcript (not the agents'): mine = every call with its result {ok, text}; went = those that went through
const mine = (() => {
  const ok = new Map(), calls = []
  for (const f of walk(join(dir, 'jsonl')).filter(f => f.endsWith('.jsonl') && !f.includes('/subagents/'))) for (const l of read(f).split('\n').filter(Boolean)) {
    let d; try { d = JSON.parse(l) } catch { continue }
    const c = d.message?.content; if (!Array.isArray(c)) continue
    if (d.type === 'assistant') for (const b of c) if (b.type === 'tool_use') calls.push(b)
    if (d.type === 'user') for (const b of c) if (b.type === 'tool_result') { const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? ''); ok.set(b.tool_use_id, { ok: !b.is_error && !/^"?error:/.test(text), text }) }   // a refusal: an error result, or one whose text starts error:
  }
  return calls.map(b => ({ ...b, ok: ok.get(b.id)?.ok, text: ok.get(b.id)?.text ?? '' }))
})(), went = mine.filter(b => b.ok)
// 6. the goal reaches the plan dialog within the turn and dialog budget
//    main's question call is one dialog however many tabs the watcher logged (one per question), and its one clarify round (ADR 0020: at most
//    maxQuestions in ONE call) earns its dialog on top of set up, safety settings and the plan: on haiku a clear goal may still score unclear
//    (main's judgement; the clarify tier's CLARIFY=none judges that, not this budget). custom-role has no goal: main's one Agent call is the whole cell
{ const g = drv.find(e => e.kind === 'goal-failed'); if (g) fail('goal-not-taken', g.text) }
if (!['custom-role', 'profile-invalid'].includes(process.env.ORACLE ?? '')) {
  const plan = drv.find(e => e.kind === 'plan'), until = plan?.t ?? tEnd
  // a fault the cell injected (FAULT=interrupt|kill) earns the setup's one recovery dialog ("… stopped …")
  const faulted = drv.some(e => e.kind === 'fault'); let budget = DIALOGS + (faulted && drv.some(e => e.kind === 'dialog' && /stopped/.test(e.text)) ? 1 : 0)
  const norm = x => x.replace(/\s+/g, ' ').trim().slice(0, 40), asks = went.filter(b => b.name === 'AskUserQuestion').map(b => (b.input?.questions ?? []).map(q => norm(q.question ?? '')).filter(Boolean))
  // a tab whose title the watcher could not read (a narrow pane wraps the question; live: `dialog ` with nothing after it) belongs to the call of the tab before it
  const seen = drv.filter(e => e.kind === 'dialog' && e.t < until).map(e => asks.findIndex(qs => qs.includes(norm(e.text)))).map((i, k, a) => i < 0 && !norm(drv.filter(e => e.kind === 'dialog' && e.t < until)[k].text) ? (a.slice(0, k).findLast(x => x >= 0) ?? i) : i), calls = new Set(seen.filter(i => i >= 0))
  const dialogs = seen.filter(i => i < 0).length + calls.size + (plan ? 1 : 0)
  budget += Math.min(1, calls.size)
  const nTurns = turns.filter(([a]) => a < until).length
  Object.assign(stats, { plan: !!plan, dialogs, turns: nTurns, secsToPlan: plan ? Math.round((plan.t - drv[0].t) / 1000) : null })
  if (!plan) fail('no-plan', `no plan dialog in ${Math.round((tEnd - drv[0].t) / 1000)} s; last screen: ${band(panes.at(-1)?.text ?? '').split('\n').filter(l => l.trim() && !/^─/.test(l)).slice(-3).join(' | ')}`)
  else { if (dialogs > budget) fail('dialog-budget', `${dialogs} dialogs before the plan (budget ${budget}): ${drv.filter(e => e.kind === 'dialog' && e.t < until).map(e => e.text).join(' / ')}`)
         if (nTurns > TURNS) fail('turn-budget', `${nTurns} turns before the plan (budget ${TURNS})`) }
}
// 7. cadre's state lives at the repo top level only (a .cadre/ below it = the root followed main's shell)
// REPO=<folder>: the fixture's repo lives in that folder of the work dir (underscore-id), so its state is at ./<folder>/.cadre
{ const s = read(join(dir, 'stray-state')).split('\n').filter(l => l && !(process.env.REPO && new RegExp(`^\\./${process.env.REPO}/\\.cadre$`).test(l))).join('\n'); if (s) fail('wrong-root', `state written below the repo root: ${s.split('\n').join(', ')}`) }
// 8. after Claude Code restarts (a quit, a crash) the session that is gone may neither block nor vanish:
//    gone-session: no "running in another session" (a cell has one session); restart-named: the first bare /cadre names the unfinished setup or plan and the next step
{
  const r = drv.find(e => e.kind === 'restart' || (e.kind === 'fault' && /^kill/.test(e.text)))
  if (r) {
    const g = panes.filter(p => p.t > r.t).find(p => /running in another session/.test(p.text))
    if (g) fail('gone-session', g.text.split('\n').find(l => /running in another session/.test(l)))
    const ask = drv.find(e => e.kind === 'send' && e.t > r.t && e.text.trim() === '/cadre')
    if (ask) {
      const win = panes.filter(p => p.t >= ask.t && p.t <= ask.t + 15000).map(p => flow(p.text)).join('\n')
      const what = /(interrupted|unfinished|stopped)[^\n]*(setup|init|plan\b|p-\w+|run-\w+)|(setup|init|plan\b|p-\w+|run-\w+)[^\n]*(interrupted|unfinished|stopped)/i, next = /\/cadre \S|press [0-9]|[0-9]: (continue|answer)/
      if (!(what.test(win) && next.test(win))) fail('restart-named', `after the restart a bare /cadre said: ${flow(panes.find(p => p.t >= ask.t)?.text ?? '').split('\n').filter(l => /cadre:/.test(l)).slice(-1)[0] ?? '(nothing)'}`)
    }
  }
}
// 8b. a stop (FAULT=interrupt) asks for a typed line once: no stopped dialog shown twice, no more than 2 typed lines (each one brings a turn)
{ const st = drv.filter(e => e.kind === 'dialog' && /stopped/.test(e.text)).length, ty = drv.filter(e => e.kind === 'type').length
  if (st > 1 || ty > 2) fail('stop-loop', `${st} stopped dialogs, ${ty} typed lines: ${drv.filter(e => e.kind === 'dialog' || e.kind === 'type').map(e => e.text).slice(-3).join(' / ')}`) }
// a cell that asked for a fault and never injected it tested nothing
{ const f = drv[0]?.text.match(/fault=(\w+)/)?.[1]; if (f && f !== 'none' && !drv.some(e => e.kind === 'fault')) fail('fault-not-injected', `FAULT=${f} never fired (its trigger was not reached)`) }
// 9. no credential in a mounted dir or the evidence (cell.sh lists the files that hold one)
{ const s = read(join(dir, 'leak')).trim(); if (s) fail('token-leak', `a credential is in: ${s.split('\n').join(', ')}`) }
// 10. optional: it landed on dev
if (wantLanded && !drv.some(e => e.kind === 'landed')) fail('not-landed', `dev: ${read(join(dir, 'refs-after')).split('\n').find(l => l.startsWith('dev ')) ?? 'no dev branch'}`)

// 11. routing: every agent request (PROXY=1 cells: effort.jsonl) runs on a model and effort the settings allow for its role (harness/expect-routing.mjs
//     computes them with cadre's own config + route code). ponytail: per role, not per task; a request is matched to its role by its system prompt.
{
  // An agent's request = its system prompt names the role AND the debug log has a `source=agent:custom:cadre:<role>` request within 300 ms. That drops Claude Code's
  // own side requests in an agent's context (source=agent_summary: the progress line) and never relabels main's request that happened at the same moment.
  const src = dlines.filter(l => /\[API REQUEST\] \/v1\/messages source=/.test(l)).map(l => [ts(l), l.match(/source=(\S+)/)[1]])
  const req = read(join(dir, 'effort.jsonl')).split('\n').filter(Boolean).map(l => JSON.parse(l))
    // the NEAREST source decides: an agent_summary 50 ms before a worker request is a side request, not the worker's (2.1.310 timing)
    .filter(r => { const n = src.filter(([t]) => Math.abs(t - r.at) < 300).sort((a, b) => Math.abs(a[0] - r.at) - Math.abs(b[0] - r.at))[0]; return !src.length || n?.[1] === `agent:custom:cadre:${r.role}` })
    .filter(r => r.role !== 'main')
  if (req.length) {
    const repo = dirname(dirname(new URL(import.meta.url).pathname)), exp = JSON.parse(execFileSync(process.execPath, ['--experimental-transform-types', '--no-warnings', '--import', `${repo}/tests/dev/register.mjs`, `${repo}/harness/expect-routing.mjs`, repo, join(dir, 'cadre-config.json'), join(dir, 'env.json')], { encoding: 'utf8' }))
    const bad = req.filter(r => { const e = exp[r.role]; return e && (!e.models.some(m => r.model?.includes(m)) || (e.efforts.length && !e.efforts.includes(r.output_config?.effort))) })
    stats.routing = Object.fromEntries(Object.keys(exp).map(k => [k, [...new Set(req.filter(r => r.role === k).map(r => `${r.model}/${r.output_config?.effort ?? '-'}`))]]))
    if (bad.length) fail('routing', `${bad.length} request(s) off the settings, e.g. ${bad[0].role} on ${bad[0].model}/${bad[0].output_config?.effort ?? '-'} (allowed ${JSON.stringify(exp[bad[0].role])})`)
  }
}
// 13. optional (EPIC_PLANNERS=N, the milestone cells): N epic plans came from planner agents (their report was accepted) and main drafted no epic's tasks
{
  const n = +(process.env.EPIC_PLANNERS ?? 0), js = walk(join(dir, 'jsonl')).filter(f => f.endsWith('.jsonl'))
  if (n) {
    const ok = js.filter(f => /plan accepted: \d+ tasks approved/.test(read(f))).length, own = js.filter(f => !f.includes('/subagents/')).flatMap(f => read(f).split('\n')).find(l => l.includes('"name":"mcp__cadre__task"') && /\\?"epic\\?":\s*\\?"/.test(l))
    stats.planners = ok
    if (ok < n) fail('epic-planner', `${ok} of ${n} epic plans came from a planner agent`)
    if (own) fail('epic-planner', `main drafted an epic's tasks: ${own.match(/"subject":"[^"]*"/)?.[0] ?? 'a task with epic'}`)
  }
}
// 12. clarify (CLARIFY=ask|none|assumed|deep): main's own calls before the plan, from its transcript (not the agents'): one explorer (its explore tool with a question);
//     ask: one AskUserQuestion that went through, 1-3 questions; none: no question; assumed: no question and the plan dialog lists "assumed:"; deep: 1-8 questions, one per call
if (process.env.CLARIFY) {
  const explore = went.filter(b => b.name === 'mcp__cadre__explore' && b.input?.question).length
  const qs = went.filter(b => b.name === 'AskUserQuestion').map(b => b.input?.questions?.length ?? 0), want = process.env.CLARIFY
  const assumed = panes.some(p => /approve/.test(p.text) && /assumed:/.test(p.text))
  Object.assign(stats, { explorers: explore, questions: qs })
  const why = explore !== 1 ? `${explore} explorers (want 1)`
    : want === 'ask' ? (qs.length === 1 && qs[0] >= 1 && qs[0] <= 3 ? '' : `questions per call ${JSON.stringify(qs)} (want one call of 1-3)`)
    : want === 'none' ? (qs.length ? `asked ${JSON.stringify(qs)} on a clear goal` : '')
    : want === 'assumed' ? (qs.length ? `asked ${JSON.stringify(qs)} under yolo` : assumed ? '' : 'the plan dialog lists no "assumed:" line')
    : want === 'deep' ? (qs.length >= 1 && qs.length <= 8 && qs.every(n => n === 1) ? '' : `questions per call ${JSON.stringify(qs)} (want 1-8 calls of 1)`) : `unknown CLARIFY=${want}`
  if (why) fail('clarify', why)
}
// 14. the 0.14 cells (harness/README.md "0.14 cells"). S=1: the scripted model answered everything; ORACLE=<cell>: that cell's one-line oracle.
//     store/<ms>.json: cadre's $.store snapshots (scenarios/_lib.sh); run records `…:run:<agentId>` {role, state, log}, budgets `…:budget:<taskId>`.
if (process.env.S) { const r = read(join(dir, 'effort.jsonl')).trim(); if (r) fail('zero-quota', `${r.split('\n').length} request(s) the stub proxy refused: ${r.split('\n')[0]}`) }
{
  // the control doc's after-images, from d/_control.<seq> or a journal entry j/<n> that wrote it (task-management/adapters/file). Entries are write-once, so
  // `seen` folds every snapshot's: a snapshot's control doc is the newest seen so far (a listing torn by the container stopping keeps the newer ones), and
  // `hist` holds every image, so a run that starts and is pruned (its task closed) between two 2 s snapshots still shows
  const seen = new Map(), ctl = d => Object.fromEntries(Object.entries(d?.doc ?? {}).map(([k, v]) => [`cadre:ctl:${k}`, v]))
  const fold = p => { for (const l of (existsSync(p) ? read(p) : '').split('\n')) { const [n, ...v] = l.split('\t'), x = (() => { try { return JSON.parse(v.join('\t')) } catch { return undefined } })(); if (!x) continue
    const d = n.match(/^d\/_control\.(\d+)$/), e = n.match(/^j\/(\d+)$/), seq = +(d?.[1] ?? e?.[1] ?? -1), doc = d ? x : e && x.docs && '_control' in x.docs ? x.docs._control : undefined
    if (doc) seen.set(seq, doc) }
    return seen.size ? ctl(seen.get(Math.max(...seen.keys()))) : {} }
  const snaps = (existsSync(join(dir, 'store')) ? readdirSync(join(dir, 'store')) : []).filter(f => f.endsWith('.json')).sort().map(f => { try { const c = fold(join(dir, 'store', f.replace(/json$/, 'state'))); return { t: +basename(f, '.json'), s: { ...JSON.parse(read(join(dir, 'store', f))), ...c } } } catch { return null } }).filter(Boolean)
  const hist = [...seen].sort((a, b) => a[0] - b[0]).map(([, d]) => ctl(d))
  const pick = (s, k) => Object.fromEntries(Object.entries(s).flatMap(([key, v]) => { const m = key.match(new RegExp(`:${k}:([^:]+)$`)); return m && v ? [[m[1], v]] : [] }))
  const runs = s => pick(s, 'run'), lost = r => r.state?.state === 'ended' && r.state.cause === 'lost'
  const subs = walk(join(dir, 'jsonl')).filter(f => f.includes('/subagents/') && f.endsWith('.jsonl')).map(f => {
    const ls = read(f).split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } }), u = ls.find(d => d.type === 'user')
    const c = u?.message?.content, brief = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join(' ') : ''
    const results = new Map(ls.filter(d => d.type === 'user').flatMap(d => (Array.isArray(d.message?.content) ? d.message.content : []).filter(b => b.type === 'tool_result').map(b => [b.tool_use_id, typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map(c => c.text ?? '').join(' ') : ''])))
    return { f, brief, results, t: Date.parse(u?.timestamp ?? '') || 0, uses: ls.filter(d => d.type === 'assistant').flatMap(d => (Array.isArray(d.message?.content) ? d.message.content : []).filter(b => b.type === 'tool_use')) }
  })
  const sorted = v => (v && typeof v === 'object' ? (Array.isArray(v) ? v.map(sorted) : Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])]))) : v)
  // dialogs besides the plan's and the release proposal every landing ends with; main's one clarify call (its tabs, ADR 0020) is not one of cadre's
  const qs = new Set(went.filter(b => b.name === 'AskUserQuestion').flatMap(b => (b.input?.questions ?? []).map(q => String(q.question ?? '').replace(/\s+/g, ' ').trim().slice(0, 40))))
  const others = drv.filter(e => e.kind === 'dialog' && !/^release /.test(e.text) && !qs.has(e.text.replace(/\s+/g, ' ').trim().slice(0, 40))).length
  const o = process.env.ORACLE
  if (o && !snaps.length && o !== 'underscore') fail(o, 'no store snapshots (scenarios/_lib.sh snapshots)')
  if (o === 'every') {   // every role in auto mode reaches a terminal run state; 0 ended{lost}; <= 1 dialog; no tool call repeated >= N in a row
    const all = Object.assign({}, ...snaps.map(x => runs(x.s)), ...hist.map(runs)), last = runs(snaps.at(-1)?.s ?? {}), N = +(process.env.ORACLE_REPEAT ?? 3)
    const gone = snaps.flatMap(x => Object.entries(runs(x.s)).filter(([, r]) => lost(r)).map(([a]) => a)), open = Object.entries(last).filter(([, r]) => r.state?.state !== 'ended')
    const roles = new Set(Object.values(all).map(r => r.role)), want = (process.env.ORACLE_ROLES ?? 'tester,worker,reviewer').split(',')
    stats.runs = Object.fromEntries(Object.entries(all).map(([a, r]) => [a, `${r.role}:${(r.log ?? []).map(x => x.state).join('>')}`]))
    if (gone.length) fail('every', `ended{lost}: ${[...new Set(gone)].join(', ')}`)
    if (open.length) fail('every', `not ended at the end: ${open.map(([a, r]) => `${r.role} ${a} ${r.state?.state}`).join(', ')}`)
    if (want.some(r => !roles.has(r))) fail('every', `roles never run: ${want.filter(r => !roles.has(r)).join(', ')} (ran: ${[...roles].join(', ')})`)
    if (others > 1) fail('every', `${others} dialogs besides the plan's and the release's: ${drv.filter(e => e.kind === 'dialog').map(e => e.text).join(' / ')}`)
    if (process.env.S) {   // an agent's hand-back prose is replaced before main reads it: main's own transcript has cadre's line, never the agent's words (the scripted agents hand back END)
      const mains = walk(join(dir, 'jsonl')).filter(f => f.endsWith('.jsonl') && !f.includes('/subagents/')).map(read).join('\n')
      if (!/This agent has stopped/.test(mains)) fail('every', 'main never read the replaced hand-back line (This agent has stopped)'); if (/The report follows:\\n\s+Done\. Stopping here\./.test(mains)) fail('every', "main read an agent's own hand-back prose")
    }
    for (const x of subs) { let n = 0, prev = ''; for (const u of x.uses) { const k = u.name + JSON.stringify(sorted(u.input)); n = k === prev ? n + 1 : 1; prev = k; if (n === N) fail('every', `${u.name} repeated ${N}x in a row in ${basename(x.f)}`) } }
  }
  if (o === 'forced') {   // an agent past its budget ends with 0 model tokens on the forced step, the engine logs a normal end, its turn.complete fires once
    const w0 = dlines.find(l => /SCRIPTED step agent=\S+ who=worker/.test(l)), w = w0?.match(/agent=(\S+)/)[1]
    const f = dlines.find(l => (!w0 || ts(l) > ts(w0)) && /cadre \(user\) answered turn\.step without next/.test(l))   // the worker's forced step (an earlier one is another agent's)
    if (!f) fail('forced', 'cadre never answered a request itself (no forced step)')
    else if (w) {
      const after = dlines.filter(l => ts(l) > ts(f)), tc = after.filter(l => l.includes(`SCRIPTED turn.complete agent=${w} `))
      if (after.some(l => l.includes(`SCRIPTED step agent=${w} `))) fail('forced', `the worker asked the model again after the forced step`)
      if (tc.length !== 1 || !/reason=answer/.test(tc[0] ?? '')) fail('forced', `worker turn.complete after the forced step: ${tc.length}x ${tc.map(l => l.match(/reason=\S+/)?.[0]).join(',')} (want 1x reason=answer)`)
    }
  }
  if (o === 'noreport') {   // a worker that stops without a report: one nudge, then it ends blocked; nothing it did is accepted; one dialog
    const all = Object.assign({}, ...snaps.map(x => runs(x.s)), ...hist.map(runs)), ws = Object.entries(all).filter(([, r]) => r.role === 'worker')
    stats.runs = Object.fromEntries(ws.map(([a, r]) => [a, (r.log ?? []).map(x => x.state).join('>')]))
    if (!ws.length) fail('noreport', 'no worker ran')
    for (const [a, r] of ws) {
      const st = (r.log ?? []).map(x => x.state), n = (r.log ?? []).filter(x => x.event === 'turn.end').length   // a nudge is a turn.end; other events logged while silent are not
      if (st.includes('idle-bound')) fail('noreport', `${a} was accepted without a report (idle-bound)`)
      if (n !== 1) fail('noreport', `${a} nudged ${n}x (want 1)`)
      if (r.state?.state !== 'ended' || r.state.cause !== 'blocked') fail('noreport', `${a} ends ${JSON.stringify(r.state)} (want ended blocked)`)
    }
    if (others > 1) fail('noreport', `${others} dialogs besides the plan's`)
  }
  if (o === 'underscore') {   // a repo folder with `_` (the file store's ids are c-<seq>-<n>): the cadre spawn resolves, 0 explorer spawns (main's clarify explorer aside)
    const ex = subs.filter(x => /Explorer brief/.test(x.brief)).length, wk = subs.filter(x => /Worker brief/.test(x.brief) && /TASK-[\w-]+/.test(x.brief)).length
    Object.assign(stats, { explorers: ex, workers: wk })
    if (ex > 1) fail('underscore', `${ex} explorers (main's one allowed)`)
    if (!wk) fail('underscore', 'no worker spawned in a repo folder with `_`')
  }
  if (o === 'holds') {   // the held scenario's test passed at red (its card line says so), the other failed, and nothing blocked
    const tr = subs.filter(x => /Tester brief/.test(x.brief)).flatMap(x => [...x.results.values()]).join('\n')
    if (!/\(S2 holds\)/.test(tr)) fail('holds', 'the red card never showed the held S2 test passing ("(S2 holds)")')
    if (!/red ✓ 1 failing/.test(tr)) fail('holds', 'the red card never showed exactly one failing test (S1)')
    if (drv.some(e => e.kind === 'dialog' && /flagged/.test(e.text))) fail('holds', 'a task flag raised a dialog')
  }
  if (o === 'flag-structured') {   // the spec-change dialog was answered (by its option key) and rejected: the worker was told, the task landed; main decided nothing
    if (!drv.some(e => e.kind === 'dialog' && /flagged spec_change/.test(e.text)) || !drv.some(e => e.kind === 'answer' && /flagged spec_change/.test(e.text))) fail('flag-structured', 'the spec_change dialog was never asked and answered')
    if (!subs.some(x => /Worker brief/.test(x.brief) && /spec change was rejected/.test(read(x.f)))) fail('flag-structured', 'the answer did not reject: the worker was never told the spec change was rejected')
    if (went.some(b => b.name === 'mcp__cadre__status' && (b.input?.choice || b.input?.args))) fail('flag-structured', 'main decided a flag the dialog owned')
  }
  if (o === 'gate-results') {   // the first try (a script writes the JUnit with an <error>) is refused as a tester round; the real runner's red holds (S1 fails, S2 held passes); nothing blocks
    const tr = subs.filter(x => /Tester brief/.test(x.brief)).flatMap(x => [...x.results.values()]).join('\n')
    if (!/errored instead of failing/.test(tr)) fail('gate-results', 'the error result was never refused as "errored instead of failing"')
    if (!/\(S2 holds\)/.test(tr) || !/red ✓ 1 failing/.test(tr)) fail('gate-results', 'the second try never reached red with S1 failing and the held S2 passing')
    if (drv.some(e => e.kind === 'dialog' && /flagged/.test(e.text))) fail('gate-results', 'a task flag raised a dialog (a gate error blocks; this cell has none)')
  }
  if (o === 'shape') {   // four malformed reports of one task: each refused for its form and counted on the task, the task still lands, nothing blocks
    const wk = subs.filter(x => /Worker brief/.test(x.brief)), n = wk.flatMap(x => [...x.results.values()]).filter(t => /malformed report \d+\/\d+/.test(t)).length
    Object.assign(stats, { shapeRefusals: n })
    if (n < 4) fail('shape', `${n} shape refusals reached the worker (want 4: the script sends four)`)
    if (drv.some(e => e.kind === 'dialog' && /flagged shape|malformed/.test(e.text))) fail('shape', 'the task blocked on malformed reports (a dialog flagged shape)')
  }
  if (o === 'specifier-off') {   // roles.specifier.enabled is off by default: no specifier is spawned, and the task still runs
    const sp = subs.filter(x => /Specifier brief/.test(x.brief)).length
    Object.assign(stats, { specifiers: sp })
    if (sp) fail(o, `${sp} specifier spawn(s) with the specifier off`)
    if (!subs.some(x => /Worker brief/.test(x.brief))) fail(o, 'no worker ran')
  }
  if (o === 'docs-task') {   // a docs task runs worker > reviewer > merge: no tester, no red; it lands as a docs commit and adds no changelog entry
    const log = read(join(dir, 'dev-log')).split('\n').filter(Boolean), roles = x => subs.filter(s => new RegExp(`${x} brief`).test(s.brief)).length
    Object.assign(stats, { devLog: log, testers: roles('Tester'), workers: roles('Worker'), reviewers: roles('Reviewer') })
    if (!roles('Worker') || !roles('Reviewer')) fail(o, `worker ${roles('Worker')}x, reviewer ${roles('Reviewer')}x (want both)`)
    if (roles('Tester')) fail(o, `${roles('Tester')} tester run(s) on a docs task`)
    if (!log.some(l => /^docs(\(|:)/.test(l))) fail(o, `no docs commit on dev: ${log.join(' | ') || 'dev has none'}`)
    if (log.some(l => /^(feat|fix|refactor)(\(|:)/.test(l))) fail(o, `a code commit on dev: ${log.find(l => /^(feat|fix|refactor)(\(|:)/.test(l))}`)
    if (/usage/i.test(read(join(dir, 'dev-changelog')))) fail(o, 'the changelog has an entry for a docs task (its changelog decision is none)')
    if (runs(snaps.at(-1)?.s ?? {}) && Object.values(Object.assign({}, ...snaps.map(x => runs(x.s)), ...hist.map(runs))).some(r => r.role === 'tester')) fail(o, 'a tester run record exists')
  }
  if (o === 'fold-vs-keep') {   // one run of an arm of the A1 check: what it counts is read by harness/fold-vs-keep.mjs; the arm's own setting must show in the spawns
    const rw = {}; for (const s of [...snaps.map(x => x.s), ...hist]) for (const [id, b] of Object.entries(pick(s, 'budget'))) rw[id] = Math.max(rw[id] ?? 0, b.rework ?? 0)   // a closed task's budget is pruned: the largest image seen
    const sp = subs.filter(x => /Specifier brief/.test(x.brief)).length, arm = process.env.ARM
    stats.foldKeep = { arm, landed: +read(join(dir, 'dev-commits')).trim() || 0, rework: Object.values(rw).reduce((a, b) => a + b, 0), dialogs: others, specifiers: sp }
    if (arm === 'kept' && !sp) fail(o, 'the kept arm ran no specifier')
    if (arm === 'folded' && sp) fail(o, `the folded arm ran ${sp} specifier(s)`)
  }
  if (o === 'limit') {   // the band shows resetAt; the task budget unchanged; after the reset exactly one spawn
    const hit = read(join(dir, 'stubbed.jsonl')).split('\n').filter(l => l.includes('"usage_limit"')).map(l => JSON.parse(l).at)
    if (!hit.length) fail('limit', 'the usage limit was never injected')
    else {
      const t0 = hit[0], b = x => pick(x.s, 'budget'), before = snaps.filter(x => x.t < t0).map(b).at(-1) ?? {}, after = snaps.filter(x => x.t > t0).map(b).filter(m => Object.keys(m).length).at(-1) ?? {}
      const drift = Object.keys(before).flatMap(id => Object.keys(before[id]).filter(k => k !== 'epoch' && after[id] && after[id][k] !== before[id][k]).map(k => `${id}.${k} ${before[id][k]}->${after[id][k]}`))
      const shown = panes.some(p => p.t > t0 && /limit[^\n]*\b\d{1,2}:\d{2}\b/i.test(band(p.text))), spawns = subs.filter(x => /Worker brief/.test(x.brief) && x.t > t0).length
      Object.assign(stats, { limitHits: hit.length, spawnsAfter: spawns })
      if (!shown) fail('limit', 'the band never showed the reset time')
      if (drift.length) fail('limit', `the limit charged the budget: ${drift.join(', ')}`)
      if (spawns !== 1) fail('limit', `${spawns} worker spawns after the limit (want 1)`)
    }
  }
  if (o === 'devmoved') {   // a user commit on dev mid-run: running branches rebased, the user's files byte-identical, <= 1 dialog
    const d = existsSync(join(dir, 'devmoved.json')) ? JSON.parse(read(join(dir, 'devmoved.json'))) : null
    if (!d) fail('devmoved', 'the user commit never happened (the worker never started)')
    else {
      stats.devmoved = d
      if (!d.reachable) fail('devmoved', `the user's commit ${d.sha.slice(0, 7)} is not on dev`)
      if (d.onDev !== d.sum || d.file !== d.sum) fail('devmoved', `USER.md changed (dev ${d.onDev}, checkout ${d.file}, written ${d.sum})`)
      const dirty = d.status.split(';').filter(l => l && !/ \.cadre\//.test(l)).join(';')   // cadre's own state dir aside
      if (dirty) fail('devmoved', `the user's checkout (${d.head}) is dirty after the landing: ${dirty}`)
    }
    if (others > 1) fail('devmoved', `${others} dialogs besides the plan's`)
  }
  if (o === 'clear') {   // records after /clear: kept or lost (the result sets the /clear handling); fails only without evidence
    const t = drv.find(e => e.kind === 'send' && e.text.trim() === '/clear')?.t
    const live = t && Object.entries(runs(snaps.filter(x => x.t < t).at(-1)?.s ?? {})).filter(([, r]) => r.state?.state !== 'ended').map(([a]) => a)
    if (!live?.length) fail('clear', t ? 'no agent was running at /clear' : 'no /clear sent')
    else {
      const later = snaps.filter(x => x.t > t).map(x => runs(x.s)), fate = a => (later.some(m => m[a] && lost(m[a])) ? 'lost' : later.some(m => m[a]) ? 'kept' : 'gone')
      stats.clear = Object.fromEntries(live.map(a => [a, fate(a)]))
    }
  }
  // the 0.15 cells: main plans only with cadre's tools (plan-tools-lite, plan-tools-full)
  if (o === 'plantools' || o === 'plantools-full') {   // lite: a plan, worker and reviewer ran; full: >= 2 tasks, a stale amend refused then retried, one explorer; both: no Task*, no Agent by main
    const n = t => went.filter(b => b.name === `mcp__cadre__${t}`).length, banned = mine.filter(b => /^(Task(Create|Get|List|Update)|Agent)$/.test(b.name))
    const am = mine.filter(b => b.name === 'mcp__cadre__amend'), role = r => subs.filter(x => new RegExp(`${r} brief`).test(x.brief)).length
    Object.assign(stats, { plans: n('plan'), tasks: n('task'), amends: am.map(b => (b.ok ? 'ok' : 'refused')).join(','), explores: n('explore'), workers: role('Worker'), reviewers: role('Reviewer') })
    if (banned.length) fail(o, `main called ${[...new Set(banned.map(b => b.name))].join(', ')}`)
    if (!n('plan')) fail(o, 'main drafted no plan with the plan tool')
    if (!role('Worker') || !role('Reviewer')) fail(o, `workers ${role('Worker')}, reviewers ${role('Reviewer')} (want both)`)
    if (o === 'plantools-full') {
      const stale = am.findIndex(b => !b.ok && /expectedRevision/.test(b.text))
      if (n('task') < 2) fail(o, `${n('task')} tasks drafted (want >= 2)`)
      if (stale < 0 || !am.slice(stale + 1).some(b => b.ok)) fail(o, `amends ${stats.amends || 'none'} (want a stale one refused, then one that went through)`)
      if (n('explore') !== 1) fail(o, `${n('explore')} explorers (want 1)`)
      if (role('Tester') < 2) fail(o, `${role('Tester')} testers (want one per task)`)
    }
  }
  if (o === 'surface') {   // under the task-tool gate: the report tool and TodoWrite listed, no task-list tool; main's Agent refused; the spawned agent ends
    const l = dlines.find(l => /SCRIPTED tools \[/.test(l)), names = l ? JSON.parse(l.slice(l.indexOf('SCRIPTED tools ') + 15)) : null
    const sp = dlines.find(l => /SCRIPTED spawned tools -> /.test(l))?.match(/"agentId":"([^"]+)"/)?.[1], ag = mine.filter(b => b.name === 'Agent')
    Object.assign(stats, { tools: names, agent: sp ?? null, mainAgent: ag.map(b => (b.ok ? 'ran' : 'refused')).join(','), taskStop: clip(dlines.find(l => /SCRIPTED TaskStop /.test(l))?.split('SCRIPTED ')[1] ?? '') })
    if (!names) fail(o, 'no tool list logged (/s0 tools)')
    else { const miss = ['mcp__cadre__report', 'TodoWrite'].filter(t => !names.includes(t)), task = names.filter(t => /^Task(Create|Get|List|Update)$/.test(t))
      if (miss.length) fail(o, `not listed: ${miss.join(', ')}`); if (task.length) fail(o, `task-list tools listed: ${task.join(', ')}`) }
    if (ag.length !== 1 || ag[0].ok) fail(o, `main's Agent calls: ${stats.mainAgent || 'none'} (want one, refused)`)
    if (!sp) fail(o, 'the spawn returned no agent id')
    else if (!dlines.some(l => l.includes(`SCRIPTED turn.complete agent=${sp} `))) fail(o, `the spawned agent ${sp} never ended`)
  }
  if (o === 'continue') {   // a kill between the worker and the reviewer, then /cadre continue: the same task goes on; no worker after the kill; one reviewer after it
    const k = drv.find(e => e.kind === 'fault' && /^kill/.test(e.text))?.t, task = b => b.match(/TASK-([a-z][\w-]*\w)/)?.[1]
    const ws = subs.filter(x => /Worker brief/.test(x.brief)), rv = subs.filter(x => /Reviewer brief/.test(x.brief) && x.t > k)
    Object.assign(stats, { workers: ws.length, reviewersAfter: rv.length, tasks: [...new Set([...ws, ...rv].map(x => task(x.brief)))] })
    if (!k) fail(o, 'the kill never happened (the worker never ended)')
    else {
      if (ws.length !== 1) fail(o, `${ws.length} worker runs (want 1: the work was done before the kill)`)
      if (rv.length !== 1) fail(o, `${rv.length} reviewer runs after the restart (want 1)`)
      else if (ws.length && task(rv[0].brief) !== task(ws[0].brief)) fail(o, `the reviewer after the restart works on ${task(rv[0].brief)}, the worker did ${task(ws[0].brief)}`)
      if (!drv.some(e => e.kind === 'send' && e.t > k && /\/cadre continue/.test(e.text))) fail(o, 'no /cadre continue after the restart')
    }
  }
  if (o === 'profile-docs') {   // the built-in docs profile: writer > critic > landing; no tester, no worker, no reviewer, no check, no changelog entry; it lands as a docs commit
    const log = read(join(dir, 'dev-log')).split('\n').filter(Boolean), roles = x => subs.filter(s => new RegExp(`${x} brief`).test(s.brief)).length
    Object.assign(stats, { devLog: log, writers: roles('Writer'), critics: roles('Critic'), defaults: roles('Tester') + roles('Worker') + roles('Reviewer') })
    if (!roles('Writer') || !roles('Critic')) fail(o, `writer ${roles('Writer')}x, critic ${roles('Critic')}x (want both)`)
    if (roles('Tester') + roles('Worker') + roles('Reviewer')) fail(o, 'an agent of the default profile ran under the docs profile')
    if (!log.some(l => /^docs(\(|:)/.test(l))) fail(o, `no docs commit on dev: ${log.join(' | ') || 'dev has none'}`)
    if (/usage/i.test(read(join(dir, 'dev-changelog')))) fail(o, 'the changelog has an entry for a doc task (this profile has no changelog)')
    if (runs(snaps.at(-1)?.s ?? {}) && Object.values(Object.assign({}, ...snaps.map(x => runs(x.s)), ...hist.map(runs))).some(r => ['tester', 'worker', 'reviewer'].includes(r.role))) fail(o, 'a run record of a default-profile role exists')
  }
  if (o === 'profile-invalid') {   // a refused repo profile: cadre is dormant for the repo: the refusal line is shown, /cadre profile says it stays off, Doctor reports a failing row, no agent ran
    const screens = panes.map(p => left(p.text).replace(/\s+/g, ' ')), shown = screens.filter(x => /repo profile: colour: unknown key/.test(x)).length
    Object.assign(stats, { agents: subs.length, refusalShown: shown, profile: screens.some(x => /repo profile invalid: colour: unknown key.*cadre stays off for this repo/.test(x)), doctor: screens.some(x => /doctor: [1-9]\d* fail/.test(x)) })
    if (!shown) fail(o, 'the refusal line `repo profile: colour: unknown key` was never shown')
    if (!stats.profile) fail(o, '/cadre profile does not say `repo profile invalid: colour: unknown key` and that cadre stays off for this repo')
    if (!stats.doctor) fail(o, 'Doctor reports no failing row')
    if (subs.length || dlines.some(l => /agent\.spawn cadre:/.test(l))) fail(o, 'an agent ran in a repo whose profile is refused')
  }
  if (o === 'custom-role') {   // the user's read-only auditor: ONE register before the spawn, spawned as cadre:auditor from a later turn, it answers by report, one terminal state
    const at = re => dlines.findIndex(l => re.test(l)), reg = dlines.filter(l => /\$\.agent\.register \(cadre\): cadre:auditor/.test(l)), sp = dlines.filter(l => /agent\.spawn cadre:auditor/.test(l))
    const done = dlines.filter(l => /\[Stall\] agent_completion .*agentType=cadre:auditor/.test(l)), id = done[0]?.match(/agentId=(\w+)/)?.[1] ?? '', rep = dlines.filter(l => id && l.includes(`SCRIPTED step agent=${id} `) && /tool mcp__cadre__report/.test(l))
    Object.assign(stats, { registers: reg.length, spawns: sp.length, completions: done.length, reports: rep.length })
    if (reg.length !== 1) fail(o, `${reg.length} agent.register of auditor (want 1)`)
    else if (sp.length !== 1) fail(o, `${sp.length} spawn(s) as cadre:auditor (want 1)`)
    else if (at(/\$\.agent\.register \(cadre\): cadre:auditor/) > at(/agent\.spawn cadre:auditor/)) fail(o, 'the spawn came before the register')
    else if (done.length !== 1 || !/exitPath=completed/.test(done[0])) fail(o, `${done.length} terminal state(s) of the auditor: ${done.join(' | ').slice(0, 200)} (want 1, completed)`)
    else if (rep.length !== 1) fail(o, `the auditor called report ${rep.length}x (want 1)`)
    if (dlines.some(l => /\bspawn refused|hook failed|ended\{lost\}/.test(l))) fail(o, `a refusal or failure line: ${dlines.find(l => /\bspawn refused|hook failed/.test(l))}`)
  }
  if (o === 'gate') {   // a model the gate refuses: the drive never starts, so no task agent runs and no model request follows; Doctor names the cell once
    const agents = subs.filter(x => /(Worker|Tester|Reviewer) brief/.test(x.brief)), steps = dlines.filter(l => /SCRIPTED step agent=\S+ who=(worker|tester|reviewer)/.test(l)).length
    const row = /drive stopped: roles\.worker\.byRisk\.light\.model: unknown model "gpt-5"/g, doc = panes.map(p => left(p.text).replace(/\s+/g, ' ')).findLast(x => row.test(x)), n = doc ? (doc.match(row) ?? []).length : 0
    Object.assign(stats, { agents: agents.length, agentSteps: steps, doctorLines: n })
    if (agents.length || steps) fail(o, `${agents.length} task agent(s) ran, ${steps} model step(s) (want 0)`)
    if (n !== 1) fail(o, `Doctor names the cell ${n}x (want 1)`)
  }
  if (o === 'revert') {   // /cadre revert <epic> after the landing: both confirms asked, the epic's files gone from dev, only the recorded branches removed, no protected-ref violation
    const r = existsSync(join(dir, 'revert.json')) ? JSON.parse(read(join(dir, 'revert.json'))) : null, heads = read(join(dir, 'refs-after')).split('\n').map(l => l.split(' ')[0]), say = drv.filter(e => e.kind === 'dialog').map(e => e.text)
    if (!r) fail(o, 'the cell never reached the revert (no revert.json)')
    else {
      Object.assign(stats, { epic: r.epic, files: r.files, dialogs: say.filter(x => /revert/i.test(x)).length })
      if (!r.files.length) fail(o, 'the epic added no file to revert')
      for (const f of r.files) if (r.devTree.includes(f)) fail(o, `${f} is still on dev after the revert`)
      if (say.filter(x => /revert/i.test(x)).length < 2) fail(o, `${say.filter(x => /revert/i.test(x)).length} revert dialog(s) (want the card and the second confirm): ${say.join(' / ')}`)
      if (heads.includes(r.taskBranch)) fail(o, `the recorded branch ${r.taskBranch} is still there`)
      for (const b of ['epic/zz-decoy', 'feat/zz-unrecorded']) if (!heads.includes(b)) fail(o, `${b} (never recorded) was removed`)
      if (heads.some(b => b.startsWith('revert/'))) fail(o, `a revert branch is left: ${heads.filter(b => b.startsWith('revert/')).join(' ')}`)
    }
    const bad = [...say, ...panes.map(p => p.text)].find(x => /moved outside a cadre merge|git:(dev|main)\b/.test(x)); if (bad) fail(o, `the effect audit flagged a protected ref: ${clip(bad)}`)
  }
  if (o === 'fifo') {   // concurrency.default 1, two tasks: the workers start in the order the tasks were admitted (ids ascend), and no snapshot shows two tasks running
    const id = b => b.match(/TASK-([a-z][\w-]*\w)/)?.[1], ws = subs.filter(x => /Worker brief/.test(x.brief) && id(x.brief)).sort((a, b) => a.t - b.t).map(x => id(x.brief))
    const two = snaps.find(x => new Set(Object.values(runs(x.s)).filter(r => ['running', 'refused', 'silent'].includes(r.state?.state)).map(r => r.taskId)).size > 1)
    Object.assign(stats, { workerOrder: ws })
    if (ws.length !== 2) fail(o, `${ws.length} worker runs (want 2, one per task)`)
    else if (ws.join() !== [...ws].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).join()) fail(o, `workers started in the order ${ws.join(', ')} (want the admit order)`)
    if (two) fail(o, `two tasks ran at once in the snapshot at ${two.t}`)
  }
  if (o === 'lessons') {   // the side-model pass: ONE request (haiku, 800 tokens) answered by the stub, one lesson with evidence, and every brief after it carries the lesson
    const reqs = read(join(dir, 'stubbed.jsonl')).split('\n').filter(l => l.includes('"lessons_pass"')).map(l => JSON.parse(l)), LESSON = /Run the project's tests before you report\./
    const briefs = subs.filter(x => /(Worker|Tester|Reviewer) brief/.test(x.brief)).sort((a, b) => a.t - b.t), after = briefs.filter(x => x.t > (reqs[0]?.at ?? Infinity)), carry = briefs.filter(x => LESSON.test(x.brief))
    Object.assign(stats, { requests: reqs.length, briefs: briefs.length, briefsAfter: after.length, briefsWithLesson: carry.length, model: reqs[0]?.model, maxTokens: reqs[0]?.max_tokens })
    if (reqs.length !== 1) fail(o, `${reqs.length} lesson request(s) (want 1)`)
    else if (!(reqs[0].max_tokens >= 800 && reqs[0].max_tokens <= 800 + 2048) ||   // the engine adds a 2048-token thinking allowance to the 800 asked (measured: 2848)
       !/haiku/.test(reqs[0].model ?? '')) fail(o, `the request was ${reqs[0].model} max_tokens ${reqs[0].max_tokens} (want haiku, 800 + the engine's 2048)`)
    else if (!after.length || after.some(x => !LESSON.test(x.brief))) fail(o, `${after.length} brief(s) after the pass, ${carry.length} carry the lesson (want every one)`)
  }
}
stats.usd = +debug.map(ls => Math.max(0, ...ls.map(l => +(l.match(/cost=\$([\d.]+)/)?.[1] ?? 0)))).reduce((a, b) => a + b, 0).toFixed(2)
stats.secs = Math.round((tEnd - (drv[0]?.t ?? tEnd)) / 1000)
// A real 429 that ended the cell: cadre's own stop toast (drive stopped · usage limit until) AND a debug line whose JSON error type is rate_limit_error, with no usage_limit
// injected by the stub (the usage-limit S cell expects that toast). A cell with a failed invariant is a FAIL whatever the 429; otherwise it judged nothing about cadre: inconclusive, rerun it. Harness-side only.
const real429 = dlines.some(l => { try { return JSON.parse(l.slice(l.indexOf('{'))).error?.type === 'rate_limit_error' } catch { return false } })
const inconclusive = !fails.length && real429 && !read(join(dir, 'stubbed.jsonl')).includes('"usage_limit"') && (/drive stopped · usage limit until/.test(dlines.join('\n')) || panes.some(p => /drive stopped · usage limit until/.test(p.text)))
const cell = basename(dir), v = { cell, pass: !fails.length && !inconclusive, inconclusive, fails, stats, setup: drv[0]?.text }
writeFileSync(join(dir, 'verdict.json'), JSON.stringify(v, null, 1))
console.log(`${cell} ${v.pass ? 'PASS' : inconclusive ? 'INCONCLUSIVE a real 429 stopped the drive; rerun' : `FAIL ${fails[0].invariant}: ${fails[0].evidence}`}`)
process.exit(v.pass ? 0 : 1)
