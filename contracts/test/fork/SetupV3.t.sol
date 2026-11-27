// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {ISafe} from "@safe/interfaces/ISafe.sol";
import {Enum} from "@safe/libraries/Enum.sol";
import {FengceGuardV3} from "../../src/safe/FengceGuardV3.sol";
import {FengceRulesV3} from "../../src/safe/FengceRulesV3.sol";
import {FengceSetupV3} from "../../src/safe/FengceSetupV3.sol";
import {LimitsLib} from "../../script/LimitsLib.sol";
import {V3Lib} from "../../script/V3Lib.sol";

interface IFactorySetup {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce) external returns (address);
}

/// Fork test on live X Layer: a new Safe created with guard v3 already installed, in one transaction, through
/// FengceSetupV3 (Safe setup's to/data delegatecall). Uses the mainnet FengceGuardV3 and the pins of the Milestone 2 run.
contract SetupV3ForkTest is Test {
    IFactorySetup constant FACTORY = IFactorySetup(0x14F2982D601c9458F93bd70B218933A6f8165e7b);
    address constant SAFE_L2 = 0xEdd160fEBBD92E350D4D398fb636302fccd67C7e;
    address constant FALLBACK = 0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4;
    bytes32 constant GUARD_SLOT = 0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8;

    address owner = makeAddr("setup-owner");
    FengceGuardV3 guard;
    FengceSetupV3 setupper;
    V3Lib.Install p;

    function setUp() public {
        vm.createSelectFork("xlayer");
        string memory m2 = vm.readFile("../deployments/m2-demo-xlayer-196.json");
        string memory j = vm.readFile("../deployments/limits-xlayer-196.json");
        guard = FengceGuardV3(vm.parseJsonAddress(m2, ".guard"));
        setupper = new FengceSetupV3();
        p.guard = address(guard);
        p.maxPerBuy = 2_000_000;
        p.maxBuyPin = vm.parseJsonBytes32(j, ".maxBuyPin");
        p.tradesPerHour = 5;
        p.tradesPin = vm.parseJsonBytes32(j, ".counterPins.5");
        p.tiltAfter = 4;
        p.counterPin = vm.parseJsonBytes32(j, ".counterPins.3");
        p.counterNetlistHash = vm.parseJsonBytes32(j, ".counterNetlistHash");
        p.latchPin = vm.parseJsonBytes32(m2, ".tiltLatchPin");
        p.latchNetlistHash = vm.parseJsonBytes32(m2, ".tiltLatchNetlistHash");
        p.tiltCooldown = 6 hours;
        p.tiltMultX10 = 30;
    }

    function _create() internal returns (ISafe safe) {
        address[] memory o = new address[](1);
        o[0] = owner;
        bytes memory init = abi.encodeCall(ISafe.setup, (o, 1, address(setupper), abi.encodeCall(FengceSetupV3.setup, (p)), FALLBACK, address(0), 0, payable(address(0))));
        vm.prank(owner);
        safe = ISafe(payable(FACTORY.createProxyWithNonce(SAFE_L2, init, 1)));
    }

    function _buy(ISafe safe, uint256 usdt) internal returns (bool) {
        vm.prank(owner);
        return safe.execTransaction(LimitsLib.MSCO, 0, LimitsLib.swapMultiSend(address(safe), LimitsLib.USDT0, LimitsLib.WOKB, usdt, 0), Enum.Operation.DelegateCall, 0, 0, 0, address(0), payable(address(0)), LimitsLib.ownerSignature(owner));
    }

    function test_createWithGuardV3_oneTransaction() public {
        ISafe safe = _create();
        assertEq(address(uint160(uint256(vm.load(address(safe), GUARD_SLOT)))), address(guard), "guard set during creation");
        (bool set, bytes32 pin,,,,,) = guard.configOf(address(safe));
        assertTrue(set, "configured");
        assertEq(pin, p.maxBuyPin, "max per buy pin");
        FengceRulesV3.Rules memory r = guard.rulesOf(address(safe));
        assertTrue(r.tiltOn, "Tilt-shield on");
        assertEq(r.tiltCountGroup, V3Lib.countGroup(address(safe)), "count group belongs to the new Safe");
        assertEq(safe.getOwners()[0], owner);

        deal(LimitsLib.USDT0, address(safe), 5_000_000);
        assertTrue(_buy(safe, 200_000), "0.2 USDT0 buy allowed");
        vm.expectRevert(abi.encodeWithSelector(FengceGuardV3.FengceRefused.selector, FengceRulesV3.CIRCUIT, address(safe), LimitsLib.USDT0));
        _buy(safe, 3_000_000);
    }

    /// A Catalog install fee is paid from the new Safe during creation, before the guard is on (here a free listing).
    function test_createWithCatalogFee_paysBeforeTheGuard() public {
        address catalog = 0x26C5437428cdD7e4854614DC5DDEFE2776B51dFe;
        bytes32 pin = 0x6661c56a76bc6769c7153d9a44a9b546b860543d42fce4cd34a4bf9d4d89ce44; // Stablecoin Transfer Limit, fee 0
        address[] memory o = new address[](1);
        o[0] = owner;
        bytes memory init = abi.encodeCall(ISafe.setup, (o, 1, address(setupper), abi.encodeCall(FengceSetupV3.setupWithCatalogFee, (p, catalog, pin, 0)), FALLBACK, address(0), 0, payable(address(0))));
        vm.recordLogs();
        vm.prank(owner);
        address safe = FACTORY.createProxyWithNonce(SAFE_L2, init, 2);
        bool paid;
        bytes32 feePaid = keccak256("FeePaid(bytes32,address,address,uint256,uint256)");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == catalog && logs[i].topics[0] == feePaid && address(uint160(uint256(logs[i].topics[2]))) == safe) paid = true;
        }
        assertTrue(paid, "FeePaid from the new Safe");
        assertEq(address(uint160(uint256(vm.load(safe, GUARD_SLOT)))), address(guard), "guard set during creation");
    }

    function test_setupCannotBeCalledDirectly() public {
        vm.expectRevert(FengceSetupV3.FengceSetupDirectCall.selector);
        setupper.setup(p);
    }
}
