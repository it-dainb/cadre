import { describe, expect, test } from 'claude-code/testing'
import { brief, caches, parse } from '../core/discover'
import * as G from '../core/git'

describe('discovery (DESIGN 10.2)', () => {
  const o = { wt: '/tmp/cadre/i/wt', scratch: '/tmp/cadre/i', chdir: '/tmp/cadre/i/wt/api', home: '/hm/u', writable: ['/hm/u/.cache/pnpm'] }
  test('golden: jail argv, overlay offline / writable / $HOME overlay / copy-jail / HOME-scratch audit (3.10, A19)', async () => {
    const j = (argv: string[], writable = o.writable) => ({ wt: o.wt, scratch: o.scratch, pkgRoot: o.chdir, argv, writable })
    expect(G.overlayJail(j(['npm', 'test']))).toEqual(['bwrap', '--unshare-net', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--bind', '/tmp/cadre/i', '/tmp', '--overlay-src', '/tmp/cadre/i/wt', '--tmp-overlay', '/tmp/cadre/i/wt', '--setenv', 'TMPDIR', '/tmp', '--bind', '/hm/u/.cache/pnpm', '/hm/u/.cache/pnpm', '--chdir', '/tmp/cadre/i/wt/api', '--', 'npm', 'test'])
    expect(G.writableJail(j(['npm', 'ci']))).toEqual(['bwrap', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--bind', '/tmp/cadre/i', '/tmp', '--bind', '/tmp/cadre/i/wt', '/tmp/cadre/i/wt', '--setenv', 'TMPDIR', '/tmp', '--bind', '/hm/u/.cache/pnpm', '/hm/u/.cache/pnpm', '--chdir', '/tmp/cadre/i/wt/api', '--', 'npm', 'ci'])
    const h = G.homeJail({ ...j(['npm', 'ci'], []), home: o.home })
    expect(h.slice(h.indexOf('--overlay-src'), h.indexOf('--overlay-src') + 5)).toEqual(['--overlay-src', '/hm/u', '--overlay', '/tmp/cadre/i/home-up', '/tmp/cadre/i/home-work'])
    expect(h).not.toContain('--unshare-net')
    const c = G.copyJail(j(['npm', 'test'], []))   // j.wt is the copy: bound writable, network off, no overlay flags
    expect(c).toEqual(['bwrap', '--unshare-net', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--bind', o.scratch, '/tmp', '--bind', o.wt, o.wt, '--setenv', 'TMPDIR', '/tmp', '--chdir', o.chdir, '--', 'npm', 'test'])
    const hs = G.homeScratchJail({ ...j(['npm', 'ci'], []), scratchHome: '/tmp/cadre/i/home' })
    expect(hs).not.toContain('--unshare-net'); expect(hs).not.toContain('--overlay-src')
    expect(hs.join(' ')).toContain('--setenv HOME /tmp/cadre/i/home'); expect(hs.join(' ')).toContain('--bind /tmp/cadre/i/home /tmp/cadre/i/home')
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
    for (const setup of [[], undefined]) { const r = JSON.parse(JSON.stringify(ok)); if (setup) r.discovery.packages[0].setup = setup; else delete r.discovery.packages[0].setup; expect((parse(r) as any)[0].setup).toEqual([]) }   // no install step (live: the explorer reported setup [])
    expect(brief()).toContain('mcp__cadre__report'); expect(brief()).toContain('CI config wins')
  })
})
