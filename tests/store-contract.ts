// TaskStore contract (DESIGN 11.1): every implementation (memory, file) must pass this. Not a test file: call `contract(name, make)` from one.
import { describe, expect, test } from 'claude-code/testing'
import type { TaskStore } from '../task-management/store'

const reg = {} as any
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: any) => e?.code as string)

export function contract(name: string, make: () => TaskStore) {
  const fresh = async (journal = true) => { const s = make(); await s.init({ types: reg, journal }); return s }
  const plan = async (s: TaskStore) => { const e = await s.createEpic('E', 'goal'); const d = (title: string, o: object = {}) => s.createDraft({ title, description: title, type: 'feature', parent: e, ...o }); return { e, d } }
  describe(`TaskStore contract: ${name}`, () => {
    test('operations before init throw NotInitialized; init is idempotent; probe works', async () => {
      const s = make()
      expect(await code(s.get('x'))).toBe('NotInitialized'); expect(await code(s.createEpic('a', 'b'))).toBe('NotInitialized')
      await s.init({ types: reg, journal: true }); await s.init({ types: reg, journal: true })
      expect(await s.probe()).toMatchObject({ ok: true, journal: true })
    })
    test('drafts: created as draft, hidden from ready, approve flips to todo, ready lists them', async () => {
      const s = await fresh(); const { e, d } = await plan(s)
      const a = await d('a'); expect(a.category).toBe('draft'); expect(a.nativeStatus).toBe('draft'); expect(a.parent).toBe(e)
      expect(await s.ready(e)).toEqual([])
      await s.approve([a.id]); expect((await s.get(a.id)).category).toBe('todo'); expect(await s.ready(e)).toEqual([a.id])
      expect(await code(s.approve([a.id]))).toBe('Invalid')
    })
    test('amend: todo -> draft; dropDrafts deletes drafts only', async () => {
      const s = await fresh(); const { d } = await plan(s)
      const a = await d('a'), b = await d('b'); await s.approve([a.id]); await s.amend(a.id)
      expect((await s.get(a.id)).category).toBe('draft'); expect(await code(s.amend(b.id))).toBe('Invalid')
      await s.dropDrafts([a.id, b.id]); expect(await code(s.get(a.id))).toBe('NotFound')
      await s.approve([]); const c = await d('c'); await s.approve([c.id]); expect(await code(s.dropDrafts([c.id]))).toBe('Invalid')
    })
    test('ready honours blocks; closing the blocker (done or cancelled) releases the dependant', async () => {
      const s = await fresh(); const { e, d } = await plan(s)
      const a = await d('a'), b = await d('b', { deps: [{ id: (await d('x')).id, type: 'blocks' }] }); await s.link(b.id, { id: a.id, type: 'blocks' })
      const all = (await s.list({ parent: e })).map(t => t.id); await s.approve(all)
      expect((await s.ready(e)).includes(b.id)).toBe(false); expect((await s.ready(e)).includes(a.id)).toBe(true)
      await s.claim(a.id, 'u'); await s.close(a.id, { outcome: 'done' })
      const x = (await s.get(b.id)).deps.find(d => d.id !== a.id)!.id; await s.close(x, { outcome: 'cancelled', note: 'failed: no' })   // deps carry no order guarantee
      expect((await s.ready(e)).includes(b.id)).toBe(true)
    })
    test('conditional-blocks runs only if the upstream failed; waits-for needs the upstream and its children closed', async () => {
      const s = await fresh(); const { e, d } = await plan(s)
      const up = await d('up'), fix = await d('fix', { deps: [{ id: up.id, type: 'conditional-blocks' }] })
      const child = await s.createDraft({ title: 'kid', description: '', type: 'feature', parent: up.id })
      const gate = await d('gate', { deps: [{ id: up.id, type: 'waits-for' }] })
      await s.approve([up.id, fix.id, child.id, gate.id])
      expect((await s.ready(e)).sort()).toEqual([up.id].sort())
      await s.close(up.id, { outcome: 'cancelled', note: 'failed: boom' })
      expect(await s.ready(e)).toEqual([fix.id])                 // fix runs (upstream failed); gate still waits on the open child
      await s.close(child.id, { outcome: 'done' }); expect((await s.ready(e)).sort()).toEqual([fix.id, gate.id].sort())
      const s2 = await fresh(); const p2 = await plan(s2); const u2 = await p2.d('up'), f2 = await p2.d('fix', { deps: [{ id: u2.id, type: 'conditional-blocks' }] })
      await s2.approve([u2.id, f2.id]); await s2.close(u2.id, { outcome: 'done' }); expect(await s2.ready(p2.e)).toEqual([])   // upstream succeeded: never ready
    })
    test('link refuses cycles (self included) among blocking deps', async () => {
      const s = await fresh(); const { d } = await plan(s)
      const a = await d('a'), b = await d('b'), c = await d('c')
      await s.link(b.id, { id: a.id, type: 'blocks' }); await s.link(c.id, { id: b.id, type: 'waits-for' })
      expect(await code(s.link(a.id, { id: c.id, type: 'blocks' }))).toBe('Cycle'); expect(await code(s.link(a.id, { id: a.id, type: 'blocks' }))).toBe('Cycle')
      await s.link(a.id, { id: c.id, type: 'related' })          // non-blocking edges cannot cycle
    })
    test('discoveredFrom adds a typed dep; a gate blocks until resolveGate', async () => {
      const s = await fresh(); const { e, d } = await plan(s)
      const a = await d('a'), f = await d('found', { discoveredFrom: a.id }); expect(f.deps).toContainEqual({ id: a.id, type: 'discovered-from' })
      const g = await d('gated', { gate: { await: 'human' } }); expect(g.deps).toHaveLength(1)
      await s.approve([a.id, f.id, g.id])   // the gate itself is created open
      expect((await s.ready(e)).includes(g.id)).toBe(false); expect((await s.ready(e)).includes(g.deps[0].id)).toBe(false)
      await s.resolveGate(g.deps[0].id, 'ok'); expect((await s.ready(e)).includes(g.id)).toBe(true)
      expect(await code(s.resolveGate(a.id, 'x'))).toBe('Invalid')
    })
    test('claim: todo -> active with assignee + lease; second claim AlreadyClaimed; draft NotClaimable', async () => {
      const s = await fresh(); const { d } = await plan(s)
      const a = await d('a'); expect(await code(s.claim(a.id, 'u1'))).toBe('NotClaimable'); await s.approve([a.id])
      const c = await s.claim(a.id, 'u1'); expect(c).toMatchObject({ category: 'active', assignee: 'u1', nativeStatus: 'in_progress' }); expect(c.leaseUntil).toBeDefined()
      expect(await code(s.claim(a.id, 'u2'))).toBe('AlreadyClaimed')
    })
    test('release / move / resume are guarded by the assignee', async () => {
      const s = await fresh(); const { d } = await plan(s); const a = await d('a'); await s.approve([a.id]); await s.claim(a.id, 'u1')
      expect(await code(s.release(a.id, 'u2', 'x'))).toBe('GuardMismatch'); expect(await code(s.move(a.id, 'review', 'u2'))).toBe('GuardMismatch')
      expect((await s.move(a.id, 'review', 'u1')).category).toBe('review')
      expect((await s.move(a.id, 'blocked', 'u1')).category).toBe('blocked'); expect(await code(s.move(a.id, 'review', 'u1'))).toBe('Invalid')
      expect(await code(s.resume(a.id, 'u2'))).toBe('GuardMismatch'); expect((await s.resume(a.id, 'u1')).category).toBe('active')
      await s.release(a.id, 'u1', 'giving up'); const r = await s.get(a.id); expect(r.category).toBe('todo'); expect(r.assignee).toBeUndefined(); expect(r.leaseUntil).toBeUndefined()
      expect((await s.claim(a.id, 'u2')).assignee).toBe('u2')
    })
    test('heartbeat extends the lease of a claimed task only', async () => {
      const s = await fresh(); const { d } = await plan(s); const a = await d('a'); await s.approve([a.id])
      expect(await code(s.heartbeat(a.id))).toBe('Invalid'); await s.claim(a.id, 'u'); await s.heartbeat(a.id); expect((await s.get(a.id)).leaseUntil).toBeDefined()
    })
    test('setMeta with ifRevision is a CAS: the loser sees GuardMismatch, a retry on the fresh revision wins', async () => {
      const s = await fresh(); const { d } = await plan(s); const a = await d('a'); await s.approve([a.id])
      const r0 = (await s.get(a.id)).revision; await s.setMeta(a.id, { 'cadre.step': 'tester' }, 'u', r0)
      expect(await code(s.setMeta(a.id, { 'cadre.step': 'worker' }, 'v', r0))).toBe('GuardMismatch')
      const r1 = (await s.get(a.id)).revision; expect(r1).not.toBe(r0)
      expect((await s.setMeta(a.id, { 'cadre.step': 'worker' }, 'v', r1)).meta).toEqual({ 'cadre.step': 'worker' })
      expect((await s.setMeta(a.id, { k: 'v' }, 'u')).meta).toEqual({ 'cadre.step': 'worker', k: 'v' })   // no ifRevision: unconditional
    })
    test('close: done|cancelled, note kept; NotClosable twice; ifRevision guards', async () => {
      const s = await fresh(); const { d } = await plan(s); const a = await d('a'), b = await d('b'); await s.approve([a.id, b.id])
      expect(await code(s.close(a.id, { outcome: 'done', ifRevision: 'nope' }))).toBe('GuardMismatch')
      const c = await s.close(a.id, { outcome: 'cancelled', note: 'failed: why' }); expect(c.category).toBe('cancelled'); expect(c.nativeStatus).toBe('closed')
      expect(await code(s.close(a.id, { outcome: 'done' }))).toBe('NotClosable')
      expect((await s.close(b.id, { outcome: 'done', ifRevision: (await s.get(b.id)).revision })).category).toBe('done')
    })
    test('update / setExternalRef / record / list filters', async () => {
      const s = await fresh(); const { e, d } = await plan(s); const a = await d('a')
      expect((await s.update(a.id, { title: 'A2', labels: ['security'], priority: 0 }, 'u'))).toMatchObject({ title: 'A2', labels: ['security'], priority: 0 })
      await s.setExternalRef(a.id, 'pm#7', 'u'); expect((await s.get(a.id)).externalRef).toBe('pm#7')
      const m = await s.record('mission', 'M', 'goal'), dec = await s.record('decision', 'D', 'why', a.id)
      expect((await s.get(m)).type).toBe('milestone'); expect((await s.get(dec)).type).toBe('decision')
      expect((await s.list({ parent: e })).map(t => t.id)).toEqual([a.id]); expect(await s.list({ parent: e, updatedAfter: '2999-01-01' })).toEqual([])
      expect((await s.list({ parent: e, updatedAfter: '1970-01-01' })).length).toBe(1)
    })
    test('get returns copies: mutating one does not change the store', async () => {
      const s = await fresh(); const { d } = await plan(s); const a = await d('a'); const t = await s.get(a.id); t.title = 'hacked'; t.labels.push('x')
      expect((await s.get(a.id)).title).toBe('a'); expect((await s.get(a.id)).labels).toEqual([])
    })
    test('events: the journal lists writes since a cursor; null when the journal is off', async () => {
      const s = await fresh(true); const { d } = await plan(s); await d('a')
      const all = await s.events(); expect(all!.events.length).toBeGreaterThan(0)
      expect(all!.events[0]).toMatchObject({ seq: '1', op: 'create' }); expect(all!.head).toBe(String(all!.events.length))
      expect((await s.events(all!.head))!.events).toEqual([]); expect((await s.events('0', 1))!.events).toHaveLength(1)
      expect(await (await fresh(false)).events()).toBeNull()
    })
    test('control: one repo-wide doc, shallow-merged; ifRevision is a CAS (stores that have it)', async () => {
      const s = make(); if (!s.control || !s.setControl) return   // optional member: the beads adapter has none (last test: its replay is unaffected)
      await s.init({ types: reg, journal: true })
      expect(await s.control()).toEqual({ revision: '0', doc: {} })
      const r1 = await s.setControl({ drive: { session: 'A' } }, '0'); expect(r1).toEqual({ revision: '1', doc: { drive: { session: 'A' } } })
      expect(await code(s.setControl({ drive: { session: 'B' } }, '0'))).toBe('GuardMismatch')
      expect((await s.setControl({ 'sync.pm': 'c1' })).doc).toEqual({ drive: { session: 'A' }, 'sync.pm': 'c1' }); expect((await s.control()).revision).toBe('2')
    })
  })
}
