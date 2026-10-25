// Workspace units (H7): `units` in .cadre/config.json (`packages` was renamed to `units`); a task maps to its unit by its declared paths; a task across
// units is cross-unit (core/close runs every one's verify checks on its squash). tests/git/units.test.mjs runs the real squash.
import { describe, expect, test } from 'claude-code/testing'
import { ownerOf, parse, unitsOf } from '../core/discover'
import { manifestOnly, pkgOf, repoSplit, unitsOfTask } from '../core/specview'
import { missingList, missingOf } from '../core/validate'
import { defaults } from '../task-management/registry'
import { resolve } from '../config/index'
import * as D from '../core/discover'

const U = [{ root: '.', kind: 'app', checks: { test: ['npm', 'test'] } }, { root: 'svc/api', kind: 'service', checks: { test: ['go', 'test'] } }, { root: 'svc/web', kind: 'service', checks: { test: ['npm', 'test'] } }]
const task = (paths: string[], pkg?: string) => ({ meta: { 'cadre.paths': JSON.stringify(paths), ...(pkg ? { 'cadre.package': pkg } : {}) } })

describe('units', () => {
  test('a task across a submodule and the main repository is refused: one task per repository', () => {
    const cfg = { units: [U[0], { root: 'lib', kind: 'submodule', ownGit: true, checks: {} }] }
    expect(repoSplit(cfg, ['lib/x.c', 'src/a.ts'])).toBe('metadata.paths: lib and the main repository are separate repositories; split this into one task per repository')
    // a task of manifest and lock files only is the install itself (live: "Declare six as a dependency", Files: pyproject.toml, uv.lock)
    expect(manifestOnly(['pyproject.toml', 'uv.lock'])).toMatch(/a package is not a task/); expect(manifestOnly(['web/package.json', 'web/package-lock.json'])).toMatch(/only manifest and lock files/)
    expect(manifestOnly(['pyproject.toml', 'src/textlib/text.py'])).toBeNull(); expect(manifestOnly([])).toBeNull(); expect(manifestOnly(undefined)).toBeNull()
    expect([repoSplit(cfg, ['lib/x.c', 'lib/y.c']), repoSplit(cfg, ['src/a.ts']), repoSplit(cfg, undefined)]).toEqual([null, null, null])
  })
  test('parse: every refusal names units[i].field; runner and concurrency are checked', () => {
    expect(parse([{ ...U[1], kind: 'lib' }], 'units')).toBe('units[0].kind: one of package, service, submodule, app')
    expect(parse([{ ...U[1], ownGit: 'yes' }], 'units')).toMatch(/^units\[0\]\.ownGit: /)
    expect(parse([{ ...U[1], routing: { worker: { effort: 'high' } } }], 'units')).toMatch(/^units\[0\]\.routing: /)
    expect(parse([{ root: '../x', checks: { t: ['x'] } }], 'units')).toMatch(/^units\[0\]\.root: /)
    expect(parse([U[0]])).toEqual([{ ...U[0], setup: [] }])
    expect(parse([{ ...U[1], runner: 'text', concurrency: 2 }])).toEqual([{ ...U[1], runner: 'text', concurrency: 2, setup: [] }])
    expect(parse([{ ...U[1], runner: 'xml' }])).toMatch(/^units\[0\]\.runner: junit or text/); expect(parse([{ ...U[1], concurrency: 0 }])).toMatch(/^units\[0\]\.concurrency: /)
  })
  test('unitsOf: the units themselves; `packages` is refused with "renamed: units" in any layer', () => {
    expect(unitsOf({ units: U })).toBe(U); expect(unitsOf({})).toEqual([])
    for (const trust of ['user', 'repo'] as const) expect(resolve([{ name: 'f', trust, value: { packages: [{ root: '.' }] } }]).diagnostics).toContain('f: packages: renamed: units')
  })
  test('a unit with runner text reads its tests from the output: the report is not used', () => {
    const ok = D.parse([{ root: '.', runner: 'text', tdd: { paths: ['t/**'], report: '/tmp/cadre/j.xml' }, checks: { test: ['x'] } }]); expect(typeof ok).toBe('object')
  })
  test('ownerOf: the longest root a path lies under; "." owns the rest', () => {
    expect(ownerOf(U, 'svc/api/main.go')?.root).toBe('svc/api'); expect(ownerOf(U, 'svc/apix/a')?.root).toBe('.'); expect(ownerOf(U.slice(1), 'README.md')).toBeUndefined()
  })
  test('a task maps to its unit by its paths; a named package wins; paths in two units make a cross-unit task', () => {
    const d = { cfg: { ...({} as any), units: U } }
    expect(pkgOf(d, task(['svc/api/h.go', 'svc/api/h_test.go']))?.root).toBe('svc/api')
    expect(pkgOf(d, task(['svc/api/h.go'], 'svc/web'))?.root).toBe('svc/web')
    expect(unitsOfTask(d, task(['svc/api/h.go', 'svc/web/a.ts'])).map(u => u.root)).toEqual(['svc/api', 'svc/web'])
    expect(unitsOfTask(d, task(['svc/api/a.go', 'svc/api/b.go']))).toHaveLength(1)
  })
  test('the overlap rule holds within a unit and across units: repo-relative paths, so two tasks on one file need an order wherever they sit', () => {
    const t = (id: string, paths: string[], deps: any[] = []) => ({ id, title: id, description: 'd', acceptance: 'S1: Given a When b Then c', type: 'docs', category: 'draft', deps, labels: [], meta: { 'cadre.changelog': '{}', 'cadre.package': '.', 'cadre.paths': JSON.stringify(paths) } }) as any
    expect(missingList([t('a', ['svc/api/h.go']), t('b', ['svc/api'])], defaults())).toEqual(['a+b both change svc/api/h.go: move it into one core task or add a blocks dependency'])
    expect(missingList([t('a', ['svc/api/h.go', 'svc/web/v.ts']), t('b', ['svc/web/v.ts'])], defaults())).toHaveLength(1)   // a cross-unit task against a one-unit task
    expect(missingList([t('a', ['svc/api/h.go']), t('b', ['svc/web/v.ts'])], defaults())).toEqual([])
    expect(missingList([t('a', ['svc/api/h.go']), t('b', ['svc/api/h.go'], [{ id: 'a', type: 'blocks' }])], defaults())).toEqual([])
  })
  test('a full-lane draft with declared paths needs no package: its paths name its unit', () => {
    const t = { id: 'a', title: 't', description: 'd', type: 'feature', category: 'draft', acceptance: 'S1: Given a When b Then c', design: '{}', deps: [], labels: [], meta: { 'cadre.changelog': '{}', 'cadre.paths': '["svc/api/x.go"]' } } as any
    expect(missingOf(t, defaults())).toEqual([]); expect(missingOf({ ...t, meta: { 'cadre.changelog': '{}' } }, defaults())).toEqual(['package'])
  })
})
