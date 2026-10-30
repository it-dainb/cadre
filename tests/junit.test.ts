// The JUnit reader (plan 2.1(c), 2.6): the old tdd.junit fixtures give the same names and statuses, bad input is refused, and the host-side limits hold.
import { describe, expect, test } from 'claude-code/testing'
import { junit, readJunit, unxml } from '../core/junit'
import { parse } from '../core/discover'
import { fakeHost } from './support'
import type { Host } from '../types'

const suite = (...cases: string[]) => `<?xml version="1.0"?><testsuites><testsuite name="s">${cases.join('')}</testsuite></testsuites>`

describe('the reader: names and statuses as the 1.0.1 regex reader gave them', () => {
  test('pass, failure, error and skipped map to pass, fail, error and skip; the text is the child message and body', () => {
    const r = junit(suite('<testcase name="a"/>', '<testcase name="b"><failure message="boom">at line 3</failure></testcase>', '<testcase name="c"><error message="ReferenceError: x"/></testcase>', '<testcase name="d"><skipped/></testcase>'))
    expect(r.map(x => [x.name, x.status])).toEqual([['a', 'pass'], ['b', 'fail'], ['c', 'error'], ['d', 'skip']])
    expect(r[1].text).toBe('boom at line 3'); expect(r[2].text).toBe('ReferenceError: x'); expect(r[0].text).toBeUndefined()
  })
  test('a nested classname gives classname.name; a self-closing and an element form read alike', () => {
    expect(junit(suite('<testcase classname="pkg.Sub" name="t one"/>', '<testcase classname="" name="bare"></testcase>')).map(x => x.name)).toEqual(['pkg.Sub.t one', 'bare'])
  })
  test('node double-escapes a quote (&amp;quot;): decoded to a quote once more than the parser does; a plain &amp; stays one &', () => {
    expect(junit(suite('<testcase name="says &amp;quot;hi&amp;quot;"/>', '<testcase name="a &amp; b"/>')).map(x => x.name)).toEqual(['says "hi"', 'a & b'])
  })
  test('unxml parity with tdd.ts: &amp;lt; decodes to &lt; once, not to <', () => {
    expect(unxml('&amp;lt;')).toBe('&lt;'); expect(unxml('&lt;&gt;&quot;&apos;&amp;')).toBe('<>"\'&')
  })
  test('a lone <testsuite> root is a report; a document that is not JUnit is refused', () => {
    expect(junit('<testsuite><testcase name="x"/></testsuite>')).toHaveLength(1); expect(() => junit('<html/>')).toThrow()
  })
  test('DOCTYPE and entity declarations are refused; malformed XML throws', () => {
    expect(() => junit('<!DOCTYPE x [<!ENTITY e "boom">]><testsuite><testcase name="&e;"/></testsuite>')).toThrow(/DOCTYPE or entity/)
    expect(() => junit('<!ENTITY a "b"><testsuite/>')).toThrow(); expect(() => junit('<testsuite><testcase name="a"')).toThrow(); expect(() => junit('')).toThrow()
  })
})

// a host whose fs is a table: stat -c answers from it, h.stat resolves a link to its target
type F = { kind: string; size: number; real?: string; text: string }
function fs(files: Record<string, F>): Host {
  const h = fakeHost({}) as Host
  return Object.assign(h, {
    run: async (argv: string[]) => { const f = files[argv[3]]; return f ? { exitCode: 0, stdout: `${f.kind} ${f.size}\n`, stderr: '' } : { exitCode: 1, stdout: '', stderr: '' } },
    stat: async (p: string, o?: { resolve?: boolean }) => (files[p] || p === '/scratch' ? { kind: 'file', realPath: o?.resolve ? files[p]?.real ?? p : undefined } : undefined),
    readText: async (p: string) => files[p]?.text ?? null,
  })
}
const OK = suite('<testcase name="a"><failure message="m"/></testcase>'), at = '/scratch/cadre/junit-test.xml'

describe('host-side limits: a breach is `bad`, never a pass; a missing file is "no results"', () => {
  test('a regular file under the scratch is read', async () => {
    expect(await readJunit(fs({ [at]: { kind: 'regular file', size: OK.length, text: OK } }), at, '/scratch')).toEqual({ results: [{ name: 'a', status: 'fail', text: 'm' }] })
    expect(await readJunit(fs({}), at, '/scratch')).toEqual({})
  })
  test('over 1 MB is refused', async () => {
    expect(await readJunit(fs({ [at]: { kind: 'regular file', size: (1 << 20) + 1, text: OK } }), at, '/scratch')).toEqual({ bad: 'the JUnit file is over 1 MB' })
  })
  test('a symlink is refused (lstat), even one that points at a good file', async () => {
    expect(await readJunit(fs({ [at]: { kind: 'symbolic link', size: 9, real: '/scratch/x.xml', text: OK } }), at, '/scratch')).toEqual({ bad: 'the JUnit file is not a regular file' })
  })
  test('a path escaping the run scratch (absolute, .., or a folder swapped for a link) is refused', async () => {
    expect(await readJunit(fs({ '/etc/j.xml': { kind: 'regular file', size: 5, text: OK } }), '/etc/j.xml', '/scratch')).toEqual({ bad: 'the JUnit file lies outside its folder' })
    expect(await readJunit(fs({ '/scratch/../etc/j.xml': { kind: 'regular file', size: 5, text: OK } }), '/scratch/../etc/j.xml', '/scratch')).toEqual({ bad: 'the JUnit file lies outside its folder' })
    expect(await readJunit(fs({ [at]: { kind: 'regular file', size: 5, real: '/home/u/.ssh/j.xml', text: OK } }), at, '/scratch')).toEqual({ bad: 'the JUnit file lies outside its folder' })
  })
  test('malformed XML and a DOCTYPE come back as bad with the reason', async () => {
    for (const text of ['<testsuite', '<!DOCTYPE x><testsuite/>']) expect(await readJunit(fs({ [at]: { kind: 'regular file', size: text.length, text } }), at, '/scratch')).toMatchObject({ bad: expect.stringMatching(/^the JUnit file is not valid: /) })
  })
})

test('B14: a unit field that names a report path is gone: units[].tdd.report and units[].runner are unknown keys', () => {
  const u = { root: '.', checks: { test: ['t'] }, tdd: { paths: ['t/**'] } }
  expect(parse([u])).toHaveLength(1)
  expect(parse([{ ...u, tdd: { ...u.tdd, report: '/tmp/cadre/j.xml' } }])).toMatch(/^units\[0\]\.tdd\.report: unknown key/); expect(parse([{ ...u, runner: 'text' }])).toMatch(/^units\[0\]\.runner: unknown key/)
})
