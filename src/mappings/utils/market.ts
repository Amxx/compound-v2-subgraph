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
let DAI = Address.fromString('0x89d24a6b4ccb1b6faa2625fe562bdd9a23260359')
let USDC = Address.fromString('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')

// Used for all cERC20 contracts
function getTokenPrice(
  blockNumber: i32,
  eventAddress: Address,
  underlyingAddress: Address,
  underlyingDecimals: i32,
): BigDecimal {
  /* PriceOracle2 is used at the block the Comptroller starts using it.
   * see here https://etherscan.io/address/0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b#events
   * Search for event topic 0xd52b2b9b7e9ee655fcb95d2e5b9e0c9f69e7ef2b8e9d2d0ea78402d576d22e22,
   * and see block 7715908.
   *
   * This must use the cToken address.
   *
   * Note this returns the value without factoring in token decimals and wei, so we must divide
   * the number by (ethDecimals - tokenDecimals) and again by the mantissa.
   * USDC would be 10 ^ ((18 - 6) + 18) = 10 ^ 30
   *
   * Note that they deployed 3 different PriceOracles at the beginning of the Comptroller,
   * and that they handle the decimals different, which can break the subgraph. So we actually
   * defer to Oracle 1 before block 7715908, which works,
   * until this one is deployed, which was used for 121 days
   *
   * PriceOracle(1) is used (only for the first ~100 blocks of Comptroller. Annoying but we must
   * handle this. We use it for more than 100 blocks, see reason at top of if statement
   * of PriceOracle2.
   *
   * This must use the token address, not the cToken address.
   *
   * Note this returns the value already factoring in token decimals and wei, therefore
   * we only need to divide by the mantissa, 10^18 */
  if (blockNumber > 7715908) {
    let comptroller = Comptroller.load('1')
    return PriceOracle2.bind(comptroller.priceOracle as Address)
      .getUnderlyingPrice(eventAddress)
      .toBigDecimal()
      .div(exponentToBigDecimal(18 - underlyingDecimals + 18))
  } else {
    return PriceOracle.bind(Address.fromString('02557a5e05defeffd4cae6d83ea3d173b272c904'))
      .getPrice(underlyingAddress)
      .toBigDecimal()
      .div(mantissaFactorBD)
  }
}

// Returns the price of USDC in eth. i.e. 0.005 would mean ETH is $200
function getUSDCpriceETH(blockNumber: i32): BigDecimal {
  // See notes on block number if statement in getTokenPrices()
  if (blockNumber > 7715908) {
    let comptroller = Comptroller.load('1')
    return PriceOracle2.bind(comptroller.priceOracle as Address)
      .getUnderlyingPrice(cUSDC)
      .toBigDecimal()
      .div(exponentToBigDecimal(18 - 6 + 18))
  } else {
    return PriceOracle.bind(Address.fromString('02557a5e05defeffd4cae6d83ea3d173b272c904'))
      .getPrice(USDC)
      .toBigDecimal()
      .div(mantissaFactorBD)
  }
}

export function fetchMarket(marketAddress: Address): Market {
  let market = Market.load(marketAddress.toHex())

  if (market == null) {
    market = new Market(marketAddress.toHex())
    let contract = CToken.bind(marketAddress)

    // It is CETH, which has a slightly different interface
    let underlyingAddress = contract.try_underlying()
    if (underlyingAddress.reverted) { // CEth
      market.underlyingAddress = Address.fromString('0x0000000000000000000000000000000000000000')
      market.underlyingName = 'Ether'
      market.underlyingSymbol = 'ETH'
      market.underlyingDecimals = 18
      market.underlyingPrice = BigDecimal.fromString('1')

      // It is all other CERC20 contracts
    } else {
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

      if (marketAddress == cUSDC) {
        market.underlyingPriceUSD = BigDecimal.fromString('1')
      }
    }

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
    let usdPriceInEth = getUSDCpriceETH(blockNumber)

    // if crETH, we only update USD price
    if (market.underlyingAddress == Address.fromString('0x0000000000000000000000000000000000000000')) {
      market.underlyingPriceUSD = market.underlyingPrice
        .div(usdPriceInEth)
        .truncate(market.underlyingDecimals)
    } else {
      let tokenPriceEth = getTokenPrice(
        blockNumber,
        contractAddress,
        market.underlyingAddress as Address,
        market.underlyingDecimals,
      )
      market.underlyingPrice = tokenPriceEth.truncate(market.underlyingDecimals)
      // if USDC, we only update ETH price
      if (marketAddress != cUSDC) {
        market.underlyingPriceUSD = market.underlyingPrice
          .div(usdPriceInEth)
          .truncate(market.underlyingDecimals)
      }
    }

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
