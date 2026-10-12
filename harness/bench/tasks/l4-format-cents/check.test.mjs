import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pick } from './zz-find.mjs'
const { formatCents } = pick('formatCents')
test('S1', () => assert.equal(formatCents(123456), '$1,234.56'))
test('S2', () => assert.equal(formatCents(-5), '-$0.05'))
test('S3', () => assert.equal(formatCents(0), '$0.00'))
test('S4', () => assert.equal(formatCents(100000000), '$1,000,000.00'))
