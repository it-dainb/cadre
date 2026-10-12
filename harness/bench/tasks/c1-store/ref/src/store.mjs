export function createMemoryStore() {
  const m = new Map()
  return { get: k => (m.has(k) ? structuredClone(m.get(k)) : undefined), put: (k, v) => { m.set(k, structuredClone(v)) }, list: (p = '') => [...m.keys()].filter(k => k.startsWith(p)).sort() }
}
