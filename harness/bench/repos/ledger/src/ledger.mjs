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
}
