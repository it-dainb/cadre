// Eval scaffolds: an APPROVED plan in the project's task store (.cadre/state), written through cadre's own FileStore, and its epic branch cut from dev.
// The human step is simulated, as a scaffold must: the tasks are approved in the store, and a new session adopts the plan from there (core/session).
// Run from the scaffolded repo's root, after `dev` exists:  node --experimental-transform-types --no-warnings <evals>/seed.mjs < plan.json
// plan.json: {"epic": {"title", "goal"}, "tasks": [{"title", "description", "type", "acceptance", "design"?, "meta"?}]}  ->  prints the epic id
import { execFile, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const root = new URL('..', import.meta.url).pathname
await import(`${root}tests/dev/register.mjs`)   // extensionless TS imports, as the kit resolves them
const { FileStore } = await import(`${root}task-management/adapters/file/store.ts`)
const { types: dt } = await import(`${root}profiles/default.ts`), defaults = () => dt
const { epicBranch } = await import(`${root}core/branches.ts`)

const run = (argv, o = {}) => new Promise(res => execFile(argv[0], argv.slice(1), { timeout: o.timeoutMs }, (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const host = { run, now: async () => Date.now(), rand: (n = 16) => randomBytes(n).toString('hex'), write: async (p, t) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, t) } }
const plan = JSON.parse(readFileSync(0, 'utf8')), store = new FileStore(host, `${process.cwd()}/.cadre/state`, 'eval-seed')
await store.init({ types: defaults(), journal: true })
const epic = await store.createEpic(plan.epic.title, plan.epic.goal), ids = []
for (const t of plan.tasks) ids.push((await store.createDraft({ title: t.title, description: t.description, type: t.type, acceptance: t.acceptance, design: t.design, parent: epic, meta: t.meta ?? {} })).id)
await store.approve(ids)
execFileSync('git', ['branch', epicBranch('epic/', epic, plan.epic.title), 'dev'])
console.log(epic)
