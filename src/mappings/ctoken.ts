/* eslint-disable prefer-const */ // to satisfy AS compiler
import {
  Mint,
  Redeem,
  Borrow,
  RepayBorrow,
  LiquidateBorrow,
  Transfer,
  AccrueInterest,
  AccrueInterest1,
  NewReserveFactor,
  NewMarketInterestRateModel,
} from '../types/templates/CToken/CToken'
import { Market } from '../types/schema'

import { fetchAccount } from './utils/account'
import { updateCommonCTokenStats } from './utils/accountCToken'
import { fetchMarket, updateMarket } from './utils/market'
import {
  exponentToBigDecimal,
  cTokenDecimalsBD,
  cTokenDecimals,
  zeroBD,
} from './utils/helpers'

/* Account supplies assets into market and receives cTokens in exchange
 *
 * event.mintAmount is the underlying asset
 * event.mintTokens is the amount of cTokens minted
 * event.minter is the account
 *
 * Notes
 *    Transfer event will always get emitted with this
 *    Mints originate from the cToken address, not 0x000000, which is typical of ERC-20s
 *    No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this
 *    No need to updateCommonCTokenStats, handleTransfer() will
 *    No need to update cTokenBalance, handleTransfer() will
 */
export function handleMint(event: Mint): void {
  // Currently not in use. Everything can be done in handleTransfer, since a Mint event
  // is always done alongside a Transfer event, with the same data
}

/*  Account supplies cTokens into market and receives underlying asset in exchange
 *
 *  event.redeemAmount is the underlying asset
 *  event.redeemTokens is the cTokens
 *  event.redeemer is the account
 *
 *  Notes
 *    Transfer event will always get emitted with this
 *    No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this
 *    No need to updateCommonCTokenStats, handleTransfer() will
 *    No need to update cTokenBalance, handleTransfer() will
 */
export function handleRedeem(event: Redeem): void {
  // Currently not in use. Everything can be done in handleTransfer, since a Redeem event
  // is always done alongside a Transfer event, with the same data
}

/* Borrow assets from the protocol. All values either ETH or ERC20
 *
 * event.params.totalBorrows = of the whole market (not used right now)
 * event.params.accountBorrows = total of the account
 * event.params.borrowAmount = that was added in this event
 * event.params.borrower = the account
 * Notes
 *    No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this
 */
export function handleBorrow(event: Borrow): void {
  let market = fetchMarket(event.address)

  let account = fetchAccount(event.params.borrower)
  account.hasBorrowed = true
  account.save()

  // Update cTokenStats common for all events, and return the stats to update unique
  // values for each event
  let cTokenStats = updateCommonCTokenStats(
    event.address,
    event.params.borrower,
    event.transaction.hash,
    event.block.timestamp.toI32(),
    event.block.number.toI32(),
  )

  let borrowAmountBD = event.params.borrowAmount
    .toBigDecimal()
    .div(exponentToBigDecimal(market.underlyingDecimals))
  let previousBorrow = cTokenStats.storedBorrowBalance

  cTokenStats.storedBorrowBalance = event.params.accountBorrows
    .toBigDecimal()
    .div(exponentToBigDecimal(market.underlyingDecimals))
    .truncate(market.underlyingDecimals)

  cTokenStats.accountBorrowIndex = market.borrowIndex
  cTokenStats.totalUnderlyingBorrowed = cTokenStats.totalUnderlyingBorrowed.plus(
    borrowAmountBD,
  )
  cTokenStats.save()

  if (
    previousBorrow.equals(zeroBD) &&
    !event.params.accountBorrows.toBigDecimal().equals(zeroBD) // checking edge case for borrwing 0
  ) {
    market.numberOfBorrowers = market.numberOfBorrowers + 1
    market.save()
  }
}

