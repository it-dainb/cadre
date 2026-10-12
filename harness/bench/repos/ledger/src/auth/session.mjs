import { randomBytes } from 'node:crypto'
// an opaque random session id (base64url, 32 bytes)
export const newSessionId = () => randomBytes(32).toString('base64url')
