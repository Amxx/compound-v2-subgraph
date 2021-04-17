/* eslint-disable prefer-const */ // to satisfy AS compiler

// For each division by 10, add one to exponent to truncate one significant figure
import { BigInt, BigDecimal } from '@graphprotocol/graph-ts/index'

export function exponentToBigDecimal(decimals: i32): BigDecimal {
  return BigInt.fromI32(10).pow(<u8>decimals).toBigDecimal()
}

export let mantissaFactor = 18
export let cTokenDecimals = 8
export let mantissaFactorBD: BigDecimal = exponentToBigDecimal(18)
export let cTokenDecimalsBD: BigDecimal = exponentToBigDecimal(8)
export let zeroBD = BigDecimal.fromString('0')
