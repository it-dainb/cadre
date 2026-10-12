import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sign, verify } from '../src/auth/token.mjs'
const t = sign({ sub: 'a' }, 's3cret', { ttlSec: 60, now: 0 })
test('S1', () => assert.deepEqual(verify(t, 's3cret', { now: 59000 }), { sub: 'a' }))
test('S2', () => assert.throws(() => verify(t, 's3cret', { now: 60000 }), /^Error: expired token/))
test('S3', () => { const [b, s] = t.split('.'); const c = b[3] === 'A' ? 'B' : 'A'; assert.throws(() => verify(`${b.slice(0, 3)}${c}${b.slice(4)}.${s}`, 's3cret', { now: 0 }), /invalid token/) })
test('S3b forged exp', () => { const [, s] = t.split('.'); const b = Buffer.from(JSON.stringify({ sub: 'a', exp: 9e9 })).toString('base64url'); assert.throws(() => verify(`${b}.${s}`, 's3cret', { now: 0 }), /invalid token/) })
test('S4', () => assert.throws(() => verify(t, 'other', { now: 0 }), /invalid token/))
test('S5', () => { for (const x of ['abc', 'a.b.c', '.']) assert.throws(() => verify(x, 's3cret', { now: 0 }), /invalid token/) })
test('S6', () => { assert.throws(() => sign({}, '', { ttlSec: 1 }), TypeError); assert.throws(() => verify(t, ''), TypeError) })
test('format', () => { const [b, s] = t.split('.'); assert.equal(JSON.parse(Buffer.from(b, 'base64url')).exp, 60); assert.match(s, /^[A-Za-z0-9_-]{43}$/) })