/* Repay some amount borrowed. Anyone can repay anyones balance
 *
 * event.params.totalBorrows = of the whole market (not used right now)
 * event.params.accountBorrows = total of the account (not used right now)
 * event.params.repayAmount = that was added in this event
 * event.params.borrower = the borrower
 * event.params.payer = the payer
 *
 * Notes
 *    No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this
 *    Once a account totally repays a borrow, it still has its account interest index set to the
 *    markets value. We keep this, even though you might think it would reset to 0 upon full
 *    repay.
 */
export function handleRepayBorrow(event: RepayBorrow): void {
  let market = fetchMarket(event.address)

  // Update cTokenStats common for all events, and return the stats to update unique
  // values for each event
  let cTokenStats = updateCommonCTokenStats(
    event.address,
    event.params.borrower,
    event.transaction.hash,
    event.block.timestamp.toI32(),
    event.block.number.toI32(),
  )

  let repayAmountBD = event.params.repayAmount
    .toBigDecimal()
    .div(exponentToBigDecimal(market.underlyingDecimals))

  cTokenStats.storedBorrowBalance = event.params.accountBorrows
    .toBigDecimal()
    .div(exponentToBigDecimal(market.underlyingDecimals))
    .truncate(market.underlyingDecimals)

  cTokenStats.accountBorrowIndex = market.borrowIndex
  cTokenStats.totalUnderlyingRepaid = cTokenStats.totalUnderlyingRepaid.plus(
    repayAmountBD,
  )
  cTokenStats.save()

  if (cTokenStats.storedBorrowBalance.equals(zeroBD)) {
    market.numberOfBorrowers = market.numberOfBorrowers - 1
    market.save()
  }
}

/*
 * Liquidate an account who has fell below the collateral factor.
 *
 * event.params.borrower - the borrower who is getting liquidated of their cTokens
 * event.params.cTokenCollateral - the market ADDRESS of the ctoken being liquidated
 * event.params.liquidator - the liquidator
 * event.params.repayAmount - the amount of underlying to be repaid
 * event.params.seizeTokens - cTokens seized (transfer event should handle this)
 *
 * Notes
 *    No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this.
 *    When calling this function, event RepayBorrow, and event Transfer will be called every
 *    time. This means we can ignore repayAmount. Seize tokens only changes state
 *    of the cTokens, which is covered by transfer. Therefore we only
 *    add liquidation counts in this handler.
 */
export function handleLiquidateBorrow(event: LiquidateBorrow): void {
  let liquidator = fetchAccount(event.params.liquidator)
  liquidator.countLiquidator = liquidator.countLiquidator + 1
  liquidator.save()

  let borrower = fetchAccount(event.params.borrower)
  borrower.countLiquidated = borrower.countLiquidated + 1
  borrower.save()
}

/* Transferring of cTokens
 *
 * event.params.from = sender of cTokens
 * event.params.to = receiver of cTokens
 * event.params.amount = amount sent
 *
 * Notes
 *    Possible ways to emit Transfer:
 *      seize() - i.e. a Liquidation Transfer (does not emit anything else)
 *      redeemFresh() - i.e. redeeming your cTokens for underlying asset
 *      mintFresh() - i.e. you are lending underlying assets to create ctokens
 *      transfer() - i.e. a basic transfer
 *    This function handles all 4 cases. Transfer is emitted alongside the mint, redeem, and seize
 *    events. So for those events, we do not update cToken balances.
 */
