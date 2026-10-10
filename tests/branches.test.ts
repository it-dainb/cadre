import { describe, expect, test } from 'claude-code/testing'
import { epicBranch, inferVersion, protectedRef, slug, taskBranch, wtPath } from '../core/branches'

describe('branch names (3.6) and version inference (3.9)', () => {
  test('names: <commitType>/<id>-<slug>, epic/<id>-<slug>, <wtRoot>/<repoKey>/<id>', async () => {
    expect(slug('Add login!  (v2)')).toBe('add-login-v2'); expect(slug('???')).toBe('task'); expect(slug('x'.repeat(80)).length).toBe(32)
    expect(taskBranch('feat', 'bd-a1', 'Add login')).toBe('feat/bd-a1-add-login'); expect(epicBranch('epic/', 'p3', 'Auth')).toBe('epic/p3-auth'); expect(wtPath('/c/cadre/wt', 'repo-ab12cd', 'bd-a1')).toBe('/c/cadre/wt/repo-ab12cd/bd-a1')
  })
  test('protected refs: main, dev, epic/*', async () => {
    const o = { main: 'main', dev: 'dev', epicPrefix: 'epic/' }
    expect(['main', 'dev', 'epic/p3-auth', 'feat/a-b', 'develop'].map(b => protectedRef(b, o))).toEqual([true, true, true, false, false])
  })
  test('version: no tag 0.1.0; ! major (0.x -> minor); feat minor; else patch', async () => {
    expect(inferVersion(null, ['feat: x'])).toBe('0.1.0')
    expect(inferVersion('v1.2.3', ['fix: a', 'docs: b'])).toBe('1.2.4'); expect(inferVersion('v1.2.3', ['fix: a', 'feat(ui): b'])).toBe('1.3.0')
    expect(inferVersion('v1.2.3', ['feat!: break'])).toBe('2.0.0'); expect(inferVersion('v1.2.3', ['refactor(core)!: break'])).toBe('2.0.0')
    expect(inferVersion('v0.4.1', ['feat!: break'])).toBe('0.5.0'); expect(inferVersion('v0.4.1', ['fix: a'])).toBe('0.4.2')
  })
})
