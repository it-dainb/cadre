import * as m001 from '../migrations/001_init.mjs'
import * as m002 from '../migrations/002_currency.mjs'
export const migrations = [m001, m002]
// ascending numeric id, each once; stops at the first failure
export function migrate(db, list = migrations) {
  for (const m of [...list].sort((a, b) => Number(a.id) - Number(b.id))) { if (db.applied.includes(m.id)) continue; m.up(db); db.applied.push(m.id) }
  return db
}
