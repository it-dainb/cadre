// Need-to-know at the boundary (AGENTS.md): every model-visible exit goes through core/say.modelText (the scan in scripts/budget.mjs proves the routing;
// tests/support.ts makes every routed text a lint check). Here: the lint itself, the files written into an agent's view, the guides and agent files,
// and the brief builders with realistic inputs.
import { describe, expect, test } from 'claude-code/testing'
import { BUDGET } from './fixtures/budget.generated'
import { banned, bannedFor } from './fixtures/wording'
import { fakeHost } from './support'
import { SAY, leaks, modelText } from '../core/say'
import { buildView } from '../core/specview'
import { brief } from '../core/briefs'
import { ROLES_DEFAULT } from '../core/roles'
import { NUDGE as ASK_NUDGE, askCard, askTask } from '../core/asks'
import { noReportCard } from '../core/render'
import { reportRefusal } from '../core/validate'
import type { Task } from '../task-management/store'

const code = (md: string) => md.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')   // prose only: commands and paths in code spans are the reader's to run

describe('the list', () => {
  test('dev vocabulary, versions, source paths, host paths and machinery are leaks; task language is not', () => {
    for (const t of ['see ADR 0011', 'since 0.8.0', 'live 0.7.0 showed', 'the kit says', 'M0 result', 'smoke S13', 'API catalog', 'from the d.ts', 'core/specview.ts builds it', 'docs/adr/0012', 'a hook runs', 'cadre: refused', 'in /tmp/x/y'])
      expect([t, leaks('context', t).length]).toEqual([t, 1])
    for (const t of ['a lite bug fix', 'the full lane', 'lanes']) { expect(leaks('agent-file', t)).toHaveLength(1); expect(leaks('context', t)).toHaveLength(0) }   // lane words: main's planning API only
    for (const t of ['S1: Given a user When they log in Then a session exists', 'S12: Given x Then y', 'run the full test suite', 'call TaskUpdate p-1 completed', 'src/page.mjs line 2'])
      expect([t, leaks('agent-file', t)]).toEqual([t, []])
  })
  test('the test host checks every routed text: a leak throws at the boundary', () => {
    expect(SAY.check).toBeDefined(); expect(() => modelText('agent-file', 'No scenarios: a lite bug fix (ADR 0011).')).toThrow(/model-visible leak/); expect(modelText('brief', 'Plan p-1 is approved')).toBe('Plan p-1 is approved')
  })
  test('every model-visible exit in the product routes through modelText()/modelData() (scripts/budget.mjs scan)', () => { expect(BUDGET.modelExits).toEqual([]) })
})

