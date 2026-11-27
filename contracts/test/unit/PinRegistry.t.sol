// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PinRegistry} from "../../src/core/PinRegistry.sol";
import {PolicyEngine} from "../../src/core/PolicyEngine.sol";
import {ITapeOutFactory} from "../../src/core/interfaces/ITapeOut.sol";
import {MockBeacon, MockFactory, MockImpl, MockProcessor, NetlistBytes as NB} from "./mocks/TapeOutMocks.sol";

contract PinRegistryTest is Test {
    MockBeacon beacon;
    MockImpl impl;
    MockFactory factory;
    MockProcessor p;
    PinRegistry reg;
    bytes nandNetlist;

    function setUp() public {
        beacon = new MockBeacon();
        impl = new MockImpl();
        beacon.set(address(impl));
        factory = new MockFactory(address(beacon));
        p = new MockProcessor(address(beacon));
        factory.setCPU(address(p), true);
        nandNetlist = abi.encodePacked(NB.nand(2, 3), NB.nand(4, 4), NB.nand(5, 5));
        p.set(1, nandNetlist, 2, 1);
        reg = new PinRegistry(ITapeOutFactory(address(factory)));
    }

    function _pin() internal returns (bytes32) {
        return reg.pin(address(p), 1, keccak256("schema"), keccak256("cert"));
    }

    function test_pinRecordsLiveState() public {
        bytes32 id = _pin();
        assertTrue(reg.isPinned(id));
        assertEq(uint256(reg.kindOf(id)), uint256(PinRegistry.Kind.Circuit));
        PinRegistry.CircuitPin memory c = reg.circuitPin(id);
        assertEq(c.netlistHash, keccak256(nandNetlist));
        assertEq(c.refClosureHash, keccak256("")); // no REF
        assertEq(c.implementation, address(impl));
        assertEq(c.processors.length, 1);
        assertEq(c.processorCodehashes[0], address(p).codehash);
        assertFalse(reg.isPinned(keccak256("unknown")));
    }

    function test_isPinnedFalseWhenBeaconImplementationChanges() public {
        bytes32 id = _pin();
        beacon.set(address(new MockImpl()));
        assertFalse(reg.isPinned(id));
    }

    /// A beacon upgrade leaves every processor's own code hash unchanged (the beacon address is an immutable in its
    /// code), so a pin on processor code hashes alone would miss it. The pin also records the beacon's implementation,
    /// so the check fails and evaluation at execution time fails closed.
    function test_beaconUpgradeKeepsProcessorCodehashButBreaksThePin() public {
        bytes32 id = _pin();
        PolicyEngine engine = new PolicyEngine(reg, 1_000_000);
        assertEq(engine.evaluate(id, hex"02"), hex"01");
        bytes32 before = address(p).codehash;

        beacon.set(address(new MockImpl())); // the upgrade

        assertEq(address(p).codehash, before, "processor code hash does not change");
        assertEq(reg.circuitPin(id).processorCodehashes[0], before);
        assertFalse(reg.isPinned(id));
        vm.expectRevert(abi.encodeWithSelector(PolicyEngine.EngineNotPinned.selector, id));
        engine.evaluate(id, hex"02");
    }

    function test_isPinnedFalseWhenImplementationCodeChanges() public {
        bytes32 id = _pin();
        vm.etch(address(impl), hex"00");
        assertFalse(reg.isPinned(id));
    }

    function test_isPinnedFalseWhenProcessorCodeChanges() public {
        bytes32 id = _pin();
        vm.etch(address(p), hex"6000");
        assertFalse(reg.isPinned(id));
    }

    function test_isPinnedFalseWhenDeregistered() public {
        bytes32 id = _pin();
        factory.setCPU(address(p), false);
        assertFalse(reg.isPinned(id));
    }

    function test_isPinnedFalseOnAnotherChain() public {
        bytes32 id = _pin();
        vm.chainId(8453);
        assertFalse(reg.isPinned(id));
    }

    function test_isPinnedFalseNotRevertWhenReadsFail() public {
        bytes32 id = _pin();
        vm.mockCallRevert(address(factory), abi.encodeWithSelector(ITapeOutFactory.isCPU.selector), "down");
        assertFalse(reg.isPinned(id));
        vm.clearMockedCalls();
        // a dirty (non-address) word from the beacon is treated as a failure
        vm.mockCall(address(beacon), abi.encodeWithSelector(bytes4(keccak256("implementation()"))), abi.encode(type(uint256).max));
        assertFalse(reg.isPinned(id));
    }

    function test_pinRejectsNonCpuForeignBeaconAndDuplicates() public {
        MockProcessor stranger = new MockProcessor(address(beacon));
        stranger.set(1, nandNetlist, 2, 1);
        vm.expectRevert(abi.encodeWithSelector(PinRegistry.PinNotCPU.selector, address(stranger)));
        reg.pin(address(stranger), 1, 0, 0);

        MockProcessor foreign = new MockProcessor(address(0xBEEC));
        foreign.set(1, nandNetlist, 2, 1);
        factory.setCPU(address(foreign), true);
        vm.expectRevert(abi.encodeWithSelector(PinRegistry.PinNotBeaconProxy.selector, address(foreign), address(beacon)));
        reg.pin(address(foreign), 1, 0, 0);

        bytes32 id = _pin();
        vm.expectRevert(abi.encodeWithSelector(PinRegistry.PinExists.selector, id));
        _pin();
    }

    function test_closureCoversRefsOnceAndAcrossProcessors() public {
        MockProcessor q = new MockProcessor(address(beacon));
        factory.setCPU(address(q), true);
        // q#1 refs p#1 twice; q#2 refs q#1 (nested)
        q.set(1, abi.encodePacked(NB.ref2(address(p), 1, 2, 3), NB.ref2(address(p), 1, 3, 2)), 2, 1);
        q.set(2, abi.encodePacked(NB.ref2(address(q), 1, 2, 3)), 2, 1);
        bytes32 id = reg.pin(address(q), 2, 0, 0);
        PinRegistry.CircuitPin memory c = reg.circuitPin(id);
        bytes memory q1 = abi.encodePacked(NB.ref2(address(p), 1, 2, 3), NB.ref2(address(p), 1, 3, 2));
        bytes32 expected = keccak256(
            abi.encodePacked(address(q), uint256(1), keccak256(q1), address(p), uint256(1), keccak256(nandNetlist))
        );
        assertEq(c.refClosureHash, expected);
        assertEq(c.processors.length, 2);
        assertEq(c.processors[0], address(q));
        assertEq(c.processors[1], address(p));
        assertTrue(reg.isPinned(id));

        // A processor anywhere in the closure leaving the factory breaks the pin.
        factory.setCPU(address(p), false);
        assertFalse(reg.isPinned(id));
    }

    function test_closureRejectsRefToNonCpuAndTooLarge() public {
        MockProcessor q = new MockProcessor(address(beacon));
        factory.setCPU(address(q), true);
        q.set(1, NB.ref2(address(0xDEAD), 1, 2, 3), 2, 1);
        vm.expectRevert(abi.encodeWithSelector(PinRegistry.PinNotCPU.selector, address(0xDEAD)));
        reg.pin(address(q), 1, 0, 0);

        bytes memory many;
        for (uint64 i = 1; i <= 64; i++) {
            p.set(100 + i, nandNetlist, 2, 1);
            many = abi.encodePacked(many, NB.ref2(address(p), 100 + i, 2, 3));
        }
        q.set(2, many, 2, 1);
        vm.expectRevert(PinRegistry.PinClosureTooLarge.selector);
        reg.pin(address(q), 2, 0, 0);
    }

    function test_pinContractCodehashOnly() public {
        bytes32 id = reg.pinContract(address(impl), bytes4(0));
        assertTrue(reg.isPinned(id));
        assertEq(uint256(reg.kindOf(id)), uint256(PinRegistry.Kind.Contract));
        vm.etch(address(impl), hex"00");
        assertFalse(reg.isPinned(id));
    }

    function test_pinContractWithImplementationGetter() public {
        bytes32 id = reg.pinContract(address(beacon), bytes4(keccak256("implementation()")));
        assertTrue(reg.isPinned(id));
        assertEq(reg.contractPin(id).implementation, address(impl));
        beacon.set(address(new MockImpl()));
        assertFalse(reg.isPinned(id));
    }

    function test_pinContractRejects() public {
        vm.expectRevert(abi.encodeWithSelector(PinRegistry.PinNoCode.selector, address(0x1234)));
        reg.pinContract(address(0x1234), bytes4(0));
        vm.expectRevert(abi.encodeWithSelector(PinRegistry.PinReadFailed.selector, address(impl)));
        reg.pinContract(address(impl), bytes4(0xdeadbeef)); // getter does not exist
        beacon.set(address(0x5678)); // getter returns an address without code
        vm.expectRevert(abi.encodeWithSelector(PinRegistry.PinReadFailed.selector, address(beacon)));
        reg.pinContract(address(beacon), bytes4(keccak256("implementation()")));
    }
}
