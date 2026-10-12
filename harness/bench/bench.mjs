#!/usr/bin/env node
// Model x effort bench: expand a grid into runs + estimate, judge one run from its evidence, aggregate a results table. See harness/bench/README.md.
//   node bench.mjs plan <grid.json>          -> one line per run: <cell>|<task>|<k>|<roles json>  (stdout), estimate (stderr)
//   node bench.mjs judge <run dir>           -> <run dir>/result.json
//   node bench.mjs table <bench dir> [--md]  -> results per tier x cell
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, cpSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'

const B = new URL('.', import.meta.url).pathname, [cmd, arg] = process.argv.slice(2)
const read = f => (existsSync(f) ? readFileSync(f, 'utf8') : '')
const walk = d => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap(f => (f.isDirectory() ? (['work', 'plug', '.git'].includes(f.name) ? [] : walk(join(d, f.name))) : f.isFile() ? [join(d, f.name)] : [])) : [])   // skips symlinks and the run's repo copies
const plans = Object.fromEntries(readdirSync(join(B, 'tasks')).map(t => [t, JSON.parse(read(join(B, 'tasks', t, 'plan.json')))]))

// official 5.5 prices, $ per Mtok: in, out; cache read multiplier; writes 5m 1.25x, 1h 2x the input price
const PRICE = { opus: [4, 20, 0.05], sonnet: [2, 10, 0.05], haiku: [0.1, 0.5, 0.1] }
const fam = m => (/opus/.test(m) ? 'opus' : /haiku/.test(m) ? 'haiku' : 'sonnet')
const usd = (m, u) => { const [i, o, r] = PRICE[fam(m)]; return (u.in * i + u.out * o + u.cr * i * r + u.cw5 * i * 1.25 + u.cw1h * i * 2) / 1e6 }

// ---- plan: grid -> runs ----
const tag = r => r ? `${r.tier}.${r.effort ?? 'default'}${r.escalate?.after ? `+esc.${r.escalate.to}` : ''}` : '-'
const role = r => ({ tier: r.tier, effort: r.effort ?? 'default', ...(r.escalate ? { escalate: r.escalate } : {}) })
// rough $ per task by role and model (calibrate from a smoke run: README); main dominates
const EST = { main: 0.45, worker: { haiku: 0.06, sonnet: 0.3, opus: 0.8 }, tester: { haiku: 0.04, sonnet: 0.18, opus: 0.5 }, reviewer: { haiku: 0.04, sonnet: 0.15, opus: 0.45 } }
const EFF = { low: 0.6, medium: 0.8, high: 1, xhigh: 1.4, max: 1.8, default: 1 }
if (cmd === 'plan') {
  const g = JSON.parse(read(arg)), tasks = Object.entries(plans).filter(([t, p]) => g.tiers.includes(p.tier) && (!g.only || g.only.includes(t)))
  const cells = []
  for (const w of g.workers) for (const t of g.testers) for (const r of g.reviewers) {
    const w2 = w.tier === 'haiku' && g.escalateHaiku !== false && !w.escalate ? { ...w, escalate: { after: 1, to: 'sonnet' } } : w
    cells.push({ name: `w-${tag(w2)}_t-${tag(t)}_r-${tag(r)}`, roles: { worker: role(w2), tester: role(t), reviewer: role(r) } })
  }
  let usdSum = 0, min = 0, n = 0
  for (const c of cells) for (const [t, p] of tasks) for (let k = 1; k <= (g.n ?? 3); k++) {
    console.log(`${c.name}|${t}|${k}|${JSON.stringify(c.roles)}`); n++
    const per = EST.main + ['worker', 'tester', 'reviewer'].reduce((a, x) => a + EST[x][c.roles[x].tier] * EFF[c.roles[x].effort], 0)
    usdSum += per * p.tasks.length; min += 8 * p.tasks.length
  }
  const j = +(process.env.J ?? 4)
  console.error(`${cells.length} cells x ${tasks.length} tasks x N=${g.n ?? 3} = ${n} runs · about US$${Math.round(usdSum * 0.7)}-${Math.round(usdSum * 1.3)} · about ${Math.round(min / j / 60 * 10) / 10} h with -j ${j} (${Math.round(min / 60)} h serial)`)
}

