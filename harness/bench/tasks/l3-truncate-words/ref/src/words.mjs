// words(' a  b ') -> ['a', 'b']
export const words = s => s.trim().split(/\s+/).filter(Boolean)
export const truncateWords = (s, n) => { const w = words(s); return w.length > n ? `${w.slice(0, n).join(' ')}...` : w.join(' ') }
