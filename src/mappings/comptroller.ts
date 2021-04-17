/* eslint-disable prefer-const */ // to satisfy AS compiler

import {
  MarketListed,
  MarketEntered,
  MarketExited,
  NewCloseFactor,
  NewCollateralFactor,
  NewLiquidationIncentive,
  NewMaxAssets,
  NewPriceOracle,
} from '../types/Comptroller/Comptroller'

import { Market, Comptroller } from '../types/schema'
import { CToken } from '../types/templates'
import { mantissaFactorBD } from './utils/helpers'
import { fetchMarket } from './utils/market'
import { updateCommonCTokenStats } from './utils/accountCToken'

export function handleMarketListed(event: MarketListed): void {
  // instantiate new market
  fetchMarket(event.params.cToken).save()
  CToken.create(event.params.cToken)
}

export function handleMarketEntered(event: MarketEntered): void {
    let cTokenStats = updateCommonCTokenStats(
    event.params.cToken,
    event.params.account,
    event.transaction.hash,
    event.block.timestamp.toI32(),
    event.block.number.toI32(),
  )
  cTokenStats.enteredMarket = true
  cTokenStats.save()
}

export function handleMarketExited(event: MarketExited): void {
  let cTokenStats = updateCommonCTokenStats(
    event.params.cToken,
    event.params.account,
    event.transaction.hash,
    event.block.timestamp.toI32(),
    event.block.number.toI32(),
  )
  cTokenStats.enteredMarket = false
  cTokenStats.save()
}

export function handleNewCloseFactor(event: NewCloseFactor): void {
  let comptroller = Comptroller.load('1')
  if (comptroller == null) {
    comptroller = new Comptroller('1')
  }
  comptroller.closeFactor = event.params.newCloseFactorMantissa
  comptroller.save()
}

export function handleNewCollateralFactor(event: NewCollateralFactor): void {
  let market = fetchMarket(event.params.cToken)
  market.collateralFactor = event.params.newCollateralFactorMantissa
    .toBigDecimal()
    .div(mantissaFactorBD)
  market.save()
}

// This should be the first event acccording to etherscan but it isn't.... price oracle is. weird
export function handleNewLiquidationIncentive(event: NewLiquidationIncentive): void {
  let comptroller = Comptroller.load('1')
  if (comptroller == null) {
    comptroller = new Comptroller('1')
  }
  comptroller.liquidationIncentive = event.params.newLiquidationIncentiveMantissa
  comptroller.save()
}

export function handleNewMaxAssets(event: NewMaxAssets): void {
  let comptroller = Comptroller.load('1')
  if (comptroller == null) {
    comptroller = new Comptroller('1')
  }
  comptroller.maxAssets = event.params.newMaxAssets
  comptroller.save()
}

export function handleNewPriceOracle(event: NewPriceOracle): void {
  let comptroller = Comptroller.load('1')
  if (comptroller == null) {
    comptroller = new Comptroller('1')
  }
  comptroller.priceOracle = event.params.newPriceOracle
  comptroller.save()
}
