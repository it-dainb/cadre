import { describe, expect, test } from 'claude-code/testing'
import { audit, parse, resolveGit, sweep, wrap, writes } from '../core/effect'
import { fakeHost, task } from './support'
import type { Binding } from '../types'

const SHA = (c: string) => c.repeat(40)
// Scripted git: per-tree porcelain records, one ref table, calls recorded. Stash drops the named paths.
function world() {
  const st: Record<string, string[]> = { '/r': [], '/wt/a': [] }, refs: Record<string, string> = { 'refs/heads/main': SHA('1'), 'refs/heads/dev': SHA('2'), 'refs/heads/task': SHA('3') }, calls: string[][] = []
  const run = async (argv: readonly string[]) => {
    const [, , tree, cmd, ...a] = argv; calls.push([...argv])
    if (cmd === 'status') return { exitCode: 0, stdout: st[tree].map(r => r + '\0').join(''), stderr: '' }
    if (cmd === 'rev-parse') return { exitCode: 0, stdout: SHA('0') + '\n', stderr: '' }
    if (cmd === 'for-each-ref') return { exitCode: 0, stdout: Object.entries(refs).map(([r, s]) => `${s} ${r}\n`).join(''), stderr: '' }
    if (cmd === 'stash') { const ps = a.slice(a.indexOf('--') + 1); st[tree] = st[tree].filter(r => !ps.some(p => r.endsWith(' ' + p))); return { exitCode: 0, stdout: '', stderr: '' } }
    if (cmd === 'update-ref') { const [ref, nw, old] = a; if (old && refs[ref] !== old) return { exitCode: 1, stdout: '', stderr: 'cas' }; refs[ref] = nw; return { exitCode: 0, stdout: '', stderr: '' } }
    return { exitCode: 1, stdout: '', stderr: 'unknown' }
  }
  return { st, refs, calls, run }
}
const mod = (p: string) => `1 .M N... 100644 100644 100644 ${SHA('a')} ${SHA('b')} ${p}`
async function mk(effectCheck = 'auto') {
  const w = world(), h = fakeHost()
  h.run = w.run as any
  await h.store.set('policy', { repo: '/r', wtRoot: '/wt', effectCheck })
  await h.board.update(s => ({ ...s, containment: { state: 'contained', unsandboxed: 0 }, tasks: [task('bd-a1', { state: 'active', step: 'worker' })] }))
  await h.bind.update(() => ({ w1: { taskId: 'bd-a1', role: 'worker', step: 'worker', worktree: '/wt/a', sessionId: 's', ctxTokens: 0, startedAt: 0 } as Binding }))
  await sweep(h)   // baseline
  return { w, h, flags: async () => Object.keys((await h.git.read()).flags ?? {}) }
}
const callBy = (h: any, agentId: string | undefined, tool: string, id: string, during: () => void) => wrap(h, { tool, agentId, tool_use_id: id }, async () => { during(); return { result: 'ok' } })

