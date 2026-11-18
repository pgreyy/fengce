import { parseAbi } from "viem";

export const processorAbi = parseAbi([
  "function circuitInfo(uint256 id) view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)",
  "function netlist(uint256 id) view returns (bytes)",
  "function eval(uint256 id, bytes inputs) view returns (bytes)",
]);

export const safeAbi = parseAbi([
  "function setup(address[] owners, uint256 threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
]);

export const proxyFactoryAbi = parseAbi([
  "function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address)",
]);

export const XLAYER = {
  chainId: 196,
  rpc: "https://rpc.xlayer.tech",
  tapeoutFactory: "0x1f09DAeFA827f02CBb40967cc91b259763760761",
  safeProxyFactory: "0x14F2982D601c9458F93bd70B218933A6f8165e7b",
  safeL2: "0xEdd160fEBBD92E350D4D398fb636302fccd67C7e",
  fallbackHandler: "0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4",
} as const;
