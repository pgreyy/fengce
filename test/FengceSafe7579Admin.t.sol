// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISafe} from "@safe/interfaces/ISafe.sol";
import {Enum} from "@safe/libraries/Enum.sol";

import {FengceGuard} from "../src/safe/FengceGuard.sol";
import {SafeAdmin} from "../src/safe/SafeAdmin.sol";
import {ForkBase} from "./utils/ForkBase.sol";

contract MockExecutor7579 {
    function onInstall(bytes calldata) external {}
    function onUninstall(bytes calldata) external {}

    function isModuleType(uint256 t) external pure returns (bool) {
        return t == 2;
    }

    function isInitialized(address) external pure returns (bool) {
        return true;
    }
}

interface ISafe7579Admin {
    function execute(bytes32 mode, bytes calldata executionCalldata) external;
    function installModule(uint256 moduleTypeId, address module, bytes calldata initData) external;
    function uninstallModule(uint256 moduleTypeId, address module, bytes calldata deInitData) external;
    function isModuleInstalled(uint256 moduleTypeId, address module, bytes calldata ctx) external view returns (bool);
}

/// Fork tests on live X Layer: a Safe v1.5.0 with Rhinestone's Safe7579 adapter (canonical runtime code
/// read from a Base fork during the test) and FengceGuard as transaction and module guard. ERC-7579
/// module changes must wait for the admin timelock on every route.
contract FengceSafe7579AdminForkTest is ForkBase {
    address constant SAFE7579 = 0x7579EE8307284F293B1927136486880611F20002;
    address constant SAFE7579_UTIL = 0x45D7deB1229E0254a0561a2769B4A28e4e67Df00;
    address constant ENTRYPOINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    address constant SENTINEL = address(1);

    struct ModuleInit {
        address module;
        bytes initData;
    }

    struct RegistryInit {
        address registry;
        address[] attesters;
        uint8 threshold;
    }

    ISafe safe;
    MockExecutor7579 execA;
    MockExecutor7579 execB;
    bytes uninstallA;
    bytes installB;

    function setUp() public {
        vm.createSelectFork("base");
        bytes memory adapter = SAFE7579.code;
        bytes memory util = SAFE7579_UTIL.code;
        _forkAndPin();
        vm.etch(SAFE7579, adapter);
        vm.etch(SAFE7579_UTIL, util);
        execA = new MockExecutor7579();
        execB = new MockExecutor7579();

        safe = _newSafe();
        _exec(safe, address(safe), 0, abi.encodeWithSignature("enableModule(address)", SAFE7579));
        _exec(safe, address(safe), 0, abi.encodeWithSignature("setFallbackHandler(address)", SAFE7579));
        ModuleInit[] memory none = new ModuleInit[](0);
        ModuleInit[] memory executors = new ModuleInit[](1);
        executors[0] = ModuleInit(address(execA), "");
        RegistryInit memory noRegistry;
        _exec(
            safe,
            address(safe),
            0,
            abi.encodeWithSignature(
                "initializeAccount((address,bytes)[],(address,bytes)[],(address,bytes)[],(address,bytes)[],(address,address[],uint8))",
                none,
                executors,
                none,
                none,
                noRegistry
            )
        );
        assertTrue(_installed(address(execA)));

        // Install Fengce: this test contract is also a plain Safe module (the "another module" route).
        _exec(safe, address(safe), 0, abi.encodeWithSignature("enableModule(address)", address(this)));
        FengceGuard.ConfigInput memory c = _cfg();
        c.acceptExistingModules = true; // Safe7579 and this test are modules
        _exec(safe, address(guard), 0, abi.encodeCall(FengceGuard.configure, (c)));
        _exec(safe, address(safe), 0, abi.encodeWithSignature("setGuard(address)", address(guard)));
        _exec(safe, address(safe), 0, abi.encodeWithSignature("setModuleGuard(address)", address(guard)));

        uninstallA = abi.encodeCall(ISafe7579Admin.uninstallModule, (2, address(execA), abi.encode(SENTINEL, bytes(""))));
        installB = abi.encodeCall(ISafe7579Admin.installModule, (2, address(execB), bytes("")));
    }

    function _installed(address m) internal view returns (bool) {
        return ISafe7579Admin(address(safe)).isModuleInstalled(2, m, "");
    }

    function _schedule(bytes memory data) internal {
        _exec(safe, address(guard), 0, abi.encodeCall(SafeAdmin.scheduleAdmin, (address(safe), data)));
    }

    function _idA() internal view returns (bytes32) {
        return guard.erc7579AdminId(address(safe), false, 2, address(execA));
    }

    function test_route1_ownerTransaction() public {
        vm.expectRevert(abi.encodeWithSelector(SafeAdmin.AdminNotReady.selector, _idA()));
        _exec(safe, address(safe), 0, uninstallA);
        _schedule(uninstallA);
        vm.expectRevert(abi.encodeWithSelector(SafeAdmin.AdminNotReady.selector, _idA()));
        _exec(safe, address(safe), 0, uninstallA);

        vm.warp(block.timestamp + DELAY);
        assertTrue(_exec(safe, address(safe), 0, uninstallA));
        assertFalse(_installed(address(execA)));
    }

    function test_route2_anotherModule() public {
        // Through the Safe's own uninstall entry point, and straight to the adapter's helper.
        bytes memory utilCall = abi.encodeWithSignature("unInstallModule(uint256,address,bytes)", 2, address(execA), bytes(""));
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceModuleAdminDenied.selector, address(safe)));
        safe.execTransactionFromModule(address(safe), 0, uninstallA, Enum.Operation.Call);
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceDelegateCallDenied.selector, SAFE7579_UTIL));
        safe.execTransactionFromModule(SAFE7579_UTIL, 0, utilCall, Enum.Operation.DelegateCall);

        // Still refused after the change is scheduled and ready: modules never make admin changes.
        _schedule(uninstallA);
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceModuleAdminDenied.selector, address(safe)));
        safe.execTransactionFromModule(address(safe), 0, uninstallA, Enum.Operation.Call);
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceDelegateCallDenied.selector, SAFE7579_UTIL));
        safe.execTransactionFromModule(SAFE7579_UTIL, 0, utilCall, Enum.Operation.DelegateCall);
        assertTrue(_installed(address(execA)));
    }

    function test_route3_validatorUserOp() public {
        vm.expectRevert(abi.encodeWithSelector(SafeAdmin.AdminNotReady.selector, _idA()));
        vm.prank(ENTRYPOINT);
        ISafe7579Admin(address(safe)).uninstallModule(2, address(execA), abi.encode(SENTINEL, bytes("")));
        assertTrue(_installed(address(execA)));

        _schedule(uninstallA);
        vm.warp(block.timestamp + DELAY);
        vm.prank(ENTRYPOINT);
        ISafe7579Admin(address(safe)).uninstallModule(2, address(execA), abi.encode(SENTINEL, bytes("")));
        assertFalse(_installed(address(execA)));
    }

    function test_route4_bundledWithAnotherModuleChange() public {
        _schedule(uninstallA);
        _schedule(installB);

        bytes memory packed = abi.encodePacked(
            abi.encodePacked(uint8(0), address(safe), uint256(0), uninstallA.length, uninstallA),
            abi.encodePacked(uint8(0), address(safe), uint256(0), installB.length, installB)
        );
        bytes memory ms = abi.encodeWithSignature("multiSend(bytes)", packed);
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceInnerAdminDenied.selector, address(safe)));
        _execOp(safe, MSCO, 0, ms, Enum.Operation.DelegateCall);

        // One user operation that batches both changes as self-calls.
        Execution7579[] memory xs = new Execution7579[](2);
        xs[0] = Execution7579(address(safe), 0, uninstallA);
        xs[1] = Execution7579(address(safe), 0, installB);
        vm.expectRevert();
        vm.prank(ENTRYPOINT);
        ISafe7579Admin(address(safe)).execute(bytes32(bytes1(0x01)), abi.encode(xs));

        // Even after both schedules are ready, bundles stay refused; each change must go on its own.
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceInnerAdminDenied.selector, address(safe)));
        _execOp(safe, MSCO, 0, ms, Enum.Operation.DelegateCall);
        vm.expectRevert();
        vm.prank(ENTRYPOINT);
        ISafe7579Admin(address(safe)).execute(bytes32(bytes1(0x01)), abi.encode(xs));
        assertTrue(_installed(address(execA)));
        assertFalse(_installed(address(execB)));
    }

    struct Execution7579 {
        address target;
        uint256 value;
        bytes callData;
    }
}
