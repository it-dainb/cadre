// Dev-only: who still holds a plan (core/session.held), against real processes. A crashed session's stamp frees the plan once its process is gone from this machine.
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { hostname } from 'node:os'

const S = await import('../../core/session.ts')
const run = (argv) => new Promise(res => execFile(argv[0], argv.slice(1), (err, stdout, stderr) => res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))
const cell = v => ({ read: async () => v, update: async fn => (v = fn(v)) })
const kv = new Map(), clock = { now: 1_000_000 }
const hostOf = (session) => ({ run, now: async () => clock.now, rand: () => 'r', cwd: async () => '/repo', secret: cell({ session }), store: { get: async k => kv.get(k), set: async (k, v) => { kv.set(k, v) }, del: async k => { kv.delete(k) } } })

test('this process stamps "<host> <pid>"; a stamp whose process died on this machine is gone at once, a live one waits the window out', async () => {
  const me = hostOf('S2'); S.proc.id = 'P2'; S.proc.pid = undefined
  await S.stampAlive(me)
  const [, own] = [...kv.values()][0].S2.pid.split(' '); assert.equal(Number(own), process.pid)   // sh's parent is this process
  const child = spawn('sleep', ['30']), [k] = kv.keys()
  kv.set(k, { ...kv.get(k), S1: { p: 'P1', at: clock.now, pid: `${(await run(['uname', '-n'])).stdout.trim()} ${child.pid}` } })
  assert.equal(await S.held(me, 'S1'), 'other')
  child.kill('SIGKILL'); await new Promise(r => child.on('exit', r))
  assert.equal(await S.held(me, 'S1'), 'gone')
  kv.set(k, { ...kv.get(k), S1: { p: 'P1', at: clock.now, pid: `not-${hostname()} ${child.pid}` } })
  assert.equal(await S.held(me, 'S1'), 'other')   // another machine: the 30 s window decides
  clock.now += 30_000; assert.equal(await S.held(me, 'S1'), 'gone')
})
