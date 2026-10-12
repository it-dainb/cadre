// entries: [{ at: Date | ISO string, cents: number }]
export const total = entries => entries.reduce((n, e) => n + e.cents, 0)
export const totals = store => { const ks = store.list('account:'); return { accounts: ks.length, cents: ks.reduce((n, k) => n + store.get(k), 0) } }
