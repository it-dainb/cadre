import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Ledger } from '../src/ledger.mjs'
import { InsufficientFunds } from '../src/errors.mjs'
const two = (a, b) => { const l = new Ledger(); l.open('a'); l.open('b'); if (a) l.deposit('a', a); if (b) l.deposit('b', b); return l }
const bal = l => [l.balance('a'), l.balance('b')]
test('S1', () => { const l = two(500, 0); l.transfer('a', 'b', 200); assert.deepEqual(bal(l), [300, 200]) })
test('S2', () => { const l = two(100, 0); assert.throws(() => l.transfer('a', 'b', 150), e => e instanceof InsufficientFunds && e instanceof Error && e.name === 'InsufficientFunds' && e.account === 'a' && e.needed === 150 && e.available === 100); assert.deepEqual(bal(l), [100, 0]) })
test('S3', () => { const l = two(100, 0); for (const x of [0, 1.5, -3]) assert.throws(() => l.transfer('a', 'b', x), RangeError); assert.deepEqual(bal(l), [100, 0]) })
test('S4', () => { const l = two(100, 0); assert.throws(() => l.transfer('a', 'zz', 10)); assert.throws(() => l.transfer('zz', 'a', 10)); assert.deepEqual(bal(l), [100, 0]) })
