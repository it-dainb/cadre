// The ONE exit for text a model reads (AGENTS.md, CONTRACTS "Model-visible text"): briefs, context, tool results, cards, TaskGet answers, nudges,
// auto-reports, deny/refusal reasons and the files written into an agent's view. In the product it returns the text unchanged; the test host installs
// SAY.check, which fails a test on a leak (tests/support.ts), so every new text site is checked without being listed anywhere.
export type Kind = 'brief' | 'agent-brief' | 'context' | 'tool-result' | 'card' | 'taskget' | 'nudge' | 'auto-report' | 'agent-file' | 'deny' | 'lesson'
// Need-to-know (ADR 0006): words that name the machinery running the agent, cadre's own development (ADRs, versions, smoke ids, the API catalog, d.ts,
// its source paths), absolute host paths, or typed commands that no longer exist (decisions are answered in the dialog, ADR 0012). Lane words are main's planning API (TaskCreate metadata `lane`), so they are banned only for subagents.
const LEAK = /\b(mods?|hooks?|harness|sandbox\w*|fence[sd]?|quarantine\w*|jail\w*|L[123]|ADR\s*\d*|kit|M0|catalog)\b|\bS\d\d\b(?!:)|\bv?0\.\d+\.\d+\b|\blive 0\.|\bd\.ts\b|cadre:|(^|[\s(`'"])\/(home|tmp|wt|var|x)\/|\b(core|ui|commands|native|policy|tools|config|hooks|agents|adapters)\/[\w-]+\.ts\b|docs\/adr|\/cadre (resolve|approve|reject|release|restore|drive|config|sync|open|status|confirm|lane)\b/i
const LANE = /\b(lite|lite\+tdd|full lane|lanes?)\b/i
const SUB: Kind[] = ['agent-brief', 'card', 'nudge', 'auto-report', 'agent-file', 'lesson']
export const leaks = (kind: Kind, text: string): string[] => String(text).split('\n').filter(l => LEAK.test(l) || (SUB.includes(kind) && LANE.test(l)))
export const SAY: { check?: (kind: Kind, text: string) => void } = {}
export const modelText = (kind: Kind, text: string): string => { SAY.check?.(kind, text); return text }
// a structured answer (Task* results, an MCP result object): every string in it is checked, the value is returned as is
export const modelData = <T>(kind: Kind, v: T): T => { if (SAY.check) SAY.check(kind, typeof v === 'string' ? v : JSON.stringify(v ?? null, null, 1)); return v }
