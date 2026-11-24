// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PinRegistry} from "../../src/core/PinRegistry.sol";
import {Schema} from "../../src/core/Schema.sol";
import {ITapeOutFactory} from "../../src/core/interfaces/ITapeOut.sol";
import {Verdict, IERC20Min} from "../../src/verdict/Verdict.sol";
import {MockBeacon, MockFactory, MockImpl, MockProcessor, NetlistBytes as NB} from "./mocks/TapeOutMocks.sol";

contract VToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a;
        balanceOf[f] -= a;
        balanceOf[to] += a;
        return true;
    }
}

/// A data source: `value()` returns a settable number; `pair()` returns two words.
contract VSource {
    uint256 public value;
    bool public broken;

    function set(uint256 v) external {
        value = v;
    }

    function breakIt() external {
        broken = true;
    }

    function read() external view returns (uint256) {
        require(!broken, "down");
        return value;
    }

    function pair() external view returns (uint256, uint256) {
        return (7, value);
    }
}

contract VerdictUnitTest is Test {
    MockBeacon beacon;
    MockProcessor p;
    PinRegistry reg;
    Verdict v;
    VToken tok;
    VSource src;
    bytes32 pinId;
    Schema.Layout layout;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    uint64 constant WINDOW = 30 minutes;

    function setUp() public {
        beacon = new MockBeacon();
        beacon.set(address(new MockImpl()));
        MockFactory factory = new MockFactory(address(beacon));
        p = new MockProcessor(address(beacon));
        factory.setCPU(address(p), true);
        bytes memory nl = abi.encodePacked(NB.nand(2, 3));
        p.set(1, nl, 2, 1);
        reg = new PinRegistry(ITapeOutFactory(address(factory)));
        layout.netlistHash = keccak256(nl);
        layout.nIn = 2;
        layout.fields.push(Schema.Field(Schema.Kind.Bool, 0, 1, 0)); // a: read from the source
        layout.fields.push(Schema.Field(Schema.Kind.Bool, 1, 1, 0)); // b: constant 1
        pinId = reg.pin(address(p), 1, Schema.hash(layout), 0);
        tok = new VToken();
        v = new Verdict(reg, IERC20Min(address(tok)), 1_000_000);
        src = new VSource();
        for (uint256 i; i < 3; i++) {
            address w = [alice, bob, carol][i];
            tok.mint(w, 1_000e6);
            vm.prank(w);
            tok.approve(address(v), type(uint256).max);
        }
    }

    // ------------------------------------------------------------------ helpers

    function _inputs() internal view returns (Verdict.Input[] memory xs) {
        xs = new Verdict.Input[](2);
        xs[0] = Verdict.Input(address(src), abi.encodeCall(VSource.read, ()), Verdict.Decode.Word, 0);
        xs[1] = Verdict.Input(address(0), "", Verdict.Decode.Constant, 1);
    }

    function _create() internal returns (uint256) {
        return v.createMarket(Verdict.NewMarket("Is the source value 0?", pinId, layout, _inputs(), uint64(block.timestamp + 1 days), WINDOW));
    }

    function _bet(uint256 id, address who, Verdict.Side side, uint256 amt) internal {
        vm.prank(who);
        v.bet(id, side, amt);
    }

    /// NAND(a, 1) = NOT a: YES when the source value is 0, NO when it is 1.
    function _toCheckpoint(uint256 id) internal {
        vm.warp(v.market(id).deadline);
        v.checkpoint(id);
    }

    // ------------------------------------------------------------------ create

    function test_createRecordsCodehashesAndClosure() public {
        uint256 id = _create();
        Verdict.Market memory m = v.market(id);
        assertEq(m.pinId, pinId);
        assertEq(m.refClosureHash, reg.circuitPin(pinId).refClosureHash);
        assertEq(m.question, "Is the source value 0?");
        (, Verdict.Input[] memory xs, bytes32[] memory hashes,) = v.marketData(id);
        assertEq(xs.length, 2);
        assertEq(hashes[0], address(src).codehash);
        assertEq(hashes[1], bytes32(0));
        assertEq(v.marketCount(), 1);
    }

    function test_createRejectsBadMarkets() public {
        uint64 dl = uint64(block.timestamp + 1 days);
        vm.expectRevert(abi.encodeWithSelector(Verdict.VerdictNotPinned.selector, bytes32(uint256(1))));
        v.createMarket(Verdict.NewMarket("q", bytes32(uint256(1)), layout, _inputs(), dl, WINDOW));

        Schema.Layout memory other = layout;
        other.fields = new Schema.Field[](2);
        other.fields[0] = Schema.Field(Schema.Kind.Bool, 1, 1, 0);
        other.fields[1] = Schema.Field(Schema.Kind.Bool, 0, 1, 0);
        vm.expectRevert(Verdict.VerdictSchemaMismatch.selector);
        v.createMarket(Verdict.NewMarket("q", pinId, other, _inputs(), dl, WINDOW));

        Verdict.Input[] memory one = new Verdict.Input[](1);
        one[0] = _inputs()[0];
        vm.expectRevert(Verdict.VerdictBadInputs.selector);
        v.createMarket(Verdict.NewMarket("q", pinId, layout, one, dl, WINDOW));

        Verdict.Input[] memory xs = _inputs();
        xs[1].source = address(src); // a constant must not name a source
        vm.expectRevert(Verdict.VerdictBadInputs.selector);
        v.createMarket(Verdict.NewMarket("q", pinId, layout, xs, dl, WINDOW));

        xs = _inputs();
        xs[0].source = makeAddr("eoa"); // a read needs code
        vm.expectRevert(Verdict.VerdictBadInputs.selector);
        v.createMarket(Verdict.NewMarket("q", pinId, layout, xs, dl, WINDOW));

        vm.expectRevert(Verdict.VerdictBadTimes.selector);
        v.createMarket(Verdict.NewMarket("q", pinId, layout, _inputs(), uint64(block.timestamp), WINDOW));
        vm.expectRevert(Verdict.VerdictBadTimes.selector);
        v.createMarket(Verdict.NewMarket("q", pinId, layout, _inputs(), dl, 4 minutes));
        vm.expectRevert(Verdict.VerdictBadTimes.selector);
        v.createMarket(Verdict.NewMarket("q", pinId, layout, _inputs(), dl, 1 days + 1));
    }

    function test_createRejectsBrokenPin() public {
        beacon.set(address(new MockImpl())); // implementation changed after pinning
        vm.expectRevert(abi.encodeWithSelector(Verdict.VerdictNotPinned.selector, pinId));
        _create();
    }

    // ------------------------------------------------------------------ bet

    function test_betUntilDeadline() public {
        uint256 id = _create();
        _bet(id, alice, Verdict.Side.Yes, 100e6);
        _bet(id, alice, Verdict.Side.No, 5e6);
        (uint256 y, uint256 n) = v.stakeOf(id, alice);
        assertEq(y, 100e6);
        assertEq(n, 5e6);
        assertEq(tok.balanceOf(address(v)), 105e6);

        vm.expectRevert(Verdict.VerdictZeroAmount.selector);
        _bet(id, bob, Verdict.Side.No, 0);
        vm.warp(v.market(id).deadline);
        vm.expectRevert(Verdict.VerdictClosed.selector);
        _bet(id, bob, Verdict.Side.No, 1e6);
        vm.expectRevert(abi.encodeWithSelector(Verdict.VerdictUnknownMarket.selector, 9));
        _bet(9, bob, Verdict.Side.No, 1e6);
    }

    // ------------------------------------------------------------------ checkpoint

    function test_checkpointOnlyInsideWindowAndOnce() public {
        uint256 id = _create();
        uint64 dl = v.market(id).deadline;
        vm.warp(dl - 1);
        vm.expectRevert(Verdict.VerdictOutsideWindow.selector);
        v.checkpoint(id);

        vm.warp(dl + WINDOW + 1);
        vm.expectRevert(Verdict.VerdictOutsideWindow.selector);
        v.checkpoint(id);

        vm.warp(dl + WINDOW);
        src.set(1);
        vm.roll(1234);
        uint256[] memory expected = new uint256[](2);
        expected[0] = 1;
        expected[1] = 1;
        vm.expectEmit(true, true, false, true);
        emit Verdict.Checkpointed(id, address(this), 1234, expected);
        v.checkpoint(id);
        Verdict.Market memory m = v.market(id);
        assertEq(m.checkpointBlock, 1234);
        assertEq(uint8(m.state), uint8(Verdict.State.Checkpointed));

        src.set(0); // later changes do not matter
        (,,, uint256[] memory vals) = v.marketData(id);
        assertEq(vals[0], 1);
        vm.expectRevert(abi.encodeWithSelector(Verdict.VerdictWrongState.selector, Verdict.State.Checkpointed));
        v.checkpoint(id);
    }

    function test_checkpointRevertsWhenSourceCodeChanged() public {
        uint256 id = _create();
        vm.etch(address(src), address(new VToken()).code);
        vm.warp(v.market(id).deadline);
        vm.expectRevert(abi.encodeWithSelector(Verdict.VerdictSourceChanged.selector, 0));
        v.checkpoint(id);
    }

    function test_checkpointRevertsWhenSourceReadFails() public {
        uint256 id = _create();
        src.breakIt();
        vm.warp(v.market(id).deadline);
        vm.expectRevert(abi.encodeWithSelector(Verdict.VerdictSourceRead.selector, 0));
        v.checkpoint(id);
    }

    function test_decodeReadsTheChosenWord() public {
        Verdict.Input[] memory xs = _inputs();
        xs[0] = Verdict.Input(address(src), abi.encodeCall(VSource.pair, ()), Verdict.Decode.Word, 1);
        uint256 id = v.createMarket(Verdict.NewMarket("q", pinId, layout, xs, uint64(block.timestamp + 1 days), WINDOW));
        src.set(1);
        uint256[] memory r = v.readInputs(id);
        assertEq(r[0], 1);
        assertEq(r[1], 1);

        xs[0].arg = 2; // pair() returns only two words
        id = v.createMarket(Verdict.NewMarket("q", pinId, layout, xs, uint64(block.timestamp + 1 days), WINDOW));
        vm.expectRevert(abi.encodeWithSelector(Verdict.VerdictSourceRead.selector, 0));
        v.readInputs(id);
    }

    // ------------------------------------------------------------------ settle and claim

    function test_settleYesAndClaimProRata() public {
        uint256 id = _create();
        _bet(id, alice, Verdict.Side.Yes, 30e6);
        _bet(id, bob, Verdict.Side.Yes, 10e6);
        _bet(id, carol, Verdict.Side.No, 60e6);
        _toCheckpoint(id); // source value 0 -> NAND(0, 1) = 1 -> YES
        (bytes memory input, bytes memory output) = v.evaluateStored(id);
        assertEq(input, hex"02");
        assertEq(output, hex"01");
        v.settle(id);
        assertEq(uint8(v.market(id).state), uint8(Verdict.State.Yes));

        assertEq(v.claimable(id, alice), 75e6);
        assertEq(v.claimable(id, bob), 25e6);
        assertEq(v.claimable(id, carol), 0);
        uint256 a0 = tok.balanceOf(alice);
        vm.prank(alice);
        v.claim(id);
        assertEq(tok.balanceOf(alice) - a0, 75e6);
        vm.prank(bob);
        v.claim(id);
        assertEq(tok.balanceOf(address(v)), 0);

        vm.prank(alice);
        vm.expectRevert(Verdict.VerdictNothingToPay.selector);
        v.claim(id);
        vm.prank(carol);
        vm.expectRevert(Verdict.VerdictNothingToPay.selector);
        v.claim(id);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(Verdict.VerdictWrongState.selector, Verdict.State.Yes));
        v.refund(id);
    }

    function test_settleNo() public {
        uint256 id = _create();
        _bet(id, alice, Verdict.Side.Yes, 30e6);
        _bet(id, bob, Verdict.Side.No, 10e6);
        src.set(1);
        _toCheckpoint(id); // NAND(1, 1) = 0 -> NO
        v.settle(id);
        assertEq(uint8(v.market(id).state), uint8(Verdict.State.No));
        vm.prank(bob);
        v.claim(id);
        assertEq(tok.balanceOf(bob), 1_000e6 + 30e6);
    }

    function test_settleNeedsCheckpointAndHappensOnce() public {
        uint256 id = _create();
        vm.expectRevert(abi.encodeWithSelector(Verdict.VerdictWrongState.selector, Verdict.State.Open));
        v.settle(id);
        vm.expectRevert(abi.encodeWithSelector(Verdict.VerdictWrongState.selector, Verdict.State.Open));
        v.evaluateStored(id);
        _bet(id, alice, Verdict.Side.Yes, 1e6);
        _bet(id, bob, Verdict.Side.No, 1e6);
        _toCheckpoint(id);
        v.settle(id);
        vm.expectRevert(abi.encodeWithSelector(Verdict.VerdictWrongState.selector, Verdict.State.Yes));
        v.settle(id);
        vm.expectRevert(Verdict.VerdictNothingToPay.selector);
        v.claim(id); // this contract has no stake
    }

    function test_settleNeedsEnoughGas() public {
        uint256 id = _create();
        _bet(id, alice, Verdict.Side.Yes, 1e6);
        _bet(id, bob, Verdict.Side.No, 1e6);
        _toCheckpoint(id);
        vm.expectRevert(Verdict.VerdictNotEnoughGas.selector);
        v.settle{gas: 600_000}(id);
    }

    // ------------------------------------------------------------------ refund paths

    function _refundAll(uint256 id) internal {
        vm.prank(alice);
        v.refund(id);
        vm.prank(bob);
        v.refund(id);
        assertEq(tok.balanceOf(alice), 1_000e6);
        assertEq(tok.balanceOf(bob), 1_000e6);
        assertEq(tok.balanceOf(address(v)), 0);
        vm.prank(alice);
        vm.expectRevert(Verdict.VerdictNothingToPay.selector);
        v.refund(id);
    }

    function _twoSided() internal returns (uint256 id) {
        id = _create();
        _bet(id, alice, Verdict.Side.Yes, 40e6);
        _bet(id, alice, Verdict.Side.No, 2e6);
        _bet(id, bob, Verdict.Side.No, 20e6);
    }

    function test_refundWhenNoCheckpointInWindow() public {
        uint256 id = _twoSided();
        vm.warp(v.market(id).deadline + WINDOW);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Verdict.VerdictWrongState.selector, Verdict.State.Open));
        v.refund(id); // still inside the window
        vm.warp(v.market(id).deadline + WINDOW + 1);
        assertEq(uint8(v.stuckReason(id)), uint8(Verdict.VoidReason.NoCheckpoint));
        _refundAll(id);
        assertEq(uint8(v.market(id).voidReason), uint8(Verdict.VoidReason.NoCheckpoint));
        vm.expectRevert(abi.encodeWithSelector(Verdict.VerdictWrongState.selector, Verdict.State.Void));
        v.checkpoint(id);
    }

    function test_refundWhenSourceCodeChanged() public {
        uint256 id = _twoSided();
        vm.etch(address(src), address(new VToken()).code);
        assertEq(uint8(v.stuckReason(id)), uint8(Verdict.VoidReason.SourceChanged));
        _refundAll(id);
        assertEq(uint8(v.market(id).voidReason), uint8(Verdict.VoidReason.SourceChanged));
        vm.expectRevert(Verdict.VerdictClosed.selector);
        _bet(id, carol, Verdict.Side.Yes, 1e6);
    }

    function test_refundWhenClosureChanged() public {
        uint256 id = _twoSided();
        _toCheckpoint(id);
        beacon.set(address(new MockImpl()));
        v.settle(id);
        assertEq(uint8(v.market(id).voidReason), uint8(Verdict.VoidReason.ClosureChanged));
        _refundAll(id);
    }

    function test_refundWhenEvalReverts() public {
        uint256 id = _twoSided();
        _toCheckpoint(id);
        p.setOut(1, "", true);
        v.settle(id);
        assertEq(uint8(v.market(id).voidReason), uint8(Verdict.VoidReason.EvalFailed));
        _refundAll(id);
    }

    function test_refundWhenValueDoesNotFitTheLayout() public {
        uint256 id = _twoSided();
        src.set(2); // a is a 1-bit field
        _toCheckpoint(id);
        v.settle(id);
        assertEq(uint8(v.market(id).voidReason), uint8(Verdict.VoidReason.EvalFailed));
        _refundAll(id);
    }

    function test_refundWhenOneSideEmpty() public {
        uint256 id = _create();
        _bet(id, alice, Verdict.Side.Yes, 40e6);
        _bet(id, bob, Verdict.Side.Yes, 20e6);
        _toCheckpoint(id);
        v.settle(id);
        assertEq(uint8(v.market(id).voidReason), uint8(Verdict.VoidReason.OneSided));
        _refundAll(id);
    }

    function test_refundNotBeforeVoid() public {
        uint256 id = _twoSided();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Verdict.VerdictWrongState.selector, Verdict.State.Open));
        v.refund(id);
        _toCheckpoint(id);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Verdict.VerdictWrongState.selector, Verdict.State.Checkpointed));
        v.refund(id);
    }
}
