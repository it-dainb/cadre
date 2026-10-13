// Probe (ADR 0018 slice 1): does a child spawned with $.agent.spawn from one dedicated registration stay visible to every OTHER registration?
// Every line it logs starts with PROBE; read them from the debug log with the engine's own "left out for re-entry" lines.
import type { Register } from 'claude-code'
const kids: Record<string, string> = {}   // agentId -> tag
let gen = 0
const viaStop = false   // true: probe 2, chain from classic.SubagentStop (Q) instead of turn.complete (S); see RESULTS.md
const L = ($: any, t: string) => $.ui.log(`PROBE ${t}`)
const brief = (tag: string) => `Step 1: run this Bash command: echo ${tag} > probe-${tag}.txt\nStep 2: run this Bash command: echo forbidden-${tag}\nStep 3: call the report tool with summary "${tag} done".\nThen stop.`
async function spawn($: any, tag: string, from: string) {
  try { const r = await $.agent.spawn({ prompt: brief(tag), description: `probe ${tag}`, subagentType: 'probe:runner' }); if (r?.agentId) kids[r.agentId] = tag; await L($, `${from} spawned ${tag} -> ${JSON.stringify(r)}`) }
  catch (x) { await L($, `${from} spawn ${tag} threw ${x}`) }
}
export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'probe', description: 'probe: spawn from command.run', immediate: true })
    await $.tool.register({ name: 'report', isDeferred: false, description: 'Finish: call exactly once with a short summary.', inputSchema: { type: 'object', required: ['summary'], properties: { summary: { type: 'string' } } } } as any)
    return next(e)
  })
  // A: observer of every turn.complete (a registration that never spawns)
  on('turn.complete', { reason: /^/ }, async ($, e: any, next) => { await L($, `A turn.complete agent=${e.agentId ?? 'main'} tag=${kids[e.agentId] ?? '-'} reason=${e.reason}`); return next(e) })
  // S: the spawner. main's 1st turn.complete -> g1; g1's turn.complete (if S sees it) -> g2
  on('turn.complete', { reason: /[\s\S]*/ }, async ($, e: any, next) => {
    const r = await next(e); await L($, `S turn.complete agent=${e.agentId ?? 'main'} tag=${kids[e.agentId] ?? '-'}`)
    if (!e.agentId && gen === 0) { gen = 1; await spawn($, 'g1', 'S') } else if (e.agentId && kids[e.agentId] === 'g1' && gen === 1 && !viaStop) { gen = 2; await spawn($, 'g2', 'S') }
    return r
  })
  // X: agent.spawn sees the spawn (cadre's admission stands here); rewrites cwd to sub/
  on('agent.spawn', async ($, e: any, next) => { await L($, `X agent.spawn type=${e.subagentType} prompt=${String(e.prompt).slice(0, 40).replace(/\n/g, ' ')}`); const r = await next({ ...e, cwd: '/work/run/sub' }); await L($, `X agent.spawn -> ${JSON.stringify(r)}`); return r })
  // G: the guard. Every tool call logged; a Bash "forbidden" denied
  on('tool.call', async ($, e: any, next) => {
    await L($, `G tool.call agent=${e.agentId ?? 'main'} tag=${kids[e.agentId] ?? '-'} tool=${e.tool} cmd=${String(e.command ?? '').slice(0, 60)}`)
    if (e.tool === 'Bash' && /forbidden/.test(String(e.command))) return { deny: 'refused by the probe guard' }
    return next(e)
  })
  // R: the report tool
  on('tool.call', { tool: /^mcp__probe__report$/ }, async ($, e: any) => { await L($, `R report agent=${e.agentId ?? 'main'} tag=${kids[e.agentId] ?? '-'} summary=${e.summary}`); return { result: 'recorded; stop now' } })
  // T: turn.step in the child
  on('turn.step', async function* ($, e: any, next) { await L($, `T turn.step agent=${e.agentId ?? 'main'} tag=${kids[e.agentId] ?? '-'}`); return yield* next(e) })
  // P: what main is told
  on('prompt.submit', async ($, e: any, next) => { await L($, `P prompt.submit agent=${e.agentId ?? 'main'} origin=${e.origin?.kind} text=${String(e.text ?? '').slice(0, 80).replace(/\n/g, ' ')}`); return next(e) })
  // Q: chain from the child's SubagentStop (headless: the child's turn.complete comes after the background task ended)
  on('classic.SubagentStop', async ($, e: any, next) => {
    const id = e.agent_id ?? e.agentId, tag = kids[id] ?? '-'; await L($, `Q SubagentStop agent=${id} tag=${tag} keys=${Object.keys(e).join(',')}`)
    if (viaStop && tag === 'g1' && gen === 1) { gen = 2; await spawn($, 'g2', 'Q') } else if (viaStop && tag === 'g2' && gen === 2) { gen = 3; await spawn($, 'g3', 'Q') }
    return next(e)
  })
  // C: /probe spawns g3 from command.run
  on('command.run', { command: 'probe' }, async ($, e: any, next) => { await spawn($, 'g3', 'C'); return { text: 'probe spawned g3' } })
}
