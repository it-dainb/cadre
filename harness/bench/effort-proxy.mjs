// Passthrough to api.anthropic.com that logs, per /v1/messages request, ONLY: model, output_config, thinking, the agent role named in the system prompt, and its first 60 chars.
// Never headers (the OAuth token travels there) and never message content. Usage (in the container): node effort-proxy.mjs <log> & ANTHROPIC_BASE_URL=http://127.0.0.1:8899 claude ...
import http from 'node:http'
import https from 'node:https'
import { appendFileSync } from 'node:fs'
const log = process.argv[2]
http.createServer((req, res) => {
  const chunks = []
  req.on('data', c => chunks.push(c)).on('end', () => {
    const body = Buffer.concat(chunks)
    if (req.url.startsWith('/v1/messages')) try {
      const b = JSON.parse(body), sys = Array.isArray(b.system) ? b.system.map(s => s.text ?? '').join(' ') : b.system ?? ''
      appendFileSync(log, JSON.stringify({ at: Date.now(), path: req.url.split('?')[0], model: b.model, output_config: b.output_config, thinking: b.thinking, role: sys.match(/You are an? (worker|tester|reviewer|explorer)\b/)?.[1] ?? 'main', sys: sys.replace(/\s+/g, ' ').slice(0, 60) }) + '\n')
    } catch {}
    const up = https.request({ host: 'api.anthropic.com', path: req.url, method: req.method, headers: { ...req.headers, host: 'api.anthropic.com' } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
    up.on('error', e => { res.writeHead(502); res.end(String(e)) }); up.end(body)
  })
}).listen(8899, '127.0.0.1')
