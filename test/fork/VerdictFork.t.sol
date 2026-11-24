// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PinRegistry} from "../../src/core/PinRegistry.sol";
import {Schema} from "../../src/core/Schema.sol";
import {ITapeOutProcessor} from "../../src/core/interfaces/ITapeOut.sol";
import {Verdict, IERC20Min} from "../../src/verdict/Verdict.sol";

interface IERC20Approve is IERC20Min {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

interface ICatalogCount {
    function count() external view returns (uint256);
}

/// Fork tests on live X Layer state with the deployed v2 PinRegistry, the Catalog's comparator listing
/// (processor 0xF9bB…0a0F circuit 7: output 1 when a >= b, a and b 16-bit) and real USDT0.
/// Market: "Catalog.count() >= threshold", a = Catalog.count() read at the checkpoint, b = threshold.
contract VerdictForkTest is Test {
    PinRegistry constant REG = PinRegistry(0xD905dde3A09a9777B98013AD196E3b3F988e3715);
    ICatalogCount constant CATALOG = ICatalogCount(0x26C5437428cdD7e4854614DC5DDEFE2776B51dFe);
    bytes32 constant CMP_PIN = 0xc9ccba1f2e025335a938f0c0c200c562662d9a75221a1e8ca45fa20b05fe6c91;
    address constant CMP_CPU = 0xF9bBdc7f678eb3A49D338ffAcDaaD9339de50a0F;
    IERC20Approve constant USDT0 = IERC20Approve(0x779Ded0c9e1022225f8E0630b35a9b54bE713736);
    address constant HISTORY = 0x0000F90827F1C53a10cb7A02335B175320002935; // EIP-2935

    Verdict v;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint256 listed;

    function setUp() public {
        vm.createSelectFork("xlayer");
        v = new Verdict(REG, USDT0, 2_000_000);
        listed = CATALOG.count();
        deal(address(USDT0), alice, 100e6);
        deal(address(USDT0), bob, 100e6);
        vm.prank(alice);
        USDT0.approve(address(v), type(uint256).max);
        vm.prank(bob);
        USDT0.approve(address(v), type(uint256).max);
    }

    function _layout() internal view returns (Schema.Layout memory l) {
        l.netlistHash = keccak256(ITapeOutProcessor(CMP_CPU).netlist(7));
        l.nIn = 32;
        l.fields = new Schema.Field[](2);
        l.fields[0] = Schema.Field(Schema.Kind.Uint, 0, 16, 0); // a: Catalog.count()
        l.fields[1] = Schema.Field(Schema.Kind.Uint, 16, 16, 0); // b: threshold
    }

    function _market(uint256 threshold) internal returns (uint256) {
        Verdict.Input[] memory xs = new Verdict.Input[](2);
        xs[0] = Verdict.Input(address(CATALOG), abi.encodeCall(ICatalogCount.count, ()), Verdict.Decode.Word, 0);
        xs[1] = Verdict.Input(address(0), "", Verdict.Decode.Constant, threshold);
        return v.createMarket(
            Verdict.NewMarket(
                "Will the Fengce Catalog list at least N policies?",
                CMP_PIN,
                _layout(),
                xs,
                uint64(block.timestamp + 2 days),
                30 minutes
            )
        );
    }

    function test_createBetCheckpointSettleClaim() public {
        assertTrue(REG.isPinned(CMP_PIN), "comparator pin must hold on mainnet");
        uint256 id = _market(listed); // count >= count -> YES
        vm.prank(alice);
        v.bet(id, Verdict.Side.Yes, 10e6);
        vm.prank(bob);
        v.bet(id, Verdict.Side.No, 30e6);

        vm.warp(block.timestamp + 2 days + 10 minutes);
        vm.roll(block.number + 1);
        v.checkpoint(id);
        (,,, uint256[] memory vals) = v.marketData(id);
        assertEq(vals[0], listed);
        assertEq(vals[1], listed);

        v.settle(id);
        assertEq(uint8(v.market(id).state), uint8(Verdict.State.Yes));
        (bytes memory input, bytes memory output) = v.evaluateStored(id);
        assertEq(output, hex"01");
        // The same answer straight from the processor, as the app's Re-run panel does it.
        assertEq(ITapeOutProcessor(CMP_CPU).eval(7, input), output);

        uint256 before = USDT0.balanceOf(alice);
        vm.prank(alice);
        v.claim(id);
        assertEq(USDT0.balanceOf(alice) - before, 40e6);
        assertEq(USDT0.balanceOf(address(v)), 0);
    }

    function test_settlesNoWhenBelowThreshold() public {
        uint256 id = _market(listed + 1);
        vm.prank(alice);
        v.bet(id, Verdict.Side.Yes, 10e6);
        vm.prank(bob);
        v.bet(id, Verdict.Side.No, 10e6);
        vm.warp(block.timestamp + 2 days);
        v.checkpoint(id);
        v.settle(id);
        assertEq(uint8(v.market(id).state), uint8(Verdict.State.No));
    }

    function test_refundWhenNobodyCheckpoints() public {
        uint256 id = _market(listed);
        vm.prank(alice);
        v.bet(id, Verdict.Side.Yes, 10e6);
        vm.prank(bob);
        v.bet(id, Verdict.Side.No, 30e6);
        vm.warp(block.timestamp + 2 days + 30 minutes + 1);
        vm.prank(bob);
        v.refund(id);
        vm.prank(alice);
        v.refund(id);
        assertEq(USDT0.balanceOf(alice), 100e6);
        assertEq(USDT0.balanceOf(bob), 100e6);
        assertEq(uint8(v.market(id).voidReason), uint8(Verdict.VoidReason.NoCheckpoint));
    }

    /// EIP-2935: the block-hash history contract exists on X Layer and serves the last 8191 hashes.
    function test_eip2935HistoryContract() public view {
        assertEq(HISTORY.code.length, 83);
        uint256 n = block.number - 1;
        (bool ok, bytes memory ret) = HISTORY.staticcall(abi.encode(n));
        assertTrue(ok);
        assertEq(bytes32(ret), blockhash(n));
        assertTrue(bytes32(ret) != bytes32(0));
        (ok,) = HISTORY.staticcall(abi.encode(block.number - 8192));
        assertFalse(ok, "older than 8191 blocks reverts");
    }
}
