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
const debug = readdirSync(dir).filter(f => /^debug.*\.log$/.test(f)).sort().map(f => read(join(dir, f)).split('\n'))
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
for (const e of drv.filter(e => e.kind === 'press1')) {
  const ok = panes.some(p => p.t >= e.t && p.t <= e.t + 7000 && isDialog(p.text)) || asks.some(t => t >= e.t - 500 && t <= e.t + 5000)
  if (!ok) fail('press1-no-dialog', `pressed 1 on "${e.text}", no dialog within 5 s`)
}
// 3. no refusal repeated >= 3 times with the same text (tool calls refused, Claude's stop refused)
{
  const n = new Map()
  for (const f of walk(join(dir, 'jsonl')).filter(f => f.endsWith('.jsonl'))) for (const l of read(f).split('\n').filter(Boolean)) {
    let d; try { d = JSON.parse(l) } catch { continue }
    const c = d.type === 'user' ? d.message?.content : undefined
    const texts = typeof c === 'string' ? (c.startsWith('Stop hook feedback') ? [c] : [])
      : Array.isArray(c) ? c.filter(b => b.type === 'tool_result' && b.is_error).map(b => (typeof b.content === 'string' ? b.content : JSON.stringify(b.content))) : []
    for (const t of texts) n.set(t, (n.get(t) ?? 0) + 1)
  }
  const [t, k] = [...n].sort((a, b) => b[1] - a[1])[0] ?? ['', 0]
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
  const hit = dlines.find(l => bad.test(l)) ?? panes.map(p => p.text.split('\n').find(l => bad.test(l))).find(Boolean)
  if (hit) fail('errors', hit.replace(/^\S+ \[\w+\] /, ''))
}
// 6. the goal reaches the plan dialog within the turn and dialog budget
{
  const plan = drv.find(e => e.kind === 'plan'), until = plan?.t ?? tEnd
  // a fault the cell injected (FAULT=interrupt|kill) earns the setup's one recovery dialog ("… stopped …")
  const faulted = drv.some(e => e.kind === 'fault'), budget = DIALOGS + (faulted && drv.some(e => e.kind === 'dialog' && /stopped/.test(e.text)) ? 1 : 0)
  const dialogs = drv.filter(e => e.kind === 'dialog' && e.t < until).length + (plan ? 1 : 0)
  const nTurns = turns.filter(([a]) => a < until).length
  Object.assign(stats, { plan: !!plan, dialogs, turns: nTurns, secsToPlan: plan ? Math.round((plan.t - drv[0].t) / 1000) : null })
  if (!plan) fail('no-plan', `no plan dialog in ${Math.round((tEnd - drv[0].t) / 1000)} s; last screen: ${band(panes.at(-1)?.text ?? '').split('\n').filter(l => l.trim() && !/^─/.test(l)).slice(-3).join(' | ')}`)
  else { if (dialogs > budget) fail('dialog-budget', `${dialogs} dialogs before the plan (budget ${budget}): ${drv.filter(e => e.kind === 'dialog' && e.t < until).map(e => e.text).join(' / ')}`)
         if (nTurns > TURNS) fail('turn-budget', `${nTurns} turns before the plan (budget ${TURNS})`) }
}
// 7. cadre's state lives at the repo top level only (a .cadre/ or .beads/ below it = the root followed main's shell)
{ const s = read(join(dir, 'stray-state')).trim(); if (s) fail('wrong-root', `state written below the repo root: ${s.split('\n').join(', ')}`) }
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
    .filter(r => !src.length || src.some(([t, s]) => Math.abs(t - r.at) < 300 && s === `agent:custom:cadre:${r.role}`))
    .filter(r => r.role !== 'main')
  if (req.length) {
    const repo = dirname(dirname(new URL(import.meta.url).pathname)), exp = JSON.parse(execFileSync(process.execPath, ['--experimental-transform-types', '--no-warnings', '--import', `${repo}/tests/dev/register.mjs`, `${repo}/harness/expect-routing.mjs`, repo, join(dir, 'cadre-config.json')], { encoding: 'utf8' }))
    const bad = req.filter(r => { const e = exp[r.role]; return e && (!e.models.some(m => r.model?.includes(m)) || (e.efforts.length && !e.efforts.includes(r.output_config?.effort))) })
    stats.routing = Object.fromEntries(Object.keys(exp).map(k => [k, [...new Set(req.filter(r => r.role === k).map(r => `${r.model}/${r.output_config?.effort ?? '-'}`))]]))
    if (bad.length) fail('routing', `${bad.length} request(s) off the settings, e.g. ${bad[0].role} on ${bad[0].model}/${bad[0].output_config?.effort ?? '-'} (allowed ${JSON.stringify(exp[bad[0].role])})`)
  }
}
// 13. optional (EPIC_PLANNERS=N, the milestone cells): N epic plans came from planner agents (their report was accepted) and main drafted no epic's tasks
{
  const n = +(process.env.EPIC_PLANNERS ?? 0), js = walk(join(dir, 'jsonl')).filter(f => f.endsWith('.jsonl'))
  if (n) {
    const ok = js.filter(f => /plan accepted: \d+ tasks approved/.test(read(f))).length, own = js.filter(f => !f.includes('/subagents/')).flatMap(f => read(f).split('\n')).find(l => l.includes('"name":"TaskCreate"') && /\\?"epic\\?":\s*\\?"/.test(l))
    stats.planners = ok
    if (ok < n) fail('epic-planner', `${ok} of ${n} epic plans came from a planner agent`)
    if (own) fail('epic-planner', `main drafted an epic's tasks: ${own.match(/"subject":"[^"]*"/)?.[0] ?? 'TaskCreate with metadata.epic'}`)
  }
}
// 12. clarify (CLARIFY=ask|none|assumed|deep): main's own calls before the plan, from its transcript (not the agents'): one explorer (Agent type Explore);
//     ask: one AskUserQuestion that went through, 1-3 questions; none: no question; assumed: no question and the plan dialog lists "assumed:"; deep: 1-8 questions, one per call
if (process.env.CLARIFY) {
  const ok = new Map(), calls = []
  for (const f of walk(join(dir, 'jsonl')).filter(f => f.endsWith('.jsonl') && !f.includes('/subagents/'))) for (const l of read(f).split('\n').filter(Boolean)) {
    let d; try { d = JSON.parse(l) } catch { continue }
    const c = d.message?.content; if (!Array.isArray(c)) continue
    if (d.type === 'assistant') for (const b of c) if (b.type === 'tool_use') calls.push(b)
    if (d.type === 'user') for (const b of c) if (b.type === 'tool_result') ok.set(b.tool_use_id, !b.is_error)
  }
  const went = calls.filter(b => ok.get(b.id)), explore = went.filter(b => b.name === 'Agent' && b.input?.subagent_type === 'Explore').length
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
stats.usd = +debug.map(ls => Math.max(0, ...ls.map(l => +(l.match(/cost=\$([\d.]+)/)?.[1] ?? 0)))).reduce((a, b) => a + b, 0).toFixed(2)
stats.secs = Math.round((tEnd - (drv[0]?.t ?? tEnd)) / 1000)
const cell = basename(dir), v = { cell, pass: !fails.length, fails, stats, setup: drv[0]?.text }
writeFileSync(join(dir, 'verdict.json'), JSON.stringify(v, null, 1))
console.log(`${cell} ${v.pass ? 'PASS' : `FAIL ${fails[0].invariant}: ${fails[0].evidence}`}`)
process.exit(v.pass ? 0 : 1)
