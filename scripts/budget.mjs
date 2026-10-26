// Dev-only (node): the kit has no fs, so budgets are measured here and frozen into tests/fixtures/budget.generated.ts,
// which tests/budget.test.ts asserts. Run `node scripts/budget.mjs` before committing; `--check` fails if the file is stale.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
// `--leaks`: host paths and session ids must not be tracked anywhere (harness/out is scratch)
if (process.argv.includes('--leaks')) {
  let hits = ''
  try { hits = execFileSync('git', ['grep', '-nIE', '/home/[a-z_]|/Users[/]|[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}', '--', '.', ':!harness/out'], { cwd: root, encoding: 'utf8' }).trim() } catch {}   // git grep exits 1 on no match
  if (hits) { console.error(hits); process.exit(1) }
  process.exit(0)
}
const out = join(root, 'tests/fixtures/budget.generated.ts')
const CORE = ['hooks', 'core', 'policy', 'commands', 'task-management', 'agents', 'config', 'tools']
const SKIP = ['task-management/adapters/memory', 'adapters/fake']   // test-only code is outside the core cap

const loc = f => { let n = 0, blk = false
  for (const raw of readFileSync(f, 'utf8').split('\n')) {
    const l = raw.trim(); if (blk) { if (l.includes('*/')) blk = false; continue }
    if (l.startsWith('/*')) { blk = !l.includes('*/'); continue }
    if (l && !l.startsWith('//')) n++ }
  return n }
const walk = d => !existsSync(d) ? [] : readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? (n === 'node_modules' || n.startsWith('.') ? [] : walk(p)) : /\.ts$/.test(n) && !/\.d\.ts$/.test(n) ? [p] : [] })

