// entries: [{ at: Date | ISO string, cents: number }]
export const total = entries => entries.reduce((n, e) => n + e.cents, 0)
