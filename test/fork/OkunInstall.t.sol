// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ISafe} from "@safe/interfaces/ISafe.sol";
import {Enum} from "@safe/libraries/Enum.sol";
import {PinRegistry} from "../../src/core/PinRegistry.sol";
import {Schema} from "../../src/core/Schema.sol";
import {Tick} from "../../src/core/Tick.sol";
import {FengceGuard} from "../../src/safe/FengceGuard.sol";
import {OkunLib} from "../../script/OkunLib.sol";
import {ICircuitProcessor, ITransistors} from "../../script/PrepareOkun.s.sol";

interface IProxyFactoryO {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce) external returns (address);
}

interface IERC20O {
    function balanceOf(address) external view returns (uint256);
}

/// Fork test on live X Layer with the deployed v2 guard, PinRegistry and Tick, and the real Uniswap V3 pool:
/// 1. the Solidity install builder (script/OkunLib.sol) gives the same bytes as the app (test/vectors/okun-install.json);
/// 2. the counter is taped out and both limits pinned, as script/PrepareOkun.s.sol does;
/// 3. a fresh 1-of-1 Safe installs max per buy (1 USDT0) and 2 trades per hour in one owner transaction;
/// 4. a 0.5 USDT0 swap passes, a 1.5 USDT0 swap reverts, a third swap in the hour reverts, the next hour passes;
/// 5. raising the cap needs the 1-day wait.
contract OkunInstallForkTest is Test {
    IProxyFactoryO constant FACTORY = IProxyFactoryO(0x14F2982D601c9458F93bd70B218933A6f8165e7b);
    address constant SAFE_L2 = 0xEdd160fEBBD92E350D4D398fb636302fccd67C7e;
    address constant FALLBACK = 0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4;
    FengceGuard constant GUARD = FengceGuard(OkunLib.GUARD);
    PinRegistry constant REG = PinRegistry(OkunLib.PIN_REGISTRY);

    address owner = makeAddr("owner");
    ISafe safe;
    bytes netlist;
    bytes32 maxBuyPin;
    bytes32 counterPin;

    function setUp() public {
        vm.createSelectFork("xlayer");
        netlist = vm.parseJsonBytes(vm.readFile("circuits/trade-counter.json"), ".netlist");
        _prepare();
        bytes memory init = abi.encodeCall(ISafe.setup, (_one(owner), 1, address(0), "", FALLBACK, address(0), 0, payable(address(0))));
        safe = ISafe(payable(FACTORY.createProxyWithNonce(SAFE_L2, init, uint256(keccak256("okun.fork")))));
        deal(OkunLib.USDT0, address(safe), 10_000_000); // 10 USDT0
    }

    function _one(address a) internal pure returns (address[] memory o) {
        o = new address[](1);
        o[0] = a;
    }

    /// What PrepareOkun.s.sol broadcasts, from a funded EOA.
    function _prepare() internal {
        address deployer = makeAddr("deployer");
        vm.deal(deployer, 1 ether);
        vm.startPrank(deployer);
        ICircuitProcessor cpu = ICircuitProcessor(OkunLib.COUNTER_CPU);
        ITransistors t = ITransistors(cpu.transistorsContract());
        t.mint{value: t.protocolFee()}(t.NAND(), 100);
        t.mint{value: t.protocolFee()}(t.LATCH(), 4);
        uint256 id = cpu.tapeout{value: cpu.TAPEOUT_FEE()}(netlist, 7, 1);
        maxBuyPin = REG.pin(OkunLib.MAX_BUY_CPU, OkunLib.MAX_BUY_ID, Schema.hash(OkunLib.maxBuyLayout()), bytes32(0));
        counterPin = REG.pin(OkunLib.COUNTER_CPU, id, Schema.hash(OkunLib.counterLayout(keccak256(netlist), 2)), bytes32(0));
        vm.stopPrank();
        assertTrue(REG.isPinned(maxBuyPin) && REG.isPinned(counterPin));
    }

    function _exec(address to, bytes memory data, Enum.Operation op) internal returns (bool) {
        vm.prank(owner);
        return safe.execTransaction(to, 0, data, op, 0, 0, 0, address(0), payable(address(0)), OkunLib.ownerSignature(owner));
    }

    function _swap(uint256 amountIn) internal returns (bool) {
        return _exec(OkunLib.MSCO, OkunLib.swapMultiSend(address(safe), OkunLib.USDT0, OkunLib.WOKB, amountIn, 0), Enum.Operation.DelegateCall);
    }

    function _install() internal {
        bytes memory ms = OkunLib.installMultiSend(address(safe), 1_000_000, 2, maxBuyPin, counterPin, keccak256(netlist));
        assertTrue(_exec(OkunLib.MSCO, ms, Enum.Operation.DelegateCall), "install");
    }

    function test_appAndSolidityBuildTheSameBytes() public view {
        string memory j = vm.readFile("test/vectors/okun-install.json");
        address s = vm.parseJsonAddress(j, ".safe");
        bytes memory want = vm.parseJsonBytes(j, ".installMultiSend");
        bytes memory got = OkunLib.installMultiSend(
            s,
            vm.parseJsonUint(j, ".maxPerBuy"),
            vm.parseJsonUint(j, ".tradesPerHour"),
            vm.parseJsonBytes32(j, ".maxBuyPin"),
            vm.parseJsonBytes32(j, ".counterPin"),
            keccak256(netlist)
        );
        assertEq(got, want, "install bytes");
        assertEq(OkunLib.swapMultiSend(s, OkunLib.USDT0, OkunLib.WOKB, 500_000, 0), vm.parseJsonBytes(j, ".swapIn"));
        assertEq(OkunLib.swapMultiSend(s, OkunLib.USDT0, OkunLib.WOKB, 1_500_000, 0), vm.parseJsonBytes(j, ".swapOver"));
        assertEq(Schema.hash(OkunLib.maxBuyLayout()), vm.parseJsonBytes32(j, ".maxBuySchemaHash"));
        assertEq(Schema.hash(OkunLib.counterLayout(keccak256(netlist), 2)), vm.parseJsonBytes32(j, ".counterSchemaHash"));
        assertEq(OkunLib.tickGroupId(s), vm.parseJsonBytes32(j, ".tickGroup"));
    }

    function test_installThenSwapsAllowedAndRefused() public {
        _install();
        (bool set, bytes32 pin,,, uint64 adminDelay, address tick, bytes32 group) = GUARD.configOf(address(safe));
        assertTrue(set);
        assertEq(pin, maxBuyPin);
        assertEq(adminDelay, 1 days);
        assertEq(tick, OkunLib.TICK);
        assertEq(group, OkunLib.tickGroupId(address(safe)));

        uint256 okb = IERC20O(OkunLib.WOKB).balanceOf(address(safe));
        assertTrue(_swap(500_000), "0.5 USDT0 swap"); // in limit: passes
        assertGt(IERC20O(OkunLib.WOKB).balanceOf(address(safe)), okb);

        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceDenied.selector, address(safe), OkunLib.USDT0));
        _swap(1_500_000); // over the cap: the approve of 1.5 USDT0 is the first call refused

        assertTrue(_swap(400_000), "second swap this hour");
        vm.expectRevert(abi.encodeWithSelector(Tick.TickDenied.selector, OkunLib.tickGroupId(address(safe)), address(safe)));
        _swap(300_000); // third swap in the same hour: refused by the counter

        vm.warp((block.timestamp / 1 hours + 1) * 1 hours); // next clock hour
        assertTrue(_swap(300_000), "new hour");
    }

    function test_raisingTheCapWaitsOneDay() public {
        _install();
        bytes memory raise = abi.encodeCall(FengceGuard.configure, (OkunLib.configureInput(5_000_000, maxBuyPin)));
        vm.expectRevert(); // not scheduled: the guard refuses a direct change
        _exec(address(GUARD), raise, Enum.Operation.Call);

        assertTrue(_exec(address(GUARD), abi.encodeCall(GUARD.scheduleAdmin, (address(GUARD), raise)), Enum.Operation.Call));
        vm.warp(block.timestamp + 1 days - 1);
        vm.expectRevert();
        _exec(address(GUARD), raise, Enum.Operation.Call);
        vm.warp(block.timestamp + 1);
        assertTrue(_exec(address(GUARD), raise, Enum.Operation.Call), "after 1 day");
        assertTrue(_swap(1_500_000), "1.5 USDT0 now within the raised cap");
    }
}
