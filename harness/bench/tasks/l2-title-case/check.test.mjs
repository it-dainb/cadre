import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pick } from './zz-find.mjs'
const { titleCase } = pick('titleCase')
test('S1', () => assert.equal(titleCase('hello world'), 'Hello World'))
test('S2', () => assert.equal(titleCase('  hELLO   wORLD '), 'Hello World'))
test('S3', () => assert.equal(titleCase(''), ''))
