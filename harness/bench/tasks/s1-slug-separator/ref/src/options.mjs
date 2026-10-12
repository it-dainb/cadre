const SEPS = ['-', '_', '.']
export function slugOptions(opts = {}) {
  const separator = opts.separator ?? '-'
  if (!SEPS.includes(separator)) throw new TypeError(`separator must be one of ${SEPS.join(' ')}`)
  return { separator }
}