// ---- judge one run dir: work/ (the repo), projects/ (transcripts), meta.json (cell, task, k, t0, t1, exit) ----
function judge(dir) {
  const m = JSON.parse(read(join(dir, 'meta.json'))), p = plans[m.task], work = join(dir, 'work'), env = { ...process.env, BEADS_DIR: join(work, '.cadre/store') }
  const sh = (c, a, o = {}) => { try { return execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env, ...o }) } catch { return null } }
  const ids = JSON.parse(read(join(dir, 'scaffold.json')) || '{}').tasks ?? {}, epicBranch = JSON.parse(read(join(dir, 'scaffold.json')) || '{}').epicBranch
  // tokens + $ by role from every transcript; a streamed message repeats its id: keep the last usage per id
  const byRole = {}, rejections = []
  for (const f of walk(join(dir, 'projects')).filter(f => f.endsWith('.jsonl'))) {
    const lines = read(f).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    const first = lines.find(l => l.type === 'user')?.message?.content, text = typeof first === 'string' ? first : Array.isArray(first) ? first.map(b => b.text ?? '').join('') : ''
    const at = (() => { try { return JSON.parse(read(f.replace(/\.jsonl$/, '.meta.json'))).agentType ?? '' } catch { return '' } })()   // cadre:<role>; the brief's first words as a fallback
    const r = !/subagents/.test(f) ? 'main' : (at.match(/^cadre:(\w+)/)?.[1] ?? text.match(/^(Tester|Worker|Reviewer|Explorer) brief/)?.[1]?.toLowerCase() ?? 'other')
    const last = new Map()
    for (const l of lines) if (l.type === 'assistant' && l.message?.usage) last.set(l.message.id ?? l.uuid, l.message)
    for (const msg of last.values()) {
      const u = msg.usage, cw1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0, cw5 = u.cache_creation ? u.cache_creation.ephemeral_5m_input_tokens ?? 0 : u.cache_creation_input_tokens ?? 0
      const k = `${r}:${fam(msg.model ?? '')}`, a = (byRole[k] ??= { in: 0, out: 0, cr: 0, cw5: 0, cw1h: 0, usd: 0 })
      const x = { in: u.input_tokens ?? 0, out: u.output_tokens ?? 0, cr: u.cache_read_input_tokens ?? 0, cw5, cw1h }
      for (const q of Object.keys(x)) a[q] += x[q]; a.usd += usd(msg.model ?? '', x)
    }
    if (r === 'reviewer') for (const l of lines) for (const b of (Array.isArray(l.message?.content) ? l.message.content : [])) {
      if (b.type === 'tool_use' && /report$/.test(b.name) && b.input?.verdict === 'changes') rejections.push((b.input.findings ?? []).map(x => x.issue).filter(Boolean).slice(0, 3).join(' | ') || b.input.summary || 'changes')
    }
  }
  // per task: store status + meta, then the hidden check on the epic branch tip
  // the epic branch while the plan runs; once the plan landed the branch is gone and dev holds it
  let tip = null; const ref = [epicBranch, 'dev'].find(b => b && sh('git', ['-C', work, 'rev-parse', '--verify', '-q', b]))
  if (ref) {
    tip = mkdtempSync(join(tmpdir(), 'bench-tip-')); execFileSync('bash', ['-c', `git -C '${work}' archive '${ref}' | tar -x -C '${tip}'`]); cpSync(join(B, 'tasks', m.task, 'check.test.mjs'), join(tip, 'test', 'zz-bench-check.test.mjs'))
  }
  const multi = p.tasks.length > 1
  const tasks = p.tasks.map(t => {
    const id = ids[t.key], j = JSON.parse(sh('bd', ['show', id, '--json']) ?? 'null'), x = (Array.isArray(j?.data ?? j) ? (j.data ?? j)[0] : j?.data ?? j) ?? {}, meta = x.metadata ?? {}
    const runs = (() => { try { return JSON.parse(meta['cadre.runs'] ?? '[]') } catch { return [] } })(), rework = (+meta['cadre.rework'] || 0) + (+meta['cadre.rebase'] || 0)
    const check = tip ? sh('node', ['--test', ...(multi ? [`--test-name-pattern=^${t.key}\\.`] : []), 'test/zz-bench-check.test.mjs'], { cwd: tip }) !== null : false
    const closed = x.status === 'closed', landed = closed && check
    return { key: t.key, id, status: x.status ?? 'missing', closed, check, landed, rework, workerRuns: runs.filter(r => r.role === 'worker').length, escalations: runs.filter(r => r.escalated).length, runs,
      firstTry: landed && rework === 0 && runs.filter(r => r.role === 'worker').length <= 1 }
  })
  if (tip) rmSync(tip, { recursive: true, force: true })
  const roles = {}; for (const [k, v] of Object.entries(byRole)) { const r = k.split(':')[0]; roles[r] = (roles[r] ?? 0) + v.usd }
  // invalid (not a failure): the run hit its time budget, or the harness broke (no final result from Claude Code)
  const done = read(join(dir, 'stream.jsonl')).split('\n').some(l => { try { return JSON.parse(l).type === 'result' } catch { return false } }), invalid = m.exit === 124 ? 'budget' : !done ? `harness (exit ${m.exit})` : null
  const res = { cell: m.cell, task: m.task, tier: p.tier, k: m.k, exit: m.exit, invalid, checkedOn: ref ?? null, secs: Math.round((m.t1 - m.t0) / 1000), tasks, rejections, tokens: byRole,
    usd: { ...Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, +v.toFixed(4)])), total: +Object.values(roles).reduce((a, b) => a + b, 0).toFixed(4) } }
  writeFileSync(join(dir, 'result.json'), JSON.stringify(res, null, 1)); return res
}
if (cmd === 'spent') console.log(walk(arg).filter(f => basename(f) === 'result.json').reduce((a, f) => a + JSON.parse(read(f)).usd.total, 0).toFixed(2))
if (cmd === 'judge') { const r = judge(arg); console.log(`${r.cell} ${r.task}#${r.k}${r.invalid ? ` INVALID ${r.invalid}` : ''} landed ${r.tasks.filter(t => t.landed).length}/${r.tasks.length} first-try ${r.tasks.filter(t => t.firstTry).length} rework ${r.tasks.reduce((a, t) => a + t.rework, 0)} $${r.usd.total} ${r.secs}s`) }

