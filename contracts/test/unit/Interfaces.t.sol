// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PinRegistry} from "../../src/core/PinRegistry.sol";
import {PolicyEngine} from "../../src/core/PolicyEngine.sol";
import {IPinRegistry} from "../../src/core/interfaces/IPinRegistry.sol";
import {IPolicyEngine} from "../../src/core/interfaces/IPolicyEngine.sol";

/// The interfaces are not inherited by the contracts (to keep their types where they are), so this
/// checks that every interface function, event and error matches the contract exactly.
contract InterfacesTest is Test {
    function test_pinRegistrySurfaceMatches() public pure {
        assertEq(IPinRegistry.MAX_CLOSURE.selector, bytes4(keccak256("MAX_CLOSURE()")));
        assertEq(IPinRegistry.CHECK_GAS.selector, bytes4(keccak256("CHECK_GAS()")));
        assertEq(IPinRegistry.factory.selector, bytes4(keccak256("factory()")));
        assertEq(IPinRegistry.kindOf.selector, bytes4(keccak256("kindOf(bytes32)")));
        assertEq(IPinRegistry.pin.selector, PinRegistry.pin.selector);
        assertEq(IPinRegistry.pinContract.selector, PinRegistry.pinContract.selector);
        assertEq(IPinRegistry.isPinned.selector, PinRegistry.isPinned.selector);
        assertEq(IPinRegistry.circuitPin.selector, PinRegistry.circuitPin.selector);
        assertEq(IPinRegistry.evalInfo.selector, PinRegistry.evalInfo.selector);
        assertEq(IPinRegistry.contractPin.selector, PinRegistry.contractPin.selector);
        assertEq(IPinRegistry.CircuitPinned.selector, PinRegistry.CircuitPinned.selector);
        assertEq(IPinRegistry.ContractPinned.selector, PinRegistry.ContractPinned.selector);
        assertEq(IPinRegistry.PinExists.selector, PinRegistry.PinExists.selector);
        assertEq(IPinRegistry.PinNotCPU.selector, PinRegistry.PinNotCPU.selector);
        assertEq(IPinRegistry.PinNotBeaconProxy.selector, PinRegistry.PinNotBeaconProxy.selector);
        assertEq(IPinRegistry.PinReadFailed.selector, PinRegistry.PinReadFailed.selector);
        assertEq(IPinRegistry.PinClosureTooLarge.selector, PinRegistry.PinClosureTooLarge.selector);
        assertEq(IPinRegistry.PinNoCode.selector, PinRegistry.PinNoCode.selector);
    }

    function test_policyEngineSurfaceMatches() public pure {
        assertEq(IPolicyEngine.registry.selector, bytes4(keccak256("registry()")));
        assertEq(IPolicyEngine.evalGasCap.selector, bytes4(keccak256("evalGasCap()")));
        assertEq(IPolicyEngine.evaluate.selector, PolicyEngine.evaluate.selector);
        assertEq(IPolicyEngine.evaluateFields.selector, PolicyEngine.evaluateFields.selector);
        assertEq(IPolicyEngine.EngineNotPinned.selector, PolicyEngine.EngineNotPinned.selector);
        assertEq(IPolicyEngine.EngineInputLength.selector, PolicyEngine.EngineInputLength.selector);
        assertEq(IPolicyEngine.EngineInputPadding.selector, PolicyEngine.EngineInputPadding.selector);
        assertEq(IPolicyEngine.EngineSchemaMismatch.selector, PolicyEngine.EngineSchemaMismatch.selector);
        assertEq(IPolicyEngine.EngineEvalFailed.selector, PolicyEngine.EngineEvalFailed.selector);
        assertEq(IPolicyEngine.EngineOutputLength.selector, PolicyEngine.EngineOutputLength.selector);
        assertEq(IPolicyEngine.EngineOutputPadding.selector, PolicyEngine.EngineOutputPadding.selector);
    }
}
