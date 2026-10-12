import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryStore } from '../src/store.mjs'
import { Ledger } from '../src/ledger.mjs'
import { totals } from '../src/report.mjs'
test('a.S1-2', () => { const s = createMemoryStore(); assert.equal(s.get('x'), undefined); s.put('k', { n: 1 }); assert.deepEqual(s.get('k'), { n: 1 }) })
test('a.S3', () => { const s = createMemoryStore(), o = { n: 1 }; s.put('k', o); o.n = 2; assert.deepEqual(s.get('k'), { n: 1 }); s.get('k').n = 3; assert.deepEqual(s.get('k'), { n: 1 }) })
test('a.S4', () => { const s = createMemoryStore(); for (const k of ['b:1', 'a:2', 'a:1']) s.put(k, 1); assert.deepEqual(s.list('a:'), ['a:1', 'a:2']); assert.deepEqual(s.list(), ['a:1', 'a:2', 'b:1']) })
test('b.S1-2', () => { const s = createMemoryStore(), l1 = new Ledger(s); l1.open('a'); assert.equal(s.get('account:a'), 0); l1.deposit('a', 150); assert.equal(new Ledger(s).balance('a'), 150) })
test('b.S3', () => { const l = new Ledger(); l.open('a'); l.deposit('a', 5); assert.equal(l.balance('a'), 5); assert.throws(() => l.deposit('a', 0), RangeError); assert.throws(() => l.balance('zz')) })
test('b.S4', () => { const s = createMemoryStore(); new Ledger(s).open('a'); assert.throws(() => new Ledger(s).open('a')) })
test('c.S1-3', () => { const s = createMemoryStore(); assert.deepEqual(totals(s), { accounts: 0, cents: 0 }); s.put('account:a', 100); s.put('account:b', 50); s.put('user:x', 999); assert.deepEqual(totals(s), { accounts: 2, cents: 150 }) })
