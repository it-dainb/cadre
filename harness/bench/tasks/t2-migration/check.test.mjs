import { test } from 'node:test'
import assert from 'node:assert/strict'
import { migrate } from '../src/migrate.mjs'
import * as m001 from '../migrations/001_init.mjs'
import * as m002 from '../migrations/002_currency.mjs'
const fresh = () => ({ tables: {}, applied: [] })
test('S1', () => { const db = migrate(fresh()); assert.deepEqual(db.applied, ['001', '002']); assert.deepEqual(db.tables.accounts, []) })
test('S2', () => { const db = migrate({ tables: { accounts: [{ id: 'a' }] }, applied: ['001'] }); assert.equal(db.tables.accounts[0].currency, 'USD'); assert.deepEqual(db.applied, ['001', '002']) })
test('S3', () => { const db = { tables: { accounts: [{ id: 'a', currency: 'EUR' }] }, applied: [] }; m002.up(db); assert.equal(db.tables.accounts[0].currency, 'EUR') })
test('S4', () => { const order = []; const w = m => ({ id: m.id, up: db => { order.push(m.id); m.up(db) } }); migrate(fresh(), [w(m002), w(m001)]); assert.deepEqual(order, ['001', '002']) })
test('S5', () => { const db = migrate(fresh()); const before = JSON.stringify(db); migrate(db); assert.equal(JSON.stringify(db), before) })
test('S6', () => { const db = fresh(), ran = []; const bad = { id: '005', up: () => { throw new Error('boom') } }, later = { id: '010', up: () => ran.push('010') }
  assert.throws(() => migrate(db, [later, m001, bad]), /boom/); assert.deepEqual(db.applied, ['001']); assert.deepEqual(ran, []) })
test('numeric order', () => { const order = []; const mk = id => ({ id, up: () => order.push(id) }); migrate(fresh(), [mk('10'), mk('9')]); assert.deepEqual(order, ['9', '10']) })
