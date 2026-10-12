// amounts are integer cents everywhere
export const toCents = dollars => Math.round(dollars * 100)
export const formatCents = c => { const a = Math.abs(c), d = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+$)/g, ','); return `${c < 0 ? '-' : ''}$${d}.${String(a % 100).padStart(2, '0')}` }
