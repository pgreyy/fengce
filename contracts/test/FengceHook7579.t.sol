// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISafe} from "@safe/interfaces/ISafe.sol";

import {FengceHook} from "../src/erc7579/FengceHook.sol";
import {TxFacts} from "../src/core/TxFacts.sol";
import {ForkBase} from "./utils/ForkBase.sol";

interface IERC7579Exec {
    function execute(bytes32 mode, bytes calldata executionCalldata) external;
    function uninstallModule(uint256 moduleTypeId, address module, bytes calldata deInitData) external;
}

/// Fork test on live X Layer with an ERC-7579 account: a real Safe v1.5.0 plus Rhinestone's Safe7579
/// adapter. Safe7579 is not deployed on X Layer, so its canonical runtime code (identical on Ethereum and
/// Base) and that of its helper are read from a Base fork during the test and placed at the same
/// addresses on the X Layer fork. Nothing from Safe7579 is stored in this repository.
contract FengceHook7579ForkTest is ForkBase {
    address constant SAFE7579 = 0x7579EE8307284F293B1927136486880611F20002;
    address constant SAFE7579_UTIL = 0x45D7deB1229E0254a0561a2769B4A28e4e67Df00; // created by SAFE7579 (nonce 1)
    address constant ENTRYPOINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032; // v0.7, live on X Layer

    struct ModuleInit {
        address module;
        bytes initData;
    }

    struct RegistryInit {
        address registry;
        address[] attesters;
        uint8 threshold;
    }

    FengceHook hook;
    ISafe account;

    function setUp() public {
        vm.createSelectFork("base");
        bytes memory adapter = SAFE7579.code;
        bytes memory util = SAFE7579_UTIL.code;
        require(adapter.length > 0 && util.length > 0, "Safe7579 not found on Base");

        _forkAndPin(); // selects the X Layer fork
        vm.etch(SAFE7579, adapter);
        vm.etch(SAFE7579_UTIL, util);
        hook = new FengceHook(reg, 2_000_000);

        account = _newSafe();
        _exec(account, address(account), 0, abi.encodeWithSignature("enableModule(address)", SAFE7579));
        _exec(account, address(account), 0, abi.encodeWithSignature("setFallbackHandler(address)", SAFE7579));

        ModuleInit[] memory none = new ModuleInit[](0);
        ModuleInit[] memory hooks = new ModuleInit[](1);
        bytes memory cfg = abi.encode(pinId, _layout(), _bindings());
        hooks[0] = ModuleInit(address(hook), abi.encode(uint8(0), bytes4(0), cfg)); // global hook
        RegistryInit memory noRegistry;
        assertTrue(
            _exec(
                account,
                address(account),
                0,
                abi.encodeWithSignature(
                    "initializeAccount((address,bytes)[],(address,bytes)[],(address,bytes)[],(address,bytes)[],(address,address[],uint8))",
                    none,
                    none,
                    none,
                    hooks,
                    noRegistry
                )
            )
        );
        assertTrue(hook.isInitialized(address(account)));
    }

    function _bindings() internal pure returns (TxFacts.Binding[] memory b) {
        b = new TxFacts.Binding[](1);
        b[0] = TxFacts.Binding(TxFacts.Source.AmountGt, 100);
    }

    function _single(address to, uint256 value) internal {
        vm.prank(ENTRYPOINT);
        IERC7579Exec(address(account)).execute(bytes32(0), abi.encodePacked(to, value, bytes("")));
    }

    function test_7579AccountBlockedOverLimit() public {
        _single(RECIP, 50);
        assertEq(RECIP.balance, 50);

        vm.expectRevert();
        _single(RECIP, 150);
        assertEq(RECIP.balance, 50);
        // The same check, asked of the hook directly as the account would:
        vm.prank(address(account));
        vm.expectRevert(abi.encodeWithSelector(FengceHook.HookDenied.selector, address(account), RECIP));
        hook.preCheck(ENTRYPOINT, 0, abi.encodeCall(IERC7579Exec.execute, (bytes32(0), abi.encodePacked(RECIP, uint256(150)))));
    }

    function test_7579BatchHiding150Blocked() public {
        FengceHook.Execution[] memory xs = new FengceHook.Execution[](2);
        xs[0] = FengceHook.Execution(RECIP, 40, "");
        xs[1] = FengceHook.Execution(RECIP, 150, "");
        bytes32 batchMode = bytes32(bytes1(0x01));
        vm.expectRevert();
        vm.prank(ENTRYPOINT);
        IERC7579Exec(address(account)).execute(batchMode, abi.encode(xs));
        assertEq(RECIP.balance, 0);

        xs[1].value = 40;
        vm.prank(ENTRYPOINT);
        IERC7579Exec(address(account)).execute(batchMode, abi.encode(xs));
        assertEq(RECIP.balance, 80);
    }

    /// Known limit, recorded as a test: Safe7579 v1.0.0 does not run a hook when that same hook is being
    /// uninstalled, so the hook's own uninstall delay is never consulted on Safe7579. Anyone allowed to
    /// make the account call uninstallModule (a validator-approved user operation, or the Safe itself) can
    /// remove it at once. See docs/THREAT-MODEL.md.
    function test_safe7579SkipsHookOnItsOwnUninstall() public {
        bytes memory deinit = abi.encode(uint8(0), bytes4(0), bytes(""));
        vm.prank(ENTRYPOINT);
        IERC7579Exec(address(account)).uninstallModule(4, address(hook), deinit);
        assertFalse(hook.isInitialized(address(account)));

        // An account implementation that does call the hook gets the delay:
        vm.prank(makeAddr("otherAccount"));
        vm.expectRevert(abi.encodeWithSelector(FengceHook.HookUninstallNotReady.selector, makeAddr("otherAccount")));
        hook.preCheck(ENTRYPOINT, 0, abi.encodeCall(IERC7579Exec.uninstallModule, (4, address(hook), deinit)));
    }
}
