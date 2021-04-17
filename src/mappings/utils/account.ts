/* eslint-disable prefer-const */ // to satisfy AS compiler

import { Address } from '@graphprotocol/graph-ts/index'
import { Account } from '../../types/schema'

export function fetchAccount(address: Address): Account {
  let account = Account.load(address.toHex())
  if (account == null) {
    account = new Account(address.toHex())
    account.countLiquidated = 0
    account.countLiquidator = 0
    account.hasBorrowed = false
    account.save()
  }
  return account as Account
}
