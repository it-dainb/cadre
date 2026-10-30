// Review aid (AGENTS.md): the model-visible text a git range adds or changes, so a reviewer reads it before a push.
//   node --experimental-transform-types scripts/model-text-diff.mjs [range]   (default: @{upstream}..HEAD, else HEAD~1..HEAD)
// Lists string literals on added lines that call modelText()/modelData() or write into an agent's view, every added literal in the files that build
// model text (briefs, cards, prompts, Task* answers, tool results, guards), and added lines of guides/ and agents/*.md. `!` marks a line the lint rejects.
import { execFileSync } from 'node:child_process'
const { leaks } = await import(new URL('../core/say.ts', import.meta.url).href)
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
const range = process.argv[2] ?? (() => { try { git('rev-parse', '@{upstream}'); return '@{upstream}..HEAD' } catch { return 'HEAD~1..HEAD' } })()
const BUILDERS = ['core/briefs.ts', 'core/render.ts', 'core/asks.ts', 'core/say.ts', 'agents/prompts.ts', 'native/tasks.ts', 'tools/index.ts', 'policy/guards.ts', 'core/close.ts', 'core/plantools.ts', 'core/admission.ts', 'core/specview.ts', 'core/lanes.ts', 'core/dispatch.ts', 'core/reuse.ts', 'core/effect.ts', 'core/tdd.ts', 'core/risk.ts', 'core/decide.ts', 'core/validate.ts']
const SITE = /modelText\(|modelData\(|h\.write\(`\$\{view\}/
const LIT = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g
let file = '', n = 0, bad = 0
for (const l of git('diff', '-U0', '--no-color', range, '--', ...['core', 'native', 'policy', 'tools', 'agents', 'commands', 'hooks', 'guides'].map(d => `${d}/`)).split('\n')) {
  if (l.startsWith('+++ ')) { file = l.slice(6); continue }
  if (!l.startsWith('+') || l.startsWith('+++')) continue
  const line = l.slice(1), md = /\.md$/.test(file) && /^(guides|agents)\//.test(file)
  const src = line.replace(/\/\/ .*$/, '').replace(/\bh\.(log|toast)\((`[^`]*`|'[^']*'|[^)])*\)/g, ''), at = src.search(SITE)   // on a call site: only what is inside the call, not a log line next to it
  const part = BUILDERS.includes(file) ? src : at < 0 ? '' : src.slice(at).split(/\.catch\(|\bh\.log\(/)[0]
  const texts = md ? [line.trim()] : (part.match(LIT) ?? []).filter(s => /[a-z]{3,}\s/i.test(s))
  // main's own planning files (lanes, plan tools) may name lanes: the lane ban is for what a task agent reads
  for (const t of texts) { const hit = leaks(/^guides\/|^native\/tasks\.ts|^core\/(lanes|plantools)\.ts/.test(file) ? 'context' : 'agent-file', t).length > 0; bad += +hit; n++; console.log(`${hit ? '!' : ' '} ${file}: ${t.slice(0, 200)}`) }
}
console.log(`${n} model-visible text(s) added or changed in ${range}${bad ? ` · ${bad} rejected by the lint (! lines)` : ''}`)
if (bad) process.exitCode = 1
