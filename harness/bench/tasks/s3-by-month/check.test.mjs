import { test } from 'node:test'
import assert from 'node:assert/strict'
import { byMonth } from '../src/report.mjs'
import { monthKey } from '../src/dates.mjs'
test('S1', () => assert.deepEqual(byMonth([{ at: '2026-01-05', cents: 100 }, { at: '2026-01-20', cents: 50 }, { at: '2026-03-01', cents: 7 }]), { '2026-01': 150, '2026-03': 7 }))
test('S2', () => assert.equal(monthKey('2026-01-31T23:30:00-02:00'), '2026-02'))
test('S3', () => assert.deepEqual(Object.keys(byMonth([{ at: '2026-05-01', cents: 1 }, { at: '2025-12-01', cents: 1 }, { at: '2026-02-01', cents: 1 }])), ['2025-12', '2026-02', '2026-05']))
test('S4', () => assert.deepEqual(byMonth([]), {}))
test('S5', () => { const d = new Date('2026-07-15T10:00:00Z'); assert.equal(monthKey(d), monthKey(d.toISOString())); assert.equal(monthKey(d), '2026-07') })
