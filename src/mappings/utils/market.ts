/* eslint-disable prefer-const */ // to satisfy AS compiler

// For each division by 10, add one to exponent to truncate one significant figure
import { Address, BigDecimal, BigInt, log } from '@graphprotocol/graph-ts/index'
import { Market, Comptroller } from '../../types/schema'
// PriceOracle is valid from Comptroller deployment until block 8498421
import { PriceOracle } from '../../types/templates/CToken/PriceOracle'
// PriceOracle2 is valid from 8498422 until present block (until another proxy upgrade)
import { PriceOracle2 } from '../../types/templates/CToken/PriceOracle2'
import { ERC20 } from '../../types/templates/CToken/ERC20'
import { CToken } from '../../types/templates/CToken/CToken'

import {
  exponentToBigDecimal,
  mantissaFactor,
  mantissaFactorBD,
  cTokenDecimalsBD,
  zeroBD,
} from './helpers'

let cUSDC = Address.fromString('0x39aa39c021dfbae8fac545936693ac917d5e7563')
let cETH = Address.fromString('0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5')
let DAI = Address.fromString('0x89d24a6b4ccb1b6faa2625fe562bdd9a23260359')
let USDC = Address.fromString('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')

export function fetchMarket(marketAddress: Address): Market {
  let market = Market.load(marketAddress.toHex())

  if (market == null) {
    let contract = CToken.bind(marketAddress)

    market = new Market(marketAddress.toHex())
    market.borrowRate = zeroBD
    market.cash = zeroBD
    market.collateralFactor = zeroBD
    market.exchangeRate = zeroBD
    market.interestRateModelAddress = Address.fromString('0x0000000000000000000000000000000000000000')
    market.name = contract.name()
    market.numberOfBorrowers = 0
    market.numberOfSuppliers = 0
    market.reserves = zeroBD
    market.supplyRate = zeroBD
    market.symbol = contract.symbol()
    market.totalBorrows = zeroBD
    market.totalSupply = zeroBD
    market.underlyingPrice = zeroBD

    market.accrualBlockNumber = 0
    market.blockTimestamp = 0
    market.borrowIndex = zeroBD
    market.reserveFactor = BigInt.fromI32(0)
    market.underlyingPriceUSD = zeroBD

    market.totalInterestAccumulatedExact = BigInt.fromI32(0)
    market.totalInterestAccumulated = zeroBD

    // It is CETH, which has a slightly different interface
    let underlyingAddress = contract.try_underlying()
    if (underlyingAddress.reverted) {
      // CEth
      market.underlyingAddress = Address.fromString('0x0000000000000000000000000000000000000000')
      market.underlyingName = 'Ether'
      market.underlyingSymbol = 'ETH'
      market.underlyingDecimals = 18
    } else {
      // It is all other CERC20 contracts
      let underlying = ERC20.bind(underlyingAddress.value)
      market.underlyingAddress = underlyingAddress.value

      if (underlying._address == DAI) {
        market.underlyingName = 'Dai Stablecoin v1.0 (DAI)'
        market.underlyingSymbol = 'DAI'
        market.underlyingDecimals = 18
      } else {
        let underlyingName = underlying.try_name()
        let underlyingSymbol = underlying.try_symbol()
        let underlyingDecimals = underlying.try_decimals()
        market.underlyingName = underlyingName.reverted ? '<MissingName>' : underlyingName.value
        market.underlyingSymbol = underlyingSymbol.reverted ? '<MissingSymbol>' : underlyingSymbol.value
        market.underlyingDecimals = underlyingDecimals.reverted ? 18 : underlyingDecimals.value
      }
    }
  }

  return market as Market
}

