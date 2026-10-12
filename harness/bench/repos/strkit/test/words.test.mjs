import { test } from 'node:test'
import assert from 'node:assert/strict'
import { words } from '../src/words.mjs'

test('words splits on whitespace', () => assert.deepEqual(words(' a  b '), ['a', 'b']))
