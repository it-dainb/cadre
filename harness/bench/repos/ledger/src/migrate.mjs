import * as m001 from '../migrations/001_init.mjs'
// runs every migration on db, in the listed order
export const migrations = [m001]
export function migrate(db, list = migrations) { for (const m of list) { m.up(db); db.applied.push(m.id) } return db }
