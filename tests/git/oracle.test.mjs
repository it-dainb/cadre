// Dev-only: the matrix oracle on a saved screen (harness/oracle.mjs). node --test tests/git/oracle.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('../../', import.meta.url).pathname, fix = join(root, 'tests/fixtures/oracle/restart-docked')
const judge = (edit = t => t) => {
  const d = mkdtempSync(join(tmpdir(), 'cadre-oracle-')); cpSync(fix, d, { recursive: true })
  for (const f of readdirSync(join(d, 'panes'))) writeFileSync(join(d, 'panes', f), edit(readFileSync(join(d, 'panes', f), 'utf8')))
  try { execFileSync('node', [join(root, 'harness/oracle.mjs'), d], { stdio: 'pipe' }) } catch {}
  return JSON.parse(readFileSync(join(d, 'verdict.json'), 'utf8')).fails.map(f => f.invariant)
}

// quick tier, kill-mid-setup on 9918502: the bare /cadre after the restart said "Setup was interrupted · /cadre …", but the pane docked at the right
// wrapped it over two rows ("Setup was" / "interrupted · /cadre") and the one-row pattern failed restart-named
test('restart-named reads a reply the docked pane wrapped over two rows', () => {
  assert.ok(readFileSync(join(fix, 'panes', readdirSync(join(fix, 'panes'))[0]), 'utf8').includes('cadre: Setup was    │'))
  assert.ok(!judge().includes('restart-named'))
  assert.ok(judge(t => t.replace(/Setup was/g, 'All good  ').replace(/interrupted/g, 'xxxxxxxxxxx')).includes('restart-named'))   // a reply that names nothing still fails
})

// scripted dev-moved on 4922aa6: the watcher pressed 1 on the band 185 ms before the cell ended; the capture stopped and the debug log was copied
// before the dialog (1 s later) could show, so press1-no-dialog judged a press it never watched. A press with no 5 s left to watch is not judged.
test('press1-no-dialog judges only a press the cell watched for 5 s', () => {
  const press1 = gap => {
    const d = mkdtempSync(join(tmpdir(), 'cadre-oracle-')), t = 1_792_131_660_000, rule = '─'.repeat(40)
    cpSync(join(fix, 'panes'), join(d, 'panes'), { recursive: true, filter: s => !s.endsWith('.txt') })
    writeFileSync(join(d, 'panes', `${t}.txt`), `x [-]\n! NEEDS YOU · dev has new work for your checkout   1: answer\n${rule}\n❯ \n${rule}\n  ⚠ cadre: dev has new work for your checkout · press 1\n`)
    writeFileSync(join(d, 'driver.log'), [`${t - 1000} start x`, `${t + 100} press1 ⚠ cadre: dev has new work for your checkout · press 1`, `${t + 100 + gap} end`].join('\n') + '\n')
    try { execFileSync('node', [join(root, 'harness/oracle.mjs'), d], { stdio: 'pipe' }) } catch {}
    return JSON.parse(readFileSync(join(d, 'verdict.json'), 'utf8')).fails.map(f => f.invariant)
  }
  assert.ok(!press1(185).includes('press1-no-dialog'))
  assert.ok(press1(10_000).includes('press1-no-dialog'))   // a press watched for 10 s with no dialog still fails
})

// quick tier, single-295 on 7d24520 (haiku): main asked its one clarify round, 3 questions in ONE AskUserQuestion; the watcher logged a dialog per
// question tab, so set up + safety + 3 tabs + the plan = 6 failed the budget of 3. That call is one dialog, and its round earns one.
test('dialog-budget counts main\'s question call once and allows its one clarify round', () => {
  const qs = ['Which words should titleCase split on? The explorer found only the whitespace-separated words in the existing slug style', 'What happens to the rest of each word?', 'How should non-string or empty input behave?']
  const budget = (questions, extra = []) => {
    const d = mkdtempSync(join(tmpdir(), 'cadre-oracle-')), t = 1_792_133_000_000
    cpSync(join(fix, 'panes'), join(d, 'panes'), { recursive: true, filter: s => !s.endsWith('.txt') })
    writeFileSync(join(d, 'driver.log'), [`${t} start x`, `${t + 1} dialog cadre isn't set up here. Set it up and plan this goal? add titleCase(s)`, `${t + 2} dialog init · safety settings · confirm`,
      ...qs.map((q, i) => `${t + 3 + i} dialog ${q.slice(0, 120)}`), ...extra.map((q, i) => `${t + 6 + i} dialog ${q}`), `${t + 9} submit submit answers`, `${t + 10} plan approve the mission and plan`, `${t + 11} end`].join('\n') + '\n')
    const js = join(d, 'jsonl/p'); cpSync(join(fix, 'panes'), js, { recursive: true, filter: s => !s.endsWith('.txt') })
    writeFileSync(join(js, 'main.jsonl'), [{ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { questions: questions.map(q => ({ question: q })) } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'q1' }] } }].map(x => JSON.stringify(x)).join('\n'))
    try { execFileSync('node', [join(root, 'harness/oracle.mjs'), d], { stdio: 'pipe' }) } catch {}
    return JSON.parse(readFileSync(join(d, 'verdict.json'), 'utf8')).fails.map(f => f.invariant)
  }
  assert.ok(!budget(qs).includes('dialog-budget'))
  assert.ok(budget([]).includes('dialog-budget'))   // dialogs main never asked still count one each
  assert.ok(budget(qs, ['Release now?']).includes('dialog-budget'))   // one dialog beyond the clarify round still fails
})

