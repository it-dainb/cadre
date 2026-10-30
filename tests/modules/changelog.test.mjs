import { describe, expect, test } from 'claude-code/testing'
import { cut, insert, skeleton, validate } from '../core/changelog'

const SEED = `${skeleton()}
### Fixed

- old bug (m-1)

## [0.1.0] - 2026-01-02

### Added

- first (m-0)

[Unreleased]: https://example.com/compare/v0.1.0...HEAD
`
describe('KAC 1.1.0 changelog (DESIGN 3.9)', () => {
  test('golden: skeleton validates and is byte-stable', async () => {
    expect(validate(skeleton())).toBeNull()
    expect(skeleton()).toBe('# Changelog\n\nAll notable changes to this project will be documented in this file.\n\nThe format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),\nand this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).\n\n## [Unreleased]\n')
    expect(validate(SEED)).toBeNull()
  })
  test('golden: insert creates the category in KAC order and appends "- entry (id)"', async () => {
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
  test('insert into a bare skeleton', async () => {
    expect(insert(skeleton(), 'Added', 'x', 'm-1')).toBe(`${skeleton()}\n### Added\n\n- x (m-1)\n`)
  })
  test('golden: cut moves [Unreleased] into a release and leaves it empty; empty refuses', async () => {
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
  test('invalid files are refused with the line', async () => {
    const bad: [string, string][] = [
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
