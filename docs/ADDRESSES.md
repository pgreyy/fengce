# X Layer addresses

Chain: X Layer mainnet, chain id 196, RPC `https://rpc.xlayer.tech`.

Checked live on 2026-11-18 at block 76,214,799 with `eth_getCode` (size = deployed bytecode in bytes).
Safe addresses are the canonical v1.5.0 deployments from `safe-global/safe-deployments`.

## Safe v1.5.0

| Contract | Address | Code size |
|---|---|---|
| Safe (singleton) | `0xFf51A5898e281Db6DfC7855790607438dF2ca44b` | 21,451 |
| SafeL2 (singleton, used by Fengce) | `0xEdd160fEBBD92E350D4D398fb636302fccd67C7e` | 22,231 |
| SafeProxyFactory | `0x14F2982D601c9458F93bd70B218933A6f8165e7b` | 3,321 |
| CompatibilityFallbackHandler | `0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4` | 6,294 |
| ExtensibleFallbackHandler | `0x85a8ca358D388530ad0fB95D0cb89Dd44Fc242c3` | 11,659 |
| TokenCallbackHandler | `0x54e86d004d71a8D2112ec75FaCE57D730b0433F3` | 2,467 |
| MultiSendCallOnly | `0xA83c336B20401Af773B6219BA5027174338D1836` | 421 |
| MultiSend (allows delegatecall; Fengce denies it) | `0x218543288004CD07832472D464648173c77D7eB7` | 640 |
| SignMessageLib | `0x4FfeF8222648872B3dE295Ba1e49110E61f5b5aa` | 966 |
| CreateCall | `0x2Ef5ECfbea521449E4De05EDB1ce63B75eDA90B4` | 1,099 |

`VERSION()` on the singleton returns `"1.5.0"`.

## TapeOut

| Contract | Address | Notes |
|---|---|---|
| Factory (proxy) | `0x1f09DAeFA827f02CBb40967cc91b259763760761` | 130 bytes. EIP-1967 implementation slot: `0x336e9f0f4c3fee7c8c803377e4dea00293f4ae2a` |
| NAND test processor | `0x839bdD6fa7A66416A609A735e11DE5411B98574e` | Circuit #2 (one NAND gate), used in the spike. `isCPU` = true |
| Large test processor | `0x2046aa63bFB03f393AD85a518011fdf8aF3DDB53` | Circuit #3 (1,204 gates), used for gas measurement |
| Processor beacon | `0xf70d1ed4f62cf3780157b0b421b7e2f45bd0991c` | Beacon of both processors above; `implementation()` = `0x977f217887E085D298Cb3819cDAD5A0ee35F29B2` |

Processor entry point: `eval(uint256,bytes)`, selector `0x934d06ea`.

## Tokens and approvals

| Contract | Address | Notes |
|---|---|---|
| USDT0 | `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` | Symbol `USD₮0`, 6 decimals |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | 9,152 bytes |

## Not deployed on X Layer (from the blueprint sweep)

Safe7579 adapter (canonical address) and ZeroDev Kernel v3 factory. Fengce deploys the Safe7579 adapter itself.

## Verdict checks (2026-11-18, read-only)

### Comparator circuit for "value >= threshold"

Found: processor `0xF9bBdc7f678eb3A49D338ffAcDaaD9339de50a0F`, circuit **7**: `a >= b` on 16-bit operands.

| Field | Value |
|---|---|
| Inputs / outputs / state | 32 / 1 / 0 (stateless) |
| Gates | 114 NAND, no LATCH, no REF |
| Layout | a = inputs 0..15, b = inputs 16..31, LSB first; output bit 0 = (a >= b) |
| netlistHash | `0x3f79ea6c551d8b2206c10b8a38e6c27ad3f7da332028c32e3c1a25dfe6f31c9f` |
| `isCPU` | true |
| `eval` gas (eth_estimateGas, zero input) | 318,233 |
| Check | 3,016 vectors (16 edge pairs, equal and off-by-one pairs, random) with 0 mismatches at block 76,221,299. Not exhaustive (2^32 inputs) |

