// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FengceHook6900, ExecutionManifest, IModularAccount6900} from "../../src/erc6900/FengceHook6900.sol";
import {WalletBase} from "./WalletBase.sol";

interface ISMA7702 {
    function installExecution(address module, ExecutionManifest calldata manifest, bytes calldata installData) external;
    function installValidation(
        bytes25 validationConfig,
        bytes4[] calldata selectors,
        bytes calldata installData,
        bytes[] calldata hooks
    ) external;
}

/// EIP-7702: an EOA delegates to Alchemy's SemiModularAccount7702 (live on X Layer) and installs
/// FengceHook6900. An agent key gets a direct-call validation (it calls the EOA's `execute` itself, like a
/// session key) and every agent call is checked by the circuit. The EOA's own key cannot be restricted: it can
/// always send a plain transaction, which runs no account code.
contract Fengce7702ForkTest is WalletBase {
    address constant SMA7702 = 0x69007702764179f14F51cdce752f4f775d74E139;
    uint32 constant DIRECT_CALL = type(uint32).max;
    uint256 constant EOA_KEY = 0xE0A;

    FengceHook6900 hook;
    address eoa;
    address agent;

    function setUp() public {
        _forkAndPin();
        vm.setEvmVersion("prague");
        hook = new FengceHook6900(reg, 2_000_000);
        eoa = vm.addr(EOA_KEY);
        agent = makeAddr("agent");
        vm.deal(eoa, 1000);
        vm.signAndAttachDelegation(SMA7702, EOA_KEY);
        require(eoa.code.length == 23, "not delegated");

        bytes memory cfg = _hookCfg();
        ExecutionManifest memory m = hook.executionManifest();
        // The EOA configures its own account (a call to itself counts as validated).
        vm.prank(eoa);
        ISMA7702(eoa).installExecution(address(hook), m, cfg);
        // Agent: direct-call validation (entity id max), global, no user operations or signatures.
        bytes25 vc = bytes25(abi.encodePacked(agent, DIRECT_CALL, bytes1(0x04)));
        vm.prank(eoa);
        ISMA7702(eoa).installValidation(vc, new bytes4[](0), "", new bytes[](0));
        assertTrue(hook.isInitialized(eoa));
    }

    function test_7702AgentGoesThroughCircuitOwnerKeyDoesNot() public {
        vm.prank(agent);
        IModularAccount6900(eoa).execute(RECIP, 50, "");
        assertEq(RECIP.balance, 50);

        vm.prank(agent);
        vm.expectRevert();
        IModularAccount6900(eoa).execute(RECIP, 150, "");
        assertEq(RECIP.balance, 50);

        // A batch that hides the over-limit transfer is refused too.
        IModularAccount6900.Call[] memory calls = new IModularAccount6900.Call[](2);
        calls[0] = IModularAccount6900.Call(RECIP, 10, "");
        calls[1] = IModularAccount6900.Call(RECIP, 150, "");
        vm.prank(agent);
        vm.expectRevert();
        IModularAccount6900(eoa).executeBatch(calls);
        assertEq(RECIP.balance, 50);

        // The owner key: a plain transaction from the EOA runs no account code, so no hook (documented limit).
        vm.prank(eoa);
        (bool ok,) = RECIP.call{value: 150}("");
        assertTrue(ok);
        assertEq(RECIP.balance, 200);
    }
}
