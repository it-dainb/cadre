// Need-to-know lint (ADR 0006): model-visible text speaks task language. The list lives in core/say.ts (one list for the product boundary and the tests).
import { type Kind, leaks } from '../../core/say'
const lines = (texts: unknown[]) => texts.flatMap(t => String(typeof t === 'string' ? t : JSON.stringify(t, null, 1)).split('\n'))
export const banned = (...texts: unknown[]): string[] => lines(texts).filter(l => leaks('context', l).length)            // main's text (lane words allowed: its planning API)
export const bannedFor = (kind: Kind, ...texts: unknown[]): string[] => lines(texts).filter(l => leaks(kind, l).length)
