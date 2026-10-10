// Need-to-know lint (ADR 0006): model-visible text speaks task language. A banned word names the machinery that runs the agent.
const BANNED = /\b(mods?|hooks?|harness|sandbox\w*|fence[sd]?|quarantine\w*|jail\w*|L[123])\b|cadre:|(^|\s)\/(home|tmp|wt|var|x)\//i
export const banned = (...texts: unknown[]): string[] => texts.flatMap(t => String(typeof t === 'string' ? t : JSON.stringify(t)).split('\n')).filter(l => BANNED.test(l))
