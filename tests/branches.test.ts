import { describe, expect, test } from 'claude-code/testing'
import { epicBranch, protectedRef, slug, slug32, taskBranch, wtPath } from '../core/branches'

describe('branch names (3.6)', () => {
  test('names: <type prefix><id>-<slug> (B13: the prefix is the type\'s plain `branch` string), epic/<id>-<slug>, <wtRoot>/<repoKey>/<id>', async () => {
    expect(slug('Add login!  (v2)')).toBe('add-login-v2'); expect(slug('???')).toBe('task'); expect(slug('x'.repeat(80)).length).toBe(24)
    expect(slug('add lastPage items size to src page')).toBe('add-lastpage-items-size'); expect(slug('exactly twenty four char')).toBe('exactly-twenty-four-char'); expect(slug32('x'.repeat(80)).length).toBe(32)
    expect(taskBranch('feat/', 'bd-a1', 'Add login')).toBe('feat/bd-a1-add-login'); expect(taskBranch('team-x-', 'bd-a1', 'Add login')).toBe('team-x-bd-a1-add-login'); expect(epicBranch('epic/', 'p3', 'Auth')).toBe('epic/p3-auth'); expect(wtPath('/c/cadre/wt', 'repo-ab12cd', 'bd-a1')).toBe('/c/cadre/wt/repo-ab12cd/bd-a1')
  })
  test('protected refs: main, dev, epic/*', async () => {
    const o = { main: 'main', dev: 'dev', epicPrefix: 'epic/' }
    expect(['main', 'dev', 'epic/p3-auth', 'feat/a-b', 'develop'].map(b => protectedRef(b, o))).toEqual([true, true, true, false, false])
  })
})