export function updateMarket(
  marketAddress: Address,
  blockNumber: i32,
  blockTimestamp: i32,
): Market {
  let market = fetchMarket(marketAddress)
  // Only updateMarket if it has not been updated this block
  if (market.accrualBlockNumber != blockNumber) {
    let contractAddress = Address.fromString(market.id)
    let contract = CToken.bind(contractAddress)

    updateMarketPrice(market, blockNumber);

    market.accrualBlockNumber = contract.accrualBlockNumber().toI32()
    market.blockTimestamp = blockTimestamp
    market.totalSupply = contract
      .totalSupply()
      .toBigDecimal()
      .div(cTokenDecimalsBD)

    /* Exchange rate explanation
       In Practice
        - If you call the cDAI contract on etherscan it comes back (2.0 * 10^26)
        - If you call the cUSDC contract on etherscan it comes back (2.0 * 10^14)
        - The real value is ~0.02. So cDAI is off by 10^28, and cUSDC 10^16
       How to calculate for tokens with different decimals
        - Must div by tokenDecimals, 10^market.underlyingDecimals
        - Must multiply by ctokenDecimals, 10^8
        - Must div by mantissa, 10^18
     */
    market.exchangeRate = contract
      .exchangeRateStored()
      .toBigDecimal()
      .div(exponentToBigDecimal(market.underlyingDecimals))
      .times(cTokenDecimalsBD)
      .div(mantissaFactorBD)
      .truncate(mantissaFactor)
    market.borrowIndex = contract
      .borrowIndex()
      .toBigDecimal()
      .div(mantissaFactorBD)
      .truncate(mantissaFactor)

    market.reserves = contract
      .totalReserves()
      .toBigDecimal()
      .div(exponentToBigDecimal(market.underlyingDecimals))
      .truncate(market.underlyingDecimals)
    market.totalBorrows = contract
      .totalBorrows()
      .toBigDecimal()
      .div(exponentToBigDecimal(market.underlyingDecimals))
      .truncate(market.underlyingDecimals)
    market.cash = contract
      .getCash()
      .toBigDecimal()
      .div(exponentToBigDecimal(market.underlyingDecimals))
      .truncate(market.underlyingDecimals)

    // Must convert to BigDecimal, and remove 10^18 that is used for Exp in Compound Solidity
    market.supplyRate = contract
      .borrowRatePerBlock()
      .toBigDecimal()
      .times(BigDecimal.fromString('2102400'))
      .div(mantissaFactorBD)
      .truncate(mantissaFactor)

    // This fails on only the first call to cZRX. It is unclear why, but otherwise it works.
    // So we handle it like this.
    let supplyRatePerBlock = contract.try_supplyRatePerBlock()
    if (supplyRatePerBlock.reverted) {
      log.info('***CALL FAILED*** : cERC20 supplyRatePerBlock() reverted', [])
      market.borrowRate = zeroBD
    } else {
      market.borrowRate = supplyRatePerBlock.value
        .toBigDecimal()
        .times(BigDecimal.fromString('2102400'))
        .div(mantissaFactorBD)
        .truncate(mantissaFactor)
    }
    market.save()
  }
  return market as Market
}

function updateMarketPrice(
  market: Market,
  blockNumber: i32,
): void {
  if (blockNumber > 10984837) {
    let comptroller = Comptroller.load('1')
    // eth → usd after  10984837
    let conversion = PriceOracle2.bind(comptroller.priceOracle as Address)
      .getUnderlyingPrice(cETH)
      .toBigDecimal()
      .div(exponentToBigDecimal(18));

    if (market.underlyingAddress == Address.fromString('0x0000000000000000000000000000000000000000')) {
      market.underlyingPrice = BigDecimal.fromString('1');
      market.underlyingPriceUSD = conversion;
    } else if (market.underlyingAddress as Address == USDC) {
      market.underlyingPrice = conversion;
      market.underlyingPriceUSD = BigDecimal.fromString('1');
    } else {
      market.underlyingPriceUSD = PriceOracle2.bind(comptroller.priceOracle as Address)
        .getUnderlyingPrice(Address.fromString(market.id))
        .toBigDecimal()
        .div(exponentToBigDecimal(18 - market.underlyingDecimals + 18))
        .truncate(market.underlyingDecimals);
      market.underlyingPrice = market.underlyingPriceUSD
        .div(conversion)
        .truncate(market.underlyingDecimals)
    }
  } else if (blockNumber > 7715908) {
    let comptroller = Comptroller.load('1')
    // usd → eth before 10984837
    let conversion = PriceOracle2.bind(comptroller.priceOracle as Address)
      .getUnderlyingPrice(cUSDC)
      .toBigDecimal()
      .div(exponentToBigDecimal(18 - 6 + 18));

    if (market.underlyingAddress == Address.fromString('0x0000000000000000000000000000000000000000')) {
      market.underlyingPrice = BigDecimal.fromString('1');
      market.underlyingPriceUSD = BigDecimal.fromString('1').div(conversion);
    } else if (market.underlyingAddress as Address == USDC) {
      market.underlyingPrice = conversion;
      market.underlyingPriceUSD = BigDecimal.fromString('1');
    } else {
      market.underlyingPrice = PriceOracle2.bind(comptroller.priceOracle as Address)
        .getUnderlyingPrice(Address.fromString(market.id))
        .toBigDecimal()
        .div(exponentToBigDecimal(18 - market.underlyingDecimals + 18))
        .truncate(market.underlyingDecimals);
      market.underlyingPriceUSD = market.underlyingPrice
        .div(conversion)
        .truncate(market.underlyingDecimals)
    }
  } else {
    // usd → eth before 10984837
    let conversion = PriceOracle.bind(Address.fromString('02557a5e05defeffd4cae6d83ea3d173b272c904'))
      .getPrice(USDC)
      .toBigDecimal()
      .div(mantissaFactorBD);

    if (market.underlyingAddress == Address.fromString('0x0000000000000000000000000000000000000000')) {
      market.underlyingPrice = BigDecimal.fromString('1');
      market.underlyingPriceUSD = BigDecimal.fromString('1').div(conversion);
    } else if (market.underlyingAddress as Address == USDC) {
      market.underlyingPrice = conversion;
      market.underlyingPriceUSD = BigDecimal.fromString('1');
    } else {
      market.underlyingPrice = PriceOracle.bind(Address.fromString('02557a5e05defeffd4cae6d83ea3d173b272c904'))
        .getPrice(market.underlyingAddress as Address)
        .toBigDecimal()
        .div(mantissaFactorBD)
        .truncate(market.underlyingDecimals);
      market.underlyingPriceUSD = market.underlyingPrice
        .div(conversion)
        .truncate(market.underlyingDecimals)
    }
  }
}
