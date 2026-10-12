import { InsufficientFunds } from './errors.mjs'
// Accounts hold integer cents.
export class Ledger {
  constructor() { this.accounts = new Map() }
  open(id) { if (this.accounts.has(id)) throw new Error(`account ${id} exists`); this.accounts.set(id, 0) }
  deposit(id, cents) {
    if (!this.accounts.has(id)) throw new Error(`no account ${id}`)
    if (!Number.isInteger(cents) || cents <= 0) throw new RangeError('amount must be a positive integer of cents')
    this.accounts.set(id, this.accounts.get(id) + cents)
  }
  balance(id) { if (!this.accounts.has(id)) throw new Error(`no account ${id}`); return this.accounts.get(id) }
  transfer(from, to, cents) {
    if (!Number.isInteger(cents) || cents <= 0) throw new RangeError('amount must be a positive integer of cents')
    const have = this.balance(from); this.balance(to)
    if (have < cents) throw new InsufficientFunds(from, cents, have)
    this.accounts.set(from, have - cents); this.accounts.set(to, this.accounts.get(to) + cents)
  }
}
