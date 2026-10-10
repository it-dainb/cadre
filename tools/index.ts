// OWNER: wave-3 tools (3 MCP tools: schemas + handlers). DESIGN 5.2: report, inspect, run_check; all isDeferred:false.
import type { Hook } from '../types'

export const TOOLS = ['report', 'inspect', 'run_check'] as const
// tool.call for mcp__cadre__*: answer {result}.
export const handle: Hook = (h, e, next) => next(e)
