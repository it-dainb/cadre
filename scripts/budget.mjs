// Dev-only (node): the kit has no fs, so budgets are measured here and frozen into tests/fixtures/budget.generated.ts,
// which tests/budget.test.ts asserts. Run `node scripts/budget.mjs` before committing; `--check` fails if the file is stale.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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
// `tr` (ui/tr.ts, H11) is imported from ui/** only: a file elsewhere that imports it could hand a translated string to a model. `--tr-imports <dir>` scans another tree (tests/language.test.ts).
const trRoot = process.argv.includes('--tr-imports') ? process.argv[process.argv.indexOf('--tr-imports') + 1] : root
const trImports = (function scan(d) { return readdirSync(d, { withFileTypes: true }).flatMap(e => { const p = join(d, e.name)
  return e.isDirectory() ? (e.name === 'node_modules' || e.name.startsWith('.') ? [] : scan(p)) : /\.m?[tj]s$/.test(e.name) && !relative(trRoot, p).startsWith('ui/') && !relative(trRoot, p).startsWith('tests/') && /(from\s*|import\s*\(\s*)(['"])[^'"]*\/tr(\.m?[tj]s)?\2/.test(readFileSync(p, 'utf8')) ? [relative(trRoot, p)] : [] }) })(trRoot)
if (trImports.length) { console.error(`ui/tr imported outside ui/**:\n${trImports.join('\n')}`); process.exitCode = 1 }
if (process.argv.includes('--tr-imports')) process.exit()
const out = join(root, 'tests/fixtures/budget.generated.ts')
// docs: the kit has no fs, so the user docs are frozen here for tests/docs.test.ts and tests/doctor-coverage.test.ts; a relative link that does not resolve is listed
const DOCS = { readme: 'README.md', troubleshooting: 'docs/troubleshooting.md', guide: 'docs/guide.md', compat: 'docs/compat.md', commands: 'docs/commands.md' }
const docs = Object.fromEntries(Object.entries(DOCS).map(([k, f]) => [k, existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : '']))
const docLinksBroken = ['README.md', 'docs/guide.md'].flatMap(f => existsSync(join(root, f)) ? [...readFileSync(join(root, f), 'utf8').matchAll(/\]\(([^)\s]+)\)/g)].map(m => m[1]).filter(l => !/^(https?:|mailto:|#)/.test(l)).filter(l => !existsSync(join(root, f, '..', l.split('#')[0]))).map(l => `${f}: ${l}`) : [f + ': missing'])
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
const walkMjs = d => !existsSync(d) ? [] : readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? (n === 'node_modules' || n.startsWith('.') ? [] : walkMjs(p)) : /\.mjs$/.test(n) ? [p] : [] })
const extModules = Object.fromEntries(walkMjs(join(root, 'modules')).map(f => [relative(root, f), loc(f)]))   // cap commit 1: modules/*.mjs (hook, provider and sync scripts) counted apart from core, cap 640
const profiles = Object.fromEntries(walk(join(root, 'profiles')).map(f => [relative(root, f), loc(f)]))   // data consts (S2: checks only); counted apart from core, scanned for model exits like core
const exitsIn = fs => fs.flatMap(f => (existsSync(f) ? readFileSync(f, 'utf8') : readFileSync(join(root, f), 'utf8')).split('\n').map((l, i) => [`${f}:${i + 1}`, code(l)]))
  .filter(([, l]) => l && !l.startsWith('*') && EXIT.some(r => r.test(l)) && !PASS.test(l)).map(([w, l]) => `${w}: ${l.slice(0, 120)}`)
const modelExits = exitsIn([...Object.keys(modules), ...Object.keys(profiles)].filter(f => !/^core\/say\.ts$|^types\//.test(f)))

// ---- boundary lint (plan 7): an explicit file list, no name heuristic. (a) no .stdout/.stderr read outside a modelData(/log( call; (b) no RegExp literal and no new RegExp( ----
const NO_REGEX = ['core/gate.ts', 'core/junit.ts', 'core/tdd.ts', 'core/flags.ts', 'core/decide.ts', 'core/close.ts', 'core/pipeline.ts', 'core/profile.ts', 'core/machine.ts', 'core/hooks.ts', 'core/modrun.ts', 'core/integrate.ts', 'core/syncrun.ts', 'core/drive.ts', 'core/queue.ts', 'core/git.ts', 'core/admission.ts', 'core/plantools.ts', 'core/planner.ts', ...Object.keys(extModules), ...Object.keys(profiles)], NO_STDIO = ['core/gate.ts', 'core/tdd.ts']
const blank = l => l.replace(/\/\/ .*$/, '').replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""')   // strings out: a "/" inside one is no regex
const lines = f => (existsSync(f) ? readFileSync(f, 'utf8') : readFileSync(join(root, f), 'utf8')).split('\n').map((l, i) => [`${f}:${i + 1}`, l])
const TAG = '// engine-text-exception'   // the two documented regexes over engine text (plan 2.10): drive.limited and queue.modelRefusal
const rxIn = fs => fs.flatMap(f => lines(f).filter(([, l]) => !l.includes(TAG) && /(?:[=(,:!&|?]|\.test\(|\.replace\(|\breturn)\s*\/[^/*\s]|new RegExp\(/.test(blank(l))).map(([w, l]) => `${w}: ${l.trim().slice(0, 100)}`)), regexHits = rxIn(NO_REGEX), engineExceptions = NO_REGEX.flatMap(f => lines(f).filter(([, l]) => l.includes(TAG)).map(([w]) => w))
const stdioIn = fs => fs.flatMap(f => lines(f).filter(([, l]) => /\.(stdout|stderr)\b/.test(l.replace(/\/\/ .*$/, '')) && !/modelData\(|\blog\(/.test(l)).map(([w, l]) => `${w}: ${l.trim().slice(0, 100)}`)), stdioReads = stdioIn(NO_STDIO)
// `--check-file <path>`: the three detectors on one file as if it were listed (tests/git/budget-lint.test.mjs); prints the hits, exits 1 when there are any
if (process.argv.includes('--check-file')) { const f = process.argv[process.argv.indexOf('--check-file') + 1], hits = [...exitsIn([f]), ...rxIn([f]), ...stdioIn([f])]; console.log(hits.join('\n')); process.exit(hits.length ? 1 : 0) }
// core never imports modules/ (plan 2.7): hook, provider and sync scripts are run through core/modrun as processes, never loaded into the engine
const coreImportsModules = Object.keys(modules).filter(f => readFileSync(join(root, f), 'utf8').split('\n').some(l => /^\s*(?:import|export)\b.*\bfrom\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]/.test(l) && /(?:^|\/)modules\//.test(l.match(/['"]([^'"]*)['"]/)?.[1] ?? '')))
// vendored code (D14): outside the core cap and the regex list; its sha is pinned in core/vendor/VENDOR.json, only core/junit.ts imports it
const sha = f => createHash('sha256').update(readFileSync(join(root, f))).digest('hex')
const VJ = JSON.parse(readFileSync(join(root, 'core/vendor/VENDOR.json'), 'utf8')).xmldom
const vendor = { version: VJ.version, file: VJ.file, pinned: VJ.sha256, sha: sha(`core/vendor/${VJ.file}`), bytes: statSync(join(root, `core/vendor/${VJ.file}`)).size, license: existsSync(join(root, 'core/vendor/xmldom/LICENSE')), importers: Object.keys(modules).filter(f => f !== 'core/junit.ts' && /vendor\/xmldom/.test(readFileSync(join(root, f), 'utf8'))) }
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
export const BUDGET = ${JSON.stringify({ coreLoc: sum(modules), uiLoc: sum(ui), memoryStoreLoc: memoryStore, profilesLoc: sum(profiles), modulesLoc: sum(extModules), vendor, regexHits, engineExceptions, coreImportsModules, stdioReads, noRegex: NO_REGEX, noStdio: NO_STDIO, skills, gatingMissing, modelExits, trImports, writesOutside, uiLiterals, offText, license: existsSync(join(root, 'LICENSE')) ? readFileSync(join(root, 'LICENSE'), 'utf8') : '', docs, docLinksBroken, timelineDocumented: readFileSync(join(root, 'docs/commands.md'), 'utf8').includes('| `timeline` |'), modules, agents, promptBytes, guides , shippedBytes: bytes(agents) + bytes(guides) }, null, 2)} as const
`
if (process.argv.includes('--check')) { if (!existsSync(out) || readFileSync(out, 'utf8') !== body) { console.error('budget.generated.ts is stale: run node scripts/budget.mjs'); process.exit(1) } }
else writeFileSync(out, body)
for (const [n, l] of [['regex in a NO_REGEX file', regexHits], ['stdout/stderr read outside modelData(', stdioReads]]) if (l.length) { console.error(`${n}:\n${l.join('\n')}`); process.exitCode = 1 }
if (coreImportsModules.length) { console.error(`core imports modules/:\n${coreImportsModules.join('\n')}`); process.exitCode = 1 }
if (vendor.sha !== vendor.pinned) { console.error('vendored xmldom sha differs from VENDOR.json'); process.exitCode = 1 }
if (modelExits.length) console.error(`model-visible exits outside modelText():\n${modelExits.join('\n')}`); if (modelExits.length) process.exitCode = 1
console.log(`core ${sum(modules)} / 7400 (core cap 7400) · ui ${sum(ui)} / 1300 · profiles ${sum(profiles)} / 350 · modules ${sum(extModules)} / 640 · memory store ${memoryStore} / 150 · skills ${skills} · gating hooks without .catch ${gatingMissing} · model exits outside modelText ${modelExits.length} · role prompt bytes ${Object.entries(promptBytes).map(([r, n]) => `${r} ${n}`).join(', ')} (cap 1664) · shipped agents+guides ${bytes(agents) + bytes(guides)} B (cap 17693)`)
