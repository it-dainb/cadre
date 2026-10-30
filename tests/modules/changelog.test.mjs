// The changelog module (plan 2.7): the 1.0.1 core/changelog cases with the same fixtures, then the hook run for real (node modules/changelog.mjs entry) in a folder.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cut, insert, skeleton, validate } from '../../modules/changelog.mjs'

const expect = v => ({ toBe: x => assert.equal(v, x), toBeNull: () => assert.equal(v, null), toContain: x => assert.ok(String(v).includes(x), `${v} lacks ${x}`), toThrow: m => assert.throws(v, e => e.message.includes(m)) })

const SEED = `${skeleton()}
### Fixed

- old bug (m-1)

## [0.1.0] - 2026-01-02

### Added

- first (m-0)

[Unreleased]: https://example.com/compare/v0.1.0...HEAD
`
describe('KAC 1.1.0 changelog (DESIGN 3.9)', () => {
  test('golden: skeleton validates and is byte-stable', () => {
    expect(validate(skeleton())).toBeNull()
    expect(skeleton()).toBe('# Changelog\n\nAll notable changes to this project will be documented in this file.\n\nThe format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),\nand this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).\n\n## [Unreleased]\n')
    expect(validate(SEED)).toBeNull()
  })
  test('golden: insert creates the category in KAC order and appends "- entry (id)"', () => {
    let t = insert(SEED, 'Added', 'shiny thing', 'm-7')
    t = insert(t, 'Fixed', 'another bug', 'm-8')
    t = insert(t, 'Security', 'hardened', 'm-9')
    expect(t).toBe(`${skeleton()}
### Added

- shiny thing (m-7)

### Fixed

- old bug (m-1)
- another bug (m-8)

### Security

- hardened (m-9)

## [0.1.0] - 2026-01-02

### Added

- first (m-0)

[Unreleased]: https://example.com/compare/v0.1.0...HEAD
`)
    expect(validate(t)).toBeNull()
  })
  test('insert into a bare skeleton', () => {
    expect(insert(skeleton(), 'Added', 'x', 'm-1')).toBe(`${skeleton()}\n### Added\n\n- x (m-1)\n`)
  })
  test('golden: cut moves [Unreleased] into a release and leaves it empty; empty refuses', () => {
    const t = cut(insert(SEED, 'Added', 'shiny', 'm-7'), '0.2.0', '2026-03-04')
    expect(t).toBe(`${skeleton()}
## [0.2.0] - 2026-03-04

### Added

- shiny (m-7)

### Fixed

- old bug (m-1)

## [0.1.0] - 2026-01-02

### Added

- first (m-0)

[Unreleased]: https://example.com/compare/v0.1.0...HEAD
`)
    expect(validate(t)).toBeNull()
    expect(() => cut(skeleton(), '0.1.0', '2026-01-01')).toThrow('nothing to release')
    expect(() => cut(t, '0.3.0', '2026-03-05')).toThrow('nothing to release')
  })
  test('invalid files are refused with the line', () => {
    const bad = [
      ['# Log\n\n## [Unreleased]\n', 'line 1: must start with'],
      ['# Changelog\n\n## [0.1.0] - 2026-01-01\n', 'line 3: "## [Unreleased]" must come first'],
      ['# Changelog\n\n## [Unreleased]\n\n### Misc\n', 'line 5: "Misc" is not a KAC category'],
      ['# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n### Added\n', 'line 7: "Added" is out of KAC order'],
      ['# Changelog\n\n## [Unreleased]\n\n### Added\n\nnot a bullet\n', 'line 7: entries must be'],
      ['# Changelog\n\n## [Unreleased]\n\nfree text\n', 'line 5: text outside'],
      ['# Changelog\n\n## [Unreleased]\n\n## [1.0] - x\n', 'line 5: release heading'],
      ['# Changelog\n', 'no "## [Unreleased]"'],
    ]
    for (const [t, why] of bad) expect(validate(t)).toContain(why)
    expect(() => insert('# Changelog\n', 'Added', 'x', 'm-1')).toThrow('changelog invalid')
    expect(() => insert(skeleton(), 'Misc', 'x', 'm-1')).toThrow('not a KAC category')
    expect(() => insert(skeleton(), 'Added', 'a\nb', 'm-1')).toThrow('one line')
  })
})

const MOD = new URL('../../modules/changelog.mjs', import.meta.url).pathname
describe('the entry hook (event task.closed), run as core runs it', () => {
  const run = (dir, fields, id = 'm-5') => {
    writeFileSync(join(dir, 'in.json'), JSON.stringify({ event: 'task.closed', id, title: 't', type: 'feature', branch: 'epic/x', fields }))
    try { execFileSync('node', [MOD, 'entry'], { cwd: dir, env: { CADRE_INPUT: join(dir, 'in.json'), CADRE_RESULT: join(dir, 'out.json'), PATH: process.env.PATH }, stdio: 'pipe' }); return 0 } catch (e) { return e.status }
  }
  test('the task decision is inserted once; a repeat, a none decision and a missing file change nothing', () => {
    const d = mkdtempSync(join(tmpdir(), 'clog-'))
    try {
      assert.equal(run(d, { changelog: '{"category":"Added","entry":"x"}' }), 0); assert.equal(existsSync(join(d, 'CHANGELOG.md')), false)   // no file yet: nothing written
      writeFileSync(join(d, 'CHANGELOG.md'), skeleton())
      assert.equal(run(d, { changelog: '{"category":"Added","entry":"x"}' }), 0); assert.equal(readFileSync(join(d, 'CHANGELOG.md'), 'utf8'), `${skeleton()}\n### Added\n\n- x (m-5)\n`)
      assert.equal(run(d, { changelog: '{"category":"Added","entry":"x"}' }), 0); assert.equal(readFileSync(join(d, 'CHANGELOG.md'), 'utf8'), `${skeleton()}\n### Added\n\n- x (m-5)\n`)
      assert.equal(run(d, { changelog: '{"none":true,"reason":"internal"}' }, 'm-6'), 0); assert.equal(readFileSync(join(d, 'CHANGELOG.md'), 'utf8').includes('m-6'), false)
    } finally { rmSync(d, { recursive: true, force: true }) }
  })
  test('an invalid changelog fails the hook with the line in its result', () => {
    const d = mkdtempSync(join(tmpdir(), 'clog-'))
    try {
      writeFileSync(join(d, 'CHANGELOG.md'), '# Log\n')
      assert.equal(run(d, { changelog: '{"category":"Added","entry":"x"}' }), 1); assert.match(JSON.parse(readFileSync(join(d, 'out.json'), 'utf8')).note, /changelog invalid: line 1/)
    } finally { rmSync(d, { recursive: true, force: true }) }
  })
})

test('S8: the minimal file guides/init.md describes (header, one intro line, an empty Unreleased heading) is valid and takes an entry', () => {
  const min = '# Changelog\n\nAll notable changes to this project.\n\n## [Unreleased]\n'
  expect(validate(min)).toBeNull(); expect(validate(insert(min, 'Added', 'x', 'm-1'))).toBeNull()
})
