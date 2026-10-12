import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Ledger } from '../src/ledger.mjs'
import { total } from '../src/report.mjs'
import { toCents } from '../src/money.mjs'

test('deposit and balance', () => { const l = new Ledger(); l.open('a'); l.deposit('a', 150); assert.equal(l.balance('a'), 150) })
test('total sums cents', () => assert.equal(total([{ at: '2026-01-01', cents: 5 }, { at: '2026-01-02', cents: 7 }]), 12))
test('toCents rounds', () => assert.equal(toCents(1.25), 125))
