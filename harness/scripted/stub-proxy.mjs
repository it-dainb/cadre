// The effort proxy for scripted runs (run.sh puts it in place of harness/bench/effort-proxy.mjs in the plugged copy, same port and log).
// Named request kinds that bypass turn.step are answered here and logged to stubbed.jsonl beside the log. Any other /v1/messages request is a leak:
// it is logged to the log (effort.jsonl, which a zero-quota run must leave empty) by its shape and refused with a 500, never forwarded, so even a
// leak costs no quota. Never logs headers (the OAuth token) or message content.
//   quota_check: Claude Code's startup probe (max_tokens 1, one user message "quota"), source=quota_check in the debug log.
//   auto_mode_classifier: auto mode's permission classifier (source=side_query, stage xml_s1; its first message opens with "<transcript>"):
//     answered "<block>no</block><severity>0</severity>" = allow under either of its answer formats.
//     So a scripted auto run never sees a classifier refusal; that path needs a real-model run.
//   agent_summary: the progress line of a background agent running > ~30 s (a fork of its transcript, streamed; its last message asks to "Describe your
//     most recent action in 3-5 words"): answered "Working on the task".
//   usage_limit: injected. While `<log dir>/limit` exists (its text: seconds to the reset), the next unstubbed request opens a limit window: every
//     unstubbed request until the reset gets a 429 usage-limit answer with the unified rate-limit headers (the usage-limit cell's scripted worker asks once).
import http from 'node:http'
import https from 'node:https'
import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
const log = process.argv[2], stubbed = join(dirname(log), 'stubbed.jsonl'), flag = join(dirname(log), 'limit')
let resetAt = 0   // epoch s; a limit window is open while now < resetAt
const KINDS = { quota_check: b => b.max_tokens === 1 && b.messages?.length === 1 && b.messages[0].content === 'quota', auto_mode_classifier: b => !b.stream && /^<transcript>/.test(b.messages?.[0]?.content?.[0]?.text ?? ''),
  agent_summary: (b, raw) => raw.includes('Describe your most recent action') }
// a refused request names which of these phrases its body holds (never the body): enough to name a new kind
const MARKS = ['Describe your most recent action', '<transcript>', 'quota', 'away_summary', 'You are an agent for Claude Code', 'compact', 'summar']
const TEXT = { quota_check: ['.', 'max_tokens', null], auto_mode_classifier: ['<block>no</block><severity>0</severity>', 'end_turn', null], agent_summary: ['Working on the task', 'end_turn', null] }
// a stubbed answer, whole or streamed as the request asked
function reply(res, b, [text, stop_reason, stop_sequence]) {
  const msg = { id: 'msg_s0stub', type: 'message', role: 'assistant', model: b.model, content: [{ type: 'text', text }], stop_reason, stop_sequence, usage: { input_tokens: 1, output_tokens: 1 } }
  if (!b.stream) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(msg)) }
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  ev('message_start', { message: { ...msg, content: [], stop_reason: null } }); ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
  ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } }); ev('content_block_stop', { index: 0 })
  ev('message_delta', { delta: { stop_reason, stop_sequence }, usage: { output_tokens: 1 } }); ev('message_stop', {}); res.end()
}
const line = (b, path, kind, raw) => JSON.stringify({ at: Date.now(), path, kind, model: b.model, max_tokens: b.max_tokens, stream: !!b.stream, n: b.messages?.length, tools: b.tools?.length ?? 0, keys: Object.keys(b).sort().join(','), ...(raw ? { marks: MARKS.filter(m => raw.includes(m)) } : {}) })
http.createServer((req, res) => {
  const chunks = []
  req.on('data', c => chunks.push(c)).on('end', () => {
    const body = Buffer.concat(chunks), path = req.url.split('?')[0]
    let b = {}; try { b = JSON.parse(body) } catch {}
    const kind = path === '/v1/messages' ? Object.keys(KINDS).find(k => KINDS[k](b, body.toString())) : undefined
    if (kind) {
      appendFileSync(stubbed, line(b, path, kind) + '\n')
      return reply(res, b, TEXT[kind])
    }
    if (path.startsWith('/v1/messages') && existsSync(flag)) { resetAt = Math.floor(Date.now() / 1000) + (+readFileSync(flag, 'utf8') || 90); rmSync(flag) }
    if (path.startsWith('/v1/messages') && Date.now() / 1000 < resetAt) {
      appendFileSync(stubbed, line(b, path, 'usage_limit') + '\n')
      res.writeHead(429, { 'content-type': 'application/json', 'anthropic-ratelimit-unified-status': 'rejected', 'anthropic-ratelimit-unified-reset': String(resetAt), 'anthropic-ratelimit-unified-5h-reset': String(resetAt),
        'anthropic-ratelimit-unified-5h-utilization': '1.0', 'anthropic-ratelimit-unified-representative-claim': 'five_hour', 'retry-after': String(resetAt - Math.floor(Date.now() / 1000)) })
      return res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'usage limit reached' } }))
    }
    if (path.startsWith('/v1/messages')) { appendFileSync(log, line(b, path, 'refused', body.toString()) + '\n'); res.writeHead(500, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'scripted run: this request has no stub' } })) }
    const up = https.request({ host: 'api.anthropic.com', path: req.url, method: req.method, headers: { ...req.headers, host: 'api.anthropic.com' } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
    up.on('error', e => { res.writeHead(502); res.end(String(e)) }); up.end(body)
  })
}).listen(8899, '127.0.0.1')
