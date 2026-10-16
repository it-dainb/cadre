// Dev-only: the matrix oracle on a saved screen (harness/oracle.mjs). node --test tests/git/oracle.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
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
