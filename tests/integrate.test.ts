import { describe, expect, test } from 'claude-code/testing'
import { fakeHost, task } from './support'
import { integrateEpic, releaseDev } from '../core/integrate'
import { inferVersion } from '../core/branches'
import { ROUTES } from '../core/dispatch'

const plan = (state: string, flags?: string[]) => ({ id: 'p3', slug: 'a', state, epicBranch: 'epic/p3-a', ...(flags ? { flags } : {}) }) as any
const world = async (state = 'approved', tasks = [task('m-2', { state: 'done' })]) => {
  const h = fakeHost(); await h.board.update(b => ({ ...b, epic: 'p3', plan: plan(state), tasks })); return h
}

describe('integration gates (3.9; git runs in tests/git/integrate.test.mjs)', () => {
  test('a human commit on dev (git:dev flag) blocks integration and release; nothing changes', async () => {
    const h = await world(); await h.git.update(g => ({ ...g, flags: { 'git:dev': {} } }))
    expect(await integrateEpic(h, 'p3')).toContain('git flag git:dev'); expect((await h.board.read()).plan!.state).toBe('approved')
    expect(await releaseDev(h)).toContain('git:dev is open')
  })
  test('refused: other epic, not approved, open children', async () => {
    expect(await integrateEpic(await world(), 'p9')).toContain('not the current epic')
    expect(await integrateEpic(await world('integrating'), 'p3')).toContain('already running')
    expect(await integrateEpic(await world('done-on-dev'), 'p3')).toContain('only an approved epic')
    expect(await integrateEpic(await world('approved', [task('m-2', { state: 'review' })]), 'p3')).toContain('children still open: m-2')
  })
  test('release refuses a bad version and a blocking task flag; /cadre release is routed', async () => {
    expect(await releaseDev(await world(), '1.0')).toContain('expected x.y.z')
    expect(await releaseDev(await world('approved', [task('m-2', { state: 'done', flags: ['drift'] })]))).toContain('flag drift is open')
    expect(typeof ROUTES.release).toBe('function')
  })
  test('version inference table', () => {
    const t: [string | null, string[], string][] = [
      [null, ['feat: x'], '0.1.0'], ['v1.2.3', ['fix: a', 'docs: b'], '1.2.4'], ['v1.2.3', ['fix: a', 'feat(ui): b'], '1.3.0'],
      ['v1.2.3', ['feat!: a'], '2.0.0'], ['v1.2.3', ['fix(api)!: a', 'feat: b'], '2.0.0'], ['v0.4.1', ['feat!: a'], '0.5.0'], ['v0.4.1', ['refactor: a'], '0.4.2'], ['v0.4.1', ['feature: a'], '0.4.2'],
    ]
    for (const [tag, s, want] of t) expect(inferVersion(tag, s)).toBe(want)
  })
})
