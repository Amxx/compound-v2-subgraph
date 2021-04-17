/* eslint-disable prefer-const */ // to satisfy AS compiler

// For each division by 10, add one to exponent to truncate one significant figure
import { Address, Bytes } from '@graphprotocol/graph-ts/index'
import { AccountCToken } from '../../types/schema'
import { zeroBD } from './helpers'
import { fetchAccount } from './account'
import { fetchMarket } from './market'

export function fetchAccountCToken(
  account: string,
  market: string,
  symbol: string,
): AccountCToken {
  let id = market.concat('-').concat(account)
  let cTokenStats = AccountCToken.load(id)

  if (cTokenStats == null) {
    cTokenStats = new AccountCToken(id)
    cTokenStats.symbol = symbol
    cTokenStats.market = market
    cTokenStats.account = account
    cTokenStats.transactionHashes = []
    cTokenStats.transactionTimes = []
    cTokenStats.accrualBlockNumber = 0
    cTokenStats.cTokenBalance = zeroBD
    cTokenStats.totalUnderlyingSupplied = zeroBD
    cTokenStats.totalUnderlyingRedeemed = zeroBD
    cTokenStats.accountBorrowIndex = zeroBD
    cTokenStats.totalUnderlyingBorrowed = zeroBD
    cTokenStats.totalUnderlyingRepaid = zeroBD
    cTokenStats.storedBorrowBalance = zeroBD
    cTokenStats.enteredMarket = false
  }

  return cTokenStats as AccountCToken
}

export function updateCommonCTokenStats(
  marketAddress: Address,
  accountAddress: Address,
  txHash: Bytes,
  timestamp: i32,
  blockNumber: i32,
): AccountCToken {
  let market = fetchMarket(marketAddress)
  let account = fetchAccount(accountAddress)
  let cTokenStats = fetchAccountCToken(account.id, market.id, market.symbol)

  let txHashes = cTokenStats.transactionHashes
  txHashes.push(txHash)
  cTokenStats.transactionHashes = txHashes

  let txTimes = cTokenStats.transactionTimes
  txTimes.push(timestamp)
  cTokenStats.transactionTimes = txTimes

  cTokenStats.accrualBlockNumber = blockNumber

  return cTokenStats
}
