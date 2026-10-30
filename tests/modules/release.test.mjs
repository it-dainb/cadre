// The release module (plan 2.7), run for real over a git repo: the version from our own commit headers (dry), and the changelog cut in the folder core cut at dev (real).
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { insert, skeleton } from '../../modules/changelog.mjs'

const MOD = new URL('../../modules/release.mjs', import.meta.url).pathname, ID = ['-c', 'user.name=t', '-c', 'user.email=t@t']
const git = (d, ...a) => execFileSync('git', [...ID, ...a], { cwd: d, encoding: 'utf8' }).trim()
const repo = () => { const d = mkdtempSync(join(tmpdir(), 'rel-')); git(d, 'init', '-q', '-b', 'dev'); writeFileSync(join(d, 'CHANGELOG.md'), insert(skeleton(), 'Added', 'x', 'm-1')); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'chore: init'); return d }
const run = (d, input) => {
  writeFileSync(join(d, 'in.json'), JSON.stringify(input)); let code = 0
  try { execFileSync('node', [MOD], { cwd: d, env: { CADRE_INPUT: join(d, 'in.json'), CADRE_RESULT: join(d, 'out.json'), PATH: process.env.PATH }, stdio: 'pipe' }) } catch (e) { code = e.status }
  return { code, out: JSON.parse(readFileSync(join(d, 'out.json'), 'utf8')) }
}
const commit = (d, subject) => { writeFileSync(join(d, `f${subject.length}${Math.random()}`), 'x'); git(d, 'add', '-A'); git(d, 'commit', '-qm', subject) }

describe('the release module', () => {
  test('dry: no tag gives 0.1.0; after a tag a fix is a patch, feat a minor, a `!` a major (0.x: a minor)', () => {
    const d = repo()
    try {
      assert.deepEqual(run(d, { dry: true, at: 'dev' }).out, { version: '0.1.0' })
      git(d, 'tag', '-a', 'v1.2.3', '-m', 'v1.2.3'); commit(d, 'fix: a')
      assert.equal(run(d, { dry: true, at: 'dev' }).out.version, '1.2.4'); commit(d, 'feat(x): b')
      assert.equal(run(d, { dry: true, at: 'dev' }).out.version, '1.3.0'); commit(d, 'refactor!: c')
      assert.equal(run(d, { dry: true, at: 'dev' }).out.version, '2.0.0')
      assert.equal(run(d, { dry: true, at: 'dev', version: '9.9.9' }).out.version, '9.9.9')   // a named version is kept
      git(d, 'tag', '-a', 'v0.4.1', '-m', 'v0.4.1'); git(d, 'tag', '-d', 'v1.2.3'); commit(d, 'feat!: d')
      assert.equal(run(d, { dry: true, at: 'dev' }).out.version, '0.5.0'); git(d, 'tag', '-a', 'v0.5.0', '-m', 'v0.5.0'); commit(d, 'fix(api)!: e'); commit(d, 'feat: f')
      assert.equal(run(d, { dry: true, at: 'dev' }).out.version, '0.6.0')   // a break wins over a feat; 0.x moves the minor
      git(d, 'tag', '-a', 'v0.6.0', '-m', 'v0.6.0'); commit(d, 'feature: g'); commit(d, 'docs: h')
      assert.equal(run(d, { dry: true, at: 'dev' }).out.version, '0.6.1')   // `feature:` is no feat
    } finally { rmSync(d, { recursive: true, force: true }) }
  })
  test('real: [Unreleased] becomes the release in the folder; nothing to release, or no changelog, fails with the reason in the result', () => {
    const d = repo()
    try {
      assert.equal(run(d, { version: '0.1.0', today: '2026-05-06' }).code, 0)
      const t = readFileSync(join(d, 'CHANGELOG.md'), 'utf8'); assert.ok(t.includes('## [0.1.0] - 2026-05-06') && t.includes('- x (m-1)'))
      const again = run(d, { version: '0.2.0', today: '2026-05-07' }); assert.equal(again.code, 1); assert.equal(again.out.note, 'nothing to release')
      rmSync(join(d, 'CHANGELOG.md')); const none = run(d, { version: '0.2.0', today: '2026-05-07' }); assert.equal(none.code, 1); assert.match(none.out.note, /CHANGELOG\.md is missing/)
    } finally { rmSync(d, { recursive: true, force: true }) }
  })
})