const modules = Object.fromEntries(CORE.flatMap(d => walk(join(root, d))).map(f => [relative(root, f), loc(f)]).filter(([p]) => !SKIP.some(s => p.startsWith(s))).sort())
const sum = o => Object.values(o).reduce((a, b) => a + b, 0)
const ui = Object.fromEntries(walk(join(root, 'ui')).map(f => [relative(root, f), loc(f)]))
// UI v2 files (first line `// UI v2`) hold no literal glyph, theme key or colour: those live in ui/tokens.ts only
const uiLiterals = walk(join(root, 'ui')).filter(f => !f.endsWith('/tokens.ts') && /^\/\/ UI v2/.test(readFileSync(f, 'utf8'))).flatMap(f => readFileSync(f, 'utf8').split('\n').map((l, i) => [`${relative(root, f)}:${i + 1}`, l.replace(/\/\/ .*$/, '')])
  .filter(([, l]) => /[^\x00-\x7f]|'(text|inactive|subtle|suggestion|success|error|warning|claude|permission|merged)'|#[0-9a-f]{6}\b|0x[0-9a-f]{6,8}\b/i.test(l)).map(([w, l]) => `${w}: ${l.trim().slice(0, 80)}`))
const memoryStore = sum(Object.fromEntries(walk(join(root, 'task-management/adapters/memory')).map(f => [f, loc(f)])))
const agents = Object.fromEntries(readdirSync(join(root, 'agents')).filter(n => n.endsWith('.md')).sort().map(n => [n.slice(0, -3), readFileSync(join(root, 'agents', n), 'utf8')]))   // plugin agent files, pinned to agents/index.file()
const promptBytes = Object.fromEntries(Object.entries(agents).map(([r, t]) => [r, Buffer.byteLength(t.split('\n---\n').slice(1).join('\n---\n'))]))   // A2/A4: the built-in role prompts' size (tests/budget.test.ts caps each at 1664 B)
const bytes = o => Object.values(o).reduce((a, s) => a + Buffer.byteLength(s), 0)
const guides = Object.fromEntries(readdirSync(join(root, 'guides')).filter(n => n.endsWith('.md')).sort().map(n => [n.slice(0, -3), readFileSync(join(root, 'guides', n), 'utf8')]))   // agent-run setup/init guides (ADR 0010): the wording lint reads them here
// Model-visible exits (AGENTS.md): every line that hands text to a model must route it through core/say modelText()/modelData(). New sites are caught here.
const EXIT = [/\b(h|\$\.prompt)\.submit[?!]?\.?\(/, /\bsendTo\??!?\(|session\.send\(/, /\{ ?deny: /, /(decision: '(deny|allow)'|isDelivered: false), reason: /, /\{ result: (?!string)/, /\bcontext: \[/, /\bmessages: \[/, /\bprompt: (?!string)/, /h\.write\(`\$\{view\}/, /next\(\{ \.\.\.e, (text|instructions):/]
const PASS = /modelText\(|modelData\(/, code = l => l.replace(/\/\/ .*$/, '').trim()
const modelExits = Object.keys(modules).filter(f => !/^core\/say\.ts$|^types\//.test(f)).flatMap(f => readFileSync(join(root, f), 'utf8').split('\n').map((l, i) => [`${f}:${i + 1}`, code(l)]))
  .filter(([, l]) => l && !l.startsWith('*') && EXIT.some(r => r.test(l)) && !PASS.test(l)).map(([w, l]) => `${w}: ${l.slice(0, 120)}`)
// One writer (ADR 0024 §2.4): binding, wake and budget writes appear only in core/lifecycle.ts; core/board's patchBinding writes plain fields only. tests/lifecycle.test.ts asserts none.
const WRITE = [/\bbind\.update\(/, /(?<!function )\bqueueResume\(/, /\b(un)?bindAgent\(/, /'cadre\.(attempts|nudge|testerRounds|rework|rebase)'/, /\b(runs|budgets): \{/]
const writesOutside = Object.keys(modules).filter(f => f !== 'core/lifecycle.ts').flatMap(f => readFileSync(join(root, f), 'utf8').split('\n').map((l, i) => [`${f}:${i + 1}`, code(l)]))
  .filter(([w, l]) => l && WRITE.some(r => r.test(l)) && !(w.startsWith('core/board.ts') && l.startsWith('export const patchBinding'))).map(([w, l]) => `${w}: ${l.slice(0, 120)}`)
// the retired dormant line (ADR 0014): one message state machine in commands/cadre replaced it everywhere a user or model reads
const offText = [...Object.keys(modules), ...Object.keys(ui), 'README.md', 'docs/commands.md', ...readdirSync(join(root, 'guides')).map(n => `guides/${n}`)].filter(f => existsSync(join(root, f)) && /cadre is off in this repo/.test(readFileSync(join(root, f), 'utf8')))
const skills = existsSync(join(root, 'skills')) ? readdirSync(join(root, 'skills')).length : 0

let gatingMissing = -1   // -1 = validate unavailable (set CC=/path/to/claude)
try {
  const j = JSON.parse(execFileSync(process.env.CC ?? 'claude', ['plugin', 'validate', '--json', root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  gatingMissing = [j.manifest, ...(j.contents ?? [])].flatMap(c => c?.gatingHooks ?? []).filter(g => !g.hasCatch).length
} catch (e) { if (process.env.CC) throw e }

const body = `// GENERATED by scripts/budget.mjs: do not edit. Measured outside the kit (it has no fs).
export const BUDGET = ${JSON.stringify({ coreLoc: sum(modules), uiLoc: sum(ui), memoryStoreLoc: memoryStore, skills, gatingMissing, modelExits, writesOutside, uiLiterals, offText, license: existsSync(join(root, 'LICENSE')) ? readFileSync(join(root, 'LICENSE'), 'utf8') : '', modules, agents, promptBytes, guides, shippedBytes: bytes(agents) + bytes(guides) }, null, 2)} as const
`
if (process.argv.includes('--check')) { if (!existsSync(out) || readFileSync(out, 'utf8') !== body) { console.error('budget.generated.ts is stale: run node scripts/budget.mjs'); process.exit(1) } }
else writeFileSync(out, body)
if (modelExits.length) console.error(`model-visible exits outside modelText():\n${modelExits.join('\n')}`); if (modelExits.length) process.exitCode = 1
console.log(`core ${sum(modules)} / 7400 (core cap 7400) · ui ${sum(ui)} / 1100 · memory store ${memoryStore} / 150 · skills ${skills} · gating hooks without .catch ${gatingMissing} · model exits outside modelText ${modelExits.length} · role prompt bytes ${Object.entries(promptBytes).map(([r, n]) => `${r} ${n}`).join(', ')} (cap 1664) · shipped agents+guides ${bytes(agents) + bytes(guides)} B (cap 17693)`)
