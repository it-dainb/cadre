// The effort proxy for scripted runs (run.sh puts it in place of harness/bench/effort-proxy.mjs in the plugged copy, same port and log).
// Named request kinds that bypass turn.step are answered here and logged to stubbed.jsonl beside the log. Any other /v1/messages request is a leak:
// it is logged to the log (effort.jsonl, which a zero-quota run must leave empty) by its shape and refused with a 500, never forwarded, so even a
// leak costs no quota. Never logs headers (the OAuth token) or message content.
//   quota_check: Claude Code's startup probe (max_tokens 1, one user message "quota"), source=quota_check in the debug log.
//   auto_mode_classifier: auto mode's permission classifier (source=side_query, stage xml_s1; its first message opens with "<transcript>"):
//     answered "<block>no</block><severity>0</severity>" = allow under either of its answer formats.
//     So a scripted auto run never sees a classifier refusal; that path needs a real-model run.
//   usage_limit: injected. While `<log dir>/limit` exists (its text: seconds to the reset), the next unstubbed request opens a limit window: every
//     unstubbed request until the reset gets a 429 usage-limit answer with the unified rate-limit headers (the usage-limit cell's scripted worker asks once).
import http from 'node:http'
import https from 'node:https'
import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
const log = process.argv[2], stubbed = join(dirname(log), 'stubbed.jsonl'), flag = join(dirname(log), 'limit')
let resetAt = 0   // epoch s; a limit window is open while now < resetAt
const KINDS = { quota_check: b => b.max_tokens === 1 && b.messages?.length === 1 && b.messages[0].content === 'quota', auto_mode_classifier: b => !b.stream && /^<transcript>/.test(b.messages?.[0]?.content?.[0]?.text ?? '') }
const TEXT = { quota_check: ['.', 'max_tokens', null], auto_mode_classifier: ['<block>no</block><severity>0</severity>', 'end_turn', null] }
const line = (b, path, kind) => JSON.stringify({ at: Date.now(), path, kind, model: b.model, max_tokens: b.max_tokens, stream: !!b.stream, n: b.messages?.length, tools: b.tools?.length ?? 0, keys: Object.keys(b).sort().join(',') })
http.createServer((req, res) => {
  const chunks = []
  req.on('data', c => chunks.push(c)).on('end', () => {
    const body = Buffer.concat(chunks), path = req.url.split('?')[0]
    let b = {}; try { b = JSON.parse(body) } catch {}
    const kind = path === '/v1/messages' ? Object.keys(KINDS).find(k => KINDS[k](b)) : undefined
    if (kind) {
      appendFileSync(stubbed, line(b, path, kind) + '\n')
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ id: 'msg_s0stub', type: 'message', role: 'assistant', model: b.model, content: [{ type: 'text', text: TEXT[kind][0] }], stop_reason: TEXT[kind][1], stop_sequence: TEXT[kind][2], usage: { input_tokens: 1, output_tokens: 1 } }))
    }
    if (path.startsWith('/v1/messages') && existsSync(flag)) { resetAt = Math.floor(Date.now() / 1000) + (+readFileSync(flag, 'utf8') || 90); rmSync(flag) }
    if (path.startsWith('/v1/messages') && Date.now() / 1000 < resetAt) {
      appendFileSync(stubbed, line(b, path, 'usage_limit') + '\n')
      res.writeHead(429, { 'content-type': 'application/json', 'anthropic-ratelimit-unified-status': 'rejected', 'anthropic-ratelimit-unified-reset': String(resetAt), 'anthropic-ratelimit-unified-5h-reset': String(resetAt),
        'anthropic-ratelimit-unified-5h-utilization': '1.0', 'anthropic-ratelimit-unified-representative-claim': 'five_hour', 'retry-after': String(resetAt - Math.floor(Date.now() / 1000)) })
      return res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'usage limit reached' } }))
    }
    if (path.startsWith('/v1/messages')) { appendFileSync(log, line(b, path, 'refused') + '\n'); res.writeHead(500, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'scripted run: this request has no stub' } })) }
    const up = https.request({ host: 'api.anthropic.com', path: req.url, method: req.method, headers: { ...req.headers, host: 'api.anthropic.com' } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
    up.on('error', e => { res.writeHead(502); res.end(String(e)) }); up.end(body)
  })
}).listen(8899, '127.0.0.1')
