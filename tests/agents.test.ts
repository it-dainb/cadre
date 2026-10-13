import { describe, expect, test } from 'claude-code/testing'
import { MAIN_TOOLS, ROLES, TOOLS, allowlist, file, spec } from '../agents/index'
import { BUDGET } from './fixtures/budget.generated'
import { PROMPTS } from '../agents/prompts'
import { defaults } from '../config/index'

const bytes = (s: string) => new TextEncoder().encode(s).length
const cfg = () => { const d = defaults(); return { roles: d.roles, models: d.models, mcpAllow: d.mcpAllow } }

describe('prompts (DESIGN 4.1, 7)', () => {
  test('sizes: worker <= 2.5 KB, tester/reviewer <= 1.5 KB, explorer <= 1 KB, planner <= 2 KB', async () => {
    expect(bytes(PROMPTS.planner)).toBeLessThanOrEqual(2000)
    expect(bytes(PROMPTS.worker)).toBeLessThanOrEqual(2500); expect(bytes(PROMPTS.tester)).toBeLessThanOrEqual(1500)
    expect(bytes(PROMPTS.reviewer)).toBeLessThanOrEqual(1500); expect(bytes(PROMPTS.explorer)).toBeLessThanOrEqual(1000)
  })
  test('byte-stable: no dates, ids, counters, placeholders or config values; identical on every build', async () => {
    for (const p of Object.values(PROMPTS)) {
      expect(/\d{4}-\d{2}-\d{2}|\{\{|\$\{|TASK-|bd-|epic\/|\d{3,}/.test(p)).toBe(false)
    }
    expect(ROLES.map(file).join()).toBe(ROLES.map(file).join())
  })
  test('each role prompt names its report tool contract', async () => {
    for (const r of ['worker', 'tester', 'reviewer', 'explorer', 'planner'] as const) expect(PROMPTS[r]).toContain('report')
    expect(PROMPTS.worker).toContain('never edit'); expect(PROMPTS.reviewer).toContain('disprove')
  })
})

describe('roster (DESIGN 4.1, A28)', () => {
  test('five types in order; tools are the L1 allowlist; no Grep/Glob (S45)', async () => {
    expect(ROLES).toEqual(['worker', 'tester', 'reviewer', 'explorer', 'planner'])
    expect(TOOLS.worker).toEqual(['Read', 'Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell', 'Monitor', 'TodoWrite', 'mcp__cadre__report', 'mcp__cadre__run_check'])
    expect(TOOLS.tester).toEqual(['Read', 'Write', 'Edit', 'mcp__cadre__report'])
    expect(TOOLS.reviewer).toEqual(['Read', 'mcp__cadre__inspect', 'mcp__cadre__run_check', 'mcp__cadre__report'])
    expect(TOOLS.explorer).toEqual(['Read', 'mcp__cadre__inspect', 'mcp__cadre__report']); expect(TOOLS.planner).toEqual(TOOLS.explorer)   // the planner reads and reports; its report drafts the tasks
    expect([...MAIN_TOOLS, ...Object.values(TOOLS).flat()].some(t => t === 'Grep' || t === 'Glob')).toBe(false)
  })
  test('shipped agents/<role>.md files are byte-equal to file(role): PROMPTS body, TOOLS, 1h TTL except the explorer', async () => {
    expect(Object.keys(BUDGET.agents)).toEqual(['explorer', 'planner', 'reviewer', 'tester', 'worker'])
    for (const r of ROLES) expect((BUDGET.agents as Record<string, string>)[r]).toBe(file(r))
    for (const r of ['worker', 'tester', 'reviewer', 'planner'] as const) expect(file(r)).toContain('experimental:\n  cacheTtl: 1h\n')
    expect(file('explorer')).not.toContain('cacheTtl'); expect(file('explorer')).toContain('effort: low')
    expect(file('worker').endsWith(`---\n${PROMPTS.worker}\n`)).toBe(true)
  })
  test('capabilities: only the worker has a shell; reviewer/explorer cannot write; the tester cannot shell', async () => {
    const has = (r: keyof typeof TOOLS, t: string) => TOOLS[r].includes(t)
    expect(has('worker', 'Bash')).toBe(true)
    for (const r of ['tester', 'reviewer', 'explorer'] as const) expect(['Bash', 'PowerShell', 'Monitor'].some(t => has(r, t))).toBe(false)
    for (const r of ['reviewer', 'explorer'] as const) expect(['Edit', 'Write', 'NotebookEdit'].some(t => has(r, t))).toBe(false)
  })
  test('main has no shell and no second loop owner; it keeps Task*/Agent/AskUserQuestion', async () => {
    for (const t of ['Bash', 'PowerShell', 'Monitor', 'CronCreate', 'CronDelete', 'ScheduleWakeup', 'TodoWrite']) expect(MAIN_TOOLS.includes(t)).toBe(false)
    for (const t of ['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'Agent', 'AskUserQuestion', 'SendMessage', 'mcp__cadre__inspect']) expect(MAIN_TOOLS.includes(t)).toBe(true)
  })
  test('mcpAllow extends the worker only', async () => {
    expect(allowlist('worker', ['mcp__x__y'])).toContain('mcp__x__y'); expect(allowlist('tester', ['mcp__x__y'])).not.toContain('mcp__x__y')
  })
  test('model and effort from the standard-risk cell (explorer: its own); default effort is left out', async () => {
    const [w, , , e] = ROLES.map(r => spec(r, cfg()))
    expect(w).toMatchObject({ model: 'haiku', effort: 'high' }); expect('effort' in spec('worker', { ...cfg(), roles: { worker: { byRisk: { standard: { model: 'sonnet', effort: 'default' } } } } })).toBe(false); expect(e).toMatchObject({ model: 'haiku', effort: 'low' })
    expect(spec('worker', { ...cfg(), roles: { worker: { byRisk: { standard: { model: 'opus', effort: 'high' } } } } })).toMatchObject({ model: 'opus', effort: 'high' })
    expect(spec('worker', { ...cfg(), roles: {} })).not.toHaveProperty('model')
    expect('omitClaudeMd' in w).toBe(false)
  })
})
