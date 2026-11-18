// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISafe} from "@safe/interfaces/ISafe.sol";

import {Schema} from "../src/core/Schema.sol";
import {TxFacts} from "../src/core/TxFacts.sol";
import {ITapeOutProcessor} from "../src/core/interfaces/ITapeOut.sol";
import {FengceGuard} from "../src/safe/FengceGuard.sol";
import {UniswapV3RouterDecoder} from "../src/decoders/UniswapV3RouterDecoder.sol";
import {ForkBase} from "./utils/ForkBase.sol";

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

/// Fork test on live X Layer: real Uniswap V3 swaps (SwapRouter02, WOKB/USDT0 0.05% pool) through a Safe
/// whose policy is a deployed NOR circuit (0x87BFCa…F9a6 #52): a = amountIn > 100, b = recipient is
/// not the Safe; allow only when both are 0.
contract FengceDecodersForkTest is ForkBase {
    address constant ROUTER = 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA;
    address constant WOKB = 0xe538905cf8410324e03A5A23C1c177a474D59b2b;
    address constant NOR_CPU = 0x87BFCa3494Aa228fF589ab9B642143A5e8c8F9a6;

    ISafe safe;
    UniswapV3RouterDecoder decoder;

    function setUp() public {
        _forkAndPin();
        decoder = new UniswapV3RouterDecoder();
        Schema.Layout memory l;
        l.netlistHash = keccak256(ITapeOutProcessor(NOR_CPU).netlist(52));
        l.nIn = 2;
        l.fields = new Schema.Field[](2);
        l.fields[0] = Schema.Field(Schema.Kind.Bool, 0, 1, 0);
        l.fields[1] = Schema.Field(Schema.Kind.Bool, 1, 1, 0);
        bytes32 norPin = reg.pin(NOR_CPU, 52, Schema.hash(l), bytes32(0));

        FengceGuard.ConfigInput memory c = _cfg();
        c.pinId = norPin;
        c.layout = l;
        c.bindings = new TxFacts.Binding[](2);
        c.bindings[0] = TxFacts.Binding(TxFacts.Source.AmountGt, 100);
        c.bindings[1] = TxFacts.Binding(TxFacts.Source.RecipientIsForeign, 0);

        safe = _newSafe();
        deal(USDT0, address(safe), 1_000);
        _exec(safe, address(guard), 0, abi.encodeCall(FengceGuard.setDecoder, (ROUTER, decoder.EXACT_INPUT_SINGLE(), address(decoder))));
        _exec(safe, address(guard), 0, abi.encodeCall(FengceGuard.configure, (c)));
        _exec(safe, address(safe), 0, abi.encodeWithSignature("setGuard(address)", address(guard)));
        _exec(safe, address(safe), 0, abi.encodeWithSignature("setModuleGuard(address)", address(guard)));
        // Approval through the policy: amount 100 <= cap, no recipient -> allowed.
        assertTrue(_exec(safe, USDT0, 0, abi.encodeCall(IERC20.approve, (ROUTER, 100))));
    }

    function _swap(address recipient, uint256 amountIn) internal pure returns (bytes memory) {
        return abi.encodeCall(
            ISwapRouter02.exactInputSingle, (ISwapRouter02.ExactInputSingleParams(USDT0, WOKB, 500, recipient, amountIn, 0, 0))
        );
    }

    function test_validSwapPasses() public {
        uint256 before = IERC20(WOKB).balanceOf(address(safe));
        assertTrue(_exec(safe, ROUTER, 0, _swap(address(safe), 100)));
        assertGt(IERC20(WOKB).balanceOf(address(safe)), before);
        assertEq(IERC20(USDT0).balanceOf(address(safe)), 900);
        // SwapRouter02's "msg.sender" shortcut (address(1)) resolves to the Safe: also allowed.
        _exec(safe, USDT0, 0, abi.encodeCall(IERC20.approve, (ROUTER, 50)));
        assertTrue(_exec(safe, ROUTER, 0, _swap(address(1), 50)));
    }

    function test_swapToAnotherRecipientDenied() public {
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceDenied.selector, address(safe), ROUTER));
        _exec(safe, ROUTER, 0, _swap(RECIP, 100));
    }

    function test_swapOverCapDenied() public {
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceDenied.selector, address(safe), ROUTER));
        _exec(safe, ROUTER, 0, _swap(address(safe), 150));
    }
}
