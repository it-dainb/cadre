export class InsufficientFunds extends Error {
  constructor(account, needed, available) { super(`account ${account} holds ${available}, needs ${needed}`); this.name = 'InsufficientFunds'; Object.assign(this, { account, needed, available }) }
}
