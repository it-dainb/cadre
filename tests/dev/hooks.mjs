import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
export async function resolve(spec, ctx, next) {
  if (spec === 'claude-code/testing') return { url: new URL('./kit-shim.mjs', import.meta.url).href, shortCircuit: true }
  if (spec.startsWith('.') && !/\.[cm]?[jt]s$/.test(spec) && ctx.parentURL) {
    const p = new URL(spec + '.ts', ctx.parentURL)
    if (existsSync(fileURLToPath(p))) return { url: p.href, shortCircuit: true }
  }
  return next(spec, ctx)
}