// ---- table: per tier x cell. cost per LANDED task = all $ spent in the cell's runs of that tier / tasks landed ----
if (cmd === 'table') {
  const all = walk(arg).filter(f => basename(f) === 'result.json').map(f => JSON.parse(read(f))), rs = all.filter(r => !r.invalid), g = {}
  for (const r of rs) (g[`${r.tier}|${r.cell}`] ??= []).push(r)
  const rows = Object.entries(g).sort().map(([k, v]) => {
    const ts = v.flatMap(r => r.tasks), landed = ts.filter(t => t.landed).length, spent = v.reduce((a, r) => a + r.usd.total, 0), roleUsd = v.reduce((a, r) => a + r.usd.total - (r.usd.main ?? 0), 0)
    const [tier, cell] = k.split('|')
    return [tier, cell, `${v.length}`, `${landed}/${ts.length}`, `${Math.round(100 * ts.filter(t => t.firstTry).length / ts.length)}%`, (ts.reduce((a, t) => a + t.rework, 0) / ts.length).toFixed(2), `${ts.reduce((a, t) => a + t.escalations, 0)}`,
      landed ? `$${(spent / landed).toFixed(2)}` : '-', landed ? `$${(roleUsd / landed).toFixed(2)}` : '-', `${(v.reduce((a, r) => a + r.secs, 0) / v.length / 60).toFixed(1)}`]
  })
  const head = ['tier', 'cell (worker_tester_reviewer)', 'runs', 'landed', 'first-try', 'mean rework', 'escalations', '$/landed (all)', '$/landed (roles)', 'min/run']
  if (process.argv.includes('--md')) { console.log(`| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|`); for (const r of rows) console.log(`| ${r.join(' | ')} |`) }
  else { const w = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length))); for (const r of [head, ...rows]) console.log(r.map((x, i) => x.padEnd(w[i])).join('  ')) }
  const rej = rs.flatMap(r => r.rejections.map(x => `${r.cell} ${r.task}: ${x.slice(0, 160)}`)); if (rej.length) console.log(`\nreview rejections (${rej.length}):\n${rej.slice(0, 40).join('\n')}`)
  const bad = all.filter(r => r.invalid); if (bad.length) console.log(`\ninvalid runs (left out): ${bad.map(r => `${r.cell} ${r.task}#${r.k} ${r.invalid} $${r.usd.total}`).join('; ')}`)
  const sum = (xs, f) => xs.reduce((a, r) => a + f(r), 0).toFixed(2)
  console.log(`\ntotal $${sum(all, r => r.usd.total)} over ${all.length} runs (main $${sum(all, r => r.usd.main ?? 0)}, roles $${sum(all, r => r.usd.total - (r.usd.main ?? 0))})`)
}
