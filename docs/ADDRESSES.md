# X Layer addresses

Chain: X Layer mainnet, chain id 196, RPC `https://rpc.xlayer.tech`.

Checked live on 2026-11-18 at block 76,214,799 with `eth_getCode` (size = deployed bytecode in bytes).
Safe addresses are the canonical v1.5.0 deployments from `safe-global/safe-deployments`.

## Fengce on X Layer

Current release v2 (salts `fengce.<Name>.v2.0.0`), deployed at block 76250360 from commit `e260a37`.
Source of truth: [deployments/xlayer-196-v2.json](../deployments/xlayer-196-v2.json) (compiler settings per contract:
[deployments/manifest-xlayer-196-v2.json](../deployments/manifest-xlayer-196-v2.json)). Demo Safe: `0x0bb926DC7F79e4CEFFB30a67E8291C56C3F50707`;
treasury Safe: `0x5c53CDaED1cd64fc25AcC071b0Ca7ef891bB5661`. Read-only app over these contracts: [fengce.greyy.cc](https://fengce.greyy.cc).

| Contract | Address |
|---|---|
| AaveV3PoolDecoder | `0x8007856430d5A6a22D3de3a4d9b70582A7097f89` |
| AgentExecutor | `0xc01b590227149169260e030235b78d6e034E590c` |
| BoundVault | `0xbf76fC88e16fD18f87992f1927Aa31a713263e41` |
| Catalog | `0x26C5437428cdD7e4854614DC5DDEFE2776B51dFe` |
| FengceAgentOwner | `0xd857d1850684aC80E7DDa4ab52ea6E1B1CB0aD21` |
| FengceBinding | `0x20157A63Df8ab6728698630E38f6d7683Ca6b6F8` |
| FengceFloors | `0xD842C5B9EdDdd218d2Dbe91c3911934DdA7Ff7D4` |
| FengceGuard | `0x9D2A482fFA86fa3193F85c451A44576E2f1C8E6e` |
| FengceHook | `0xE538979145E67935B85D1912904ce8d5bF19669b` |
| FengceHook6900 | `0xAf481abCb80A73C9c300f16aAF1b61BcAaC3BEA5` |
| FengceInspector | `0xdeA3e3C305460247686c3EEeAe6552F33D98EE1A` |
| FengceSignatureVerifier | `0x81f073BF271230B832aC375ed786373Af75b5B19` |
| FengceStrictHandler | `0x846bBD554F31865C9A1301D325D73973A1F884cb` |
| PinRegistry | `0xD905dde3A09a9777B98013AD196E3b3F988e3715` |
| PolicyEngine | `0x2264B97828454374a56D7407f859fEA6eE7dFAA9` |
| Tick | `0xFEb6FD15F8724bfC69a119C0448f480a7D7e5370` |
| UniswapV2RouterDecoder | `0x34140a552Aa2c23256B4a3C760257A8CD8f88124` |
| UniswapV3RouterDecoder | `0x47FDb3C6E91661562243f97Df2f4b0B8EfFAA479` |

The previous release v1 (salts `fengce.<Name>.v0.2.0`, block 76,243,766) stays on chain and is recorded in
[deployments/xlayer-196.json](../deployments/xlayer-196.json).

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

ZeroDev Kernel v3 factory.

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
