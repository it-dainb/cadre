import { test } from 'node:test'
import assert from 'node:assert/strict'
import { truncateWords } from '../src/words.mjs'
test('S1', () => assert.equal(truncateWords('the quick brown fox', 2), 'the quick...'))
test('S2', () => assert.equal(truncateWords('the quick', 5), 'the quick'))
test('S3', () => assert.equal(truncateWords(' a  b ', 2), 'a b'))
test('S4', () => { assert.equal(truncateWords('a b', 0), '...'); assert.equal(truncateWords('  ', 0), '') })