describe('what agents read', () => {
  test('the spec view files (SCENARIOS.md with and without scenarios, INTERFACE.md, FILES.md)', async () => {
    const files: Record<string, string> = {}, h = Object.assign(fakeHost({ files }), {
      run: async (argv: readonly string[]) => ({ exitCode: 0, stdout: argv.includes('ls-tree') ? '100644 blob a1\ttest/page.test.mjs\0' : '', stderr: '' }) })
    const d: any = { cfg: { units: [{ root: '.', checks: {}, tdd: { paths: ['test/**'] } }], jail: 'off' }, wtRoot: '/w', key: 'k', actor: 'a', store: { setMeta: async () => {} } }
    const T = (o: Partial<Task>): Task => ({ id: 'p-1.1', title: 'Fix page offset', description: 'page 1 skips the first page', type: 'bug', category: 'todo', nativeStatus: 'open', priority: 2, deps: [], labels: [], meta: { 'cadre.base': 'b' }, updatedAt: '', ...o })
    for (const t of [T({}), T({ acceptance: 'S1: Given items When page(items, 1, 2) Then the first two', design: JSON.stringify({ symbols: [{ name: 'page', kind: 'function', params: ['items: T[]', 'n: number', 'size: number'], returns: 'T[]', status: 'changed' }] }) })]) {
      for (const k of Object.keys(files)) delete files[k]
      await buildView(h, d, t, '/w/wt')
      const written = Object.entries(files).filter(([p]) => /\/(SCENARIOS|INTERFACE|FILES)\.md$/.test(p))
      expect(written).toHaveLength(3); expect(bannedFor('agent-file', ...written.map(([, x]) => x))).toEqual([])
    }
    expect(files['/w/k.views/p-1.1/FILES.md']).toContain("Read these files for this project's test conventions (runner, import style, naming):\n\n- test/page.test.mjs")
  })
  test('agent definition files and every brief, nudge and card a subagent gets', () => {
    expect(bannedFor('agent-brief', ...Object.values(BUDGET.agents))).toEqual([])
    const b = { id: 'p-1.1', title: 'Fix page offset', type: 'bug', description: 'page 1 skips the first page', scenarios: 'S1: Given x Then y', contract: '{"none":true,"reason":"internal"}', notes: 'spawned by main',
      testPaths: ['test/**'], locked: ['test/page.test.mjs'], redCard: 'red ✓ 1 failing', greenCard: 'green ✓', deps: [{ id: 'p-1.0', title: 'Base', out: 'done' }], findings: ['F1 name the edge'], decisions: ['keep the API'],
      handoff: 'pick up at green', others: ['p-1.2'], protectedPaths: ['CHANGELOG.md'], sourceCommit: 'abc1234', diffStat: '1 file', diff: '-a\n+b', audit: '0 outside', report: 'done', changelog: 'Fixed: page offset', flags: ['rework:1/2'], question: 'what does page do?' }
    for (const r of ['tester', 'worker', 'reviewer', 'explorer'] as const) expect([r, bannedFor('agent-brief', brief(r, b))]).toEqual([r, []])
    expect(bannedFor('nudge', ...['worker', 'tester', 'reviewer', 'explorer'].map(r => (ROLES_DEFAULT as any)[r].nudge), ASK_NUDGE)).toEqual([])
    expect(bannedFor('card', noReportCard({ id: 'p-1.1', title: 'T' }, 'worker', 'worker'), askCard({ id: 'ask-1', q: 'what?', k: 0 } as any), askCard({ id: 'ask-1', q: 'what?', answer: 'x', auto: true, k: 2 } as any))).toEqual([])
    expect(bannedFor('taskget', askTask({ id: 'ask-1', q: 'what?', answer: 'x', auto: true } as any))).toEqual([])
  })
})

describe('what a refused report says back', () => {
  test('a shape refusal never echoes a host path the agent sent (a value or a field name), and the lint passes it', () => {
    const base = { schemaVersion: 1, role: 'worker', outcome: 'done', summary: 'ok' }
    const at = (...p: string[]) => ['', ...p].join('/')   // built, so the source scan finds no host path
    for (const r of [{ ...base, summary: [at('home', 'dainb', 'secret', 'file.ts')] }, { ...base, [at('home', 'dainb', 'field')]: 1 }, { ...base, outcome: at('tmp', 'x', 'y') }]) {
      const m = reportRefusal(r)!; expect(m.code).toBe('shape'); expect(m.msg).not.toMatch(/\/(home|tmp)\//); expect(leaks('tool-result', m.msg)).toEqual([])
    }
  })
})

describe('a refusal scrubs absolute host paths only', () => {
  test('a relative path and a URL stay as sent; an absolute path (alone, quoted, or after =) is replaced', () => {
    const at = (...p: string[]) => ['', ...p].join('/'), q = (v: unknown) => reportRefusal({ schemaVersion: 1, role: 'worker', outcome: 'done', summary: v })!.msg
    expect(q(['src/a/b.ts'])).toContain('src/a/b.ts'); expect(q(['http://x.io/a/b'])).toContain('http://x.io/a/b')
    expect(q([at('home', 'u', 'f.ts')])).toContain('(a path)'); expect(q([`x=${at('tmp', 'a', 'b')}`])).toContain('x=(a path)'); expect(q([`see ${at('home', 'u', 'f.ts')} now`])).toContain('see (a path) now')
  })
})

describe('what main reads', () => {
  test('the guides it is handed (prose outside code spans)', () => {
    for (const [name, md] of Object.entries(BUDGET.guides)) expect([name, banned(code(md))]).toEqual([name, []])
  })
})
