// words(' a  b ') -> ['a', 'b']
export const words = s => s.trim().split(/\s+/).filter(Boolean)
