import { createHmac, timingSafeEqual } from 'node:crypto'
const mac = (body, secret) => createHmac('sha256', secret).update(body).digest('base64url')
const need = secret => { if (typeof secret !== 'string' || !secret) throw new TypeError('secret required') }
export function sign(payload, secret, { ttlSec, now = Date.now() }) {
  need(secret); const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + ttlSec })).toString('base64url')
  return `${body}.${mac(body, secret)}`
}
export function verify(token, secret, { now = Date.now() } = {}) {
  need(secret); const parts = String(token).split('.')
  if (parts.length !== 2) throw new Error('invalid token: shape')
  const [body, sig] = parts, want = Buffer.from(mac(body, secret)), got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw new Error('invalid token: signature')
  let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString()) } catch { throw new Error('invalid token: payload') }
  if (Math.floor(now / 1000) >= p.exp) throw new Error('expired token')
  const { exp, ...rest } = p; return rest
}
