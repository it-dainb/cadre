// Prompt-cache share of each task agent's FIRST request (ADR 0022): cache_read / (cache_read + cache_creation + input), from the subagent transcripts.
// usage: node harness/bench/cache.mjs <bench evidence dir>...   (one row per agent, then the mean per role)
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => { const p = join(d, e.name); return e.isDirectory() ? walk(p) : e.isFile() && p.includes('/subagents/') && p.endsWith('.jsonl') ? [p] : [] })
for (const dir of process.argv.slice(2)) {
  const rows = walk(dir).map(f => {
    const ls = readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)), first = ls.find(l => l.type === 'user')?.message?.content
    const text = typeof first === 'string' ? first : (first ?? []).map(c => c.text ?? '').join(''), u = ls.find(l => l.message?.usage)?.message.usage
    const role = /(\w+) brief\./.exec(text)?.[1]?.toLowerCase() ?? '?', task = /TASK-(\S+)/.exec(text)?.[1] ?? '', at = ls[0]?.timestamp ?? ''
    return u && { role, task, at, read: u.cache_read_input_tokens ?? 0, write: u.cache_creation_input_tokens ?? 0, input: u.input_tokens ?? 0 }
  }).filter(Boolean).sort((a, b) => a.at.localeCompare(b.at))
  const share = r => r.read / Math.max(1, r.read + r.write + r.input)
  console.log(`# ${dir}`)
  for (const r of rows) console.log([r.at.slice(11, 19), r.role.padEnd(8), r.task.padEnd(8), `read ${r.read}`, `write ${r.write}`, `in ${r.input}`, `share ${(share(r) * 100).toFixed(0)}%`].join('  '))
  for (const role of [...new Set(rows.map(r => r.role))]) { const rs = rows.filter(r => r.role === role); console.log(`mean ${role}: ${(rs.reduce((s, r) => s + share(r), 0) / rs.length * 100).toFixed(0)}% over ${rs.length}`) }
}
