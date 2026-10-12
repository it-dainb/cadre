import { describe, expect, test } from 'claude-code/testing'
import { Bd } from '../task-management/adapters/beads/bd'
import { dirOf, moveStore } from '../task-management/adapters/beads/layout'
import { fakeHost } from './support'
import { isProt } from '../core/git'
import type { Host } from '../types'
import type { TaskStore } from '../task-management/store'

const ok = { exitCode: 0, stdout: '{"data":{}}', stderr: '' }
// repo whose folders are `dirs`; run records argv, `mv` really renames the entries in `dirs`
function repo(dirs: string[], exclude = '') {
  const files: Record<string, string> = { '/repo/.git/info/exclude': exclude }, calls: string[][] = [], d = new Set(dirs)
  const h = fakeHost({ files }) as Host
  Object.assign(h, {
    stat: async (p: string) => (d.has(p) ? { kind: 'dir' } : undefined),
    run: async (argv: string[]) => {
      calls.push(argv)
      if (argv[0] === 'mv') { d.delete(argv[1]); d.add(argv[2]) }
      return { exitCode: 0, stdout: argv[0] === 'git' ? '.git/info/exclude\n' : '', stderr: '' }
    },
  })
  return { h, files, calls, d }
}
const fake = (tasks: { id: string; category: string }[], answers: (dir?: string) => boolean = () => true) =>
  (dir?: string) => ({ list: async () => tasks, probe: async () => ({ ok: answers(dir) }) }) as unknown as TaskStore

describe('task store folder', () => {
  test('every bd call carries BEADS_DIR when a store folder is set, and none otherwise', async () => {
    const seen: any[] = []
    const run = async (argv: readonly string[], init?: any) => { seen.push(init.env); return { ...ok, stdout: argv[1] === 'events' ? '{"x":1}' : '{"data":{}}' } }
    const a = new Bd({ run, cwd: '/repo', actor: 'a', dir: '/repo/.cadre/store' }), b = new Bd({ run, cwd: '/repo', actor: 'a' })
    await a.call(['list']); await a.lines(['events', 'tail']); await b.call(['list'])
    expect(seen[0].BEADS_DIR).toBe('/repo/.cadre/store'); expect(seen[1].BEADS_DIR).toBe('/repo/.cadre/store'); expect(seen[2]).not.toHaveProperty('BEADS_DIR')
  })
  test('fresh repo and moved repo use .cadre/store; a repo with only .beads keeps it', async () => {
    expect(await dirOf(repo([]).h, '/repo')).toBe('/repo/.cadre/store')
    expect(await dirOf(repo(['/repo/.beads']).h, '/repo')).toBeUndefined()
    expect(await dirOf(repo(['/repo/.beads', '/repo/.cadre/store']).h, '/repo')).toBe('/repo/.cadre/store')
  })
  test('move: a running task refuses and moves nothing', async () => {
    const r = repo(['/repo/.beads']), out = await moveStore(r.h, '/repo', fake([{ id: 'p.1', category: 'active' }]))
    expect(out).toContain('1 task(s) are running'); expect(r.calls.some(c => c[0] === 'mv')).toBe(false)
  })
  test('move: success renames .beads, adds the exclude lines once', async () => {
    const r = repo(['/repo/.beads'], '.beads/\n'), open = fake([{ id: 'p.1', category: 'done' }])
    expect(await moveStore(r.h, '/repo', open)).toBe('task store moved to .cadre/store'); expect(r.d.has('/repo/.cadre/store')).toBe(true); expect(r.d.has('/repo/.beads')).toBe(false)
    expect(r.files['/repo/.git/info/exclude']).toBe('.beads/\n.cadre/store/\n.cadre/store.gate.lock\n')
    expect(await moveStore(r.h, '/repo', open)).toContain('already')
  })
  test('move: a store that does not answer from its new place is moved back', async () => {
    const r = repo(['/repo/.beads'], '.beads/\n'), out = await moveStore(r.h, '/repo', fake([], dir => dir === undefined))
    expect(out).toContain('back in .beads'); expect(r.d.has('/repo/.beads')).toBe(true); expect(r.d.has('/repo/.cadre/store')).toBe(false); expect(r.files['/repo/.git/info/exclude']).toBe('.beads/\n')
  })
  test('the fence owns the store folder (writes under .cadre/store are protected) and the effect check leaves .cadre out', async () => {
    expect(isProt('.cadre/store/embeddeddolt/x')).toBe(true); expect(isProt('.cadre/store.gate.lock')).toBe(true)
    expect(await Bun.file(new URL('../core/effect.ts', import.meta.url)).text()).toContain(":(exclude).cadre'")
  })
})
