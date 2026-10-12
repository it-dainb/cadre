#!/usr/bin/env node
// Scaffold one bench run in the cwd (an empty dir): the fixture repo, .cadre/config.json with the cell's roles, git (main, dev, the epic branch),
// and a store holding the task's plan already APPROVED (status open + epic branch, as evals/execute-p1-* do), so planning is out of the measurement.
//   node scaffold.mjs <task dir> '<roles json>'
import { execFileSync } from 'node:child_process'
import { cpSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

const [dir, rolesJson = '{}'] = process.argv.slice(2), B = new URL('.', import.meta.url).pathname, p = JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8'))
const sh = (cmd, args, input) => execFileSync(cmd, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, BEADS_DIR: `${process.cwd()}/.cadre/store` } })
const git = (...a) => sh('git', a), bd = (a, input = '') => sh('bd', [...a, ...(input !== null ? ['--stdin', '--allow-empty-description'] : [])], input)
const slug = t => { const w = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); if (w.length <= 24) return w || 'task'; const c = w.slice(0, 25), i = c.lastIndexOf('-'); return i > 0 ? c.slice(0, i) : w.slice(0, 24) }

cpSync(join(B, 'repos', p.repo), '.', { recursive: true })
mkdirSync('.cadre')
writeFileSync('.cadre/config.json', JSON.stringify({ packages: [{ root: '.', setup: ['node', '--version'], checks: { test: ['npm', 'test'] }, tdd: { paths: ['test/**'] } }], roles: JSON.parse(rolesJson) }, null, 1))
writeFileSync('CHANGELOG.md', '# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n## [Unreleased]\n')
git('init', '-q', '-b', 'main'); git('config', 'user.email', 'bench@example.com'); git('config', 'user.name', 'bench')
appendFileSync('.git/info/exclude', '.cadre/store/\n.cadre/store.gate.lock\n')
git('add', '-A'); git('commit', '-qm', 'chore: initial commit')
bd(['init', '--non-interactive', '--skip-agents', '--skip-hooks', '-p', 'p'], null)
bd(['config', 'set', 'status.custom', 'draft:frozen,in_review:wip'], null); bd(['config', 'set', 'types.custom', 'refactor,docs,test,spike,decision,milestone,gate'], null); bd(['config', 'set', 'events-journal', 'true'], null)
bd(['create', '--id', 'p-p1', '-t', 'epic', '-s', 'draft', `--title=${p.epic}`], p.goal)
const ids = {}
for (const [i, t] of p.tasks.entries()) {
  ids[t.key] = `p-p1.${i + 1}`
  const meta = { 'cadre.package': '.', 'cadre.paths': JSON.stringify(t.paths), 'cadre.changelog': JSON.stringify({ category: t.changelog[0], entry: t.changelog[1] }), ...(t.core ? { 'cadre.core': 'true' } : {}) }
  bd(['create', '--parent', 'p-p1', '-t', t.type, '-s', 'draft', `--title=${t.title}`, '--priority=2', `--acceptance=${t.scenarios.map((s, k) => `S${k + 1}: ${s}`).join('\n')}`, `--design=${JSON.stringify({ symbols: t.symbols })}`, `--metadata=${JSON.stringify(meta)}`], t.description)
}
for (const t of p.tasks) for (const a of t.after ?? []) bd(['dep', 'add', ids[t.key], ids[a]], null)
for (const t of p.tasks) bd(['update', ids[t.key], '-s', 'open'], null)
git('add', '-A'); try { git('commit', '-qm', 'chore: store') } catch {}
git('branch', 'dev', 'main'); git('branch', `epic/p-p1-${slug(p.epic)}`, 'dev')
if (git('status', '--short').trim()) { console.error('scaffold left a dirty tree'); process.exit(1) }
console.log(JSON.stringify({ epicBranch: `epic/p-p1-${slug(p.epic)}`, tasks: ids }))
