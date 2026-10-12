import { test } from 'node:test'
import assert from 'node:assert/strict'
import { migrate } from '../src/migrate.mjs'

test('init creates accounts', () => { const db = migrate({ tables: {}, applied: [] }); assert.deepEqual(db.tables.accounts, []); assert.deepEqual(db.applied, ['001', '002']) })
