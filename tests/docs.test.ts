import { expect, test } from 'claude-code/testing'
import { MIN_CC } from '../commands/doctor'
import { BUDGET } from './fixtures/budget.generated'   // the kit has no fs: scripts/budget.mjs freezes the LICENSE text there

test('LICENSE exists, contains it-dainb and the MIT grant', () => {
  expect(BUDGET.license).toContain('it-dainb'); expect(BUDGET.license).toContain('MIT License'); expect(BUDGET.license).toContain('Permission is hereby granted, free of charge')
})

test('docs/commands.md lists /cadre timeline', () => { expect(BUDGET.timelineDocumented).toBe(true) })

const README = BUDGET.docs.readme, say = (re: RegExp) => expect(re.test(README)).toBe(true)
test('README states the limits a user must know', () => {
  expect(README).toContain('Repo text reaches agents unfiltered, and `setup` installs what the manifest names.'); expect(README).toContain('Hardening this is deferred;')   // repo text and setup installs
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
