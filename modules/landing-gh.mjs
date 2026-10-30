// The GitHub landing provider (plan 2.8, B8): `node landing-gh.mjs`, run by core with {op:'submit'|'poll', args:{remote?, review?}, ...}; the answer goes to CADRE_RESULT.
// submit pushes dev and the plan's commit and opens one pull request (pending, ref = its number); poll reads `gh pr view --json` (never gh's text): failing checks fail the landing (code `checks`),
// pending checks, a missing approval (args.review) or no checks yet (10 min of grace) wait, a green one is merged, fetched and answered landed (ref = the commit now on dev).
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const input = JSON.parse(readFileSync(process.env.CADRE_INPUT, 'utf8')), R = input.args?.remote ?? 'origin'
const run = (code, cmd, ...args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  if (r.status !== 0) throw Object.assign(new Error(`${cmd} ${args.slice(0, 3).join(' ')}: ${`${r.stdout}\n${r.stderr}`.trim().slice(-300)}`), { code })
  return r.stdout
}
const done = r => { writeFileSync(process.env.CADRE_RESULT, JSON.stringify(r)); process.exit(0) }
const BAD = ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'], WAIT = ['PENDING', 'EXPECTED']   // statusCheckRollup: a CheckRun has status+conclusion, a StatusContext has state

function submit() {
  const branch = `cadre/land/${input.id}`
  run('gh', 'gh', 'auth', 'status'); run('git', 'git', 'push', R, `${input.devTip}:refs/heads/${input.dev}`); run('git', 'git', 'push', '--force', R, `${input.sha}:refs/heads/${branch}`)
  const open = JSON.parse(run('gh', 'gh', 'pr', 'list', '--head', branch, '--base', input.dev, '--state', 'open', '--json', 'number') || '[]')[0]?.number   // a retry after red checks, or a crash before the record: the open one (the push above updated it)
  const n = open ?? Number(run('gh', 'gh', 'pr', 'create', '--base', input.dev, '--head', branch, '--title', `merge ${input.from} (${input.id})`, '--body', `Plan ${input.id}: it lands on ${input.dev} when the checks pass.`).split('/pull/')[1])
  if (!n) throw Object.assign(new Error('gh pr create printed no pull request URL'), { code: 'gh' })
  return { state: 'pending', ref: String(n) }
}
function poll() {
  const n = input.ref, v = JSON.parse(run('gh', 'gh', 'pr', 'view', n, '--json', 'state,reviewDecision,statusCheckRollup,headRefName,baseRefName'))
  if (v.state === 'CLOSED') return { state: 'failed', error: { code: 'closed', message: `pull request #${n} was closed without merging` } }
  const rollup = v.statusCheckRollup ?? [], name = c => c.name ?? c.context
  const bad = rollup.filter(c => BAD.includes(c.conclusion) || BAD.includes(c.state) || c.state === 'ERROR').map(name)
  if (bad.length) return { state: 'failed', error: { code: 'checks', message: `pull request #${n}: checks failed: ${bad.join(', ')}` } }
  const waiting = rollup.some(c => (c.status && c.status !== 'COMPLETED') || WAIT.includes(c.state)) || (!rollup.length && input.now < (input.at ?? 0) + 600_000) || (input.args?.review && v.reviewDecision !== 'APPROVED')
  if (v.state !== 'MERGED' && waiting) return { state: 'pending' }
  if (v.state !== 'MERGED') run('gh-merge', 'gh', 'pr', 'merge', n, '--merge')
  run('git-fetch', 'git', 'fetch', R, v.baseRefName)
  const ref = run('git-fetch', 'git', 'rev-parse', 'FETCH_HEAD').trim()
  spawnSync('git', ['push', R, '--delete', v.headRefName], { encoding: 'utf8' })   // best effort: the branch only carried this request
  return { state: 'landed', ref }
}
try { done(input.op === 'submit' ? submit() : poll()) } catch (e) { done({ state: 'pending', error: { code: e.code ?? 'module', message: e.message } }) }
