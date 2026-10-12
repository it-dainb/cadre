export const id = '002'
export const up = db => { for (const a of db.tables.accounts ?? []) a.currency ??= 'USD' }
