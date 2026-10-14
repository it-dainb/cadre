// minimal describe/test/expect over node:test + node:assert, enough for tests/store-contract.ts
import { describe, test as t } from 'node:test'
import assert from 'node:assert/strict'
export { describe }
export const test = (name, fn) => t(name, () => fn())
const sub = (a, b) => Object.entries(b).every(([k, v]) => (v && typeof v === 'object' ? sub(a?.[k], v) : a?.[k] === v))
const m = (a, neg) => {
  const ok = (c, msg) => assert.ok(neg ? !c : c, `${neg ? 'not ' : ''}${msg}: ${JSON.stringify(a)}`)
  return {
    toBe: b => ok(Object.is(a, b), `toBe ${JSON.stringify(b)}`), toEqual: b => { try { assert.deepEqual(a, b); ok(true, '') } catch (e) { if (!neg) throw e } },
    toMatchObject: b => ok(sub(a, b), `toMatchObject ${JSON.stringify(b)}`), toContainEqual: b => ok(a.some(x => JSON.stringify(x) === JSON.stringify(b)), `toContainEqual ${JSON.stringify(b)}`),
    toHaveLength: n => ok(a.length === n, `toHaveLength ${n}`), toBeDefined: () => ok(a !== undefined, 'toBeDefined'), toBeUndefined: () => ok(a === undefined, 'toBeUndefined'),
    toBeNull: () => ok(a === null, 'toBeNull'), toBeGreaterThan: n => ok(a > n, `> ${n}`), toBeLessThanOrEqual: n => ok(a <= n, `<= ${n}`), toContain: x => ok(a.includes(x), `toContain ${x}`),
    toMatch: r => ok(typeof r === 'string' ? a.includes(r) : r.test(a), `toMatch ${r}`),
  }
}
export const expect = a => ({ ...m(a, false), not: m(a, true) })
