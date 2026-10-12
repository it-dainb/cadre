import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pick } from './zz-find.mjs'
const { slug } = pick('slug')
const { slugOptions } = pick('slugOptions')
test('S1', () => assert.equal(slug('Hello, World!', { separator: '_' }), 'hello_world'))
test('S2', () => { assert.equal(slug(' Hello, World! '), 'hello-world'); assert.equal(slug('--a--b--'), 'a-b') })
test('S3', () => assert.equal(slug('a.b c', { separator: '.' }), 'a.b.c'))
test('S4', () => assert.throws(() => slug('a b', { separator: '/' }), TypeError))
test('S5', () => assert.deepEqual(slugOptions(), { separator: '-' }))
