// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PinRegistry} from "../src/core/PinRegistry.sol";
import {Catalog} from "../src/core/Catalog.sol";
import {Schema} from "../src/core/Schema.sol";
import {ITapeOutFactory, ITapeOutProcessor} from "../src/core/interfaces/ITapeOut.sol";

/// Fork test on live X Layer: listing the one-NAND circuit with test vectors run on-chain.
contract FengceCatalogForkTest is Test {
    ITapeOutFactory constant TAPEOUT = ITapeOutFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);
    address constant NAND_CPU = 0x839bdD6fa7A66416A609A735e11DE5411B98574e;

    PinRegistry reg;
    Catalog catalog;
    bytes32 pinId;
    bytes32 schemaHash;
    address designer = makeAddr("designer");
    address treasury = makeAddr("treasury");

    function setUp() public {
        vm.createSelectFork("xlayer");
        reg = new PinRegistry(TAPEOUT);
        catalog = new Catalog(reg, 2_000_000, treasury);
        Schema.Layout memory l;
        l.netlistHash = keccak256(ITapeOutProcessor(NAND_CPU).netlist(2));
        l.nIn = 2;
        l.fields = new Schema.Field[](2);
        l.fields[0] = Schema.Field(Schema.Kind.Bool, 0, 1, 0);
        l.fields[1] = Schema.Field(Schema.Kind.Flag, 1, 1, 1);
        schemaHash = Schema.hash(l);
        pinId = reg.pin(NAND_CPU, 2, schemaHash, keccak256("certificate"));
    }

    function _manifest(bytes memory secondExpected) internal view returns (Catalog.Manifest memory m) {
        m.pinId = pinId;
        m.description = "Allow if amount <= 100 (input a = amount > 100, input b = 1).";
        m.schemaHash = schemaHash;
        m.vectors = new Catalog.Vector[](2);
        m.vectors[0] = Catalog.Vector(hex"02", hex"01"); // a = 0: allow
        m.vectors[1] = Catalog.Vector(hex"03", secondExpected); // a = 1: deny
        m.designer = designer;
        m.installFee = 1 ether;
    }

    function test_listingWithWrongVectorReverts() public {
        Catalog.Manifest memory m = _manifest(hex"01"); // claims a = 1 is allowed: false
        vm.expectRevert(abi.encodeWithSelector(Catalog.CatalogVectorMismatch.selector, 1, hex"00"));
        catalog.list(m);
        assertEq(catalog.count(), 0);
    }

    function test_nandTierEqualsQuote() public {
        catalog.list(_manifest(hex"00"));
        Catalog.Entry memory e = catalog.entryOf(pinId);
        assertEq(e.allowVectors, 1);
        assertEq(e.denyVectors, 1);
        assertGt(e.measuredGas, 0);
        assertEq(e.certificateHash, keccak256("certificate"));
        // The Quote certificate for this circuit (sdk/quotes/nand-839bdd-2.json) says Green.
        string memory quoteTier = vm.parseJsonString(vm.readFile("sdk/quotes/nand-839bdd-2.json"), ".certificate.tier");
        assertEq(quoteTier, "Green");
        assertEq(uint256(e.tier), uint256(Catalog.Tier.Green));
    }

    function test_installFeeSplit() public {
        catalog.list(_manifest(hex"00"));
        address payer = makeAddr("safe");
        vm.deal(payer, 1 ether);
        vm.expectEmit(address(catalog));
        emit Catalog.FeePaid(pinId, payer, designer, 0.8 ether, 0.2 ether);
        vm.prank(payer);
        catalog.payInstall{value: 1 ether}(pinId);
        assertEq(catalog.balances(designer), 0.8 ether);
        assertEq(catalog.balances(treasury), 0.2 ether);

        vm.prank(designer);
        catalog.withdraw();
        assertEq(designer.balance, 0.8 ether);
        vm.prank(treasury);
        catalog.withdraw();
        assertEq(treasury.balance, 0.2 ether);

        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(Catalog.CatalogWrongFee.selector, 0, 1 ether));
        catalog.payInstall(pinId);
    }
}
