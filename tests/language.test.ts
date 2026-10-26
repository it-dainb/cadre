// H11 ui.language, English only (O2): the mechanism exists (ui/tr.ts), zero translations ship. A stub table proves the resolver and that no model-visible text moves.
import { describe, expect, test } from 'claude-code/testing'
import type { Decision } from '../types'
import { BUDGET } from './fixtures/budget.generated'
import { NOT_NOW, answerDialog } from '../ui/index'
import { TABLE, labels, pick, title, tr } from '../ui/tr'
import { SAY } from '../core/say'
import { decide } from '../commands/cadre'
import { ask, flagDecision } from '../core/decide'
import { plan, world } from './fixtures/native/world'

const D: Decision = { id: 'deploy:7', kind: 'deploy', title: 'deploy build 7 to staging?', lines: ['3 services restart'], hash: 'h', options: [{ key: 'd', label: 'Deploy', verb: 'approve', run: 'deploy now' }, { key: 'w', label: 'Wait', verb: 'change', run: 'deploy wait' }] }
const STUB = { 'deploy.d': 'Wait', 'deploy.w': 'Deploy', 'deploy.title': 'TITLE?', 'conflict.title': 'TITLE?' }   // swaps the two labels: only a key-based resolver gets this right

// the dialog, scripted: the free-text answers and the option pick of a fixed scenario set; returns the goal text and every modelText the run produced
async function scenarios(table: Record<string, string>) {
  Object.assign(TABLE, table)
  const seen: string[] = [], prev = SAY.check; SAY.check = (k, t) => { seen.push(`${k}: ${t}`); prev?.(k, t) }
  try {
    const out: (string | undefined)[] = []
    const w = await world(), { plan: p } = await plan(w)
    Object.assign(w.h, { answer: (id: string, k: string, hash: string) => decide(w.h, id, k, hash), ask: async () => 'split the login into two tasks' })
    await answerDialog(w.h); out.push((await w.h.ui.read()).goal as string | undefined)
    const w2 = await world(); await ask(w2.h, flagDecision('a2', 'conflict', 'Session refresh')!)
    Object.assign(w2.h, { answer: (id: string, k: string, hash: string) => decide(w2.h, id, k, hash), ask: async () => 'keep mine but tell me why' }); await answerDialog(w2.h); out.push((await w2.h.ui.read()).goal as string | undefined)
    return { out, seen, p }
  } finally { for (const k of Object.keys(table)) delete TABLE[k]; SAY.check = prev }
}

describe('ui.language: a mechanism, English only', () => {
  test('tr is the identity today and a table is the only thing that changes it', () => {
    expect(tr('x.y', 'English')).toBe('English'); Object.assign(TABLE, { 'x.y': 'Other' }); expect(tr('x.y', 'English')).toBe('Other'); delete TABLE['x.y']
  })
  test('a stub table: the resolver matches a translated label to ITS option on both sides', () => {
    expect(labels(D, D.options)).toEqual(['Deploy', 'Wait']); expect(pick(D, D.options, 'Deploy')?.key).toBe('d')
    Object.assign(TABLE, STUB)
    try {
      expect(labels(D, D.options)).toEqual(['Wait', 'Deploy']); expect(title(D)).toBe('TITLE?')
      expect(pick(D, D.options, 'Wait')?.key).toBe('d'); expect(pick(D, D.options, 'Deploy')?.key).toBe('w'); expect(pick(D, D.options, 'Nope')).toBeUndefined()
    } finally { for (const k of Object.keys(STUB)) delete TABLE[k] }
  })
  test('golden: the free-text paths (incl. ui/index.ts queueBrief with d.title) and every modelText are identical with a table in place; the title sent stays English', async () => {
    const en = await scenarios({}), tl = await scenarios({ ...STUB, 'plan.title': 'TITRE', 'plan.a': 'X' })
    expect(en.out).toEqual([`Change ${en.p}: split the login into two tasks`, 'About "a2 flagged conflict": keep mine but tell me why'])
    expect(tl.out).toEqual(en.out); expect(tl.seen).toEqual(en.seen)
    expect(JSON.stringify(tl.seen)).not.toContain('TITLE?'); expect(JSON.stringify(tl.seen)).not.toContain('TITRE')
  })
  test('a stub-translated dialog: shown labels are translated, the pick resolves to the right option', async () => {
    Object.assign(TABLE, STUB)
    try {
      const w = await world(); await ask(w.h, D); const asked: string[][] = []; let ran = ''
      Object.assign(w.h, { answer: async (_id: string, k: string) => { ran = k; return { text: 'ok' } }, ask: async (q: string, ls: string[]) => { asked.push([q.split('\n')[0], ...ls]); return 'Wait' } })
      await answerDialog(w.h); expect(asked).toEqual([['TITLE?', 'Wait', 'Deploy']]); expect(ran).toBe('d'); expect(NOT_NOW).toBe('Not now')
    } finally { for (const k of Object.keys(STUB)) delete TABLE[k] }
  })
  test('import guard: no file outside ui/** imports tr (scripts/budget.mjs scan; tests/git/tr-guard.test.mjs proves it fails when one does)', () => { expect(BUDGET.trImports).toEqual([]) })
})
