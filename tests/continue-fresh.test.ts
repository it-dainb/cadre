// A resume in a new session: the event ring starts over, so the stored progress seq (lastSeq) and the no-progress counts of the old session mean nothing.
// Live (continue-after-quit r2): the reviewer's restart read as "no progress", three of them in one second stopped the drive.
import { describe, expect, test } from 'claude-code/testing'
import { world } from './fixtures/replay/world'
import { arm, casDrive } from '../core/drive'
import { continueRun, proc, quit, life } from '../core/session'

describe('continue after quit', () => {
  test('the first step of a new session starts the no-progress counts fresh', async () => {
    const w1 = await world(); proc.id = 'P1'; await arm(w1.h, 'auto'); await w1.turn()
    expect(await w1.rep('ag1', { role: 'worker', outcome: 'done', summary: 'did it' })).toContain('report accepted'); await w1.turn()   // the reviewer starts: lastSeq = this ring's last transition
    try { await quit(w1.h) } finally { life.ending = false }
    const w2 = await world({ store: w1.store, kv: w1.kv, session: 's2' }); proc.id = 'P2'   // a cold ring: its seqs are lower than the stored lastSeq
    await casDrive(w2.h, w2.store, r => r && { ...r, idle: 2, ei: { [w2.epic]: [99, 2] } })   // two no-progress steps already counted in the old session
    expect(await continueRun(w2.h)).toMatch(/^Picking up \S+ reviewer/); await w2.turn()   // the typed /cadre: the spawner restarts the reviewer
    const r = await casDrive(w2.h, w2.store, () => undefined)
    expect(r).toMatchObject({ idle: 0 }); expect(r!.stopped).toBeUndefined(); expect((await w2.h.board.read()).drive.stopped).toBeUndefined()
  })
})
