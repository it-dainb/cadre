// main's tools as the engine sees them: through the tool.call handler, with the engine's result shape enforced. Claude Code refuses an MCP tool's
// result that is not a string, an array or nothing ("… resolved mcp__cadre__plan with a result that does not match its output shape"; live 2.1.295,
// the write had happened and main got an error). A {deny} is the error result (is_error:true): it comes back as core's {isError, result: its text}.
// A JSON answer is parsed back so the tests read its fields.
import type { Host } from '../../types'
import { handle } from '../../tools/index'

export async function viaEngine(h: Host, e: Record<string, unknown>): Promise<any> {
  const r: any = await handle(h, e as any, (() => { throw new Error('main tools answer themselves') }) as any)
  if (typeof r?.deny === 'string') return { isError: true, result: r.deny, text: r.deny }
  if (r?.result !== undefined && typeof r.result !== 'string' && !Array.isArray(r.result)) throw new Error(`${String(e.tool)} resolved with a result that does not match its output shape: ${JSON.stringify(r.result).slice(0, 80)}`)
  if (typeof r?.result === 'string' && /^[{[]/.test(r.result)) { try { return { ...r, result: JSON.parse(r.result) } } catch { /* plain text */ } }
  return r
}
