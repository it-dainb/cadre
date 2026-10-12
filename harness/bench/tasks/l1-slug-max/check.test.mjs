import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pick } from './zz-find.mjs'
const { slug, slugMax } = pick('slug', 'slugMax')
test('S1', () => assert.equal(slugMax('Hello, World!', 5), 'hello'))
test('S2', () => assert.equal(slugMax('ab cd ef', 3), 'ab'))
test('S3', () => { for (const s of ['Hello, World!', 'a b', '  x  ']) assert.equal(slugMax(s, 100), slug(s)) })
