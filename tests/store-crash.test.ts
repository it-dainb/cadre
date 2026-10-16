// The file store at Host-call granularity: an in-memory fs whose four sh scripts are emulated (inode identity kept for `ln`/`-ef`); a kill after
// every Host call, two writers over every schedule of their calls, a late ln after a timeout, a writer and a compactor suspended across a compaction.
// tests/git/store-crash.test.mjs runs the same store on real sh/ln/mv/sync.
import { describe, expect, test } from 'claude-code/testing'
import { FileStore, SCRIPTS, type FileHost } from '../task-management/adapters/file/store'
import { MemoryStore } from '../task-management/adapters/memory/store'
import { contract } from './store-contract'

type Fs = Map<string, { t: string }>
const D = '/r/.cadre/state', reg = {} as any
let r = 0   // rand: unique across hosts, as op ids are across sessions
const kind = (argv: readonly string[]) => (Object.keys(SCRIPTS) as (keyof typeof SCRIPTS)[]).find(k => argv[2].endsWith(SCRIPTS[k]))!
const under = (fs: Fs, dir: string) => [...fs.keys()].filter(p => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/')).sort()
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)
function sh(fs: Fs, argv: readonly string[]): { exitCode: number; stdout: string; stderr: string } {
  const a = argv.slice(4), ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '' }), num = (n: string) => /^\d+$/.test(n)
  switch (kind(argv)) {
    case 'scan': {
      const [d, since, full] = a, out: string[] = [], mk = (k: string) => k + under(fs, `${d}/j`).map(base).filter(n => n.startsWith('snap.')).map(n => ` ${n.slice(5)}`).join('')
      if (full === '1') { out.push(mk('M')); for (const p of under(fs, `${d}/d`)) out.push(`D ${base(p)} ${fs.get(p)!.t}`) }
      let h = 0; for (const p of under(fs, `${d}/j`)) { const n = base(p); if (n.startsWith('snap.')) out.push(`S ${fs.get(p)!.t}`); else if (num(n)) { h = Math.max(h, Number(n)); if (Number(n) > Number(since)) out.push(`E ${n} ${fs.get(p)!.t}`) } }
      out.push(`H ${h}`); if (full === '1') out.push(mk('N'))
      return ok(out.join('\n'))
    }
    case 'commit': {
      const [tmp, dst, j, s] = a, f = fs.get(tmp); if (!f) return { exitCode: 2, stdout: '', stderr: 'no tmp' }
      fs.delete(tmp); if (fs.has(dst)) return { exitCode: 17, stdout: '', stderr: '' }
      fs.set(dst, f)
      if (under(fs, j).some(p => base(p).startsWith('snap.') && Number(base(p).slice(5)) >= Number(s))) { if (fs.get(dst) === f) fs.delete(dst); return { exitCode: 18, stdout: '', stderr: '' } }
      return ok()
    }
    case 'compact': {
      const [d, n, t] = a, cut = a.indexOf('--')
      for (let i = 3; i < cut; i += 2) fs.set(a[i + 1], fs.get(a[i])!), fs.delete(a[i])
      fs.set(`${d}/j/snap.${n}`, fs.get(t)!); fs.delete(t)
      for (const p of under(fs, `${d}/j`)) { const b = base(p); if (b.startsWith('snap.') ? Number(b.slice(5)) < Number(n) : num(b) && Number(b) <= Number(n)) fs.delete(p) }
      for (const f of a.slice(cut + 1)) fs.delete(`${d}/d/${f}`)
      return ok()
    }
    case 'probe': return ok()
  }
}
// a Host over `fs`; `gate` runs before every call (scheduling, parking), `kill` throws after the k-th call completes
function hostOf(fs: Fs, o: { gate?: (what: string, argv?: readonly string[]) => Promise<void>; kill?: number; run?: (argv: readonly string[]) => any } = {}): FileHost & { calls: number } {
  let t = 1_700_000_000_000
  const h = {
    calls: 0,
    step: async <T>(what: string, f: () => T, argv?: readonly string[]): Promise<T> => { await o.gate?.(what, argv); if (o.kill && h.calls >= o.kill) throw new Error('killed'); const v = f(); if (++h.calls === o.kill) throw new Error('killed'); return v },   // dead after call k
    now: () => h.step('now', () => (t += 1000)), rand: () => (++r).toString(16).padStart(8, '0'),
    write: (p: string, s: string) => h.step('write', () => { fs.set(p, { t: s }) }),
    run: (argv: readonly string[]) => h.step('run', () => o.run?.(argv) ?? sh(fs, argv), argv),
  }
  return h
}
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: any) => e?.code ?? e?.message)
const seqs = (fs: Fs) => under(fs, `${D}/j`).map(base).filter(n => /^\d+$/.test(n)).map(Number).sort((x, y) => x - y)
async function seeded() {
  const fs: Fs = new Map(), a = new FileStore(hostOf(fs), D, 'A')
  await a.init({ types: reg, journal: true }); const e = await a.createEpic('E', 'g'); const t = await a.createDraft({ title: 't', description: '', type: 'feature', parent: e }); await a.approve([t.id])
  return { fs, a, id: t.id }
}