describe('L3 effect (13.1)', () => {
  test('parse: records, renames own their origin path, untracked', () => {
    expect([...parse(`${mod('a b.ts')}\0? new.ts\0`).values()]).toEqual(['a b.ts', 'new.ts'])
    expect([...parse(`2 R. N... 100644 100644 100644 ${SHA('a')} ${SHA('b')} R100 to.ts\0from.ts\0`).values()]).toEqual(['to.ts'])
  })
  test('read tools are skipped; shells, file tools and non-cadre MCP are audited', () => {
    expect(['Read', 'Grep', 'Glob', 'mcp__cadre__report', 'TodoWrite'].map(writes)).toEqual([false, false, false, false, false])
    expect(['Bash', 'Edit', 'Monitor', 'mcp__x__y'].every(writes)).toBe(true)
  })
  test('rule 1: owner writing in its own worktree during its call is fine; a stranger in flight -> quarantine via stash + flag + toast', async () => {
    const { w, h, flags } = await mk()
    await callBy(h, 'w1', 'Edit', 'c1', () => { w.st['/wt/a'].push(mod('src/a.ts')) })
    expect(await flags()).toEqual([]); expect(w.calls.some(c => c[3] === 'stash')).toBe(false)
    await callBy(h, 'zz', 'Bash', 'c2', () => { w.st['/wt/a'].push(mod('src/evil.ts')) })   // an unrelated loop's shell touched w1's tree
    const stash = w.calls.find(c => c[3] === 'stash')!
    expect(stash.slice(2, 6)).toEqual(['/wt/a', 'stash', 'push', '-u']); expect(stash[6]).toBe('-m'); expect(stash[7]).toMatch(/^cadre-q-bd-a1-\d+$/); expect(stash.slice(-2)).toEqual(['--', 'src/evil.ts'])
    expect(await flags()).toEqual(['quarantine:bd-a1']); expect(h.toasts.join()).toContain('quarantined')
    expect(w.st['/wt/a']).toHaveLength(1)   // a.ts stays, evil.ts stashed
  })
  test('rule 1: locked path changed by the owner\'s own shell is quarantined', async () => {
    const { w, h, flags } = await mk(); await h.store.set('policy', { repo: '/r', wtRoot: '/wt', locks: { 'bd-a1': ['src/t.test.ts'] } })
    await callBy(h, 'w1', 'Bash', 'c1', () => { w.st['/wt/a'].push(mod('src/t.test.ts'), mod('src/ok.ts')) })
    expect(w.calls.find(c => c[3] === 'stash')!.slice(-2)).toEqual(['--', 'src/t.test.ts']); expect(await flags()).toEqual(['quarantine:bd-a1'])
  })
  test('rule 2: main checkout changed while a non-main loop had a call in flight -> quarantine; otherwise flag git:main-dirty', async () => {
    const { w, h, flags } = await mk()
    await callBy(h, 'w1', 'Bash', 'c1', () => { w.st['/r'].push(mod('x.ts')) })
    expect(w.calls.some(c => c[2] === '/r' && c[3] === 'stash')).toBe(true); expect(await flags()).toEqual(['quarantine:main'])
    const m = await mk(); await sweep(m.h)
    m.w.st['/r'].push(mod('human.ts')); await sweep(m.h)   // human edit, no agent window
    expect(m.w.calls.some(c => c[3] === 'stash')).toBe(false); expect(await m.flags()).toEqual(['git:main-dirty'])
  })
  test('rule 3: protected ref moved in a human window -> git:<branch>; in an agent window -> git:<branch>:agent, restore by CAS', async () => {
    const human = await mk(); human.w.refs['refs/heads/dev'] = SHA('9'); await sweep(human.h)
    expect(await human.flags()).toEqual(['git:dev'])
    const { w, h, flags } = await mk()
    await callBy(h, 'w1', 'Bash', 'c1', () => { w.refs['refs/heads/main'] = SHA('8'); w.refs['refs/heads/task'] = SHA('7') })   // task branch is not protected
    expect(await flags()).toEqual(['git:main:agent'])
    expect(await resolveGit(h, 'git:main:agent', 'restore')).toEqual({ ok: true })
    expect(w.refs['refs/heads/main']).toBe(SHA('1')); expect(Object.keys(w.refs).some(r => r.startsWith('refs/cadre/quarantine/main-'))).toBe(true)
    expect(Object.values(w.refs).includes(SHA('8'))).toBe(true); expect(await flags()).toEqual([])
    await sweep(h); expect(await flags()).toEqual([])   // re-baselined: no repeat flag
  })
  test('restore is CAS: a ref that moved again is not clobbered', async () => {
    const { w, h } = await mk()
    await callBy(h, 'w1', 'Bash', 'c1', () => { w.refs['refs/heads/main'] = SHA('8') })
    w.refs['refs/heads/main'] = SHA('6')
    expect(await resolveGit(h, 'git:main:agent', 'restore')).toMatchObject({ ok: false }); expect(w.refs['refs/heads/main']).toBe(SHA('6'))
    expect(await resolveGit(h, 'git:main:agent', 'keep')).toEqual({ ok: true })
  })
  test('gitBusy skips; an epoch change re-baselines instead of judging', async () => {
    const { w, h, flags } = await mk()
    await h.git.update(g => ({ ...g, busy: true })); w.st['/r'].push(mod('m.ts')); await sweep(h); expect(w.calls.filter(c => c[3] === 'stash')).toEqual([]); expect(await flags()).toEqual([])
    await h.git.update(g => ({ ...g, busy: false, epoch: g.epoch + 1 })); await sweep(h); expect(await flags()).toEqual([])
    await sweep(h); expect(await flags()).toEqual([])   // baseline absorbed m.ts
  })
  test('effectCheck off audits nothing; sandbox contained audits only main + caller (a foreign tree waits for the sweep)', async () => {
    const off = await mk('off'); off.w.st['/r'].push(mod('m.ts')); await sweep(off.h); expect(await off.flags()).toEqual([])
    const { w, h, flags } = await mk(); const before = w.calls.length
    await callBy(h, 'w1', 'Bash', 'c1', () => {}); expect(w.calls.slice(before).every(c => c[2] === '/r' || c[2] === '/wt/a')).toBe(true)
    w.st['/wt/a'].push(mod('q.ts')); await sweep(h); expect(await flags()).toEqual(['quarantine:bd-a1'])   // no w1 call in flight: stash-quarantined at the sweep
  })
})