// quick + L cells on 6665614 (haiku): every cell forces agents to haiku with CLAUDE_CODE_SUBAGENT_MODEL(_FORCE) and the reviewer's keys refuse haiku, so
// routing failed "reviewer on claude-haiku-5-5/high" in every PROXY=1 cell: the oracle never handed the cell's env.json to expect-routing.
test('routing allows the model the cell env forces', () => {
  const routing = env => {
    const d = mkdtempSync(join(tmpdir(), 'cadre-oracle-')), t = 1_792_131_660_000
    cpSync(join(fix, 'panes'), join(d, 'panes'), { recursive: true })
    writeFileSync(join(d, 'driver.log'), `${t} start x\n${t + 1000} end\n`)
    writeFileSync(join(d, 'effort.jsonl'), JSON.stringify({ at: t + 500, role: 'reviewer', model: 'claude-haiku-5-5', output_config: { effort: 'high' } }) + '\n')
    if (env) writeFileSync(join(d, 'env.json'), JSON.stringify(env))
    try { execFileSync('node', [join(root, 'harness/oracle.mjs'), d], { stdio: 'pipe' }) } catch {}
    return JSON.parse(readFileSync(join(d, 'verdict.json'), 'utf8')).fails.map(f => f.invariant)
  }
  assert.ok(!routing({ CLAUDE_CODE_SUBAGENT_MODEL: 'haiku', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' }).includes('routing'))
  assert.ok(routing().includes('routing'))   // without the forcing env a reviewer on haiku is still off the settings
})

// quick tier user2-nogit-lazy-interrupt on 33ff8a3 (2.1.299): after Esc each "Let Claude try again" was refused and the stopped dialog came back 36 times
test('stop-loop: one stopped dialog and up to 2 typed lines pass; a second stopped dialog or a third typed line fails', () => {
  const run = lines => {
    const d = mkdtempSync(join(tmpdir(), 'cadre-oracle-')), t = 1_792_140_560_000
    cpSync(join(fix, 'panes'), join(d, 'panes'), { recursive: true, filter: s => !s.endsWith('.txt') })
    writeFileSync(join(d, 'driver.log'), [`${t} start fixtures=[nogit] fault=interrupt`, `${t + 1} fault interrupt`, ...lines.map((l, i) => `${t + 10 + i} ${l}`), `${t + 9000} end`].join('\n') + '\n')
    try { execFileSync('node', [join(root, 'harness/oracle.mjs'), d], { stdio: 'pipe' }) } catch {}
    return JSON.parse(readFileSync(join(d, 'verdict.json'), 'utf8')).fails.map(f => f.invariant)
  }
  assert.ok(!run(['dialog init stopped · type anything to go on', 'type go on', 'type go on']).includes('stop-loop'))
  assert.ok(run(['dialog init · Claude stopped · 6 left', 'answer x', 'dialog init · Claude stopped · 6 left']).includes('stop-loop'))
  assert.ok(run(['type go on', 'type go on', 'type go on']).includes('stop-loop'))
})

// scripted exit-every-role on c28b902 (and f99a3f2), run alone: the reviewer started and its task closed (its run records pruned) inside one 2 s gap
// between store snapshots, and the oracle read only each snapshot's newest control image: "roles never run: reviewer". The journal kept every image.
// The other run's last snapshot was torn (j/1..66 of 91, the container stopping), so its newest image still showed the worker idle-bound.
test('every reads each run from every journal image and survives a torn last snapshot', () => {
  const every = torn => {
    const d = mkdtempSync(join(tmpdir(), 'cadre-oracle-')), t = 1_792_158_900_000
    cpSync(join(fix, 'panes'), join(d, 'panes'), { recursive: true })
    writeFileSync(join(d, 'driver.log'), `${t} start x\n${t + 30000} end\n`)
    const run = (role, ...st) => ({ role, state: { state: st.at(-1) }, log: st.map(state => ({ state })) })
    const img = (n, runs) => `j/${n}\t${JSON.stringify({ docs: { _control: { revision: String(n), doc: Object.fromEntries(Object.entries(runs).map(([a, r]) => [`run:${a}`, r])) } } })}`
    const J = [img(1, { t1: run('tester', 'running') }), img(2, { t1: run('tester', 'running', 'ended'), w1: run('worker', 'running') }),
      img(3, { t1: run('tester', 'running', 'ended'), w1: run('worker', 'running', 'idle-bound'), r1: run('reviewer', 'running') }),   // never the newest at a snapshot
      img(4, { t1: run('tester', 'running', 'ended'), w1: run('worker', 'running', 'idle-bound'), r1: run('reviewer', 'running', 'idle-bound') }), img(5, {})]   // the task closed: pruned
    mkdirSync(join(d, 'store'))
    for (const [i, n] of [[1, 2], [2, 5], ...(torn ? [[3, 2]] : [])]) { writeFileSync(join(d, 'store', `${t + i * 2000}.json`), '{}'); writeFileSync(join(d, 'store', `${t + i * 2000}.state`), J.slice(0, n).join('\n')) }
    try { execFileSync('node', [join(root, 'harness/oracle.mjs'), d], { stdio: 'pipe', env: { ...process.env, ORACLE: 'every' } }) } catch {}
    return JSON.parse(readFileSync(join(d, 'verdict.json'), 'utf8')).fails.map(f => `${f.invariant}: ${f.evidence}`)
  }
  assert.deepEqual(every(false).filter(f => f.startsWith('every')), [])
  assert.deepEqual(every(true).filter(f => f.startsWith('every')), [])
})

// quick continue-after-quit on d48ffd5: the cell's restart quit CC 0.8 s into a turn.step hook; CC aborted its process.run and logged "hook failed"
test('errors skips a hook CC aborted at a quit; any other hook failure still fails', () => {
  const errs = next => {
    const d = mkdtempSync(join(tmpdir(), 'cadre-oracle-')); cpSync(fix, d, { recursive: true })
    writeFileSync(join(d, 'debug-1.log'), `2026-10-24T16:16:52.426Z [ERROR] hook failed: cadre: errorKind=HooksError errorChars=32 (turn.step; skipped; what is below it ran in its place)\n2026-10-24T16:16:52.427Z [DEBUG] [cadre] $.ui.log: turn.step hook skipped: threw ${next}\n`)
    try { execFileSync('node', [join(root, 'harness/oracle.mjs'), d], { stdio: 'pipe' }) } catch {}
    return JSON.parse(readFileSync(join(d, 'verdict.json'), 'utf8')).fails.map(f => f.invariant).includes('errors')
  }
  assert.equal(errs('cadre: $.process.run(sh) aborted'), false)
  assert.equal(errs('TypeError: x is undefined'), true)
})

// release016 on 37ddade: a worker ran `…; uv lock --check 2>&1 | tail -3` to look at the lock; the oracle read it as an install the offline settings did not stop
test('the own-shell check: installs are commands that install; a check, a dry run, a listing or a mention is not', async () => {
  const { installs } = await import('../../harness/installs.mjs')
  for (const c of ['npm install ms', 'cd x && npm i ms', 'ls; uv add six', 'uv sync', 'uv lock', 'pip install x | tail -2', 'sudo npm ci', 'git show HEAD | head; uv lock 2>&1']) assert.equal(installs(c), true, c)
  for (const c of ['uv lock --check 2>&1 | tail -3', 'git show --stat HEAD; ls .venv; uv lock --check', 'npm install --dry-run ms', 'uv --version', 'echo npm install', 'git commit -m "npm install ms"', 'grep -r "npm ci" .', 'uv run pytest', 'ls .venv/lib', undefined]) assert.equal(installs(c), false, String(c))
})

// release016 continue-after-quit.r2: Claude Code met a real 429 (lines 4889-4890 of its debug log) and cadre stopped the drive "usage limit until". That is the account's limit, not a verdict on
// cadre: inconclusive, rerun. A lone 429 (CC retries and may recover) and the stub's injected usage_limit (the usage-limit S cell expects the toast) are not.
test('a real 429 plus cadre\'s usage-limit stop is inconclusive; a lone 429 and an injected limit are not', () => {
  const verdict = (toast, { log = true, stubbed = '' } = {}) => {
    const d = mkdtempSync(join(tmpdir(), 'cadre-oracle-')), t = 1_792_945_760_000
    mkdirSync(join(d, 'panes')); writeFileSync(join(d, 'panes', `${t}.txt`), toast ? 'x [-]\n drive stopped · usage limit until 17:00\n' : 'x [-]\n')
    writeFileSync(join(d, 'driver.log'), `${t - 1000} start x\n${t + 1000} end\n`)
    writeFileSync(join(d, 'debug.log'), log ? readFileSync(join(root, 'tests/fixtures/oracle/real-429.log'), 'utf8') : '')
    writeFileSync(join(d, 'stubbed.jsonl'), stubbed)
    try { execFileSync('node', [join(root, 'harness/oracle.mjs'), d], { stdio: 'pipe' }) } catch {}
    return JSON.parse(readFileSync(join(d, 'verdict.json'), 'utf8'))
  }
  assert.equal(verdict(true).inconclusive, true)
  assert.equal(verdict(true).pass, false)
  assert.equal(verdict(false).inconclusive, false)   // a lone 429, no stop
  assert.equal(verdict(true, { log: false }).inconclusive, false)   // the stop with no 429 behind it
  assert.equal(verdict(true, { stubbed: '{"at":1,"kind":"usage_limit"}\n' }).inconclusive, false)   // the injected control
})
