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
