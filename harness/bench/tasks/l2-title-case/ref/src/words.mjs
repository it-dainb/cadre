// words(' a  b ') -> ['a', 'b']
export const words = s => s.trim().split(/\s+/).filter(Boolean)
export const titleCase = s => words(s).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ')