How it was found (`sdk/scripts/scan-comparators.ts`, read-only, block 76,221,242): all 427 processors and
11,614 circuits were listed; 3,269 were stateless with 1 to 2 outputs and 2 to 256 inputs; the 3,180 of those
with at most 5,000 gates were tested with `eval`. Other two-operand comparators found: 16-bit `a > b`
(`0x87BFCa3494Aa228fF589ab9B642143A5e8c8F9a6` #686, `0xF044d395C91E77459E6b2155015e14F0DD9B349f` #42),
10-bit `a < b` (`0xF5c2bca1f38C6861F6d1303c0CbE840671ae4298` #123), 8-bit `a < b`
(`0xF9bBdc7f678eb3A49D338ffAcDaaD9339de50a0F` #5), and smaller ones. None is wider than 16 bits, so a market
value must fit in 16 bits (0..65,535); a larger value is rejected by Schema and the market settles INVALID.
The Verdict fork tests use circuit #7 (`test/Verdict.t.sol`). Re-check with
`npx tsx sdk/scripts/check-comparator.ts 0xF9bBdc7f678eb3A49D338ffAcDaaD9339de50a0F 7 ge`.

### USDT0

Read on-chain at block 76,219,307: `symbol()` = `USD₮0`, `name()` = `USD₮0`, `decimals()` = 6.

### Chainlink Data Streams (report only, not integrated)

| Item | Value | Source |
|---|---|---|
| VerifierProxy, X Layer mainnet | `0xcE73c8ad08CBDEaCa6078BF0627C8fe0a9a536E7` | Chainlink docs source, `smartcontractkit/documentation` `src/features/feeds/data/StreamsNetworksData.ts` (last change 2026-09-16, commit `696d4f8`). The rendered docs pages returned 404 on 2026-11-18 |
| Live check | 7,009 bytes of code; `typeAndVersion()` = `VerifierProxy 2.0.0`; `s_feeManager()` = `0x0000…0000`; `owner()` = `0x53E56FefC450cd72149d6545e699c762348e19b9` | `eth_call` on X Layer |
| VerifierProxy, X Layer testnet | `0x72790f9eB82db492a7DDb6d2af22A270Dcc3Db64` | same docs source; not checked live |
| Example stream id (ETH/USD, schema v3) | `0x000362205e10b3a147d02792eccee483dca6c7b44ecce7012cb8c6e0b68b3ae9` | Chainlink docs, Data Streams API authentication page ("mainnet ETH/USD feed ID"). The `0x0003` prefix is the v3 report schema |
| X Layer support announced | 2026-02-26 | Chainlink changelog "Data Streams Expands to New Blockchains" |

Not verified: whether this stream id is served for X Layer reports. That needs a signed report, which needs
Data Streams API credentials. The zero fee manager suggests on-chain verification charges no fee on X Layer; a
real `verify()` call is still needed to confirm.

### TapeOut factory as a data source

The factory proxy keeps its implementation only in the ERC-1967 slot and exposes no getter, so a contract cannot
check it. Verdict pins the factory by code hash only (`PinRegistry.pinContract(factory, 0)`); an implementation
upgrade before settlement is not detected on-chain.

## DeFi protocols on X Layer (checked 2026-11-18, read-only)

| Protocol | Contract | Address | Check |
|---|---|---|---|
| Uniswap V3 | SwapRouter02 | `0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA` | 24,497 bytes; `factory()` = V3 factory, `WETH9()` = WOKB, `factoryV2()` = V2 factory |
| Uniswap V3 | UniswapV3Factory | `0x4B2ab38DBF28D31D467aA8993f6c2585981D6804` | 24,535 bytes; WOKB/USDT0 pools at 0.05% (`0xe3BE6A0137f1b0602Fc1a4841686f43B340a5082`) and 0.3% have liquidity |
| Uniswap | UniversalRouter v2.0 | `0x5507749f2c558bb3e162c6e90c314c092e7372ff` | 19,499 bytes (no decoder yet) |
| Uniswap V2 | UniswapV2Router02 | `0x182a927119d56008d921126764bf884221b10f59` | 21,902 bytes; `factory()` = `0xDf38F24fE153761634Be942F9d859f3DBA857E95`, `WETH()` = WOKB |
| Wrapped OKB | WOKB | `0xe538905cf8410324e03A5A23C1c177a474D59b2b` | 3,474 bytes |
| Aave V3 | Pool | `0xE3F3Caefdd7180F884c01E57f65Df979Af84f116` | proxy, 1,841 bytes; `ADDRESSES_PROVIDER()` = `0xdFf435BCcf782f11187D3a4454d96702eD78e092`; 13 reserves including USDT0 and WOKB (address from bgd-labs/aave-address-book `AaveV3XLayer.sol`) |
| OKX DEX aggregator | DexRouter | not verified | OKX's docs pages for contract addresses return 404 and the OKX DEX SDK fetches the router address from its authenticated API at runtime; no address could be confirmed, so there is no decoder for it |

Sources: Uniswap docs (v3 X Layer deployments, v2 deployments), bgd-labs/aave-address-book; every address
above was confirmed with `eth_getCode` and the calls listed.

## Gate circuits found on X Layer (read-only scan, `sdk/scripts/find-gate-circuits.ts`)

Smallest stateless 2-input circuit per truth table (inputs 0..3; bit 0 = a, bit 1 = b), block 76,227,771:
AND `0x73153e5fd2Acac604D49d6ca9fea27b750718F22` #5 (2 gates), NOR `0x87BFCa3494Aa228fF589ab9B642143A5e8c8F9a6`
#52 (4 gates, used by the swap tests), OR `0x7995B5bF48AdB2B893F12A1ef32D8Db23D88Da1E` #6, XOR
`0x839bdD6fa7A66416A609A735e11DE5411B98574e` #1, XNOR `0x7995…Da1E` #16.
