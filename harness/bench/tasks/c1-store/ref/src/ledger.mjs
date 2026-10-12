import { createMemoryStore } from './store.mjs'
// Accounts hold integer cents, kept in the store under account:<id>.
export class Ledger {
  constructor(store = createMemoryStore()) { this.store = store }
  open(id) { if (this.store.get(`account:${id}`) !== undefined) throw new Error(`account ${id} exists`); this.store.put(`account:${id}`, 0) }
  deposit(id, cents) {
    const b = this.balance(id)
    if (!Number.isInteger(cents) || cents <= 0) throw new RangeError('amount must be a positive integer of cents')
    this.store.put(`account:${id}`, b + cents)
  }
  balance(id) { const b = this.store.get(`account:${id}`); if (b === undefined) throw new Error(`no account ${id}`); return b }
}