contract('file (emulated sh)', () => new FileStore(hostOf(new Map()), D, 's1'))
contract('memory, journal-seq minter', () => { let s = 0; return new MemoryStore(() => 1_700_000_000_000, () => `c-${++s}-1`) })

describe('file store crash safety', () => {
  test('a kill after every Host call of a write and of a compaction: last committed revision, no torn doc, the next session writes on', async () => {
    for (const what of ['meta', 'compact'] as const) {
      for (let k = 1; ; k++) {
        const { fs, id } = await seeded(), r0 = (await new FileStore(hostOf(fs), D, 'R').get(id)).revision!
        const h = hostOf(fs, { kill: k }), s = new FileStore(h, D, 'K')
        const res = await code(what === 'meta' ? s.setMeta(id, { x: '1' }, 'k') : s.compact(0))
        const after = await new FileStore(hostOf(fs), D, 'B').get(id)
        if (what === 'meta') expect([r0, String(Number(r0) + 1)]).toContain(after.revision!); else expect(after.revision).toBe(r0)
        expect(after.meta.x === '1').toBe(after.revision !== r0)
        expect((await new FileStore(hostOf(fs), D, 'B').setMeta(id, { y: '1' }, 'b')).revision).toBe(String(Number(after.revision) + 1))
        if (res !== 'killed') break
      }
    }
  })

  // 256 schedules, each a fresh seeded store (about 1.5 ms apiece): 0.3-0.7 s alone, 1.3 s in the full suite, and past the kit's 5 s default once when
  // several suites shared the machine. The work is fixed; the default measured the load.
  test('two writers over every schedule of their Host calls: each write lands once, a CAS has one winner, one entry per seq', { timeoutMs: 30_000 }, async () => {
    for (let mask = 0; mask < 256; mask++) {
      const { fs, id } = await seeded(), r0 = (await new FileStore(hostOf(fs), D, 'R').get(id)).revision!
      const waiting = new Map<string, () => void>(); let live = 2, i = 0
      const pick = () => { if (!waiting.size || waiting.size < live) return; const want = (mask >> (i++ % 8)) & 1 ? 'B' : 'A', w = waiting.has(want) ? want : [...waiting.keys()][0]; const go = waiting.get(w)!; waiting.delete(w); go() }
      const gate = (who: string) => () => new Promise<void>(r => { waiting.set(who, r); pick() })
      const done = <T>(p: Promise<T>) => p.finally(() => { live--; pick() })
      const A = new FileStore(hostOf(fs, { gate: gate('A') }), D, 'A'), B = new FileStore(hostOf(fs, { gate: gate('B') }), D, 'B')
      const [ra, rb] = await Promise.all([done(code(A.setMeta(id, { a: '1' }, 'a', r0))), done(code(B.setMeta(id, { b: '1' }, 'b', r0)))])
      expect([ra, rb].sort()).toEqual(['GuardMismatch', 'ok'])   // both CAS on r0: exactly one wins
      const t = await new FileStore(hostOf(fs), D, 'C').get(id)
      expect(t.revision).toBe(String(Number(r0) + 1)); expect(Object.keys(t.meta)).toEqual([ra === 'ok' ? 'a' : 'b'])
      expect(seqs(fs)).toEqual(seqs(fs).map((_, j) => j + 1))
    }
  })

  test('two ops of one session on one doc at once both land, in turn', async () => {
    const { fs, a, id } = await seeded(), r0 = Number((await a.get(id)).revision)
    await Promise.all([a.setMeta(id, { p: '1' }, 'a'), a.setMeta(id, { q: '1' }, 'a'), a.heartbeat(id).catch(() => {})])
    const t = await new FileStore(hostOf(fs), D, 'C').get(id); expect(t.meta).toEqual({ p: '1', q: '1' }); expect(Number(t.revision)).toBe(r0 + 2)
  })

  test('a late ln after a timeout: the same call returns the committed result, no second entry', async () => {
    const { fs, id } = await seeded(); let late: (() => unknown) | undefined
    const s = new FileStore(hostOf(fs, { run: argv => kind(argv) === 'commit' && !late ? (late = () => sh(fs, argv), { exitCode: 1, stdout: '', stderr: 'aborted: still running after 120000ms' }) : undefined }), D, 'S')
    expect(await code(s.setMeta(id, { x: '1' }, 's'))).toBe('Timeout'); late!()
    const n = seqs(fs).length, t = await s.setMeta(id, { x: '1' }, 's')
    expect(seqs(fs).length).toBe(n); expect(t.meta.x).toBe('1'); expect((await new FileStore(hostOf(fs), D, 'C').get(id)).revision).toBe(t.revision)
  })

  test('a writer suspended across a compaction: its ln hits a folded slot, is unlinked, and the op redoes on the head', async () => {
    const { fs, a, id } = await seeded(); let park: Promise<void> | undefined, wake = () => {}, saw18 = false
    const s = new FileStore(hostOf(fs, {
      gate: async (w, argv) => { if (w === 'run' && argv && kind(argv) === 'commit' && !park) { park = new Promise(r => (wake = r)); await park } },
      run: argv => { if (kind(argv) !== 'commit') return undefined; const r = sh(fs, argv); saw18 ||= r.exitCode === 18; return r },
    }), D, 'S')
    const p = s.setMeta(id, { s: '1' }, 's'); while (!park) await Promise.resolve()
    for (let i = 0; i < 3; i++) await a.setMeta(id, { [`a${i}`]: '1' }, 'a')
    const n = await a.compact(0); expect(seqs(fs)).toEqual([]); wake()
    const t = await p; expect(saw18).toBe(true); expect(t.meta).toMatchObject({ s: '1', a2: '1' })
    expect(seqs(fs)).toEqual([n + 1]); expect(await new FileStore(hostOf(fs), D, 'C').get(id)).toEqual(t)
  })

  test('a compactor suspended before its doc mvs lands old docs and an old snap after a newer compaction: readers still see the head', async () => {
    const { fs, a, id } = await seeded(); let park: Promise<void> | undefined, wake = () => {}
    const c = new FileStore(hostOf(fs, { gate: async (w, argv) => { if (w === 'run' && argv && kind(argv) === 'compact' && !park) { park = new Promise(r => (wake = r)); await park } } }), D, 'C')
    await a.setMeta(id, { v: '1' }, 'a')
    const p = c.compact(0); while (!park) await Promise.resolve()
    await a.setMeta(id, { v: '2' }, 'a'); await a.compact(0); await a.setMeta(id, { w: '1' }, 'a'); wake(); await p
    const t = await new FileStore(hostOf(fs), D, 'R').get(id); expect(t.meta).toEqual({ v: '2', w: '1' })
    expect((await a.setMeta(id, { z: '1' }, 'a')).revision).toBe(String(Number(t.revision) + 1))
  })

  test('a full scan paused between its doc and journal passes across a fold rescans: no stale after-image is committed', async () => {
    const fs: Fs = new Map(), b = new FileStore(hostOf(fs), D, 'B')
    await b.init({ types: reg, journal: true }); const ep = await b.createEpic('e', 'g'), id = (await b.createDraft({ title: 't', description: '', type: 'feature', parent: ep })).id
    for (let i = 1; i <= 5; i++) await b.setMeta(id, { c: String(i) }, 'b')
    await b.compact(0); for (let i = 6; i <= 25; i++) await b.setMeta(id, { c: String(i) }, 'b')   // docs hold c=5, entries c=6..25
    let park: Promise<void> | undefined, wake = () => {}
    const split = { run: async (argv: readonly string[]) => {   // the first full scan: docs + first marker now, the rest after the fold
      if (kind(argv) !== 'scan' || argv[6] !== '1' || park) return sh(fs, argv)
      const pre = sh(fs, argv).stdout.split('\n').filter(l => /^[MD]/.test(l)); park = new Promise(r => (wake = r)); await park
      return { exitCode: 0, stderr: '', stdout: [...pre, ...sh(fs, argv).stdout.split('\n').filter(l => !/^[MD]/.test(l))].join('\n') }
    }, write: async (p: string, s: string) => { fs.set(p, { t: s }) }, now: async () => Date.now(), rand: () => (++r).toString(16).padStart(8, '0') }
    const p = new FileStore(split, D, 'A').setMeta(id, { r: 'a' }, 'a'); while (!park) await Promise.resolve()
    await b.compact(0); wake(); await p
    expect((await new FileStore(hostOf(fs), D, 'C').get(id)).meta).toEqual({ c: '25', r: 'a' })
  })

  test('a doc unlinked under its read (an empty line) rescans instead of hydrating a delete', async () => {
    const { fs, a, id } = await seeded(); await a.compact(0); let torn = false
    const s = new FileStore(hostOf(fs, { run: argv => { if (kind(argv) !== 'scan' || torn) return undefined; torn = true; const o = sh(fs, argv); return { ...o, stdout: o.stdout.replace(new RegExp(`^D ${id}\\.(\\d+) .*$`, 'm'), `D ${id}.$1 `) } } }), D, 'S')
    expect((await s.get(id)).id).toBe(id)
  })

  test('one store per directory and session: a retry after a Timeout through another hook reuses the op id; each view runs on its own Host; warm reads scan only the tail', async () => {
    const { fs, id } = await seeded(), dir = `${D}/of`; for (const [p, f] of [...fs]) if (p.startsWith(`${D}/`)) fs.set(p.replace(D, dir), f)
    let late: (() => unknown) | undefined; const scans: string[] = []
    const h1 = hostOf(fs, { run: argv => { if (kind(argv) === 'scan') scans.push(argv[6]); return kind(argv) === 'commit' && !late ? (late = () => sh(fs, argv), { exitCode: 1, stdout: '', stderr: 'aborted' }) : undefined } })
    expect(await code(FileStore.of(h1, dir, 'S').setMeta(id, { x: '1' }, 's'))).toBe('Timeout'); late!()
    const h2 = hostOf(fs, { run: argv => { if (kind(argv) === 'scan') scans.push(argv[6]); return undefined } }), c1 = h1.calls
    const live = () => under(fs, `${dir}/j`).filter(p => /^\d+$/.test(base(p))).length, n = live(), t = await FileStore.of(h2, dir, 'S').setMeta(id, { x: '1' }, 's')
    expect(h1.calls).toBe(c1); expect(t.meta.x).toBe('1')
    expect(live()).toBe(n)   // no second entry
    expect(scans[0]).toBe('1'); expect(scans.slice(1).every(f => f === '0')).toBe(true)
  })

  test('a lost race backs off and retries past four tries', async () => {
    const { fs, id } = await seeded(); let lost = 0
    const s = new FileStore(hostOf(fs, { run: argv => kind(argv) === 'commit' && lost < 6 ? (lost++, fs.delete(argv[4]), { exitCode: 17, stdout: '', stderr: '' }) : undefined }), D, 'S')
    expect((await s.setMeta(id, { x: '1' }, 's')).meta.x).toBe('1'); expect(lost).toBe(6)
  })

  test('events after compaction keep every entry above the cursor; a cursor below the fold is TooOld', async () => {
    const { fs, a, id } = await seeded()
    for (let i = 0; i < 3; i++) await a.setMeta(id, { [`k${i}`]: '1' }, 'a')
    const cur = (await a.events())!.head; for (let i = 3; i < 5; i++) await a.setMeta(id, { [`k${i}`]: '1' }, 'a')
    expect(await a.compact(2)).toBe(7)                                               // entries 1..7 folded: 4 seed ops + 3 metas
    for (const s of [a, new FileStore(hostOf(fs), D, 'C')]) {
      const ev = (await s.events(cur))!; expect(ev.events.map(e => e.op)).toEqual(['meta', 'meta']); expect(ev.events[0].seq).toBe(String(Number(cur) + 1))
      expect(await code(s.events('4'))).toBe('TooOld')
    }
  })
})
