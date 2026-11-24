/** Verdict ABI subset used by the app, generated from the compiled src/verdict/Verdict.sol (forge build). */
export const verdictAbi = [
 {
  "type": "function",
  "name": "bet",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "side",
    "type": "uint8",
    "internalType": "enum Verdict.Side"
   },
   {
    "name": "amount",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "checkpoint",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "claim",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "claimable",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "who",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "encode",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "values",
    "type": "uint256[]",
    "internalType": "uint256[]"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "bytes",
    "internalType": "bytes"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "evaluateStored",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "input",
    "type": "bytes",
    "internalType": "bytes"
   },
   {
    "name": "output",
    "type": "bytes",
    "internalType": "bytes"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "market",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "tuple",
    "internalType": "struct Verdict.Market",
    "components": [
     {
      "name": "creator",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "pinId",
      "type": "bytes32",
      "internalType": "bytes32"
     },
     {
      "name": "refClosureHash",
      "type": "bytes32",
      "internalType": "bytes32"
     },
     {
      "name": "deadline",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "settleWindow",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "checkpointBlock",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "checkpointTime",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "state",
      "type": "uint8",
      "internalType": "enum Verdict.State"
     },
     {
      "name": "voidReason",
      "type": "uint8",
      "internalType": "enum Verdict.VoidReason"
     },
     {
      "name": "totals",
      "type": "uint256[2]",
      "internalType": "uint256[2]"
     },
     {
      "name": "question",
      "type": "string",
      "internalType": "string"
     }
    ]
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "marketCount",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "marketData",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "fields",
    "type": "tuple[]",
    "internalType": "struct Schema.Field[]",
    "components": [
     {
      "name": "kind",
      "type": "uint8",
      "internalType": "enum Schema.Kind"
     },
     {
      "name": "offset",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "width",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "fixedValue",
      "type": "uint256",
      "internalType": "uint256"
     }
    ]
   },
   {
    "name": "inputs",
    "type": "tuple[]",
    "internalType": "struct Verdict.Input[]",
    "components": [
     {
      "name": "source",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "callData",
      "type": "bytes",
      "internalType": "bytes"
     },
     {
      "name": "decode",
      "type": "uint8",
      "internalType": "enum Verdict.Decode"
     },
     {
      "name": "arg",
      "type": "uint256",
      "internalType": "uint256"
     }
    ]
   },
   {
    "name": "sourceCodehashes",
    "type": "bytes32[]",
    "internalType": "bytes32[]"
   },
   {
    "name": "values",
    "type": "uint256[]",
    "internalType": "uint256[]"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "paid",
  "inputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "readInputs",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "v",
    "type": "uint256[]",
    "internalType": "uint256[]"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "refund",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "registry",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract PinRegistry"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "settle",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "settleMinGas",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "stakeOf",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "who",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "yes",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "no",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "stuckReason",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "uint8",
    "internalType": "enum Verdict.VoidReason"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "token",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract IERC20Min"
   }
  ],
  "stateMutability": "view"
 }
] as const;
