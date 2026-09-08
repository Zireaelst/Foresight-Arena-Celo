// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ForesightPool} from "../src/ForesightPool.sol";
import {TestnetUSDC} from "../src/testnet/TestnetUSDC.sol";

contract TestnetUSDCTest is Test {
    TestnetUSDC internal token;

    address internal constant ALICE = address(0xA11CE);

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new TestnetUSDC();
    }

    /// @dev The pool rejects any stake token that is not 6-decimal, because its symbolic
    ///      limits are written in 6-decimal units. The stand-in must satisfy that too, or
    ///      testnet and mainnet limits would silently mean different amounts.
    function test_isAcceptedByThePool() public {
        ForesightPool pool = new ForesightPool(IERC20(address(token)), address(this));
        assertEq(address(pool.stakeToken()), address(token));
        assertEq(token.decimals(), 6);
    }

    function test_faucetMintsOnce_thenCoolsDown() public {
        token.faucet(ALICE);
        assertEq(token.balanceOf(ALICE), token.FAUCET_AMOUNT());

        vm.expectRevert(
            abi.encodeWithSelector(
                TestnetUSDC.FaucetCooldown.selector, block.timestamp + token.FAUCET_COOLDOWN()
            )
        );
        token.faucet(ALICE);
    }

    function test_faucetIsRateLimitedPerRecipientNotPerCaller() public {
        token.faucet(ALICE);
        // A different caller must not be able to top the same recipient up again;
        // otherwise the cooldown would cost an attacker only a second gas payer.
        vm.prank(address(0xB0B));
        vm.expectRevert();
        token.faucet(ALICE);
    }

    function test_faucetRefillsAfterCooldown() public {
        token.faucet(ALICE);
        vm.warp(block.timestamp + token.FAUCET_COOLDOWN());
        token.faucet(ALICE);
        assertEq(token.balanceOf(ALICE), 2 * token.FAUCET_AMOUNT());
    }

    function test_faucetAvailableAt_reportsZeroWhenReady() public {
        assertEq(token.faucetAvailableAt(ALICE), 0, "never tapped");
        token.faucet(ALICE);
        assertEq(token.faucetAvailableAt(ALICE), block.timestamp + token.FAUCET_COOLDOWN());
        vm.warp(block.timestamp + token.FAUCET_COOLDOWN());
        assertEq(token.faucetAvailableAt(ALICE), 0, "cooled down");
    }

    // -- EIP-3009 ------------------------------------------------------
    //
    // x402's "exact" EVM scheme settles by relaying a signed authorization, so these
    // tests pin the properties that make that safe: the signature must bind every field,
    // an authorization must work exactly once, and the time window must be enforced.

    uint256 internal constant PAYER_KEY = 0xA11CE5EED;

    function _sign(address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        address payer = vm.addr(PAYER_KEY);
        bytes32 structHash = keccak256(
            abi.encode(
                token.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), payer, to, value, validAfter, validBefore, nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(PAYER_KEY, digest);
    }

    function test_transferWithAuthorization_movesFundsWithoutPayerGas() public {
        address payer = vm.addr(PAYER_KEY);
        address merchant = address(0xBEEF);
        token.faucet(payer);

        bytes32 nonce = keccak256("invoice-1");
        (uint8 v, bytes32 r, bytes32 s) = _sign(merchant, 1e6, 0, block.timestamp + 600, nonce);

        // Submitted by a third party -- the facilitator -- not by the payer.
        vm.prank(address(0xFACC));
        token.transferWithAuthorization(payer, merchant, 1e6, 0, block.timestamp + 600, nonce, v, r, s);

        assertEq(token.balanceOf(merchant), 1e6);
        assertTrue(token.authorizationState(payer, nonce));
    }

    function test_transferWithAuthorization_isSingleUse() public {
        address payer = vm.addr(PAYER_KEY);
        address merchant = address(0xBEEF);
        token.faucet(payer);

        bytes32 nonce = keccak256("invoice-2");
        (uint8 v, bytes32 r, bytes32 s) = _sign(merchant, 1e6, 0, block.timestamp + 600, nonce);
        token.transferWithAuthorization(payer, merchant, 1e6, 0, block.timestamp + 600, nonce, v, r, s);

        vm.expectRevert(TestnetUSDC.AuthorizationAlreadyUsed.selector);
        token.transferWithAuthorization(payer, merchant, 1e6, 0, block.timestamp + 600, nonce, v, r, s);
    }

    function test_transferWithAuthorization_rejectsTamperedAmount() public {
        address payer = vm.addr(PAYER_KEY);
        address merchant = address(0xBEEF);
        token.faucet(payer);

        bytes32 nonce = keccak256("invoice-3");
        (uint8 v, bytes32 r, bytes32 s) = _sign(merchant, 1e6, 0, block.timestamp + 600, nonce);

        // A relayer that inflates the amount must not be able to reuse the signature.
        vm.expectRevert(TestnetUSDC.InvalidSignature.selector);
        token.transferWithAuthorization(payer, merchant, 5e6, 0, block.timestamp + 600, nonce, v, r, s);
    }

    function test_transferWithAuthorization_enforcesTheTimeWindow() public {
        address payer = vm.addr(PAYER_KEY);
        address merchant = address(0xBEEF);
        token.faucet(payer);

        bytes32 nonce = keccak256("invoice-4");
        uint256 validBefore = block.timestamp + 100;
        (uint8 v, bytes32 r, bytes32 s) = _sign(merchant, 1e6, 0, validBefore, nonce);

        vm.warp(validBefore + 1);
        vm.expectRevert(TestnetUSDC.AuthorizationExpired.selector);
        token.transferWithAuthorization(payer, merchant, 1e6, 0, validBefore, nonce, v, r, s);
    }

    function test_cancelAuthorization_burnsItBeforeUse() public {
        address payer = vm.addr(PAYER_KEY);
        address merchant = address(0xBEEF);
        token.faucet(payer);

        bytes32 nonce = keccak256("invoice-5");
        (uint8 v, bytes32 r, bytes32 s) = _sign(merchant, 1e6, 0, block.timestamp + 600, nonce);

        bytes32 cancelStruct = keccak256(abi.encode(token.CANCEL_AUTHORIZATION_TYPEHASH(), payer, nonce));
        bytes32 cancelDigest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), cancelStruct));
        (uint8 cv, bytes32 cr, bytes32 cs) = vm.sign(PAYER_KEY, cancelDigest);
        token.cancelAuthorization(payer, nonce, cv, cr, cs);

        vm.expectRevert(TestnetUSDC.AuthorizationAlreadyUsed.selector);
        token.transferWithAuthorization(payer, merchant, 1e6, 0, block.timestamp + 600, nonce, v, r, s);
    }
}