export function handleTransfer(event: Transfer): void {
  // We only updateMarket() if accrual block number is not up to date. This will only happen
  // with normal transfers, since mint, redeem, and seize transfers will already run updateMarket()
  let market = fetchMarket(event.address)
  if (market.accrualBlockNumber != event.block.number.toI32()) {
    market = updateMarket(
      event.address,
      event.block.number.toI32(),
      event.block.timestamp.toI32(),
    )
  }

  let amountUnderlying = market.exchangeRate.times(
    event.params.amount.toBigDecimal().div(cTokenDecimalsBD),
  )
  let amountUnderylingTruncated = amountUnderlying.truncate(market.underlyingDecimals)

  // Checking if the tx is FROM the cToken contract (i.e. this will not run when minting)
  // If so, it is a mint, and we don't need to run these calculations
  if (event.address != event.params.from) {
    // Update cTokenStats common for all events, and return the stats to update unique
    // values for each event
    let cTokenStatsFrom = updateCommonCTokenStats(
      event.address,
      event.params.from,
      event.transaction.hash,
      event.block.timestamp.toI32(),
      event.block.number.toI32(),
    )

    cTokenStatsFrom.cTokenBalance = cTokenStatsFrom.cTokenBalance.minus(
      event.params.amount
        .toBigDecimal()
        .div(cTokenDecimalsBD)
        .truncate(cTokenDecimals),
    )

    cTokenStatsFrom.totalUnderlyingRedeemed = cTokenStatsFrom.totalUnderlyingRedeemed.plus(
      amountUnderylingTruncated,
    )
    cTokenStatsFrom.save()

    if (cTokenStatsFrom.cTokenBalance.equals(zeroBD)) {
      market.numberOfSuppliers = market.numberOfSuppliers - 1
      market.save()
    }
  }

  // Checking if the tx is TO the cToken contract (i.e. this will not run when redeeming)
  // If so, we ignore it. this leaves an edge case, where someone who accidentally sends
  // cTokens to a cToken contract, where it will not get recorded. Right now it would
  // be messy to include, so we are leaving it out for now TODO fix this in future
  if (event.address != event.params.to) {
    // Update cTokenStats common for all events, and return the stats to update unique
    // values for each event
    let cTokenStatsTo = updateCommonCTokenStats(
      event.address,
      event.params.to,
      event.transaction.hash,
      event.block.timestamp.toI32(),
      event.block.number.toI32(),
    )

    let previousCTokenBalanceTo = cTokenStatsTo.cTokenBalance
    cTokenStatsTo.cTokenBalance = cTokenStatsTo.cTokenBalance.plus(
      event.params.amount
        .toBigDecimal()
        .div(cTokenDecimalsBD)
        .truncate(cTokenDecimals),
    )

    cTokenStatsTo.totalUnderlyingSupplied = cTokenStatsTo.totalUnderlyingSupplied.plus(
      amountUnderylingTruncated,
    )
    cTokenStatsTo.save()

    if (
      previousCTokenBalanceTo.equals(zeroBD) &&
      !event.params.amount.toBigDecimal().equals(zeroBD) // checking edge case for transfers of 0
    ) {
      market.numberOfSuppliers = market.numberOfSuppliers + 1
      market.save()
    }
  }
}

export function handleAccrueInterest(event: AccrueInterest): void {
  let market = updateMarket(
    event.address,
    event.block.number.toI32(),
    event.block.timestamp.toI32(),
  )

  market.totalInterestAccumulatedExact = market.totalInterestAccumulatedExact.plus(
    event.params.interestAccumulated,
  )
  market.totalInterestAccumulated = market.totalInterestAccumulatedExact
    .toBigDecimal()
    .div(exponentToBigDecimal(market.underlyingDecimals))
    .truncate(market.underlyingDecimals)
  market.save()
}

export function handleAccrueInterest1(event: AccrueInterest1): void {
  let market = updateMarket(
    event.address,
    event.block.number.toI32(),
    event.block.timestamp.toI32(),
  )

  market.totalInterestAccumulatedExact = market.totalInterestAccumulatedExact.plus(
    event.params.interestAccumulated,
  )
  market.totalInterestAccumulated = market.totalInterestAccumulatedExact
    .toBigDecimal()
    .div(exponentToBigDecimal(market.underlyingDecimals))
    .truncate(market.underlyingDecimals)
  market.save()
}

export function handleNewReserveFactor(event: NewReserveFactor): void {
  let market = fetchMarket(event.address)
  market.reserveFactor = event.params.newReserveFactorMantissa
  market.save()
}

export function handleNewMarketInterestRateModel(
  event: NewMarketInterestRateModel,
): void {
  let market = fetchMarket(event.address)
  market.interestRateModelAddress = event.params.newInterestRateModel
  market.save()
}
