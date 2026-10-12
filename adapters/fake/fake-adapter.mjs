#!/usr/bin/env node
// Fake tracker/UI adapter (dev/test only): speaks cadre-adapter v1 (docs/protocol.md). State = one JSON file ($FAKE_ADAPTER_STATE) so
// separate one-shot spawns share a "remote"; tests edit that file to simulate a remote edit. Never creates projects.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const FILE = process.env.FAKE_ADAPTER_STATE ?? `${process.env.TMPDIR ?? '/tmp'}/fake-adapter.json`
const st = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}
st.tasks ??= {}; st.seq ??= 0; st.delivered ??= []; st.commands ??= []; st.writes ??= 0; st.projects ??= [{ id: 'p1', name: 'Demo' }]
const save = () => { st.writes++; writeFileSync(FILE, JSON.stringify(st, null, 1)) }
const out = o => process.stdout.write(JSON.stringify({ v: 1, ...o }))
const fail = (code, message, extra = {}) => out({ ok: false, error: { code, message, ...extra } })
const die = (...a) => { fail(...a); process.exit(0) }

let input = ''; for await (const c of process.stdin) input += c
let req; try { req = JSON.parse(input) } catch { die('Invalid', 'request is not JSON') }
if (req.protocol !== 'cadre-adapter' || req.v !== 1) die('Invalid', `unsupported protocol ${req.protocol} v${req.v}`)
if (st.mode === 'offline') die('Offline', 'tracker unreachable')
if (st.mode === 'ratelimited') die('RateLimited', 'slow down', { retryAfterMs: 45000 })
if (st.mode === 'auth' && req.method !== 'ping' && req.method !== 'describe') die('Auth', 'bad credentials')
const p = req.params ?? {}, ok = result => out({ ok: true, result })

switch (req.method) {
  case 'ping': ok({ pong: true }); break
  case 'describe': ok({ name: 'fake', version: '1.0.0', caps: ['sync', 'events'], subscribe: st.subscribe }); break
  case 'describeSchema': ok({ trackers: ['Task', 'Bug', 'Feature'], statuses: ['New', 'In Progress', 'In Review', 'Blocked', 'Closed', 'Rejected'], priorities: ['high', 'normal', 'low'], versions: ['v1'], customFields: st.customFields ?? [{ name: 'cadre_ref', required: false }] }); break
  case 'listProjects': ok(st.projects); break
  case 'validateAccess': ok({ auth: true, perms: st.perms ?? { view: true, add: true, edit: true }, missing: [] }); break   // no writes
  case 'push': {
    const results = []
    for (const t of p.tasks) {
      const rid = t.rid ?? Object.keys(st.tasks).find(r => st.tasks[r].localId === t.localId) ?? `r${Object.keys(st.tasks).length + 1}`
      const cur = st.tasks[rid] ?? { localId: t.localId, fields: {}, etag: '0', seq: 0 }, next = { ...cur.fields, ...t.fields }
      if (JSON.stringify(next) !== JSON.stringify(cur.fields) || !st.tasks[rid]) { cur.fields = next; cur.etag = String(Number(cur.etag) + 1); cur.seq = ++st.seq; cur.pushes = (cur.pushes ?? 0) + 1 }
      if (t.kind) { cur.kind = t.kind; cur.on = t.on }
      if (t.note) (cur.comments ??= []).push(t.note)
      st.tasks[rid] = cur; results.push({ localId: t.localId, rid, etag: cur.etag, rUpdated: cur.seq })
    }
    save(); ok({ results }); break
  }
  case 'pull': {
    const since = Number(p.since ?? 0)
    ok({ tasks: Object.entries(st.tasks).filter(([, t]) => t.seq > since).map(([rid, t]) => ({ rid, localId: t.localId, etag: t.etag, updatedAt: t.seq, fields: t.fields })), next: String(st.seq) }); break
  }
  case 'deliver': {
    st.delivered.push({ events: p.events, snapshot: p.snapshot, reset: !!p.reset })
    const commands = st.commands.splice(0); save()
    ok({ ack: Math.max(0, ...p.events.map(e => e.seq)), commands }); break
  }
  default: fail('Unsupported', `unknown method ${req.method}`)
}
