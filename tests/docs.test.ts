import { expect, test } from 'claude-code/testing'
import { MIN_CC } from '../commands/doctor'
import { profile as DEFAULT } from '../profiles/default'
import { BUDGET } from './fixtures/budget.generated'   // the kit has no fs: scripts/budget.mjs freezes the LICENSE text there

test('LICENSE exists, contains it-dainb and the MIT grant', () => {
  expect(BUDGET.license).toContain('it-dainb'); expect(BUDGET.license).toContain('MIT License'); expect(BUDGET.license).toContain('Permission is hereby granted, free of charge')
})

test('docs/commands.md lists /cadre timeline', () => { expect(BUDGET.timelineDocumented).toBe(true) })

const README = BUDGET.docs.readme, say = (re: RegExp) => expect(re.test(README)).toBe(true)
test('README states the limits a user must know', () => {
  expect(README).toContain("Opening a repo with cadre runs that repo's profile hooks and modules"); expect(README).toContain('only open repos you trust'); expect(README).toContain('accepted risk with no mitigation')   // 2.0 (D18, B23): the repo layer
  say(/Linux only/); say(/macOS or Windows/)
  say(/Keep the terminal open/); say(/`\/cadre continue`[^.]*respawns/)
  say(/No compatibility freeze/); say(/may break it/)
  say(/The UI is English/); say(/adding a table in `ui\/tr\.ts`/)
  say(/^## License\s+MIT/m)
})
test('the MIN Claude Code version in the docs is the one the code refuses below', () => {
  expect(MIN_CC).toBe('2.1.295')
  expect(README).toContain(`Claude Code ${MIN_CC}`); expect([...new Set(README.match(/2\.1\.\d+/g))]).toEqual([MIN_CC])
  expect(BUDGET.docs.compat).toContain(`2.1.295 (MIN)`); expect(BUDGET.docs.troubleshooting).toContain(`Claude Code ${MIN_CC} or newer`)
})
test('commands.md lists timeline and revert; compat names the live results, account modes and the offline run', () => {
  for (const c of ['timeline', 'revert <id>']) expect(BUDGET.docs.commands).toContain(`| \`${c}`)
  expect(BUDGET.docs.compat).toContain('CCV=2.1.299 harness/matrix.sh scripted'); expect(BUDGET.docs.compat).not.toContain('PENDING'); expect(BUDGET.docs.compat).toContain('| 2.1.310 | tested live'); expect(BUDGET.docs.compat).toContain('| Team |'); expect(BUDGET.docs.compat).toContain('| Max |')
})
test('the guide covers the dialogs and the metrics', () => {
  for (const s of ['Keep going', 'Cancel task', 'Already holds', 'Revert', '/cadre timeline']) expect(BUDGET.docs.guide).toContain(s)
})
test('every relative link in README and the guide resolves to a file', () => { expect(BUDGET.docLinksBroken).toEqual([]) })

test('S2 (D15, D16): guides/init.md has no `runner` field, tells the agent to write JUnit to $CADRE_JUNIT, and did not grow (4106 B before S2)', async () => {
  const g = BUDGET.guides.init as string
  expect(g).not.toContain('runner'); expect(g).toContain('$CADRE_JUNIT'); expect(g).toContain('without `checks.test`'); expect(g).toContain('docs or analysis profile')
  expect(new TextEncoder().encode(g).length).toBeLessThanOrEqual(4106)
})

// S8: docs/profile.md prints the default profile as JSON, one section per line; the page is the copyable form, so a change to profiles/default.ts must change it
const asJson = (p: object) => `{\n${Object.entries(p).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n}`
test('docs/profile.md contains the profiles/default.ts JSON and states what onFail.retry means under each `then`', () => {
  const doc = BUDGET.docs.profile as string
  expect(doc).toContain(asJson(DEFAULT))
  expect(JSON.parse(asJson(DEFAULT))).toEqual(JSON.parse(JSON.stringify(DEFAULT)))
  expect(doc).toContain('`then: {"back": "<step>"}`'); expect(doc).toContain('sent back `retry` times'); expect(doc).toContain('`then: "human"`'); expect(doc).toContain('the `retry`-th failing round raises the flag')
  for (let n = 1; n <= 23; n++) expect(doc).toContain(`| B${n} |`)
})
test('docs/limitations.md states the repo-layer risk, the engine-text exception and the unjailed-argv entry', () => {
  const l = BUDGET.docs.limitations as string
  for (const s of ['accepted owner risk', '/proc/<pid>/environ', 'adapters.<name>.url', 'run[0]', '.cadre/profile.json', '.cadre/config.json', 'Without bwrap', 'engine-text-exception', 'drive.limited', 'queue.modelRefusal', 'exit-only', 'B23']) expect(l).toContain(s)
})
