// db: { tables: { [name]: row[] }, applied: string[] }
export const id = '001'
export const up = db => { db.tables.accounts ??= [] }
