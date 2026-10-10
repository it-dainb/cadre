import { describe, expect, test } from 'claude-code/testing'
import { brief, caches, jail, parse } from '../core/discover'

describe('discovery (DESIGN 10.2)', () => {
  const o = { wt: '/tmp/cadre/i/wt', scratch: '/tmp/cadre/i', chdir: '/tmp/cadre/i/wt/api', home: '/home/u', writable: ['/home/u/.cache/pnpm'] }
  test('golden: jail argv, overlay offline / writable / $HOME overlay (3.10)', async () => {
    expect(jail('check', o, ['npm', 'test'])).toEqual(['bwrap', '--unshare-net', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--overlay-src', '/tmp/cadre/i/wt', '--tmp-overlay', '/tmp/cadre/i/wt', '--bind', '/tmp/cadre/i', '/tmp', '--bind', '/home/u/.cache/pnpm', '/home/u/.cache/pnpm', '--chdir', '/tmp/cadre/i/wt/api', '--', 'npm', 'test'])
    expect(jail('setup', o, ['npm', 'ci'])).toEqual(['bwrap', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--bind', '/tmp/cadre/i/wt', '/tmp/cadre/i/wt', '--bind', '/tmp/cadre/i', '/tmp', '--bind', '/home/u/.cache/pnpm', '/home/u/.cache/pnpm', '--chdir', '/tmp/cadre/i/wt/api', '--', 'npm', 'ci'])
    const h = jail('home', { ...o, writable: [] }, ['npm', 'ci'])
    expect(h).toContain('--overlay-src'); expect(h.slice(h.indexOf('--overlay-src'), h.indexOf('--overlay-src') + 5)).toEqual(['--overlay-src', '/home/u', '--overlay', '/tmp/cadre/i/home-up', '/tmp/cadre/i/home-work'])
    expect(h).not.toContain('--unshare-net')
  })
  test('cache listing: depth 2, parents dropped, build/target dirs never proposed', async () => {
    expect(caches('./.cache\n./.cache/pnpm\n./.cargo\n./.cargo/registry\n./.cargo/target\n./build\n')).toEqual(['.cache/pnpm', '.cargo/registry'])
    expect(caches('')).toEqual([])
  })
  test('report parsing: examples in errors, root escapes and bad report paths refused', async () => {
    const ok = { citations: [{ path: 'ci.yml', line: 1 }], discovery: { packages: [{ root: 'api', setup: ['npm', 'ci'], checks: { test: ['npm', 'test'] }, fetches: ['test'], tdd: { paths: ['t/**'], report: '/tmp/cadre/j.xml' } }] } }
    expect(parse(ok)).toEqual(ok.discovery.packages)
    const bad = (f: (p: any) => void, why: string) => { const r = JSON.parse(JSON.stringify(ok)); f(r.discovery.packages[0]); expect(parse(r)).toContain(why) }
    bad(p => { p.root = '../x' }, '.root'); bad(p => { p.setup = 'npm ci' }, '.setup'); bad(p => { p.checks = {} }, '.checks')
    bad(p => { p.tdd.report = '/var/j.xml' }, '/tmp/cadre/'); bad(p => { p.fetches = ['nope'] }, '.fetches')
    expect(parse({ ...ok, citations: [] })).toContain('citations'); expect(parse({})).toContain('discovery.packages')
    expect(brief()).toContain('mcp__cadre__report'); expect(brief()).toContain('CI config wins')
  })
})
